/**
 * Main Application Logic for LAN Ludo Multiplayer
 */

const socket = io();

// State variables
let myRole = null; // 'player' or 'spectator'
let myColor = null;
let myName = 'Player 1';
let currentRoomId = null;
let isHost = false;
let currentGameState = null;
let autoMoveTimer = null;

// UI Elements
const lobbyView = document.getElementById('lobbyView');
const gameView = document.getElementById('gameView');
const lanUrlText = document.getElementById('lanUrlText');
const btnCopyLan = document.getElementById('btnCopyLan');
const roomsList = document.getElementById('roomsList');

// Form inputs
const hostPlayerName = document.getElementById('hostPlayerName');
const joinPlayerName = document.getElementById('joinPlayerName');
const joinRoomId = document.getElementById('joinRoomId');
const hostColorSelector = document.getElementById('hostColorSelector');

// Game UI Elements
const currentRoomCode = document.getElementById('currentRoomCode');
const turnStatusText = document.getElementById('turnStatusText');
const btnStartGame = document.getElementById('btnStartGame');
const playersCardsGrid = document.getElementById('playersCardsGrid');
const spectatorBadge = document.getElementById('spectatorBadge');
const spectatorCount = document.getElementById('spectatorCount');

// Dice & Move Controls
const diceCube = document.getElementById('diceCube');
const btnRollDice = document.getElementById('btnRollDice');
const movePrompt = document.getElementById('movePrompt');
const turnColorDot = document.getElementById('turnColorDot');
const turnPlayerName = document.getElementById('turnPlayerName');

// Chat & Emote
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const emoteOverlay = document.getElementById('emoteOverlay');
const btnSoundToggle = document.getElementById('btnSoundToggle');

// Board Renderer
const boardContainer = document.getElementById('ludoBoard');
let boardRenderer = null;

// Initialize App
window.addEventListener('DOMContentLoaded', () => {
  boardRenderer = new BoardRenderer(boardContainer);
  setupEventListeners();
});

// Sound Toggle
btnSoundToggle.addEventListener('click', () => {
  const isMuted = sounds.toggleMute();
  btnSoundToggle.innerText = isMuted ? '🔇' : '🔊';
});

// Receive Network Info from Server (lanUrl is now only sent to the host on room creation,
// so this handler just wires up the copy button if we receive it at connection time).
socket.on('network-info', ({ lanUrl }) => {
  // Only update/store if we received a URL (backwards-compat if server still sends it)
  if (lanUrl) {
    window._lanUrl = lanUrl;
    lanUrlText.innerText = lanUrl;
  }
  fetchRoomsList();
});

// Fetch rooms list as soon as the socket connects (server no longer pushes network-info on connect)
socket.on('connect', () => {
  fetchRoomsList();
});

// Called after room creation to store the LAN URL for the Copy LAN IP button
function setLanUrl(lanUrl) {
  if (!lanUrl) return;
  window._lanUrl = lanUrl;
  // Wire the copy button now that we have a URL
  btnCopyLan.onclick = () => copyTextToClipboard(lanUrl, btnCopyLan);
}

function getOrCreatePlayerId() {
  let pid = localStorage.getItem('ludo_player_id');
  if (!pid) {
    pid = 'pid_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    localStorage.setItem('ludo_player_id', pid);
  }
  return pid;
}

const myPlayerId = getOrCreatePlayerId();

function fetchRoomsList() {
  const currentTypedName = joinPlayerName ? joinPlayerName.value.trim() : '';
  socket.emit('get-rooms', { playerId: myPlayerId, name: currentTypedName }, (rooms) => {
    roomsList.innerHTML = '';
    if (!rooms || rooms.length === 0) {
      roomsList.innerHTML = '<div class="empty-rooms">No active rooms found for rejoining. Create a new room or join with a room code above!</div>';
      return;
    }

    rooms.forEach(r => {
      const roomCode = r.roomId || r.id;
      const isReconnect = r.hasReconnectSlot;

      const card = document.createElement('div');
      card.className = 'room-card-item';

      let actionButtonHtml = '';
      if (isReconnect) {
        actionButtonHtml = `<button class="btn btn-success btn-sm" onclick="handleJoinAvailableRoom('${roomCode}', true, '${r.reconnectName || ''}', '${r.reconnectColor || ''}')">🔄 Rejoin Game</button>`;
      } else {
        actionButtonHtml = `<button class="btn btn-primary btn-sm" onclick="handleJoinAvailableRoom('${roomCode}', false)">🎮 Join Game</button>`;
      }

      card.innerHTML = `
        <div class="room-card-info">
          <strong>ROOM: ${roomCode}</strong>
          <div>${r.playerCount}/4 Players • ${r.status} ${isReconnect ? '• <span style="color:#4ade80;font-weight:bold;">(Your Slot Saved)</span>' : ''}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="btn btn-secondary btn-sm" onclick="copyTextToClipboard('${roomCode}', this)" title="Copy Room Code">📋</button>
          ${actionButtonHtml}
        </div>
      `;
      roomsList.appendChild(card);
    });
  });
}

function handleJoinAvailableRoom(roomId, isReconnect, reconnectName, reconnectColor) {
  // If this user has a saved player slot in this room (unique playerId / name reconnection)
  if (isReconnect) {
    const defaultName = reconnectName || joinPlayerName.value.trim() || 'Player';
    const name = prompt(`Rejoining Room ${roomId}! Confirm your name:`, defaultName) || defaultName;

    socket.emit('join-room', { roomId, name, color: reconnectColor, asSpectator: false, playerId: myPlayerId }, (res) => {
      if (res.success) {
        myName = name;
        myRole = 'player';
        myColor = res.color;
        currentRoomId = res.roomId;
        isHost = !!res.isHost;

        alert(`🔄 Welcome back ${name}! Reconnected to your ${res.color.toUpperCase()} player slot.`);
        showGameView();
      } else {
        alert(res.message || 'Could not rejoin room');
      }
    });
    return;
  }

  // Not a reconnecting player: ask for name to join as Spectator
  const defaultName = joinPlayerName.value.trim() || 'Guest';
  const name = prompt(`Join Room ${roomId} as Spectator. Enter your name:`, defaultName);
  
  if (name === null) return; // User cancelled prompt

  const finalName = name.trim() || 'Spectator';

  socket.emit('join-room', { roomId, name: finalName, asSpectator: true, playerId: myPlayerId }, (res) => {
    if (res.success) {
      myName = finalName;
      myRole = 'spectator';
      myColor = null;
      currentRoomId = res.roomId;
      isHost = false;

      showGameView();
    } else {
      alert(res.message || 'Could not join as spectator');
    }
  });
}

let selectedJoinColor = null;

function fetchAndRenderJoinColors(roomId) {
  const joinColorGroup = document.getElementById('joinColorGroup');
  const joinColorSelector = document.getElementById('joinColorSelector');
  if (!joinColorGroup || !joinColorSelector) return;

  roomId = (roomId || '').trim().toUpperCase();
  if (!roomId || roomId.length < 4) {
    joinColorGroup.style.display = 'none';
    selectedJoinColor = null;
    return;
  }

  socket.emit('get-room-colors', roomId, (res) => {
    if (!res || !res.success || !res.availableColors || res.availableColors.length === 0) {
      joinColorGroup.style.display = 'none';
      selectedJoinColor = null;
      return;
    }

    joinColorGroup.style.display = 'block';
    joinColorSelector.innerHTML = '';
    selectedJoinColor = res.availableColors[0];

    res.availableColors.forEach((color, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `color-opt ${color} ${idx === 0 ? 'selected' : ''}`;
      btn.dataset.color = color;
      btn.title = `Choose ${color.toUpperCase()}`;

      btn.addEventListener('click', () => {
        const allBtns = joinColorSelector.querySelectorAll('.color-opt');
        allBtns.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedJoinColor = color;
      });

      joinColorSelector.appendChild(btn);
    });
  });
}

function quickJoinRoom(roomId) {
  joinRoomId.value = roomId;
  fetchAndRenderJoinColors(roomId);
}

function quickSpectateRoom(roomId) {
  joinRoomId.value = roomId;
  document.getElementById('btnJoinSpectator').click();
}

function setupEventListeners() {
  // Listen for room code input changes to fetch available colors
  joinRoomId.addEventListener('input', () => {
    fetchAndRenderJoinColors(joinRoomId.value);
  });

  // Color selection in host form
  const colorBtns = hostColorSelector.querySelectorAll('.color-opt');
  colorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      colorBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // Host Create Room
  document.getElementById('btnCreateRoom').addEventListener('click', () => {
    const name = hostPlayerName.value.trim() || 'Host';
    const selectedColorEl = hostColorSelector.querySelector('.color-opt.selected');
    const color = selectedColorEl ? selectedColorEl.dataset.color : 'red';

    const botCountSelect = document.getElementById('hostBotCount');
    const botCount = botCountSelect ? parseInt(botCountSelect.value, 10) : 3;

    socket.emit('create-room', { name, color, turnTimerDuration: 20, botCount, playerId: myPlayerId }, (res) => {
      if (res.success) {
        myName = name;
        myRole = 'player';
        myColor = res.color;
        currentRoomId = res.roomId;
        isHost = true;

        // SECURITY: lanUrl is now only sent to the host (not broadcast to all clients)
        if (res.lanUrl) setLanUrl(res.lanUrl);

        showGameView();
      }
    });
  });

  // Join Room as Player with Selected Color
  document.getElementById('btnJoinPlayer').addEventListener('click', () => {
    const name = joinPlayerName.value.trim() || 'Player';
    const roomId = joinRoomId.value.trim().toUpperCase();

    if (!roomId) {
      alert('Please enter a room code!');
      return;
    }

    socket.emit('join-room', { roomId, name, color: selectedJoinColor, asSpectator: false, playerId: myPlayerId }, (res) => {
      if (res.success) {
        myName = name;
        myRole = 'player';
        myColor = res.color;
        currentRoomId = res.roomId;
        isHost = false;

        if (res.rejoined) {
          alert(`🔄 Welcome back! You have reconnected to your ${res.color.toUpperCase()} player slot.`);
        }

        showGameView();
      } else {
        alert(res.message || 'Could not join room');
      }
    });
  });

  // Join Room as Spectator
  document.getElementById('btnJoinSpectator').addEventListener('click', () => {
    const name = joinPlayerName.value.trim() || 'Spectator';
    const roomId = joinRoomId.value.trim().toUpperCase();

    if (!roomId) {
      alert('Please enter a room code!');
      return;
    }

    socket.emit('join-room', { roomId, name, asSpectator: true }, (res) => {
      if (res.success) {
        myName = name;
        myRole = 'spectator';
        myColor = null;
        currentRoomId = res.roomId;
        isHost = false;

        showGameView();
      } else {
        alert(res.message || 'Could not join as spectator');
      }
    });
  });

  // Host Start Game
  btnStartGame.addEventListener('click', () => {
    if (currentGameState && currentGameState.status !== 'WAITING') return;
    btnStartGame.disabled = true;
    btnStartGame.style.display = 'none';

    socket.emit('start-game', { roomId: currentRoomId }, (res) => {
      if (res && !res.success) {
        alert(res.message);
        btnStartGame.disabled = false;
        btnStartGame.style.display = 'inline-flex';
      }
    });
  });

  // Host Delete Room
  const btnDeleteRoom = document.getElementById('btnDeleteRoom');
  btnDeleteRoom.addEventListener('click', () => {
    if (!currentRoomId || !isHost) return;
    if (confirm('Are you sure you want to delete and close this room?')) {
      socket.emit('delete-room', { roomId: currentRoomId }, (res) => {
        if (res && !res.success) {
          alert(res.message || 'Could not delete room');
        }
      });
    }
  });

  // Host Force Finish Game
  const btnFinishGame = document.getElementById('btnFinishGame');
  if (btnFinishGame) {
    btnFinishGame.addEventListener('click', forceFinishGame);
  }

  // Roll Dice Button (ONLY enabled on player's active turn)
  btnRollDice.addEventListener('click', () => {
    if (!currentRoomId || myRole !== 'player' || btnRollDice.disabled) return;
    btnRollDice.disabled = true;
    sounds.playDiceRoll();
    animateDiceRoll();
    socket.emit('roll-dice', { roomId: currentRoomId });
  });

  // Chat Submission
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (msg && currentRoomId) {
      socket.emit('send-chat', { roomId: currentRoomId, message: msg });
      chatInput.value = '';
    }
  });

  // Quick Emote Reactions
  const emoteBtns = document.querySelectorAll('.btn-emote');
  emoteBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const emote = btn.getAttribute('data-emote');
      if (emote && currentRoomId) {
        socket.emit('send-emote', { roomId: currentRoomId, emote });
      }
    });
  });

  // Copy Room Code Click Listener
  const btnCopyRoomCode = document.getElementById('btnCopyRoomCode');
  if (btnCopyRoomCode) {
    btnCopyRoomCode.addEventListener('click', () => {
      copyTextToClipboard(currentRoomId, btnCopyRoomCode);
    });
  }
}

// Copy Text Helper (Supports Clipboard API with document.execCommand fallback)
function copyTextToClipboard(text, targetEl) {
  if (!text || text === '----') return;

  const performCopy = () => {
    if (targetEl) {
      if (targetEl.id === 'btnCopyRoomCode' || targetEl.closest('#btnCopyRoomCode')) {
        const tooltip = document.getElementById('copyTooltip');
        if (tooltip) {
          tooltip.classList.add('show');
          setTimeout(() => tooltip.classList.remove('show'), 1800);
        }
      } else {
        const originalText = targetEl.innerHTML;
        targetEl.innerHTML = '✅ Copied!';
        setTimeout(() => { targetEl.innerHTML = originalText; }, 1500);
      }
    }
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(performCopy).catch(() => {
      fallbackCopy(text);
      performCopy();
    });
  } else {
    fallbackCopy(text);
    performCopy();
  }
}

function fallbackCopy(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
  } catch (err) {}
  document.body.removeChild(textArea);
}

function forceFinishGame() {
  if (!isHost || !currentRoomId) return;
  if (confirm("Are you sure you want to end the game early? The player with the most progress will win.")) {
    socket.emit('force-finish', { roomId: currentRoomId });
  }
}

function showGameView() {
  lobbyView.classList.remove('active');
  gameView.classList.add('active');
  currentRoomCode.innerText = currentRoomId;

  if (currentGameState) {
    if (currentGameState.hostSocketId && socket.id === currentGameState.hostSocketId) {
      isHost = true;
    }
    updateGameUI(currentGameState);
  } else {
    const btnDeleteRoom = document.getElementById('btnDeleteRoom');
    if (isHost) {
      if (btnDeleteRoom) btnDeleteRoom.style.display = 'inline-flex';
      btnStartGame.style.display = 'inline-flex';
      btnStartGame.disabled = false;
    } else {
      if (btnDeleteRoom) btnDeleteRoom.style.display = 'none';
      btnStartGame.style.display = 'none';
      btnStartGame.disabled = true;
    }
  }

  // Join Voice Chat
  if (typeof VoiceManager !== 'undefined' && currentRoomId) {
    VoiceManager.joinRoom(currentRoomId);
  }
}

// Socket Real-Time Event Handlers

// Receive Game State Update
socket.on('game-state', (state) => {
  const wasFinished = currentGameState && currentGameState.status === 'FINISHED';

  if (boardRenderer && boardRenderer.animatingTokenKey && currentGameState && currentGameState.tokens) {
    // Preserve animating token step in incoming state payload to prevent premature jump to newStep
    const [animColor, animIdStr] = boardRenderer.animatingTokenKey.split('-');
    const animId = Number(animIdStr);
    if (state.tokens && state.tokens[animColor]) {
      const curToken = currentGameState.tokens[animColor]?.find(t => Number(t.id) === animId);
      const newToken = state.tokens[animColor]?.find(t => Number(t.id) === animId);
      if (curToken && newToken) {
        newToken.step = curToken.step;
      }
    }
  }
  currentGameState = state;
  updateGameUI(state);

  // Fallback: if game just transitioned to FINISHED and celebration wasn't triggered yet, fire it!
  if (state.status === 'FINISHED' && !wasFinished && !window.victoryModalShown) {
    // Delay to let any animation complete first
    setTimeout(() => {
      if (!window.victoryModalShown) {
        triggerGameOverCelebration();
      }
    }, 2500);
  }
});

// Dice Rolled Animation & Event - Immediately update state & highlights on EACH AND EVERY ROLL
socket.on('dice-rolled', ({ color, result }) => {
  if (result && result.diceValue) {
    setDiceFace(result.diceValue, true);
  }
  if (color === myColor) {
    sounds.playDiceRoll();
  }

  if (currentGameState && result) {
    currentGameState.hasRolled = true;
    currentGameState.lastDiceValue = result.diceValue;
    currentGameState.movableTokens = result.movableTokens || [];
    updateGameUI(currentGameState);
  }
});

function applyMoveToState(state, res) {
  if (!state || !state.tokens || !res) return;
  if (state.tokens[res.color]) {
    const t = state.tokens[res.color].find(t => Number(t.id) === Number(res.tokenId));
    if (t) t.step = res.newStep;
  }
  if (res.captured && state.tokens[res.captured.color]) {
    const ct = state.tokens[res.captured.color].find(t => Number(t.id) === Number(res.captured.tokenId));
    if (ct) ct.step = -1;
  }
}

// Token Moved Event
socket.on('token-moved', (res) => {
  if (res && res.success && res.oldStep !== undefined && res.newStep !== undefined) {
    boardRenderer.animateMove(res, currentGameState, myColor, () => {
      sounds.playTokenStep();
    }, (wasCaptured) => {
      // Update currentGameState with newStep so extra-turn re-renders don't pull token back!
      applyMoveToState(currentGameState, res);

      if (wasCaptured) {
        sounds.playCapture();
      } else if (res.playerJustFinished && !res.gameOver) {
        // Individual mid-game win celebration (not final game-over)
        showIndividualWinCelebration(res.finishedPlayerName || res.color, res.color, res.finishedRank || '1st');
      } else if (res.reachedGoal) {
        sounds.playGoal();
      }

      if (res.gameOver && !window.victoryModalShown) {
        triggerGameOverCelebration();
      }

      // Re-evaluate Roll Dice button and UI state NOW that movement animation has completed!
      if (currentGameState) {
        updateGameUI(currentGameState);
      }
    });
  }
});

// Bot Action
socket.on('bot-action', (action) => {
  if (action.type === 'ROLL') {
    sounds.playDiceRoll();
    if (action.result && action.result.diceValue) setDiceFace(action.result.diceValue, true);
  } else if (action.type === 'MOVE' && action.result) {
    const res = action.result;
    if (res.success && res.oldStep !== undefined && res.newStep !== undefined) {
      boardRenderer.animateMove(res, currentGameState, myColor, () => {
        sounds.playTokenStep();
      }, (wasCaptured) => {
        // Update currentGameState with newStep so extra-turn re-renders don't pull token back!
        applyMoveToState(currentGameState, res);

        if (wasCaptured) {
          sounds.playCapture();
        } else if (res.playerJustFinished && !res.gameOver) {
          showIndividualWinCelebration(res.finishedPlayerName || res.color, res.color, res.finishedRank || '1st');
        } else if (res.reachedGoal) {
          sounds.playGoal();
        }

        if (res.gameOver && !window.victoryModalShown) {
          triggerGameOverCelebration();
        }

        // Re-evaluate Roll Dice button and UI state NOW that movement animation has completed!
        if (currentGameState) {
          updateGameUI(currentGameState);
        }
      });
    }
  }
});

// --- SECURITY: Safe helper to build a chat message DOM node without innerHTML ---
// This prevents XSS by ensuring user-provided text (names, messages, emotes)
// is always set via textContent, never injected as raw HTML.
function buildChatMsgEl(senderName, colorHex, ...textParts) {
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-msg';

  const spanEl = document.createElement('span');
  spanEl.className = 'sender';
  spanEl.style.color = colorHex; // colorHex is always from a whitelisted map, not user input
  spanEl.textContent = `${senderName}:`;

  msgEl.appendChild(spanEl);
  // Join all text parts into a single safe text node
  msgEl.appendChild(document.createTextNode(' ' + textParts.join(' ')));
  return msgEl;
}

// Chat Received
socket.on('chat-received', ({ sender, color, message }) => {
  // SECURITY: color comes from the server's whitelist, not raw user input
  const colorHex = {
    red: '#f87171', green: '#4ade80', yellow: '#facc15', blue: '#60a5fa',
    spectator: '#38bdf8', cyan: '#38bdf8', white: '#f8fafc'
  }[color] || '#38bdf8';

  // SECURITY: buildChatMsgEl uses textContent, so sender and message are safe
  const msgEl = buildChatMsgEl(sender || 'Player', colorHex, message);
  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

// Emote Received
socket.on('emote-received', ({ senderName, color, emote }) => {
  sounds.playEmote();
  showFloatingEmote(senderName, color, emote);

  // Print in Chat for history
  const colorHex = {
    red: '#f87171', green: '#4ade80', yellow: '#facc15', blue: '#60a5fa',
    spectator: '#38bdf8', cyan: '#38bdf8', white: '#f8fafc'
  }[color] || '#38bdf8';

  // SECURITY: buildChatMsgEl uses textContent — emote text is safe
  const msgEl = buildChatMsgEl(senderName || 'Player', colorHex, emote);
  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

// Targeted Emote Received
socket.on('targeted-emote-received', ({ senderName, senderColor, receiverColor, emote }) => {
  if (boardRenderer) {
    boardRenderer.animateTargetedEmote(senderColor, receiverColor, emote);
  }

  // Print in Chat for history
  const colorHex = {
    red: '#f87171', green: '#4ade80', yellow: '#facc15', blue: '#60a5fa', spectator: '#38bdf8'
  }[senderColor] || '#38bdf8';

  // SECURITY: buildChatMsgEl uses textContent — all values are safe
  const msgEl = buildChatMsgEl(
    senderName || 'Player',
    colorHex,
    `sent ${emote} to ${(receiverColor || '').toUpperCase()}`
  );
  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

// Room Deleted Event (Broadcasted to all players & spectators when Host deletes room)
socket.on('room-deleted', ({ message }) => {
  alert(message || 'The room has been closed by the host.');

  if (typeof VoiceManager !== 'undefined') {
    VoiceManager.leaveRoom();
  }

  myRole = null;
  myColor = null;
  currentRoomId = null;
  isHost = false;

  gameView.classList.remove('active');
  lobbyView.classList.add('active');

  refreshActiveRooms();
});

// Update UI from Server Game State
function updateGameUI(state) {
  const { status, players, spectatorsCount, currentTurnColor, lastDiceValue, hasRolled, movableTokens } = state;

  if (state && state.hostSocketId && socket.id === state.hostSocketId) {
    isHost = true;
  }

  const btnDeleteRoom = document.getElementById('btnDeleteRoom');
  if (btnDeleteRoom) {
    btnDeleteRoom.style.display = isHost ? 'inline-flex' : 'none';
  }

  const btnFinishGame = document.getElementById('btnFinishGame');
  if (btnFinishGame) {
    // Only show during active game for host
    btnFinishGame.style.display = (isHost && status === 'PLAYING') ? 'inline-flex' : 'none';
  }

  // Spectator badge
  spectatorBadge.style.display = spectatorsCount > 0 ? 'inline-flex' : 'none';
  spectatorCount.innerText = spectatorsCount;

  // Turn status banner
  // Turn status banner
  const turnPlayer = players[currentTurnColor];
  const turnName = turnPlayer ? turnPlayer.name : currentTurnColor.toUpperCase();
  
  if (status === 'FINISHED') {
    const winnerColor = state.winnerRankings ? state.winnerRankings[0] : currentTurnColor;
    const winnerPlayer = players[winnerColor];
    const winnerName = winnerPlayer ? winnerPlayer.name : (winnerColor ? winnerColor.toUpperCase() : 'Player');

    turnColorDot.style.background = '#fbbf24';
    turnColorDot.style.boxShadow = '0 0 12px #fbbf24';
    turnPlayerName.innerText = '🏆 Game Finished!';
    turnStatusText.innerText = '🏆 Match Complete!';
    movePrompt.innerText = `👑 Winner: ${winnerName}! Congratulations!`;
    btnStartGame.style.display = 'none';
    btnStartGame.disabled = true;
  } else {
    window.victoryModalShown = false;
    turnColorDot.style.background = `var(--color-${currentTurnColor})`;
    turnColorDot.style.boxShadow = `0 0 10px var(--color-${currentTurnColor})`;
    turnPlayerName.innerText = `${turnName}'s Turn`;

    if (status === 'WAITING') {
      turnStatusText.innerText = 'Waiting for players to join...';
      if (isHost) {
        btnStartGame.style.display = 'inline-flex';
        btnStartGame.disabled = false;
      } else {
        btnStartGame.style.display = 'none';
        btnStartGame.disabled = true;
      }
    } else {
      btnStartGame.style.display = 'none';
      btnStartGame.disabled = true;
      if (turnPlayer && turnPlayer.isConnected === false) {
        turnStatusText.innerText = `🔌 Waiting for ${turnName} to reconnect...`;
      } else {
        turnStatusText.innerText = `Turn: ${turnName}`;
      }
    }
  }

  // Update Base Names and Gift Buttons
  if (boardRenderer) {
    boardRenderer.updateBaseNames(state, myColor);
  }

  // Update Player Cards in Sidebar
  renderPlayerCards(players, currentTurnColor, isHost && status === 'WAITING', status, state.winnerRankings);

  // Orient Board for Player (Starting base & movement at Bottom-Left!)
  boardRenderer.setBoardOrientation(myColor);

  // Render Board Tokens
  boardRenderer.renderTokens(state, myColor, (tokenId) => {
    // On Token Click
    if (myRole === 'player' && currentTurnColor === myColor && turnPlayer && turnPlayer.isConnected !== false) {
      socket.emit('move-token', { roomId: currentRoomId, tokenId });
    }
  });

  // Roll Dice Button State (Disabled while token is mid-movement animation or when game finished)
  const isAnimating = boardRenderer && (boardRenderer.animatingTokenKey !== null || boardRenderer.animatingCapturedDefenderKey !== null);
  const isMyTurn = myRole === 'player' && currentTurnColor === myColor && status === 'PLAYING' && turnPlayer && turnPlayer.isConnected !== false;
  btnRollDice.disabled = !isMyTurn || hasRolled || isAnimating || status === 'FINISHED';

  if (lastDiceValue) {
    setDiceFace(lastDiceValue);
  }

  // Move Prompt text
  if (status === 'FINISHED') {
    const winnerColor = state.winnerRankings ? state.winnerRankings[0] : currentTurnColor;
    const winnerPlayer = players[winnerColor];
    const winnerName = winnerPlayer ? winnerPlayer.name : (winnerColor ? winnerColor.toUpperCase() : 'Player');
    movePrompt.innerText = `👑 Winner: ${winnerName}! Congratulations!`;
  } else if (status === 'WAITING') {
    movePrompt.innerText = 'Host can start the game when ready!';
  } else if (turnPlayer && turnPlayer.isConnected === false) {
    movePrompt.innerText = `🔌 ${turnName} disconnected. Waiting for player to rejoin...`;
  } else if (isMyTurn) {
    if (!hasRolled) {
      movePrompt.innerText = '👉 It is YOUR turn! Click ROLL DICE.';
    } else if (movableTokens && movableTokens.length > 0) {
      movePrompt.innerText = '✨ Select ANY glowing piece to move!';
    } else {
      movePrompt.innerText = 'No valid moves available.';
    }
  } else {
    movePrompt.innerText = `Waiting for ${turnName} to move...`;
  }
}

// Render Player Sidebar Cards
function renderPlayerCards(players, currentTurnColor, canAddBot, gameStatus, winnerRankings = []) {
  playersCardsGrid.innerHTML = '';
  const colors = ['red', 'green', 'yellow', 'blue'];

  colors.forEach(c => {
    const p = players[c];

    // In active game, hide empty unused slots
    if (gameStatus === 'PLAYING' && !p) return;

    const card = document.createElement('div');
    card.className = `player-card ${c}`;
    if (currentTurnColor === c) card.classList.add('active-turn');

    if (p) {
      // --- SECURITY: Use DOM APIs + textContent to prevent XSS from player names ---
      const infoDiv = document.createElement('div');
      infoDiv.className = 'player-info';

      const nameDiv = document.createElement('div');
      nameDiv.className = 'player-info-name';
      nameDiv.textContent = p.name; // textContent safely escapes any HTML in the name

      const tagDiv = document.createElement('div');
      tagDiv.className = 'player-tag';
      tagDiv.textContent = p.isBot ? '🤖 AI Bot' : (p.socketId === socket.id ? '⭐ You' : 'Human');

      infoDiv.appendChild(nameDiv);
      infoDiv.appendChild(tagDiv);
      card.appendChild(infoDiv);

      // Win badge uses only static rank strings from a local array — safe to use innerHTML
      if (p.hasWon || (Array.isArray(winnerRankings) && winnerRankings.includes(c))) {
        const rankIdx = Array.isArray(winnerRankings) ? winnerRankings.indexOf(c) : -1;
        const rankClass = ['rank-1st', 'rank-2nd', 'rank-3rd', 'rank-4th'][rankIdx] || 'rank-1st';
        const rankText  = ['🥇 1st Place', '🥈 2nd Place', '🥉 3rd Place', '4th Place'][rankIdx] || '🏆 WON';
        const badge = document.createElement('span');
        badge.className = `won-badge ${rankClass}`;
        badge.textContent = rankText; // static string, but textContent is still cleaner
        card.appendChild(badge);
      }
    } else {
      // Empty slot — all content is static strings, safe to use innerHTML here
      const infoDiv = document.createElement('div');
      infoDiv.className = 'player-info';

      const nameDiv = document.createElement('div');
      nameDiv.className = 'player-info-name';
      nameDiv.style.color = 'var(--text-muted)';
      nameDiv.textContent = 'Empty Slot';

      const tagDiv = document.createElement('div');
      tagDiv.className = 'player-tag';
      tagDiv.textContent = 'Waiting for player...';

      infoDiv.appendChild(nameDiv);
      infoDiv.appendChild(tagDiv);
      card.appendChild(infoDiv);

      if (canAddBot) {
        const botBtn = document.createElement('button');
        botBtn.className = 'btn btn-secondary btn-sm';
        botBtn.textContent = '+ Add Bot';
        botBtn.addEventListener('click', () => addBotSlot(c));
        card.appendChild(botBtn);
      }
    }

    playersCardsGrid.appendChild(card);
  });
}

function addBotSlot(color) {
  if (currentRoomId) {
    socket.emit('add-bot', { roomId: currentRoomId, color });
  }
}

let diceRotX = 0;
let diceRotY = 0;

let isDiceAnimating = false;

// 3D Dice Face Setter (Continuous non-blinking rotation)
function setDiceFace(val, animate = false) {
  const targetMap = {
    1: { x: 0, y: 0 },
    2: { x: 0, y: 180 },
    3: { x: 0, y: 90 },
    4: { x: 0, y: -90 },
    5: { x: -90, y: 0 },
    6: { x: 90, y: 0 }
  };
  const target = targetMap[val] || targetMap[1];

  if (animate) {
    diceRotX += 720 + target.x - (diceRotX % 360);
    diceRotY += 720 + target.y - (diceRotY % 360);

    diceCube.style.transition = 'transform 0.55s cubic-bezier(0.25, 1, 0.5, 1)';
    diceCube.style.transform = `rotateX(${diceRotX}deg) rotateY(${diceRotY}deg)`;
    
    isDiceAnimating = true;
    setTimeout(() => { isDiceAnimating = false; }, 600);
  } else {
    if (isDiceAnimating) return; // Prevent snapping mid-roll
    
    diceRotX = target.x;
    diceRotY = target.y;
    diceCube.style.transition = 'none';
    diceCube.style.transform = `rotateX(${diceRotX}deg) rotateY(${diceRotY}deg)`;
  }
}

function animateDiceRoll() {
  // Seamless rotation handled in setDiceFace
}

// Floating Emote Reaction Effect with Player Name
function showFloatingEmote(senderName, color, emote) {
  const el = document.createElement('div');
  el.className = 'floating-emote';

  const colorHex = {
    red: '#f87171',
    green: '#4ade80',
    yellow: '#facc15',
    blue: '#60a5fa',
    spectator: '#38bdf8',
    cyan: '#38bdf8',
    white: '#f8fafc'
  }[color] || '#38bdf8';

  // --- SECURITY: Build with DOM APIs to prevent XSS from senderName ---
  const nameSpan = document.createElement('span');
  nameSpan.className = 'emote-user-name';
  nameSpan.style.color = colorHex; // colorHex is from a local whitelist, not user input
  nameSpan.textContent = `${senderName || 'Player'}:`; // textContent escapes any HTML

  const emoteSpan = document.createElement('span');
  emoteSpan.className = 'emote-icon';
  emoteSpan.textContent = emote; // server already limits this to MAX_EMOTE_LEN chars

  el.appendChild(nameSpan);
  el.appendChild(emoteSpan);

  const randomX = Math.random() * (window.innerWidth - 220) + 60;
  el.style.left = `${randomX}px`;
  el.style.top = `${window.innerHeight - 200}px`;

  emoteOverlay.appendChild(el);

  setTimeout(() => {
    el.remove();
  }, 2200);
}

// TRIGGER CANVAS CONFETTI
function triggerVictoryConfetti() {
  if (typeof confetti !== 'function') return;
  
  const duration = 4500;
  const animationEnd = Date.now() + duration;
  const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 10000 };

  function randomInRange(min, max) {
    return Math.random() * (max - min) + min;
  }

  const interval = setInterval(function() {
    const timeLeft = animationEnd - Date.now();

    if (timeLeft <= 0) {
      return clearInterval(interval);
    }

    const particleCount = 50 * (timeLeft / duration);
    confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } }));
    confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } }));
  }, 250);
}

// FULL SCREEN HTML5 FIREWORKS / CRACKERS ANIMATION
let fireworksInterval = null;

function startFireworks() {
  const canvas = document.getElementById('fireworksCanvas');
  if (!canvas) return;

  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');
  
  let width = canvas.width = window.innerWidth;
  let height = canvas.height = window.innerHeight;

  const particles = [];
  const colors = ['#f87171', '#4ade80', '#facc15', '#60a5fa', '#a855f7', '#ec4899', '#38bdf8'];

  function createFirework() {
    const x = Math.random() * width;
    const y = Math.random() * (height * 0.5);
    const count = 40 + Math.floor(Math.random() * 30);
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const speed = 2 + Math.random() * 6;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1,
        decay: 0.015 + Math.random() * 0.02,
        size: 3 + Math.random() * 3
      });
    }
  }

  createFirework();
  createFirework();
  if (fireworksInterval) clearInterval(fireworksInterval);
  fireworksInterval = setInterval(createFirework, 450);

  function loop() {
    if (canvas.style.display === 'none') return;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.08;
      p.alpha -= p.decay;

      if (p.alpha <= 0) {
        particles.splice(i, 1);
        continue;
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.fill();
    }

    requestAnimationFrame(loop);
  }
  loop();
}

function stopFireworks() {
  if (fireworksInterval) {
    clearInterval(fireworksInterval);
    fireworksInterval = null;
  }
  const canvas = document.getElementById('fireworksCanvas');
  if (canvas) canvas.style.display = 'none';
}

// Master Game Over Celebration — Big Trophy, Crackers, Music, and Match Results!
function triggerGameOverCelebration() {
  if (window.victoryModalShown) return; // Prevent double fire
  window.victoryModalShown = true;

  // Get winner info from currentGameState
  const winnerColor = currentGameState && currentGameState.winnerRankings && currentGameState.winnerRankings[0]
    ? currentGameState.winnerRankings[0]
    : null;
  const winnerPlayer = winnerColor && currentGameState.players ? currentGameState.players[winnerColor] : null;
  const winnerName = winnerPlayer ? winnerPlayer.name : (winnerColor ? winnerColor.toUpperCase() : 'Player');

  // Fire all celebration effects!
  sounds.playVictory();
  triggerVictoryConfetti();
  startFireworks();

  // Show the big Victory Modal with Match Statistics
  showVictoryCelebration(winnerName, winnerColor || 'red', '1st');
}

// Individual Player Win Celebration Toast & Fanfare
function showIndividualWinCelebration(playerName, color, rank = '1st') {
  sounds.playVictory();
  triggerVictoryConfetti();
  startFireworks();

  const winBanner = document.getElementById('individualWinBanner');
  const winIcon = document.getElementById('winBannerIcon');
  const winTitle = document.getElementById('winBannerTitle');
  const winSubtitle = document.getElementById('winBannerSubtitle');

  const rankIcons = { '1st': '🥇', '2nd': '🥈', '3rd': '🥉', '4th': '🎖️' };
  const icon = rankIcons[rank] || '🏆';

  if (winIcon) winIcon.innerText = icon;
  if (winTitle) winTitle.innerText = `🎉 ${playerName} Secured ${rank} Place!`;
  if (winSubtitle) winSubtitle.innerText = `Outstanding performance! All 4 tokens reached GOAL!`;

  if (winBanner) {
    winBanner.classList.add('show');
    setTimeout(() => {
      winBanner.classList.remove('show');
      stopFireworks();
    }, 4500);
  }
}

// Victory Celebration Modal & Complete Match Statistics
function showVictoryCelebration(winnerName, color, rank = '1st') {
  sounds.playVictory();
  triggerVictoryConfetti();
  startFireworks();

  const victoryModal = document.getElementById('victoryModal');
  const championName = document.getElementById('championName');
  const statsTableBody = document.getElementById('statsTableBody');

  if (!victoryModal) return;

  if (championName) {
    championName.innerText = winnerName || 'Player 1';
  }

  // Populate Complete Match Statistics Table
  if (statsTableBody && currentGameState && currentGameState.players) {
    statsTableBody.innerHTML = '';

    const colors = ['red', 'green', 'yellow', 'blue'];
    const activePlayers = [];

    colors.forEach(c => {
      const p = currentGameState.players[c];
      if (p) {
        activePlayers.push(p);
      }
    });

    // Sort by winner rankings or finished goal tokens
    activePlayers.sort((a, b) => {
      const rankA = currentGameState.winnerRankings ? currentGameState.winnerRankings.indexOf(a.color) : -1;
      const rankB = currentGameState.winnerRankings ? currentGameState.winnerRankings.indexOf(b.color) : -1;
      if (rankA !== -1 && rankB !== -1) return rankA - rankB;
      if (rankA !== -1) return -1;
      if (rankB !== -1) return 1;
      return 0;
    });

    activePlayers.forEach((p, idx) => {
      const rankStr  = ['🥇 1st', '🥈 2nd', '🥉 3rd', '4th'][idx] || `${idx + 1}th`;
      const stats    = p.stats || { capturedOpponents: 0, timesCaptured: 0, totalRolls: 0, sixesRolled: 0 };
      const colorHex = { red: '#ef4444', green: '#22c55e', yellow: '#eab308', blue: '#3b82f6' }[p.color] || '#3b82f6';

      const tr = document.createElement('tr');
      if (idx === 0) tr.className = 'winner-row';

      // --- SECURITY: Build stats row with DOM APIs to prevent XSS from p.name ---
      const rankTd = document.createElement('td');
      const rankStrong = document.createElement('strong');
      rankStrong.textContent = rankStr; // static string, but consistent
      rankTd.appendChild(rankStrong);

      const nameTd = document.createElement('td');
      const playerCell = document.createElement('div');
      playerCell.className = 'stats-player-cell';

      const colorDot = document.createElement('span');
      colorDot.className = 'stats-color-dot';
      colorDot.style.background = colorHex; // from a local whitelist map, safe

      const nameSpan = document.createElement('span');
      nameSpan.textContent = p.name + (p.isBot ? ' 🤖' : ''); // textContent escapes HTML

      playerCell.appendChild(colorDot);
      playerCell.appendChild(nameSpan);
      nameTd.appendChild(playerCell);

      const captureTd = document.createElement('td');
      const captureStrong = document.createElement('strong');
      captureStrong.textContent = `⚔️ ${stats.capturedOpponents}`;
      captureTd.appendChild(captureStrong);

      const capturedTd = document.createElement('td');
      capturedTd.textContent = `💀 ${stats.timesCaptured}`;

      const rollsTd = document.createElement('td');
      rollsTd.textContent = `🎲 ${stats.totalRolls} (${stats.sixesRolled} sixes)`;

      tr.appendChild(rankTd);
      tr.appendChild(nameTd);
      tr.appendChild(captureTd);
      tr.appendChild(capturedTd);
      tr.appendChild(rollsTd);

      statsTableBody.appendChild(tr);
    });
  }

  victoryModal.style.display = 'flex';
  setTimeout(() => {
    victoryModal.classList.add('active');
  }, 20);
}

function closeVictoryModal() {
  stopFireworks();
  const victoryModal = document.getElementById('victoryModal');
  if (victoryModal) {
    victoryModal.classList.remove('active');
    setTimeout(() => {
      victoryModal.style.display = 'none';
    }, 300);
  }
}

// STICKER PACK CATEGORIES
const STICKER_CATEGORIES = {
  funny: ['🤡', '🤪', '💩', '👻', '🐔', '🍌', '🍆', '🗿', '💃', '🥸', '🐽', '🦄', '🙈', '🦖', '🎃'],
  laugh: ['🤣', '💀', '🤩', '💅', '🤑', '🕶️', '🔥', '💣', '🦾', '🥳', '😎', '🎉', '🍿', '👑', '💥'],
  rage: ['🤬', '👿', '🖕', '👊', '🧂', '🐢', '🐌', '💤', '❌', '👎', '🤮', '🤐', '🥱', '⚡', '💣'],
  luck: ['🍀', '🔮', '🎯', '🎰', '🏆', '👑', '🌟', '💰', '🎲', '🧿', '✨', '💎', '🌈', '🔥', '🥇'],
  gifts: ['🧻', '💣', '🌹', '⚰️', '🔥', '🔫', '🔪', '❤️', '💋', '🫂']
};

function toggleStickerDrawer(show, defaultTab = 'funny') {
  const modal = document.getElementById('stickerDrawerModal');
  if (!modal) return;

  if (show) {
    switchStickerTab(defaultTab);
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 20);
  } else {
    modal.classList.remove('active');
    setTimeout(() => modal.style.display = 'none', 300);
  }
}

function switchStickerTab(cat) {
  const tabs = document.querySelectorAll('.sticker-category-tabs .tab-btn');
  tabs.forEach(t => t.classList.remove('active'));

  const activeTabBtn = Array.from(tabs).find(t => t.getAttribute('onclick')?.includes(cat));
  if (activeTabBtn) activeTabBtn.classList.add('active');

  const grid = document.getElementById('stickerGrid');
  if (!grid) return;

  const stickers = STICKER_CATEGORIES[cat] || STICKER_CATEGORIES.funny;
  grid.innerHTML = stickers.map(s => `
    <div class="sticker-item" onclick="sendSticker('${s}')">${s}</div>
  `).join('');
}

window.targetedReceiverColor = null;
window.openTargetedEmoteDrawer = function(color) {
  window.targetedReceiverColor = color;
  toggleStickerDrawer(true, 'gifts');
};

function sendSticker(emote) {
  if (currentRoomId) {
    if (window.targetedReceiverColor) {
      socket.emit('send-targeted-emote', { roomId: currentRoomId, receiverColor: window.targetedReceiverColor, emote });
      window.targetedReceiverColor = null;
    } else {
      socket.emit('send-emote', { roomId: currentRoomId, emote });
    }
    toggleStickerDrawer(false);

    // Add to quick reactions grid (if not already there)
    const emoteGrid = document.querySelector('.emote-buttons-grid');
    if (emoteGrid) {
      const existingBtn = Array.from(emoteGrid.querySelectorAll('.btn-emote'))
                               .find(btn => btn.getAttribute('data-emote') === emote);
      
      if (!existingBtn) {
        // Remove the last button
        const btns = emoteGrid.querySelectorAll('.btn-emote');
        if (btns.length > 0) {
          btns[btns.length - 1].remove();
        }

        // Create new button and insert at the beginning
        const newBtn = document.createElement('button');
        newBtn.className = 'btn-emote';
        newBtn.setAttribute('data-emote', emote);
        newBtn.innerText = emote;
        newBtn.addEventListener('click', () => {
          if (currentRoomId) socket.emit('send-emote', { roomId: currentRoomId, emote });
        });
        
        emoteGrid.insertBefore(newBtn, emoteGrid.firstChild);
      }
    }
  }
}
