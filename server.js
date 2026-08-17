const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');
const { LudoEngine, COLORS } = require('./lib/ludo-engine.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
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

// Helper to generate 4-character Room ID
function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 4; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
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
  console.log(`🔌 Client connected: ${socket.id} (IP: ${getClientIp(socket)})`);

  // Send network LAN URL to client
  socket.emit('network-info', {
    lanIp: LAN_IP,
    port: currentPort,
    lanUrl: `http://${LAN_IP}:${currentPort}`
  });

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
    let roomId = generateRoomId();
    while (rooms.has(roomId)) {
      roomId = generateRoomId();
    }

    const game = new LudoEngine(roomId, { turnTimerDuration, botCount });
    
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
    const chosenColor = color || 'red';
    const clientIp = getClientIp(socket);
    const result = game.addPlayer(socket.id, name, chosenColor, clientIp, playerId);
    if (!result.success) {
      rooms.delete(roomId);
      if (typeof callback === 'function') callback(result);
      return;
    }
    
    // Sync initial bots specified by host
    game.syncBotSlots();

    socketMap.set(socket.id, { roomId, role: 'player', color: chosenColor });

    console.log(`🎮 Room ${roomId} created by ${name} (${chosenColor}) IP: ${clientIp} PID: ${playerId || 'none'}`);

    if (typeof callback === 'function') {
      callback({ success: true, roomId, color: chosenColor, lanUrl: `http://${LAN_IP}:${currentPort}` });
    }

    broadcastGameState(roomId);
  });

  // Join Room (Player or Spectator with unique playerId & Username Reconnection Support)
  socket.on('join-room', ({ roomId, name, color, asSpectator, playerId }, callback) => {
    roomId = (roomId || '').toUpperCase().trim();
    const game = rooms.get(roomId);

    if (!game) {
      if (typeof callback === 'function') callback({ success: false, message: 'Room not found' });
      return;
    }

    socket.join(roomId);
    const clientIp = getClientIp(socket);

    // Check if player is reconnecting by unique playerId or exact name
    const existingPlayer = game.findPlayerToReconnect(playerId, name);
    if (existingPlayer) {
      const result = game.addPlayer(socket.id, name || existingPlayer.name, existingPlayer.color, clientIp, playerId);
      socketMap.set(socket.id, { roomId, role: 'player', color: result.color });

      console.log(`🔄 ${name || existingPlayer.name} reconnected to Room ${roomId} as ${result.color} (isHost: ${result.isHost})`);

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
      game.addSpectator(socket.id, name);
      socketMap.set(socket.id, { roomId, role: 'spectator' });
      console.log(`👁️ ${name} joined Room ${roomId} as Spectator`);
      
      if (typeof callback === 'function') callback({ success: true, roomId, isSpectator: true, isHost: false });
      broadcastGameState(roomId);
      return;
    }

    if (game.status !== 'WAITING') {
      if (typeof callback === 'function') callback({ success: false, message: 'Game is already in progress! You can join as a Spectator.' });
      return;
    }

    // Try joining as player
    let targetColor = color;
    if (!targetColor) {
      targetColor = COLORS.find(c => !game.players[c] || game.players[c].isBot);
    }

    if (!targetColor) {
      if (typeof callback === 'function') callback({ success: false, message: 'Room is full! All 4 player slots are taken. You can join as a Spectator.' });
      return;
    }

    const result = game.addPlayer(socket.id, name, targetColor, clientIp, playerId);
    if (!result.success) {
      if (typeof callback === 'function') callback(result);
      return;
    }

    socketMap.set(socket.id, { roomId, role: 'player', color: targetColor });
    console.log(`👤 ${name} joined Room ${roomId} as ${targetColor}`);

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
    const game = rooms.get(roomId);
    if (!game) return;

    const added = game.addBot(color);
    if (added) {
      broadcastGameState(roomId);
      if (typeof callback === 'function') callback({ success: true });
    } else {
      if (typeof callback === 'function') callback({ success: false, message: 'Could not add bot' });
    }
  });

  // Set Bot Count (Host only)
  socket.on('set-bot-count', ({ roomId, botCount }, callback) => {
    const game = rooms.get(roomId);
    if (!game) return;
    if (game.hostSocketId !== socket.id) return;

    game.setBotCount(botCount);
    broadcastGameState(roomId);
    if (typeof callback === 'function') callback({ success: true });
  });

  // Start Game (Host only)
  socket.on('start-game', ({ roomId }, callback) => {
    const game = rooms.get(roomId);
    if (!game) return;

    const result = game.startGame();
    if (!result.success) {
      if (typeof callback === 'function') callback(result);
      return;
    }

    console.log(`🚀 Game started in Room ${roomId}`);

    if (typeof callback === 'function') callback({ success: true });
    broadcastGameState(roomId);
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
    const game = rooms.get(roomId);
    if (!game) return;

    const user = socketMap.get(socket.id);
    if (!user || user.role !== 'player') return;

    const result = game.rollDice(user.color);
    io.to(roomId).emit('dice-rolled', { color: user.color, result });
    broadcastGameState(roomId);
  });

  // Move Token
  socket.on('move-token', ({ roomId, tokenId }) => {
    const game = rooms.get(roomId);
    if (!game) return;

    const user = socketMap.get(socket.id);
    if (!user || user.role !== 'player') return;

    const result = game.moveToken(user.color, tokenId);
    io.to(roomId).emit('token-moved', result);
    broadcastGameState(roomId);
  });

  // Force Finish Game (Host only)
  socket.on('force-finish', ({ roomId }) => {
    const game = rooms.get(roomId);
    if (!game) return;
    
    // Only host can force finish
    if (game.hostSocketId !== socket.id) return;
    
    game.forceFinish();
    
    // Trigger game over on clients by emitting a pseudo token-moved event with gameOver=true
    // Or just broadcast game state and let the clients handle the FINISHED transition
    broadcastGameState(roomId);
  });

  // Chat message
  socket.on('send-chat', ({ roomId, message }) => {
    const game = rooms.get(roomId);
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

    io.to(roomId).emit('chat-received', {
      sender: senderName,
      color,
      message,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  // Trigger bot turn (from host)
  socket.on('trigger-bot-turn', ({ roomId }) => {
    const game = rooms.get(roomId);
    if (!game) return;
    
    // Security check: only host can trigger bot turn
    if (game.hostSocketId !== socket.id) return;
    
    game.checkAndTriggerBotTurn();
  });

  // Emote reaction
  socket.on('send-emote', ({ roomId, emote }) => {
    const game = rooms.get(roomId);
    const user = socketMap.get(socket.id);
    if (!user) return;

    let senderName = 'Guest';
    let color = user.color || 'spectator';

    if (user.role === 'player' && game && game.players[user.color]) {
      senderName = game.players[user.color].name;
    } else if (game && game.spectators.has(socket.id)) {
      senderName = game.spectators.get(socket.id).name;
    }

    io.to(roomId).emit('emote-received', {
      socketId: socket.id,
      senderName,
      color,
      emote
    });
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
    const user = socketMap.get(socket.id);
    if (user) {
      const { roomId } = user;
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
