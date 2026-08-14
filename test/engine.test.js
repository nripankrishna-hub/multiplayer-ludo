const { LudoEngine, COLORS } = require('../lib/ludo-engine.js');
const assert = require('assert');

console.log('Testing Ludo Engine...');

const engine = new LudoEngine('test-room');

// Test 1: Add players & bots
assert.strictEqual(engine.addPlayer('socket1', 'Alice', 'red').success, true);
assert.strictEqual(engine.addBot('green'), true);
assert.strictEqual(engine.addBot('yellow'), true);
assert.strictEqual(engine.addBot('blue'), true);

assert.strictEqual(engine.players.red.name, 'Alice');
assert.strictEqual(engine.players.green.isBot, true);

// Test 2: Start game
engine.startGame();
assert.strictEqual(engine.status, 'PLAYING');
assert.strictEqual(engine.getCurrentTurnColor(), 'red');

// Test 3: Rolling without 6 when all tokens in base gives no movable tokens
engine.lastDiceValue = 4;
engine.hasRolled = true;
const movables = engine.getMovableTokens('red', 4);
assert.strictEqual(movables.length, 0);

// Test 4: Rolling 6 with tokens in base allows opening token 0
const movables6 = engine.getMovableTokens('red', 6);
assert.deepStrictEqual(movables6, [0, 1, 2, 3]);

// Test 5: Move token 0 out of base
engine.lastDiceValue = 6;
engine.hasRolled = true;
engine.movableTokens = [0, 1, 2, 3];
const moveRes = engine.moveToken('red', 0);
assert.strictEqual(moveRes.success, true);
assert.strictEqual(engine.tokens.red[0].step, 0);

// Test 6: Absolute position check
const absPos = engine.getAbsolutePosition('red', 0);
assert.strictEqual(absPos.type, 'MAIN');
assert.strictEqual(absPos.mainIndex, 0);
assert.strictEqual(absPos.isSafe, true);

// Test 7: Green absolute position at step 0
const greenAbs = engine.getAbsolutePosition('green', 0);
assert.strictEqual(greenAbs.mainIndex, 13);
assert.strictEqual(greenAbs.isSafe, true);

console.log('✅ All Ludo Engine tests passed!');
