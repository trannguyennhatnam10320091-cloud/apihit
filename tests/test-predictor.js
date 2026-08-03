'use strict';

const assert = require('assert');
const { AdaptiveSelectiveEngineV7, MODEL_VERSION } = require('../predictor');

function result(session, symbol) {
    const dice = symbol === 'T' ? [4, 4, 4] : [2, 2, 2];
    return {
        Phien: session,
        Xuc_xac_1: dice[0],
        Xuc_xac_2: dice[1],
        Xuc_xac_3: dice[2],
        Tong: dice.reduce((sum, value) => sum + value, 0),
        Ket_qua: symbol === 'T' ? 'Tài' : 'Xỉu'
    };
}

const engine = new AdaptiveSelectiveEngineV7({ minHistory: 20, maxEngineHistory: 240 });
assert.strictEqual(engine.modelVersion, MODEL_VERSION);

const sequence = 'TTXXTXXTTXTTXXTTXTXXTTXXT'.split('');
for (let index = 0; index < sequence.length; index += 1) {
    const outcome = engine.addResult(result(1000 + index, sequence[index]));
    assert.strictEqual(outcome.accepted, true);
    assert.ok(['WAIT_DATA', 'PREDICT', 'SKIP'].includes(outcome.decision.action));
}

assert.strictEqual(engine.history.length, sequence.length);
assert.ok(engine.getPublicHistory(10).length === 10);
assert.ok(engine.getPerformanceSummary().length === 3);
assert.ok(engine.getPublicStats().Tong_phien === sequence.length);

const duplicate = engine.addResult(result(1000 + sequence.length - 1, 'T'));
assert.strictEqual(duplicate.accepted, false);
assert.strictEqual(duplicate.reason, 'DUPLICATE');

const historyBeforeStatsReset = engine.history.length;
engine.resetStats();
assert.strictEqual(engine.history.length, historyBeforeStatsReset);
assert.strictEqual(engine.getPublicStats().Tong_phien, 0);

engine.stats.Tong_phien = 77;
engine.clearHistory();
assert.strictEqual(engine.history.length, 0);
assert.strictEqual(engine.getPublicStats().Tong_phien, 77);

engine.resetAll();
assert.strictEqual(engine.history.length, 0);
assert.strictEqual(engine.getPublicStats().Tong_phien, 0);

console.log('PASS test-predictor');
