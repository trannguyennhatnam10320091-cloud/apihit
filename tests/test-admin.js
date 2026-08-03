'use strict';

process.env.ADMIN_ACTION_TOKEN = 'test-secret';
const assert = require('assert');
const http = require('http');
const { server, feeds } = require('../server');

function request(port, method, path, token) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port,
            method,
            path,
            headers: token ? { 'X-Admin-Token': token } : {}
        }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({
                status: res.statusCode,
                headers: res.headers,
                body: Buffer.concat(chunks).toString('utf8')
            }));
        });
        req.on('error', reject);
        req.end();
    });
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    try {
        const health = await request(port, 'GET', '/health');
        assert.strictEqual(health.status, 200);
        const unauthorized = await request(port, 'POST', '/api/admin/reset?board=xanh');
        assert.strictEqual(unauthorized.status, 401);
        const exported = await request(port, 'GET', '/api/admin/export?board=all&format=csv', 'test-secret');
        assert.strictEqual(exported.status, 200);
        assert.ok(exported.body.includes('board,session'));
        feeds.hit.engine.history.push({ Phien: 123, Ket_qua: 'Tài' });
        feeds.hit.engine.stats.Tong_phien = 99;
        const resetStats = await request(port, 'POST', '/api/admin/reset?board=xanh&target=stats', 'test-secret');
        assert.strictEqual(resetStats.status, 200);
        assert.strictEqual(feeds.hit.engine.getPublicStats().Tong_phien, 0);
        assert.strictEqual(feeds.hit.engine.history.length, 1);

        feeds.hit.engine.stats.Tong_phien = 45;
        feeds.hit.latestApi.Phien = 123;
        const clearHistory = await request(port, 'POST', '/api/admin/reset?board=xanh&target=history', 'test-secret');
        assert.strictEqual(clearHistory.status, 200);
        assert.strictEqual(feeds.hit.engine.history.length, 0);
        assert.strictEqual(feeds.hit.engine.getPublicStats().Tong_phien, 45);
        assert.strictEqual(feeds.hit.ignoreBeforeSid, 123);
        console.log('PASS test-admin');
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
