'use strict';

const assert = require('assert');
const { makeResult, extractResults, feeds, buildApi } = require('../server');

const valid = makeResult(123, 6, 4, 2);
assert.deepStrictEqual(valid, {
    Phien: 123,
    Xuc_xac_1: 6,
    Xuc_xac_2: 4,
    Xuc_xac_3: 2,
    Tong: 12,
    Ket_qua: 'Tài'
});
assert.strictEqual(makeResult('bad', 1, 2, 3), null);
assert.strictEqual(makeResult(123, 0, 2, 3), null);

const md5 = extractResults(feeds.md5, {
    status: 'OK',
    data: [
        { cmd: 2006, sid: 10, d1: 1, d2: 2, d3: 3 },
        { cmd: 2006, sid: 10, d1: 1, d2: 2, d3: 3 },
        { cmd: 9999 }
    ]
});
assert.strictEqual(md5.length, 1);
assert.strictEqual(md5[0].Ket_qua, 'Xỉu');

const hit = extractResults(feeds.hit, {
    status: 'OK',
    data: [
        { cmd: 1008, sid: 20 },
        { cmd: 1003, d1: 6, d2: 6, d3: 1 }
    ]
});
assert.strictEqual(hit.length, 1);
assert.strictEqual(hit[0].Phien, 20);
assert.strictEqual(hit[0].Ket_qua, 'Tài');

const api = buildApi(valid, {
    targetSession: 124,
    prediction: null,
    confidence: null,
    probabilityT: 0.51,
    pattern: { type: 'HỖN_HỢP', description: 'Tín hiệu yếu.' },
    reasons: [],
    action: 'SKIP',
    modelVersion: '7.0.0'
}, feeds.hit.engine);
assert.strictEqual(api.Trang_thai, 'SKIP');
assert.strictEqual(api.Du_doan, null);

console.log('PASS test-api');
