/**
 * WebRTC Voice Chat Manager
 * Handles capturing local microphone, maintaining PeerConnections for all users in a room,
 * and playing incoming audio streams.
 */

class WebRTCVoiceManager {
  constructor() {
    this.localStream = null;
    this.peers = new Map(); // socketId -> RTCPeerConnection
    this.roomId = null;
    
    // UI Elements
    this.btnMicToggle = document.getElementById('btnMicToggle');
    this.audioContainer = document.getElementById('audioPeersContainer');
    this.isMuted = false;

    // Use Google's public STUN servers for standard NAT traversal
    // Use OpenRelay TURN servers for strict firewalls/Symmetric NAT (Cellular Data)
    this.iceServers = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turn:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ]
    };

    if (this.btnMicToggle) {
      this.btnMicToggle.addEventListener('click', () => this.toggleMic());
    }

    this.setupSocketListeners();
  }

  setupSocketListeners() {
    // When another user announces they joined the voice chat
    socket.on('webrtc-join', async ({ socketId }) => {
      console.log(`🎤 Peer ${socketId} joined voice chat. Initiating connection...`);
      // The existing user initiates the offer to the new user
      await this.createPeerConnection(socketId, true);
    });

    // Receive an offer from another user
    socket.on('webrtc-offer', async ({ socketId, offer }) => {
      console.log(`🎤 Received offer from ${socketId}`);
      const pc = await this.createPeerConnection(socketId, false);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      socket.emit('webrtc-answer', { targetSocketId: socketId, answer });
    });

    // Receive an answer from a user we sent an offer to
    socket.on('webrtc-answer', async ({ socketId, answer }) => {
      console.log(`🎤 Received answer from ${socketId}`);
      const pc = this.peers.get(socketId);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    // Receive ICE candidates for NAT traversal
    socket.on('webrtc-ice-candidate', async ({ socketId, candidate }) => {
      const pc = this.peers.get(socketId);
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error('Error adding received ice candidate', e);
        }
      }
    });

    // When a user leaves the room or disconnects
    socket.on('webrtc-leave', ({ socketId }) => {
      console.log(`🎤 Peer ${socketId} left voice chat.`);
      this.removePeer(socketId);
    });
  }

  async joinRoom(roomId) {
    this.roomId = roomId;
    
    // Request microphone access
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
           alert('Voice chat requires a secure HTTPS connection on mobile devices. (Browser security policy).');
        }
        throw new Error('WebRTC not supported or requires HTTPS');
      }
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      
      if (this.btnMicToggle) {
        this.btnMicToggle.style.display = 'inline-flex';
        this.updateMicUI();
      }

      console.log('🎤 Microphone access granted. Joining voice room...');
      // Tell server we are ready for voice chat
      socket.emit('webrtc-join', { roomId });

    } catch (err) {
      console.error('🎤 Microphone access denied or not available:', err);
      if (this.btnMicToggle) {
        // Do not hide the button; allow the user to tap it to retry (solves iOS Safari user-gesture requirement)
        this.btnMicToggle.style.display = 'inline-flex';
        this.btnMicToggle.className = 'btn-icon mic-muted';
        this.btnMicToggle.innerText = '❌';
        this.btnMicToggle.title = 'Tap to Connect Voice';
      }
    }
  }

  leaveRoom() {
    if (this.roomId) {
      socket.emit('webrtc-leave', { roomId: this.roomId });
    }
    
    // Close all peer connections
    for (const [socketId, pc] of this.peers.entries()) {
      pc.close();
      this.removeAudioElement(socketId);
    }
    this.peers.clear();
    
    // Stop local mic stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    if (this.btnMicToggle) {
      this.btnMicToggle.style.display = 'none';
    }
    
    this.roomId = null;
  }

  toggleMic() {
    if (!this.localStream) {
      // If we don't have a stream (e.g., it failed initially due to missing user gesture on mobile), try joining again!
      if (this.roomId) {
        this.joinRoom(this.roomId);
      }
      return;
    }
    
    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach(track => {
      track.enabled = !this.isMuted;
    });
    
    this.updateMicUI();
  }

  updateMicUI() {
    if (!this.btnMicToggle) return;
    
    if (this.isMuted) {
      this.btnMicToggle.className = 'btn-icon mic-muted';
      this.btnMicToggle.innerText = '🔇';
      this.btnMicToggle.title = 'Unmute Microphone';
    } else {
      this.btnMicToggle.className = 'btn-icon mic-active';
      this.btnMicToggle.innerText = '🎤';
      this.btnMicToggle.title = 'Mute Microphone';
    }
  }

  async createPeerConnection(targetSocketId, isInitiator) {
    if (this.peers.has(targetSocketId)) {
      return this.peers.get(targetSocketId);
    }

    const pc = new RTCPeerConnection(this.iceServers);
    this.peers.set(targetSocketId, pc);

    // Add local stream tracks to the connection
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    // Send ICE candidates to the other peer
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-ice-candidate', {
          targetSocketId,
          candidate: event.candidate
        });
      }
    };

    // When we receive an audio track from the peer, create an <audio> element
    pc.ontrack = (event) => {
      this.addAudioElement(targetSocketId, event.streams[0]);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        console.error('WebRTC Connection Failed. Symmetric NAT / Strict Firewall detected.');
        alert('Voice chat connection failed. Your mobile carrier or Wi-Fi firewall may be blocking direct P2P connections (Symmetric NAT).');
        this.removePeer(targetSocketId);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
        this.removePeer(targetSocketId);
      }
    };

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc-offer', { targetSocketId, offer });
    }

    return pc;
  }

  addAudioElement(socketId, stream) {
    let audioElement = document.getElementById(`audio-peer-${socketId}`);
    if (!audioElement) {
      audioElement = document.createElement('audio');
      audioElement.id = `audio-peer-${socketId}`;
      audioElement.autoplay = true;
      audioElement.playsInline = true; // Required for iOS Safari WebRTC playback
      this.audioContainer.appendChild(audioElement);
    }
    audioElement.srcObject = stream;
    
    // Explicitly call play to handle Safari autoplay restrictions
    audioElement.play().catch(err => {
      console.warn("Autoplay prevented for remote audio stream:", err);
    });
  }

  removeAudioElement(socketId) {
    const audioElement = document.getElementById(`audio-peer-${socketId}`);
    if (audioElement) {
      audioElement.srcObject = null;
      audioElement.remove();
    }
  }

  removePeer(socketId) {
    const pc = this.peers.get(socketId);
    if (pc) {
      pc.close();
      this.peers.delete(socketId);
    }
    this.removeAudioElement(socketId);
  }
}

// Global instance
const VoiceManager = new WebRTCVoiceManager();
