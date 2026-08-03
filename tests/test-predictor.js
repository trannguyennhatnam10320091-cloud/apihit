'use strict';

const assert = require('assert');
const {
    AdaptiveSelectiveEngineV7,
    MODEL_VERSION,
    alternatingSuffixLength
} = require('../predictor');

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

assert.strictEqual(alternatingSuffixLength('TTTXT'.split('')), 3);
assert.strictEqual(alternatingSuffixLength('XXXTX'.split('')), 3);
assert.strictEqual(alternatingSuffixLength('TXTX'.split('')), 4);
assert.strictEqual(alternatingSuffixLength('TTTT'.split('')), 1);

const engine = new AdaptiveSelectiveEngineV7({ maxEngineHistory: 240 });
assert.strictEqual(engine.modelVersion, MODEL_VERSION);

let out = engine.addResult(result(1000, 'T'));
assert.strictEqual(out.decision.prediction, 'Tài');
assert.strictEqual(out.decision.pattern.type, 'BÁM_PHIÊN_TRƯỚC');

out = engine.addResult(result(1001, 'T'));
assert.strictEqual(out.settled.Thang_thua, 'THẮNG');
assert.strictEqual(out.decision.prediction, 'Tài');

out = engine.addResult(result(1002, 'X'));
assert.strictEqual(out.decision.pattern.type, 'BÁM_PHIÊN_TRƯỚC');
assert.strictEqual(out.decision.prediction, 'Xỉu');

// Hậu tố T-X-T xuất hiện: nhận cầu 1-1 ngay và chọn cửa đối diện T là X.
out = engine.addResult(result(1003, 'T'));
assert.strictEqual(out.decision.pattern.type, 'CẦU_1-1');
assert.strictEqual(out.decision.prediction, 'Xỉu');
assert.strictEqual(out.decision.analysis.alternatingSuffixLength, 3);

// Cầu tiếp tục: giữ chế độ 1-1.
out = engine.addResult(result(1004, 'X'));
assert.strictEqual(out.settled.Thang_thua, 'THẮNG');
assert.strictEqual(out.decision.pattern.type, 'CẦU_1-1');
assert.strictEqual(out.decision.prediction, 'Tài');

// Cầu gãy ngay: dự đoán T nhưng thực tế lại X, phải quay về bám X.
out = engine.addResult(result(1005, 'X'));
assert.strictEqual(out.settled.Thang_thua, 'THUA');
assert.strictEqual(out.decision.pattern.type, 'BÁM_PHIÊN_TRƯỚC');
assert.strictEqual(out.decision.prediction, 'Xỉu');

// Mẫu đối xứng X-T-X cũng phải nhận, không phụ thuộc riêng T-X-T.
out = engine.addResult(result(1006, 'T'));
out = engine.addResult(result(1007, 'X'));
assert.strictEqual(out.decision.pattern.type, 'CẦU_1-1');
assert.strictEqual(out.decision.prediction, 'Tài');

assert.strictEqual(engine.history.length, 8);
assert.ok(engine.getPublicHistory(5).length === 5);
assert.ok(engine.getPerformanceSummary().length === 1);
assert.ok(engine.getPublicStats().Tong_phien === 8);

const duplicate = engine.addResult(result(1007, 'T'));
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
