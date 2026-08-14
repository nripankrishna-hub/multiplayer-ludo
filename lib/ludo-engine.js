/**
 * Authoritative Ludo Game Engine
 * Manages game state, turn flow, dice rolls, token movements, captures, and AI bots.
 */

const COLORS = ['red', 'green', 'yellow', 'blue'];

const START_INDEXES = {
  red: 0,
  green: 13,
  yellow: 26,
  blue: 39
};

// Safe spots on main path (0..51)
const SAFE_SPOTS = [0, 8, 13, 21, 26, 34, 39, 47];

class LudoEngine {
  constructor(roomId, options = {}) {
    this.roomId = roomId;
    this.status = 'WAITING'; // WAITING, PLAYING, FINISHED
    this.turnTimerDuration = options.turnTimerDuration || 20; // seconds per turn
    this.targetBotCount = options.botCount !== undefined ? parseInt(options.botCount, 10) : 3;
    
    // Players: { red: playerObj, green: playerObj, yellow: playerObj, blue: playerObj }
    this.players = {
      red: null,
      green: null,
      yellow: null,
      blue: null
    };

    this.spectators = new Map(); // socketId -> spectator info
    
    this.currentTurnIndex = 0; // index in activeColors
    this.activeColors = ['red', 'green', 'yellow', 'blue'];
    this.winnerRankings = []; // colors in order of finish
    
    // Board state: tokens for each color: [ { id: 0, step: -1 }, ... ]
    // step -1 = BASE
    // step 0..50 = main path cell (relative to start index)
    // step 51..55 = home stretch (cells 0..4)
    // step 56 = GOAL
    this.tokens = {
      red: [ { id: 0, step: -1 }, { id: 1, step: -1 }, { id: 2, step: -1 }, { id: 3, step: -1 } ],
      green: [ { id: 0, step: -1 }, { id: 1, step: -1 }, { id: 2, step: -1 }, { id: 3, step: -1 } ],
      yellow: [ { id: 0, step: -1 }, { id: 1, step: -1 }, { id: 2, step: -1 }, { id: 3, step: -1 } ],
      blue: [ { id: 0, step: -1 }, { id: 1, step: -1 }, { id: 2, step: -1 }, { id: 3, step: -1 } ]
    };

    // Current turn state
    this.lastDiceValue = null;
    this.hasRolled = false;
    this.consecutiveSixes = 0;
    this.movableTokens = [];
    this.turnTimer = null;
    this.turnTimeRemaining = 0;
    this.history = [];
    this.hostSocketId = null;
  }

  // Find existing player by IP address
  findPlayerByIp(ipAddress) {
    if (!ipAddress) return null;
    for (const c of COLORS) {
      const p = this.players[c];
      if (p && p.ipAddress === ipAddress) {
        return p;
      }
    }
    return null;
  }

  // Add human player to a color (with IP address reconnection support)
  addPlayer(socketId, name, color, ipAddress) {
    // Check if this IP is reconnecting to an existing player slot
    if (ipAddress) {
      const existingPlayer = this.findPlayerByIp(ipAddress);
      if (existingPlayer) {
        const slotColor = existingPlayer.color;
        const wasHost = (this.hostSocketId === existingPlayer.socketId || !this.hostSocketId || this.hostIp === ipAddress);
        
        existingPlayer.socketId = socketId;
        existingPlayer.isBot = false;
        existingPlayer.isConnected = true;
        if (name && !existingPlayer.name.includes(name)) {
          existingPlayer.name = name;
        }

        if (wasHost) {
          this.hostSocketId = socketId;
          this.hostIp = ipAddress;
        }

        this.logHistory(`🔄 ${existingPlayer.name} reconnected to ${slotColor} slot!`);

        // Remove from spectators if present
        this.spectators.delete(socketId);

        if (this.onStateChange) this.onStateChange();
        return { 
          success: true, 
          color: slotColor, 
          rejoined: true, 
          isHost: (this.hostSocketId === socketId), 
          message: `Reconnected as ${existingPlayer.name}` 
        };
      }
    }

    if (this.status !== 'WAITING') {
      return { success: false, message: 'Game is already in progress! You can join as a Spectator.' };
    }

    // Count current human players
    let humanCount = 0;
    for (const c of COLORS) {
      if (this.players[c] && !this.players[c].isBot) {
        humanCount++;
      }
    }

    if (humanCount >= 4) {
      return { success: false, message: 'Room is full! All 4 player slots are taken. You can join as a Spectator.' };
    }

    if (!COLORS.includes(color)) return { success: false, message: 'Invalid color' };

    // If requested color is taken by another human player, find an empty/bot slot
    if (this.players[color] && !this.players[color].isBot) {
      let altColor = null;
      for (const c of COLORS) {
        if (!this.players[c] || this.players[c].isBot) {
          altColor = c;
          break;
        }
      }

      if (!altColor) {
        return { success: false, message: 'Room is full! No available player slots left. You can join as a Spectator.' };
      }

      color = altColor;
    }

    this.players[color] = {
      socketId,
      ipAddress: ipAddress || null,
      name: name || `Player ${color.toUpperCase()}`,
      color,
      isBot: false,
      isConnected: true,
      isReady: true,
      hasWon: false
    };

    if (!this.hostSocketId) {
      this.hostSocketId = socketId;
      this.hostIp = ipAddress || null;
    }

    // Remove from spectators if present
    this.spectators.delete(socketId);

    return { success: true, color, rejoined: false, isHost: (this.hostSocketId === socketId) };
  }

  // Add Bot to a color slot
  addBot(color) {
    if (!COLORS.includes(color)) return false;
    if (this.players[color] && !this.players[color].isBot) return false;

    const botNames = {
      red: 'Cyber Red 🤖',
      green: 'Viper Green 🤖',
      yellow: 'Solar Yellow 🤖',
      blue: 'Quantum Blue 🤖'
    };

    this.players[color] = {
      socketId: `bot_${color}_${Date.now()}`,
      ipAddress: null,
      name: botNames[color],
      color,
      isBot: true,
      isConnected: true,
      isReady: true,
      hasWon: false
    };
    return true;
  }

  // Remove player or bot (Keep slot waiting for human player reconnection, NO AI takeover)
  removePlayer(socketId) {
    for (const color of COLORS) {
      if (this.players[color] && this.players[color].socketId === socketId) {
        this.players[color].isConnected = false;
        // Keep isBot = false so game waits for player to reconnect
        this.logHistory(`🔌 ${this.players[color].name} disconnected. Waiting for player to reconnect...`);
        break;
      }
    }
  }

  // Add spectator
  addSpectator(socketId, name) {
    this.spectators.set(socketId, { socketId, name: name || 'Spectator' });
  }

  removeSpectator(socketId) {
    this.spectators.delete(socketId);
  }

  // Set target bot count and adjust bot slots
  setBotCount(count) {
    this.targetBotCount = Math.max(0, Math.min(3, parseInt(count, 10) || 0));
    this.syncBotSlots();
  }

  // Sync bot slots based on targetBotCount and human players
  syncBotSlots() {
    // Count current bots and humans
    let currentBotCount = 0;
    for (const color of COLORS) {
      if (this.players[color] && this.players[color].isBot) {
        currentBotCount++;
      }
    }

    // Add bots if below target
    if (currentBotCount < this.targetBotCount) {
      for (const color of COLORS) {
        if (currentBotCount >= this.targetBotCount) break;
        if (!this.players[color]) {
          this.addBot(color);
          currentBotCount++;
        }
      }
    } else if (currentBotCount > this.targetBotCount) {
      // Remove excess bots from back
      for (const color of [...COLORS].reverse()) {
        if (currentBotCount <= this.targetBotCount) break;
        if (this.players[color] && this.players[color].isBot) {
          this.players[color] = null;
          currentBotCount--;
        }
      }
    }
  }

  // Start game
  startGame() {
    // Sync bot slots up to target count
    this.syncBotSlots();

    // Check active players count
    const activePlayerCount = COLORS.filter(c => this.players[c] !== null).length;
    if (activePlayerCount < 2) {
      return { success: false, message: 'At least 2 players (or 1 player + 1 bot) are required to start a game!' };
    }

    this.status = 'PLAYING';
    
    // Set first turn to first non-null player
    let firstIdx = 0;
    while (!this.players[COLORS[firstIdx]] && firstIdx < 4) {
      firstIdx++;
    }
    this.currentTurnIndex = firstIdx;
    this.resetTurnState();

    const startColor = this.getCurrentTurnColor();
    this.logHistory(`Game started! ${this.players[startColor]?.name || startColor}'s turn.`);

    // If first player is Bot, schedule bot turn
    this.checkAndTriggerBotTurn();
    return { success: true };
  }

  getCurrentTurnColor() {
    return this.activeColors[this.currentTurnIndex];
  }

  resetTurnState() {
    this.lastDiceValue = null;
    this.hasRolled = false;
    this.movableTokens = [];
  }

  // Convert relative step to absolute main path cell (0..51) or stretch identifier
  getAbsolutePosition(color, relStep) {
    if (relStep === -1) return { type: 'BASE' };
    if (relStep === 56) return { type: 'GOAL' };
    if (relStep >= 51) {
      return { type: 'STRETCH', color, stretchIndex: relStep - 51 };
    }
    const startIndex = START_INDEXES[color];
    const mainIndex = (startIndex + relStep) % 52;
    const isSafe = SAFE_SPOTS.includes(mainIndex);
    return { type: 'MAIN', mainIndex, isSafe };
  }

  // Roll Dice
  rollDice(color) {
    if (this.status !== 'PLAYING') return { success: false, message: 'Game not active' };
    if (this.getCurrentTurnColor() !== color) return { success: false, message: 'Not your turn' };
    if (this.hasRolled) return { success: false, message: 'Already rolled this turn' };

    const diceValue = Math.floor(Math.random() * 6) + 1;
    this.lastDiceValue = diceValue;
    this.hasRolled = true;

    if (diceValue === 6) {
      this.consecutiveSixes++;
    } else {
      this.consecutiveSixes = 0;
    }

    this.logHistory(`${this.players[color].name} rolled a ${diceValue}!`);

    // Three 6s penalty check
    if (this.consecutiveSixes === 3) {
      this.logHistory(`⚠️ ${this.players[color].name} rolled three 6s in a row! Turn forfeited.`);
      this.consecutiveSixes = 0;
      this.nextTurn();
      return { success: true, diceValue, forfeited: true, movableTokens: [] };
    }

    // Calculate valid moves
    this.movableTokens = this.getMovableTokens(color, diceValue);

    // If no valid moves, pass turn (unless rolled 6? No, if rolled 6 but no moves, roll 6 allows another roll if moves exist, but if no moves at all, pass turn or keep roll if 6? In Ludo, if no piece can move even on 6, turn passes).
    if (this.movableTokens.length === 0) {
      this.logHistory(`No valid moves for ${this.players[color].name}.`);
      // If rolled 6 and no move possible, pass turn
      setTimeout(() => {
        this.nextTurn();
      }, 1000);
    } else if (this.movableTokens.length === 1 && this.players[color].isBot) {
      // Auto move single option for bot after slight delay
    }

    return {
      success: true,
      diceValue,
      movableTokens: this.movableTokens
    };
  }

  // Find which tokens can legally move for given dice roll
  getMovableTokens(color, diceValue) {
    const colorTokens = this.tokens[color];
    const movable = [];

    for (const token of colorTokens) {
      const { step } = token;
      
      // Goal tokens cannot move
      if (step === 56) continue;

      // Base token needs a 6 to open
      if (step === -1) {
        if (diceValue === 6) {
          movable.push(token.id);
        }
        continue;
      }

      // Token on path: step + diceValue must be <= 56
      if (step + diceValue <= 56) {
        movable.push(token.id);
      }
    }

    return movable;
  }

  // Move token
  moveToken(color, tokenId) {
    if (this.status !== 'PLAYING') return { success: false, message: 'Game not active' };
    if (this.getCurrentTurnColor() !== color) return { success: false, message: 'Not your turn' };
    if (!this.hasRolled) return { success: false, message: 'Must roll dice first' };
    if (!this.movableTokens.includes(tokenId)) return { success: false, message: 'Invalid token choice' };

    const token = this.tokens[color].find(t => t.id === tokenId);
    if (!token) return { success: false, message: 'Token not found' };

    const oldStep = token.step;
    let newStep = oldStep;

    if (oldStep === -1) {
      // Coming out of base on 6
      newStep = 0;
    } else {
      newStep = oldStep + this.lastDiceValue;
    }

    token.step = newStep;

    let captured = null;
    let reachedGoal = false;

    // Check Goal
    if (newStep === 56) {
      reachedGoal = true;
      this.logHistory(`🎉 ${this.players[color].name}'s token reached GOAL!`);
    } else {
      // Check capture if on main path
      const absPos = this.getAbsolutePosition(color, newStep);
      if (absPos.type === 'MAIN' && !absPos.isSafe) {
        captured = this.checkCapture(absPos.mainIndex, color);
      }
    }

    // Check if player won (all 4 tokens in GOAL)
    const allInGoal = this.tokens[color].every(t => t.step === 56);
    if (allInGoal && !this.winnerRankings.includes(color)) {
      this.players[color].hasWon = true;
      this.winnerRankings.push(color);
      const rankOrdinal = ['1st', '2nd', '3rd', '4th'][this.winnerRankings.length - 1];
      this.logHistory(`🏆 ${this.players[color].name} finished in ${rankOrdinal} PLACE!`);

      // Check if game ends (3 players finished or only 1 player remains)
      if (this.winnerRankings.length >= 3 || this.activeColors.length - this.winnerRankings.length <= 1) {
        this.status = 'FINISHED';
        this.logHistory(`🎮 GAME OVER! Winner is ${this.players[this.winnerRankings[0]].name}!`);
        return {
          success: true,
          color,
          tokenId,
          oldStep,
          newStep,
          captured,
          reachedGoal,
          gameOver: true,
          winnerRankings: this.winnerRankings
        };
      }
    }

    // Extra Turn logic:
    // Player gets another turn if:
    // 1. Rolled a 6
    // 2. Captured an opponent token
    // 3. Reached GOAL with a token
    const getsExtraTurn = (this.lastDiceValue === 6 || captured !== null || reachedGoal) && !allInGoal;

    if (getsExtraTurn) {
      const reason = this.lastDiceValue === 6 ? 'rolling a 6' : (captured ? 'capturing a piece' : 'reaching goal');
      this.logHistory(`✨ ${this.players[color].name} gets an extra turn for ${reason}!`);
      this.resetTurnState();
      this.checkAndTriggerBotTurn();
    } else {
      this.nextTurn();
    }

    return {
      success: true,
      color,
      tokenId,
      oldStep,
      newStep,
      captured,
      reachedGoal,
      extraTurn: getsExtraTurn,
      gameOver: false
    };
  }

  // Check and execute capture on main path index
  checkCapture(mainIndex, attackingColor) {
    for (const defenderColor of COLORS) {
      if (defenderColor === attackingColor) continue;

      for (const defenderToken of this.tokens[defenderColor]) {
        if (defenderToken.step >= 0 && defenderToken.step <= 50) {
          const defenderAbs = this.getAbsolutePosition(defenderColor, defenderToken.step);
          if (defenderAbs.type === 'MAIN' && defenderAbs.mainIndex === mainIndex) {
            // Captured! Reset to BASE (-1)
            defenderToken.step = -1;
            this.logHistory(`⚔️ ${this.players[attackingColor].name} captured ${this.players[defenderColor].name}'s token!`);
            return { color: defenderColor, tokenId: defenderToken.id };
          }
        }
      }
    }
    return null;
  }

  // Advance turn to next active non-finished player
  nextTurn() {
    this.consecutiveSixes = 0;
    this.resetTurnState();

    let attempts = 0;
    do {
      this.currentTurnIndex = (this.currentTurnIndex + 1) % 4;
      attempts++;
      const player = this.players[this.activeColors[this.currentTurnIndex]];
      if (player && !player.hasWon) {
        break;
      }
    } while (attempts < 4);

    const nextColor = this.getCurrentTurnColor();
    this.logHistory(`It's ${this.players[nextColor]?.name || nextColor}'s turn.`);

    if (this.onStateChange) {
      this.onStateChange();
    }

    this.checkAndTriggerBotTurn();
  }

  // AI Bot Logic
  checkAndTriggerBotTurn() {
    if (this.status !== 'PLAYING') return;
    if (this.isBotProcessing) return;

    const currentColor = this.getCurrentTurnColor();
    const player = this.players[currentColor];

    if (player && player.isBot && player.isConnected !== false) {
      this.isBotProcessing = true;

      setTimeout(() => {
        if (this.status !== 'PLAYING' || this.getCurrentTurnColor() !== currentColor) {
          this.isBotProcessing = false;
          return;
        }

        // Step 1: Roll Dice
        const rollResult = this.rollDice(currentColor);
        
        if (this.onBotAction) {
          this.onBotAction({ type: 'ROLL', color: currentColor, result: rollResult });
        }

        if (rollResult.success && rollResult.movableTokens && rollResult.movableTokens.length > 0) {
          setTimeout(() => {
            if (this.status !== 'PLAYING' || this.getCurrentTurnColor() !== currentColor) {
              this.isBotProcessing = false;
              return;
            }
            
            // Choose best token for bot
            const chosenTokenId = this.chooseBestBotToken(currentColor, rollResult.diceValue, rollResult.movableTokens);
            this.isBotProcessing = false;
            const moveResult = this.moveToken(currentColor, chosenTokenId);

            if (this.onBotAction) {
              this.onBotAction({ type: 'MOVE', color: currentColor, result: moveResult });
            }
          }, 900);
        } else {
          this.isBotProcessing = false;
        }
      }, 800);
    }
  }

  // Smart Bot Decision Making
  chooseBestBotToken(color, diceValue, movableTokens) {
    if (movableTokens.length === 1) return movableTokens[0];

    let bestTokenId = movableTokens[0];
    let highestScore = -999;

    for (const tokenId of movableTokens) {
      const token = this.tokens[color].find(t => t.id === tokenId);
      let score = 0;

      // Rule 1: Priority to open token from base
      if (token.step === -1 && diceValue === 6) {
        score += 80;
      }

      // Rule 2: Priority to reach goal
      if (token.step + diceValue === 56) {
        score += 100;
      }

      // Rule 3: Priority to capture opponent
      const newStep = token.step + diceValue;
      const absPos = this.getAbsolutePosition(color, newStep);
      if (absPos.type === 'MAIN' && !absPos.isSafe) {
        for (const oppColor of COLORS) {
          if (oppColor === color) continue;
          for (const oppToken of this.tokens[oppColor]) {
            if (oppToken.step >= 0 && oppToken.step <= 50) {
              const oppAbs = this.getAbsolutePosition(oppColor, oppToken.step);
              if (oppAbs.type === 'MAIN' && oppAbs.mainIndex === absPos.mainIndex) {
                score += 90; // Capture bonus!
              }
            }
          }
        }
      }

      // Rule 4: Priority to land on safe spot
      if (absPos.type === 'MAIN' && absPos.isSafe) {
        score += 30;
      }

      // Rule 5: Advance furthest token along home stretch
      if (token.step >= 51) {
        score += 40 + token.step;
      } else {
        score += token.step; // General advancement
      }

      if (score > highestScore) {
        highestScore = score;
        bestTokenId = tokenId;
      }
    }

    return bestTokenId;
  }

  logHistory(msg) {
    const entry = { time: new Date().toLocaleTimeString(), message: msg };
    this.history.push(entry);
    if (this.history.length > 50) this.history.shift();
  }

  // Full state payload for client sync
  getState() {
    return {
      roomId: this.roomId,
      status: this.status,
      players: this.players,
      hostSocketId: this.hostSocketId,
      spectatorsCount: this.spectators.size,
      currentTurnColor: this.getCurrentTurnColor(),
      lastDiceValue: this.lastDiceValue,
      hasRolled: this.hasRolled,
      movableTokens: this.movableTokens,
      tokens: this.tokens,
      winnerRankings: this.winnerRankings,
      history: this.history.slice(-15)
    };
  }
}

module.exports = { LudoEngine, COLORS, START_INDEXES, SAFE_SPOTS };
