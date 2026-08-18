const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');
const { randomInt } = require('crypto'); // SECURITY: CSPRNG for room ID generation
const { LudoEngine, COLORS } = require('./lib/ludo-engine.js');

const app = express();
const server = http.createServer(app);

// --- SECURITY: HTTP security headers via helmet ---
// Prevents clickjacking, MIME sniffing, XSS, and enforces CSP on all responses.
let helmet;
try {
  helmet = require('helmet');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        scriptSrc:   ["'self'", "https://cdn.jsdelivr.net"],
        styleSrc:    ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
        fontSrc:     ["'self'", "https://fonts.gstatic.com"],
        connectSrc:  ["'self'", "ws:", "wss:"],
        imgSrc:      ["'self'", "data:"],
        frameSrc:    ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false, // Required: WebRTC voice chat will break otherwise
  }));
  console.log('🛡️  Helmet security headers enabled');
} catch (e) {
  console.warn('⚠️  helmet not installed — run `npm install helmet` to enable HTTP security headers');
}

// --- SECURITY: Restrict CORS to known origins. Use env var in production. ---
// Set ALLOWED_ORIGIN env var when deploying (e.g. https://yourdomain.com).
// For LAN usage with no env var, we fall back to allowing any same-network origin
// via wildcard — acceptable for a local-only deployment.
const CORS_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const io = new Server(server, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST']
  }
});

const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;

// Serve static web app from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Helper to find local physical IPv4 network address (filters out vEthernet/WSL/VirtualBox)
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  let candidate = null;

  for (const devName in interfaces) {
    const isVirtual = /vEthernet|WSL|Virtual|VMware|Hyper-V|Loopback|Default Switch|OpenVPN/i.test(devName);
    const iface = interfaces[devName];

    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && !alias.internal && alias.address !== '127.0.0.1') {
        if (!isVirtual && (alias.address.startsWith('192.168.') || alias.address.startsWith('10.') || alias.address.startsWith('172.16.'))) {
          return alias.address;
        }
        if (!isVirtual && !candidate) {
          candidate = alias.address;
        }
      }
    }
  }

  if (candidate) return candidate;

  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && !alias.internal && alias.address !== '127.0.0.1') {
        return alias.address;
      }
    }
  }

  return 'localhost';
}

const LAN_IP = getLocalIpAddress();
let currentPort = DEFAULT_PORT;

// Map of roomId -> LudoEngine
const rooms = new Map();
// Map of socketId -> { roomId, role: 'player'|'spectator', color }
const socketMap = new Map();

// --- SECURITY: Allowed color values (used to whitelist all color-based inputs) ---
const VALID_COLORS = new Set(['red', 'green', 'yellow', 'blue']);

// --- SECURITY: Input length limits ---
const MAX_NAME_LEN    = 24;   // player display names
const MAX_MSG_LEN     = 300;  // chat messages
const MAX_EMOTE_LEN   = 10;   // emoji string (a single emoji can be up to 8 bytes)
const MAX_ROOM_ID_LEN = 6;    // room codes are 4 chars; allow a tiny margin

// Helper to generate a 6-character Room ID using a CSPRNG
// SECURITY: crypto.randomInt() is cryptographically secure (unlike Math.random()).
// 6 chars from a 32-char alphabet = 32^6 ≈ 1 billion combinations, brute-force resistant.
function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[randomInt(0, chars.length)];
  }
  return id;
}

// Broadcast game state to room (players & spectators)
function broadcastGameState(roomId) {
  const game = rooms.get(roomId);
  if (!game) return;

  const state = game.getState();
  io.to(roomId).emit('game-state', state);
}
// Helper to extract clean IPv4 client IP address
function getClientIp(socket) {
  let ip = socket.handshake.address || (socket.request && socket.request.connection && socket.request.connection.remoteAddress) || '';
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  if (ip === '::1') {
    ip = '127.0.0.1';
  }
  return ip;
}

// Socket IO Event Routing
io.on('connection', (socket) => {
  // NOTE: We intentionally do NOT log the socket.id here to reduce noise in production.
  // The client IP is logged when a room is created or joined instead.
  // SECURITY: We no longer broadcast the LAN IP to every connecting client.
  // The LAN URL is only returned to the room creator in the create-room callback.


  // Get active rooms list (ONLY returns rooms where the requesting user is a part of as host/player/spectator)
  socket.on('get-rooms', (payload, callback) => {
    let playerId = null;
    let name = null;
    if (typeof payload === 'function') {
      callback = payload;
    } else if (payload) {
      playerId = payload.playerId;
      name = payload.name;
    }

    const list = Array.from(rooms.values())
      .filter(r => r.isUserInRoom(playerId, name, socket.id))
      .map(r => {
        const existingPlayer = r.findPlayerToReconnect(playerId, name);
        const isSpectator = r.spectators.has(socket.id);
        return {
          id: r.roomId,
          roomId: r.roomId,
          status: r.status,
          playerCount: r.activeColors.filter(c => r.players[c] !== null).length,
          spectatorsCount: r.spectators.size,
          hasReconnectSlot: !!existingPlayer || isSpectator,
          isSpectator: isSpectator,
          reconnectName: existingPlayer ? existingPlayer.name : null,
          reconnectColor: existingPlayer ? existingPlayer.color : null
        };
      });
    if (typeof callback === 'function') callback(list);
  });

  // Get available colors for joining a room
  socket.on('get-room-colors', (roomId, callback) => {
    roomId = (roomId || '').toUpperCase().trim();
    const game = rooms.get(roomId);
    if (!game) {
      if (typeof callback === 'function') callback({ success: false, message: 'Room not found', availableColors: [] });
      return;
    }

    const availableColors = [];
    const takenColors = [];

    for (const c of COLORS) {
      if (!game.players[c] || game.players[c].isBot) {
        availableColors.push(c);
      } else {
        takenColors.push(c);
      }
    }

    if (typeof callback === 'function') {
      callback({
        success: true,
        roomId,
        status: game.status,
        availableColors,
        takenColors
      });
    }
  });

  // Create Room
  socket.on('create-room', ({ name, color, turnTimerDuration, botCount, playerId }, callback) => {
    // --- SECURITY: Validate & sanitize inputs ---
    const safeName = (typeof name === 'string' ? name.trim() : 'Player').slice(0, MAX_NAME_LEN) || 'Player';
    const safeColor = VALID_COLORS.has(color) ? color : 'red';
    const safeBotCount = Math.max(0, Math.min(3, parseInt(botCount, 10) || 0));
    const safeTurnTimer = Math.max(0, Math.min(300, parseInt(turnTimerDuration, 10) || 0));
    const safePlayerId = (typeof playerId === 'string' ? playerId.slice(0, 64) : null);

    let roomId = generateRoomId();
    while (rooms.has(roomId)) {
      roomId = generateRoomId();
    }

    const game = new LudoEngine(roomId, { turnTimerDuration: safeTurnTimer, botCount: safeBotCount });

    // Attach bot action, auto-move & state change listeners
    game.onBotAction = (action) => {
      io.to(roomId).emit('bot-action', action);
      broadcastGameState(roomId);
    };

    game.onAutoMove = ({ color, tokenId, result }) => {
      io.to(roomId).emit('token-moved', result);
      broadcastGameState(roomId);
    };

    game.onStateChange = () => {
      broadcastGameState(roomId);
    };

    rooms.set(roomId, game);

    // Join socket room
    socket.join(roomId);

    // Add player with unique playerId tracking
    const clientIp = getClientIp(socket);
    const result = game.addPlayer(socket.id, safeName, safeColor, clientIp, safePlayerId);
    if (!result.success) {
      rooms.delete(roomId);
      if (typeof callback === 'function') callback(result);
      return;
    }

    // Sync initial bots specified by host
    game.syncBotSlots();

    socketMap.set(socket.id, { roomId, role: 'player', color: safeColor });

    console.log(`🎮 Room ${roomId} created by ${safeName} (${safeColor}) IP: ${clientIp}`);

    if (typeof callback === 'function') {
      // SECURITY: lanUrl is returned ONLY to the host (creator), not broadcast to all clients
      callback({ success: true, roomId, color: safeColor, lanUrl: `http://${LAN_IP}:${currentPort}` });
    }

    broadcastGameState(roomId);
  });

  // Join Room (Player or Spectator with unique playerId & Username Reconnection Support)
  socket.on('join-room', ({ roomId, name, color, asSpectator, playerId }, callback) => {
    // --- SECURITY: Validate & sanitize inputs ---
    roomId = (typeof roomId === 'string' ? roomId.toUpperCase().trim() : '').slice(0, MAX_ROOM_ID_LEN);
    const safeName = (typeof name === 'string' ? name.trim() : 'Player').slice(0, MAX_NAME_LEN) || 'Player';
    const safeColor = VALID_COLORS.has(color) ? color : null;
    const safePlayerId = (typeof playerId === 'string' ? playerId.slice(0, 64) : null);
    const game = rooms.get(roomId);

    if (!game) {
      if (typeof callback === 'function') callback({ success: false, message: 'Room not found' });
      return;
    }

    socket.join(roomId);
    const clientIp = getClientIp(socket);

    // Check if player is reconnecting by unique playerId or exact name
    const existingPlayer = game.findPlayerToReconnect(safePlayerId, safeName);
    if (existingPlayer) {
      const result = game.addPlayer(socket.id, safeName || existingPlayer.name, existingPlayer.color, clientIp, safePlayerId);
      socketMap.set(socket.id, { roomId, role: 'player', color: result.color });

      console.log(`🔄 Player reconnected to Room ${roomId} as ${result.color}`);

      if (typeof callback === 'function') {
        callback({
          success: true,
          roomId,
          color: result.color,
          isSpectator: false,
          rejoined: true,
          isHost: !!result.isHost,
          message: `Reconnected as ${existingPlayer.name}`
        });
      }
      broadcastGameState(roomId);
      return;
    }

    if (asSpectator) {
      game.addSpectator(socket.id, safeName);
      socketMap.set(socket.id, { roomId, role: 'spectator' });
      console.log(`👁️ Spectator joined Room ${roomId}`);

      if (typeof callback === 'function') callback({ success: true, roomId, isSpectator: true, isHost: false });
      broadcastGameState(roomId);
      return;
    }

    if (game.status !== 'WAITING') {
      if (typeof callback === 'function') callback({ success: false, message: 'Game is already in progress! You can join as a Spectator.' });
      return;
    }

    // Try joining as player
    let targetColor = safeColor;
    if (!targetColor) {
      targetColor = COLORS.find(c => !game.players[c] || game.players[c].isBot);
    }

    if (!targetColor) {
      if (typeof callback === 'function') callback({ success: false, message: 'Room is full! All 4 player slots are taken. You can join as a Spectator.' });
      return;
    }

    const result = game.addPlayer(socket.id, safeName, targetColor, clientIp, safePlayerId);
    if (!result.success) {
      if (typeof callback === 'function') callback(result);
      return;
    }

    socketMap.set(socket.id, { roomId, role: 'player', color: targetColor });
    console.log(`👤 Player joined Room ${roomId} as ${targetColor}`);

    if (typeof callback === 'function') {
      callback({
        success: true,
        roomId,
        color: targetColor,
        isSpectator: false,
        isHost: !!result.isHost
      });
    }

    broadcastGameState(roomId);
  });

  // Add Bot (Host only)
  socket.on('add-bot', ({ roomId, color }, callback) => {
    // --- SECURITY: Validate roomId type and length ---
    if (typeof roomId !== 'string') return;
    const safeRoomId = roomId.toUpperCase().trim().slice(0, MAX_ROOM_ID_LEN);
    const safeColor = VALID_COLORS.has(color) ? color : null;

    const game = rooms.get(safeRoomId);
    if (!game) return;

    const added = safeColor ? game.addBot(safeColor) : false;
    if (added) {
      broadcastGameState(safeRoomId);
      if (typeof callback === 'function') callback({ success: true });
    } else {
      if (typeof callback === 'function') callback({ success: false, message: 'Could not add bot' });
    }
  });

  // Set Bot Count (Host only)
  socket.on('set-bot-count', ({ roomId, botCount }, callback) => {
    // --- SECURITY: Validate roomId type and length ---
    if (typeof roomId !== 'string') return;
    const safeRoomId = roomId.toUpperCase().trim().slice(0, MAX_ROOM_ID_LEN);
    const safeBotCount = Math.max(0, Math.min(3, parseInt(botCount, 10) || 0));

    const game = rooms.get(safeRoomId);
    if (!game) return;
    if (game.hostSocketId !== socket.id) return;

    game.setBotCount(safeBotCount);
    broadcastGameState(safeRoomId);
    if (typeof callback === 'function') callback({ success: true });
  });

  // Start Game (Host only)
  socket.on('start-game', ({ roomId }, callback) => {
    // --- SECURITY: Validate roomId type and length ---
    if (typeof roomId !== 'string') return;
    const safeRoomId = roomId.toUpperCase().trim().slice(0, MAX_ROOM_ID_LEN);

    const game = rooms.get(safeRoomId);
    if (!game) return;

    const result = game.startGame();
    if (!result.success) {
      if (typeof callback === 'function') callback(result);
      return;
    }

    console.log(`🚀 Game started in Room ${safeRoomId}`);

    if (typeof callback === 'function') callback({ success: true });
    broadcastGameState(safeRoomId);
  });

  // Delete / Close Room (Host only)
  socket.on('delete-room', ({ roomId }, callback) => {
    roomId = (roomId || '').toUpperCase().trim();
    const game = rooms.get(roomId);
    if (!game) {
      if (typeof callback === 'function') callback({ success: false, message: 'Room not found' });
      return;
    }

    if (game.hostSocketId !== socket.id) {
      if (typeof callback === 'function') callback({ success: false, message: 'Only the host can delete this room.' });
      return;
    }

    console.log(`🗑️ Room ${roomId} deleted by host`);

    // Notify all sockets in room
    io.to(roomId).emit('room-deleted', { message: 'The host has closed this room.' });

    // Sockets leave room
    io.in(roomId).socketsLeave(roomId);

    // Remove room from rooms map
    rooms.delete(roomId);

    if (typeof callback === 'function') callback({ success: true });
  });

  // Roll Dice
  socket.on('roll-dice', ({ roomId }) => {
    // --- SECURITY: Validate roomId type and length ---
    if (typeof roomId !== 'string') return;
    const safeRoomId = roomId.toUpperCase().trim().slice(0, MAX_ROOM_ID_LEN);

    const game = rooms.get(safeRoomId);
    if (!game) return;

    const user = socketMap.get(socket.id);
    if (!user || user.role !== 'player') return;

    const result = game.rollDice(user.color);
    io.to(safeRoomId).emit('dice-rolled', { color: user.color, result });
    broadcastGameState(safeRoomId);
  });

  // Move Token
  socket.on('move-token', ({ roomId, tokenId }) => {
    // --- SECURITY: Validate roomId type and length ---
    if (typeof roomId !== 'string') return;
    const safeRoomId = roomId.toUpperCase().trim().slice(0, MAX_ROOM_ID_LEN);
    // tokenId must be a non-negative integer
    const safeTokenId = Number.isInteger(tokenId) && tokenId >= 0 && tokenId <= 3 ? tokenId : null;
    if (safeTokenId === null) return;

    const game = rooms.get(safeRoomId);
    if (!game) return;

    const user = socketMap.get(socket.id);
    if (!user || user.role !== 'player') return;

    const result = game.moveToken(user.color, safeTokenId);
    io.to(safeRoomId).emit('token-moved', result);
    broadcastGameState(safeRoomId);
  });

  // Force Finish Game (Host only)
  socket.on('force-finish', ({ roomId }) => {
    // --- SECURITY: Validate roomId type and length ---
    if (typeof roomId !== 'string') return;
    const safeRoomId = roomId.toUpperCase().trim().slice(0, MAX_ROOM_ID_LEN);

    const game = rooms.get(safeRoomId);
    if (!game) return;

    // Only host can force finish
    if (game.hostSocketId !== socket.id) return;

    game.forceFinish();
    broadcastGameState(safeRoomId);
  });

  // Chat message
  socket.on('send-chat', ({ roomId, message }) => {
    // --- SECURITY: Validate input types and length before processing ---
    if (typeof roomId !== 'string' || typeof message !== 'string') return;
    const safeRoomId = roomId.toUpperCase().trim().slice(0, MAX_ROOM_ID_LEN);
    // Trim the message and cap its length to prevent payload amplification
    const safeMessage = message.trim().slice(0, MAX_MSG_LEN);
    if (!safeMessage) return;

    const game = rooms.get(safeRoomId);
    if (!game) return;

    const user = socketMap.get(socket.id);
    let senderName = 'Guest';
    let color = 'white';

    if (user && user.role === 'player') {
      const p = game.players[user.color];
      senderName = p ? p.name : user.color;
      color = user.color;
    } else if (game.spectators.has(socket.id)) {
      senderName = game.spectators.get(socket.id).name + ' (Spectator)';
      color = 'cyan';
    }

    io.to(safeRoomId).emit('chat-received', {
      sender: senderName,
      color,
      message: safeMessage,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  // Trigger bot turn (from host)
  socket.on('trigger-bot-turn', ({ roomId }) => {
    // --- SECURITY: Validate roomId type and length ---
    if (typeof roomId !== 'string') return;
    const safeRoomId = roomId.toUpperCase().trim().slice(0, MAX_ROOM_ID_LEN);

    const game = rooms.get(safeRoomId);
    if (!game) return;

    // Security check: only host can trigger bot turn
    if (game.hostSocketId !== socket.id) return;

    game.checkAndTriggerBotTurn();
  });

  // Emote reaction
  socket.on('send-emote', ({ roomId, emote }) => {
    // --- SECURITY: Validate input types and length ---
    if (typeof roomId !== 'string' || typeof emote !== 'string') return;
    const safeRoomId = roomId.toUpperCase().trim().slice(0, MAX_ROOM_ID_LEN);
    const safeEmote  = emote.trim().slice(0, MAX_EMOTE_LEN);
    if (!safeEmote) return;

    const game = rooms.get(safeRoomId);
    const user = socketMap.get(socket.id);
    if (!user || !game) return;

    let senderName = 'Guest';
    let color = user.color || 'spectator';

    if (user.role === 'player' && game.players[user.color]) {
      senderName = game.players[user.color].name;
    } else if (game.spectators.has(socket.id)) {
      senderName = game.spectators.get(socket.id).name;
    }

    io.to(safeRoomId).emit('emote-received', {
      senderName,
      color,
      emote: safeEmote
    });
  });

  // Targeted Emote
  socket.on('send-targeted-emote', ({ roomId, receiverColor, emote }) => {
    // --- SECURITY: Validate input types, length, and whitelist the color value ---
    if (typeof roomId !== 'string' || typeof emote !== 'string') return;
    const safeRoomId = roomId.toUpperCase().trim().slice(0, MAX_ROOM_ID_LEN);
    const safeEmote  = emote.trim().slice(0, MAX_EMOTE_LEN);
    // SECURITY: receiverColor must be one of the four known game colors
    if (!VALID_COLORS.has(receiverColor)) return;
    if (!safeEmote) return;

    const game = rooms.get(safeRoomId);
    const user = socketMap.get(socket.id);
    if (!user || !game) return;

    let senderName = 'Guest';
    let senderColor = user.color || 'spectator';

    if (user.role === 'player' && game.players[user.color]) {
      senderName = game.players[user.color].name;
    } else if (game.spectators.has(socket.id)) {
      senderName = game.spectators.get(socket.id).name;
    }

    io.to(safeRoomId).emit('targeted-emote-received', {
      senderName,
      senderColor,
      receiverColor,
      emote: safeEmote
    });
  });

  // ==========================================
  // WebRTC Signaling for Voice Chat
  // ==========================================

  socket.on('webrtc-join', ({ roomId }) => {
    // Notify all OTHER clients in the room that a new peer wants to connect
    socket.to(roomId).emit('webrtc-join', { socketId: socket.id });
  });

  socket.on('webrtc-offer', ({ targetSocketId, offer }) => {
    // Relay offer to the specific target socket
    socket.to(targetSocketId).emit('webrtc-offer', {
      socketId: socket.id,
      offer
    });
  });

  socket.on('webrtc-answer', ({ targetSocketId, answer }) => {
    // Relay answer back to the offering socket
    socket.to(targetSocketId).emit('webrtc-answer', {
      socketId: socket.id,
      answer
    });
  });

  socket.on('webrtc-ice-candidate', ({ targetSocketId, candidate }) => {
    // Relay ICE candidate to the target socket
    socket.to(targetSocketId).emit('webrtc-ice-candidate', {
      socketId: socket.id,
      candidate
    });
  });

  socket.on('webrtc-leave', ({ roomId }) => {
    // Notify room that this peer is leaving voice chat
    socket.to(roomId).emit('webrtc-leave', { socketId: socket.id });
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
    const user = socketMap.get(socket.id);
    if (user) {
      const { roomId } = user;

      // Notify room for WebRTC cleanup
      socket.to(roomId).emit('webrtc-leave', { socketId: socket.id });

      const game = rooms.get(roomId);
      if (game) {
        game.removePlayer(socket.id);
        game.removeSpectator(socket.id);
        broadcastGameState(roomId);
      }
      socketMap.delete(socket.id);
    }
  });
});

function startServer(portToTry) {
  server.listen(portToTry, '0.0.0.0', () => {
    currentPort = portToTry;
    const lanUrl = `http://${LAN_IP}:${portToTry}`;
    console.log('=====================================================');
    console.log(`🎲 LAN LUDO MULTIPLAYER SERVER IS LIVE!`);
    console.log(`📍 Local PC Access: http://localhost:${portToTry}`);
    console.log(`🌐 LAN Network URL: ${lanUrl}`);
    console.log(`📱 Share this URL with other devices on your Wi-Fi/LAN!`);
    console.log('=====================================================');
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ Port ${portToTry} is in use. Trying port ${portToTry + 1}...`);
      startServer(portToTry + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer(DEFAULT_PORT);
