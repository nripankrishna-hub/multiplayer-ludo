/**
 * Ludo Board Renderer & Coordinate System with Location Pin Pawns & Image 1 Layout
 */

const MAIN_PATH_COORDS = [
  { r: 6, c: 1 },  // 0  Green Start ⭐
  { r: 6, c: 2 },  // 1
  { r: 6, c: 3 },  // 2
  { r: 6, c: 4 },  // 3
  { r: 6, c: 5 },  // 4
  { r: 5, c: 6 },  // 5
  { r: 4, c: 6 },  // 6
  { r: 3, c: 6 },  // 7
  { r: 2, c: 6 },  // 8  Green Secondary ⭐
  { r: 1, c: 6 },  // 9
  { r: 0, c: 6 },  // 10
  { r: 0, c: 7 },  // 11 Top Center
  { r: 0, c: 8 },  // 12
  { r: 1, c: 8 },  // 13 Yellow Start ⭐
  { r: 2, c: 8 },  // 14
  { r: 3, c: 8 },  // 15
  { r: 4, c: 8 },  // 16
  { r: 5, c: 8 },  // 17
  { r: 6, c: 9 },  // 18
  { r: 6, c: 10 }, // 19
  { r: 6, c: 11 }, // 20
  { r: 6, c: 12 }, // 21 Yellow Secondary ⭐
  { r: 6, c: 13 }, // 22
  { r: 6, c: 14 }, // 23
  { r: 7, c: 14 }, // 24 Right Center
  { r: 8, c: 14 }, // 25
  { r: 8, c: 13 }, // 26 Blue Start ⭐
  { r: 8, c: 12 }, // 27
  { r: 8, c: 11 }, // 28
  { r: 8, c: 10 }, // 29
  { r: 8, c: 9 },  // 30
  { r: 9, c: 8 },  // 31
  { r: 10, c: 8 }, // 32
  { r: 11, c: 8 }, // 33
  { r: 12, c: 8 }, // 34 Blue Secondary ⭐
  { r: 13, c: 8 }, // 35
  { r: 14, c: 8 }, // 36
  { r: 14, c: 7 }, // 37 Bottom Center
  { r: 14, c: 6 }, // 38
  { r: 13, c: 6 }, // 39 Red Start ⭐
  { r: 12, c: 6 }, // 40
  { r: 11, c: 6 }, // 41
  { r: 10, c: 6 }, // 42
  { r: 9, c: 6 },  // 43
  { r: 8, c: 5 },  // 44
  { r: 8, c: 4 },  // 45
  { r: 8, c: 3 },  // 46
  { r: 8, c: 2 },  // 47 Red Secondary ⭐
  { r: 8, c: 1 },  // 48
  { r: 8, c: 0 },  // 49
  { r: 7, c: 0 },  // 50 Left Center
  { r: 6, c: 0 }   // 51
];

const HOME_STRETCH_COORDS = {
  green:  [{ r: 7, c: 1 }, { r: 7, c: 2 }, { r: 7, c: 3 }, { r: 7, c: 4 }, { r: 7, c: 5 }],
  yellow: [{ r: 1, c: 7 }, { r: 2, c: 7 }, { r: 3, c: 7 }, { r: 4, c: 7 }, { r: 5, c: 7 }],
  blue:   [{ r: 7, c: 13 }, { r: 7, c: 12 }, { r: 7, c: 11 }, { r: 7, c: 10 }, { r: 7, c: 9 }],
  red:    [{ r: 13, c: 7 }, { r: 12, c: 7 }, { r: 11, c: 7 }, { r: 10, c: 7 }, { r: 9, c: 7 }]
};

const BASE_SLOT_COORDS = {
  green:  [{ r: 1.3, c: 1.3 }, { r: 1.3, c: 3.7 }, { r: 3.7, c: 1.3 }, { r: 3.7, c: 3.7 }],
  yellow: [{ r: 1.3, c: 10.3 }, { r: 1.3, c: 12.7 }, { r: 3.7, c: 10.3 }, { r: 3.7, c: 12.7 }],
  blue:   [{ r: 10.3, c: 10.3 }, { r: 10.3, c: 12.7 }, { r: 12.7, c: 10.3 }, { r: 12.7, c: 12.7 }],
  red:    [{ r: 10.3, c: 1.3 }, { r: 10.3, c: 3.7 }, { r: 12.7, c: 1.3 }, { r: 12.7, c: 3.7 }]
};

const GOAL_TARGET_COORDS = {
  green:  { r: 7, c: 6 },
  yellow: { r: 6, c: 7 },
  blue:   { r: 7, c: 8 },
  red:    { r: 8, c: 7 }
};

// Create 3D Pin / Location Pointer Pawn SVG matching Image 2
function createPawnSVG(color, number) {
  const colorGradients = {
    red:    { inner1: '#ff6b6b', inner2: '#e52521', inner3: '#880000' },
    green:  { inner1: '#51cf66', inner2: '#00a651', inner3: '#00572b' },
    yellow: { inner1: '#ffd43b', inner2: '#f7b500', inner3: '#8c6600' },
    blue:   { inner1: '#4dabf7', inner2: '#0072bc', inner3: '#003a61' }
  };
  const g = colorGradients[color] || colorGradients.red;
  const uniqueId = `${color}_${number}_${Math.floor(Math.random()*10000)}`;

  return `
    <svg viewBox="0 0 100 125" class="pawn-svg">
      <defs>
        <!-- Chrome/Silver Metallic Rim Gradient -->
        <linearGradient id="silverRim_${uniqueId}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="35%" stop-color="#cbd5e1"/>
          <stop offset="65%" stop-color="#64748b"/>
          <stop offset="100%" stop-color="#334155"/>
        </linearGradient>

        <!-- Glossy Inner Color Sphere Gradient -->
        <radialGradient id="sphere_${uniqueId}" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="${g.inner1}"/>
          <stop offset="60%" stop-color="${g.inner2}"/>
          <stop offset="100%" stop-color="${g.inner3}"/>
        </radialGradient>

        <!-- Drop Shadow Filter -->
        <filter id="pawnShadow_${uniqueId}" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="5" stdDeviation="3.5" flood-color="#000000" flood-opacity="0.45"/>
        </filter>
      </defs>

      <g filter="url(#pawnShadow_${uniqueId})">
        <!-- Base Ground Shadow -->
        <ellipse cx="50" cy="114" rx="20" ry="7" fill="rgba(0,0,0,0.35)" />

        <!-- Chrome Metallic Outer Pin Body -->
        <path d="M 50 112 C 22 76 14 58 14 42 A 36 36 0 1 1 86 42 C 86 58 78 76 50 112 Z" 
              fill="url(#silverRim_${uniqueId})" stroke="#1e293b" stroke-width="2" stroke-linejoin="round" />

        <!-- Glossy Colored Center Core -->
        <circle cx="50" cy="42" r="23" fill="url(#sphere_${uniqueId})" stroke="rgba(255,255,255,0.7)" stroke-width="2.5" />

        <!-- Specular Highlight Curve -->
        <ellipse cx="42" cy="31" rx="8" ry="4.5" fill="#ffffff" opacity="0.75" transform="rotate(-30 42 31)" />

        <!-- Number Badge Circle -->
        <circle cx="50" cy="42" r="8" fill="rgba(0,0,0,0.45)" />
        <text x="50" y="46" text-anchor="middle" fill="#ffffff" font-weight="900" font-size="11" font-family="'Outfit', sans-serif">${number}</text>
      </g>
    </svg>
  `;
}

class BoardRenderer {
  constructor(containerEl) {
    this.container = containerEl;
    this.tokensLayer = document.getElementById('tokensLayer');
    this.cellsMap = new Map();
    this.tokenElements = new Map();
    this.animatingTokenKey = null;
    this.animatingCapturedDefenderKey = null;

    this.initBoardGrid();
    this.initTokensLayer();
  }

  // Transform logical grid coordinates to player's visual orientation
  getVisualCoords(r, c) {
    const color = this.orientationColor || 'red';
    switch (color) {
      case 'green':
        return { r: 14 - c, c: r };
      case 'yellow':
        return { r: 14 - r, c: 14 - c };
      case 'blue':
        return { r: c, c: 14 - r };
      case 'red':
      default:
        return { r, c };
    }
  }

  // Orient board so the current player's starting base & path are ALWAYS at Bottom-Left!
  setBoardOrientation(playerColor) {
    const targetColor = playerColor || 'red';
    if (this.orientationColor === targetColor) return;
    this.orientationColor = targetColor;

    // Reset container CSS transform so animations remain 100% vertical on screen
    const boardWrapper = document.querySelector('.board-wrapper');
    if (boardWrapper) {
      boardWrapper.style.transform = 'none';
      boardWrapper.style.removeProperty('--board-rotation');
      boardWrapper.style.removeProperty('--pawn-unrotate');
    }

    // Re-render board grid cells at visual coordinates for player's perspective
    this.initBoardGrid();
  }

  // Create 15x15 Board Grid matching Image 1
  initBoardGrid() {
    this.container.innerHTML = '';

    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {

        // Base Blocks
        if (r < 6 && c < 6) {
          if (r === 0 && c === 0) this.createBaseBlock('green', 0, 0);
          continue;
        }
        if (r < 6 && c > 8) {
          if (r === 0 && c === 9) this.createBaseBlock('yellow', 0, 9);
          continue;
        }
        if (r > 8 && c > 8) {
          if (r === 9 && c === 9) this.createBaseBlock('blue', 9, 9);
          continue;
        }
        if (r > 8 && c < 6) {
          if (r === 9 && c === 0) this.createBaseBlock('red', 9, 0);
          continue;
        }

        // Center Goal
        if (r >= 6 && r <= 8 && c >= 6 && c <= 8) {
          if (r === 6 && c === 6) this.createCenterGoal();
          continue;
        }

        // Normal Track Cells
        const vis = this.getVisualCoords(r, c);
        const cell = document.createElement('div');
        cell.className = 'board-cell';
        cell.style.gridRow = `${Math.round(vis.r) + 1}`;
        cell.style.gridColumn = `${Math.round(vis.c) + 1}`;

        // Home Stretches
        if (r === 7 && c >= 1 && c <= 5) {
          cell.classList.add('path-green');
        } else if (c === 7 && r >= 1 && r <= 5) {
          cell.classList.add('path-yellow');
        } else if (r === 7 && c >= 9 && c <= 13) {
          cell.classList.add('path-blue');
        } else if (c === 7 && r >= 9 && r <= 13) {
          cell.classList.add('path-red');
        }

        // Entry Start Arrows
        if (r === 7 && c === 0) {
          cell.innerHTML = '<span class="entry-arrow green">&gt;</span>';
        } else if (r === 0 && c === 7) {
          cell.innerHTML = '<span class="entry-arrow yellow">v</span>';
        } else if (r === 7 && c === 14) {
          cell.innerHTML = '<span class="entry-arrow blue">&lt;</span>';
        } else if (r === 14 && c === 7) {
          cell.innerHTML = '<span class="entry-arrow red">^</span>';
        }

        // Starting positions colored backgrounds
        if (r === 6 && c === 1) cell.classList.add('start-cell-green');
        if (r === 1 && c === 8) cell.classList.add('start-cell-yellow');
        if (r === 8 && c === 13) cell.classList.add('start-cell-blue');
        if (r === 13 && c === 6) cell.classList.add('start-cell-red');

        // Safe Stars
        const isTrackSafe = (r === 8 && c === 2) || (r === 2 && c === 6) || (r === 6 && c === 12) || (r === 12 && c === 8);

        if (isTrackSafe) {
          cell.innerHTML = '<span class="safe-star">☆</span>';
        }

        this.container.appendChild(cell);
        this.cellsMap.set(`${r}-${c}`, cell);
      }
    }
  }

  // Create Base Blocks matching Image 1
  createBaseBlock(color, startRow, startCol) {
    const vis1 = this.getVisualCoords(startRow, startCol);
    const vis2 = this.getVisualCoords(startRow + 5, startCol + 5);
    const minR = Math.min(vis1.r, vis2.r);
    const minC = Math.min(vis1.c, vis2.c);

    const baseCell = document.createElement('div');
    baseCell.className = `base-cell ${color}`;
    baseCell.style.gridRow = `${Math.round(minR) + 1} / span 6`;
    baseCell.style.gridColumn = `${Math.round(minC) + 1} / span 6`;

    const inner = document.createElement('div');
    inner.className = 'base-inner';

    for (let i = 0; i < 4; i++) {
      const slot = document.createElement('div');
      slot.className = 'base-slot';
      slot.id = `slot-${color}-${i}`;
      inner.appendChild(slot);
    }

    baseCell.appendChild(inner);
    this.container.appendChild(baseCell);
  }

  createCenterGoal() {
    const vis1 = this.getVisualCoords(6, 6);
    const vis2 = this.getVisualCoords(8, 8);
    const minR = Math.min(vis1.r, vis2.r);
    const minC = Math.min(vis1.c, vis2.c);

    const center = document.createElement('div');
    center.className = 'center-goal';
    center.style.gridRow = `${Math.round(minR) + 1} / span 3`;
    center.style.gridColumn = `${Math.round(minC) + 1} / span 3`;

    center.innerHTML = `
      <svg viewBox="0 0 100 100" style="width:100%; height:100%; display:block;" preserveAspectRatio="none">
        <!-- Top Triangle: Yellow -->
        <polygon points="0,0 100,0 50,50" fill="#f7b500" />
        <!-- Right Triangle: Blue -->
        <polygon points="100,0 100,100 50,50" fill="#0072bc" />
        <!-- Bottom Triangle: Red -->
        <polygon points="0,100 100,100 50,50" fill="#e52521" />
        <!-- Left Triangle: Green -->
        <polygon points="0,0 0,100 50,50" fill="#00a651" />

        <!-- Diagonal X Lines & Border -->
        <line x1="0" y1="0" x2="100" y2="100" stroke="#000000" stroke-width="2" />
        <line x1="100" y1="0" x2="0" y2="100" stroke="#000000" stroke-width="2" />
        <rect x="0" y="0" width="100" height="100" fill="none" stroke="#000000" stroke-width="3" />
      </svg>
    `;

    this.container.appendChild(center);
  }

  // Create persistent token DOM elements inside tokensLayer
  initTokensLayer() {
    if (!this.tokensLayer) return;
    this.tokensLayer.innerHTML = '';
    this.tokenElements.clear();

    const colors = ['red', 'green', 'yellow', 'blue'];
    colors.forEach(color => {
      for (let id = 0; id < 4; id++) {
        const tokenKey = `${color}-${id}`;
        const tokenEl = document.createElement('div');
        tokenEl.className = `token ${color}`;
        tokenEl.dataset.color = color;
        tokenEl.dataset.tokenId = id;
        tokenEl.innerHTML = createPawnSVG(color, id + 1);

        const baseCoord = this.getGridCoordinates(color, -1, id);
        tokenEl.style.left = `${(baseCoord.c / 15) * 100}%`;
        tokenEl.style.top = `${(baseCoord.r / 15) * 100}%`;

        this.tokensLayer.appendChild(tokenEl);
        this.tokenElements.set(tokenKey, tokenEl);
      }
    });
  }

  // Calculate (r, c) grid coordinates for step
  getGridCoordinates(color, step, tokenId) {
    let raw;
    if (step === -1) {
      raw = BASE_SLOT_COORDS[color][tokenId];
    } else if (step === 56) {
      raw = GOAL_TARGET_COORDS[color];
    } else if (step >= 51) {
      raw = HOME_STRETCH_COORDS[color][step - 51];
    } else {
      const startIdx = { green: 0, yellow: 13, blue: 26, red: 39 }[color];
      const mainIdx = (startIdx + step) % 52;
      raw = MAIN_PATH_COORDS[mainIdx];
    }
    return this.getVisualCoords(raw.r, raw.c);
  }

  // Position token smoothly using percentage left & top
  positionToken(tokenKey, color, step, tokenId, stackingIndex = 0) {
    const tokenEl = this.tokenElements.get(tokenKey);
    if (!tokenEl) return;

    const coord = this.getGridCoordinates(color, step, tokenId);
    
    // Spread stacked tokens on main track cells so every pawn is distinctly visible
    let stackOffsetX = 0;
    let stackOffsetY = 0;
    if (step >= 0 && stackingIndex > 0) {
      const offsets = [
        { x: 0, y: 0 },
        { x: 1.2, y: -1.2 },
        { x: -1.2, y: 1.2 },
        { x: 1.2, y: 1.2 }
      ];
      const off = offsets[stackingIndex % 4];
      stackOffsetX = off.x;
      stackOffsetY = off.y;
    }

    const leftPct = `${((coord.c / 15) * 100 + stackOffsetX).toFixed(2)}%`;
    const topPct = `${((coord.r / 15) * 100 + stackOffsetY).toFixed(2)}%`;

    if (tokenEl.dataset.leftPct !== leftPct) {
      tokenEl.dataset.leftPct = leftPct;
      tokenEl.style.left = leftPct;
    }
    if (tokenEl.dataset.topPct !== topPct) {
      tokenEl.dataset.topPct = topPct;
      tokenEl.style.top = topPct;
    }
  }

  // Clear highlights immediately when a move starts
  clearMovableHighlights() {
    this.tokenElements.forEach(tokenEl => {
      tokenEl.classList.remove('movable', 'step-hop', 'captured-hit', 'goal-reach');
      tokenEl.onclick = null;
    });
  }

  // Render static token state from server
  renderTokens(gameState, myColor, onTokenClick) {
    if (!gameState || !gameState.tokens) return;

    const { tokens, movableTokens, currentTurnColor, hasRolled } = gameState;
    const cellOccupancy = new Map();

    for (const color of ['red', 'green', 'yellow', 'blue']) {
      const colorTokens = tokens[color];
      const playerAssigned = gameState.players && gameState.players[color] !== null;

      if (!colorTokens) continue;

      colorTokens.forEach(t => {
        const tokenKey = `${color}-${t.id}`;
        const tokenEl = this.tokenElements.get(tokenKey);
        if (!tokenEl) return;

        if (!playerAssigned) {
          tokenEl.style.display = 'none';
          return;
        } else {
          tokenEl.style.display = 'flex';
        }

        const isSelfAnimating = this.animatingTokenKey === tokenKey || this.animatingCapturedDefenderKey === tokenKey;

        // Forcefully strip stale animation classes if token is not actively mid-animation
        if (!isSelfAnimating) {
          tokenEl.classList.remove('step-hop', 'captured-hit', 'goal-reach');

          const coord = this.getGridCoordinates(color, t.step, t.id);
          const cellKey = `${coord.r.toFixed(1)}-${coord.c.toFixed(1)}`;
          const count = cellOccupancy.get(cellKey) || 0;
          cellOccupancy.set(cellKey, count + 1);

          this.positionToken(tokenKey, color, t.step, t.id, count);
        }

        // Movable highlight
        const isTurnColor = currentTurnColor === color;
        const isMovableToken = Array.isArray(movableTokens) && movableTokens.some(id => Number(id) === Number(t.id));
        const isMovable = !isSelfAnimating && hasRolled && isTurnColor && isMovableToken;
        const isMyTurn = currentTurnColor === myColor;

        if (isMovable) {
          if (!tokenEl.classList.contains('movable')) {
            tokenEl.classList.add('movable');
          }
          tokenEl.style.zIndex = '9999';
          if (isMyTurn) {
            tokenEl.onclick = (e) => {
              e.stopPropagation();
              this.clearMovableHighlights();
              if (onTokenClick) onTokenClick(t.id);
            };
          } else {
            tokenEl.onclick = null;
          }
        } else {
          if (tokenEl.classList.contains('movable')) {
            tokenEl.classList.remove('movable');
          }
          tokenEl.style.zIndex = (currentTurnColor === color) ? '50' : '20';
          tokenEl.onclick = null;
        }
      });
    }
  }

  // Silky Smooth Step-by-Step Hopping Movement & Synchronized Capture
  animateMove(moveResult, gameState, myColor, onStepHop, onComplete) {
    const { color, tokenId, oldStep, newStep, captured, reachedGoal } = moveResult;
    const tokenKey = `${color}-${tokenId}`;
    const tokenEl = this.tokenElements.get(tokenKey);

    // Immediately clear highlights so no pieces pulse during animation
    this.clearMovableHighlights();
    if (gameState) gameState.movableTokens = [];

    // Track captured defender key so renderTokens doesn't move defender prematurely
    if (captured) {
      this.animatingCapturedDefenderKey = `${captured.color}-${captured.tokenId}`;
    } else {
      this.animatingCapturedDefenderKey = null;
    }

    if (!tokenEl) {
      if (gameState && gameState.tokens && gameState.tokens[color]) {
        const targetToken = gameState.tokens[color].find(t => t.id === tokenId);
        if (targetToken) targetToken.step = newStep;
      }
      if (captured && gameState && gameState.tokens && gameState.tokens[captured.color]) {
        const defToken = gameState.tokens[captured.color].find(t => t.id === captured.tokenId);
        if (defToken) defToken.step = -1;
      }
      this.animatingCapturedDefenderKey = null;
      if (onComplete) onComplete();
      return;
    }

    this.animatingTokenKey = tokenKey;

    // Reset dataset position cache so positionToken forces DOM placement at oldStep without jumping
    delete tokenEl.dataset.leftPct;
    delete tokenEl.dataset.topPct;
    this.positionToken(tokenKey, color, oldStep, tokenId);

    // Step 1: Open from Base (-1 to 0)
    if (oldStep === -1) {
      this.positionToken(tokenKey, color, 0, tokenId);
      tokenEl.classList.add('step-hop');
      if (onStepHop) onStepHop();

      if (gameState && gameState.tokens && gameState.tokens[color]) {
        const targetToken = gameState.tokens[color].find(t => t.id === tokenId);
        if (targetToken) targetToken.step = 0;
      }

      setTimeout(() => {
        tokenEl.classList.remove('step-hop');
        this.animatingTokenKey = null;
        this.animatingCapturedDefenderKey = null;
        this.renderTokens(gameState, myColor);
        if (onComplete) onComplete();
      }, 280);
      return;
    }

    // Step 2: Step-by-step movement loop
    const stepsSequence = [];
    for (let s = oldStep + 1; s <= newStep; s++) {
      stepsSequence.push(s);
    }

    let idx = 0;
    const stepInterval = setInterval(() => {
      if (idx >= stepsSequence.length) {
        clearInterval(stepInterval);

        if (gameState && gameState.tokens && gameState.tokens[color]) {
          const targetToken = gameState.tokens[color].find(t => t.id === tokenId);
          if (targetToken) targetToken.step = newStep;
        }

        // Check Capture ONLY when attacker lands on destination cell
        if (captured) {
          const defenderKey = `${captured.color}-${captured.tokenId}`;
          const defenderEl = this.tokenElements.get(defenderKey);

          if (defenderEl) {
            defenderEl.classList.add('captured-hit');

            setTimeout(() => {
              if (gameState && gameState.tokens && gameState.tokens[captured.color]) {
                const defToken = gameState.tokens[captured.color].find(t => t.id === captured.tokenId);
                if (defToken) defToken.step = -1;
              }
              this.positionToken(defenderKey, captured.color, -1, captured.tokenId);
              defenderEl.classList.remove('captured-hit');

              this.animatingTokenKey = null;
              this.animatingCapturedDefenderKey = null;
              this.renderTokens(gameState, myColor);
              if (onComplete) onComplete(true);
            }, 650);
            return;
          }
        }

        // Check Goal
        if (reachedGoal) {
          tokenEl.classList.add('goal-reach');
          setTimeout(() => {
            tokenEl.classList.remove('goal-reach');
            this.animatingTokenKey = null;
            this.animatingCapturedDefenderKey = null;
            this.renderTokens(gameState, myColor);
            if (onComplete) onComplete();
          }, 700);
          return;
        }

        this.animatingTokenKey = null;
        this.animatingCapturedDefenderKey = null;
        this.renderTokens(gameState, myColor);
        if (onComplete) onComplete();
        return;
      }

      const currentStep = stepsSequence[idx];
      this.positionToken(tokenKey, color, currentStep, tokenId);

      tokenEl.classList.remove('step-hop');
      void tokenEl.offsetWidth;
      tokenEl.classList.add('step-hop');

      if (onStepHop) onStepHop();

      idx++;
    }, 190);
  }
}
