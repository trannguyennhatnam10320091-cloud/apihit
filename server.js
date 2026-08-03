'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { AdaptiveSelectiveEngineV7, MODEL_VERSION, ENGINE_NAME } = require('./predictor');
const { parseLimit, percent, compactApi, historyApi, cauApi } = require('./compact-api');

const API_VERSION = '7.2.0-RUNTIME-BOT-READY';
const API_BUILD = '2026-08-03-V720-RUNTIME-BOT-READY';
const HOST = '0.0.0.0';
const PORT = Number(process.env.PORT) || 3001;
const POLL_INTERVAL = Math.max(700, Number(process.env.POLL_INTERVAL) || 1500);
const REQUEST_TIMEOUT = Math.max(2000, Number(process.env.REQUEST_TIMEOUT) || 8000);
const MIN_HISTORY = Math.max(8, Number(process.env.MIN_HISTORY) || 12);
const MAX_ENGINE_HISTORY = Math.max(12, Number(process.env.MAX_ENGINE_HISTORY) || 20);
const MAX_RUNTIME_HISTORY = Math.max(MAX_ENGINE_HISTORY, Number(process.env.MAX_RUNTIME_HISTORY) || 10000);
const PREDICT_EDGE = Number(process.env.PREDICT_EDGE) || 0.014;
const MIN_CONSENSUS = Number(process.env.MIN_CONSENSUS) || 0.56;
const ADMIN_ACTION_TOKEN = String(process.env.ADMIN_ACTION_TOKEN || '').trim();
const SOURCE_BASE = 'https://jakpotgwab.geightdors.net/glms/v1/notify/taixiu?platform_id=g8&gid=';

function emptyStats() {
    return {
        Tong_phien: 0,
        Tong_du_doan: 0,
        Bo_qua: 0,
        Thang: 0,
        Thua: 0,
        Ti_le_thang: '0%',
        Do_phu: '0%',
        Chuoi_thang_dai_nhat: 0,
        Chuoi_thua_dai_nhat: 0,
        Chuoi_hien_tai: { Loai: 'CHƯA_CÓ', So_luong: 0 }
    };
}

function emptyApi() {
    return {
        Phien: null,
        Xuc_xac: [],
        Tong: null,
        Ket_qua: null,
        Phien_tiep_theo: null,
        Du_doan: null,
        Do_tin_cay: null,
        Loai_cau: null,
        Mo_ta_cau: 'API vừa khởi động, đang chờ dữ liệu mới.',
        Ly_do_du_doan: [],
        Trang_thai: 'WAIT_DATA',
        Xac_suat: { Tai: '50%', Xiu: '50%' },
        Model_version: MODEL_VERSION,
        Thong_ke: emptyStats()
    };
}

function createFeed(key, name, gid, mode) {
    return {
        key,
        name,
        gid,
        mode,
        engine: new AdaptiveSelectiveEngineV7({
            minHistory: MIN_HISTORY,
            maxEngineHistory: MAX_ENGINE_HISTORY,
            maxRuntimeHistory: MAX_RUNTIME_HISTORY,
            predictEdge: PREDICT_EDGE,
            minConsensus: MIN_CONSENSUS,
            modelVersion: MODEL_VERSION,
            board: key
        }),
        latestApi: emptyApi(),
        pendingSid: null,
        running: false,
        stopped: false,
        lastSuccessAt: null,
        lastError: null,
        requests: 0,
        ignoreBeforeSid: null
    };
}

const feeds = {
    hit: createFeed('xanh', 'BÀN HŨ', 'vgmn_100', 'TX'),
    md5: createFeed('md5', 'BÀN MD5', 'vgmn_101', 'MD5')
};

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
    const payload = Buffer.from(String(body));
    res.writeHead(status, {
        'Content-Type': contentType,
        'Content-Length': payload.length,
        'Cache-Control': 'no-store',
        ...extraHeaders
    });
    res.end(payload);
}

function sendJson(res, status, body) {
    const payload = Buffer.from(JSON.stringify(body));
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': payload.length,
        'Cache-Control': 'no-store'
    });
    res.end(payload);
}

function normalizeDie(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 1 && number <= 6 ? number : null;
}

function makeResult(sid, d1, d2, d3) {
    const session = Number(sid);
    const dice = [normalizeDie(d1), normalizeDie(d2), normalizeDie(d3)];
    if (!Number.isSafeInteger(session) || dice.some(value => value === null)) return null;
    const total = dice.reduce((sum, value) => sum + value, 0);
    return {
        Phien: session,
        Xuc_xac_1: dice[0],
        Xuc_xac_2: dice[1],
        Xuc_xac_3: dice[2],
        Tong: total,
        Ket_qua: total > 10 ? 'Tài' : 'Xỉu'
    };
}

function extractResults(feed, data) {
    if (!data || data.status !== 'OK' || !Array.isArray(data.data)) return [];
    const results = [];

    if (feed.mode === 'MD5') {
        for (const item of data.data) {
            if (item && Number(item.cmd) === 2006) {
                const result = makeResult(item.sid, item.d1, item.d2, item.d3);
                if (result) results.push(result);
            }
        }
    } else {
        let sid = feed.pendingSid;
        for (const item of data.data) {
            if (!item || typeof item !== 'object') continue;
            if (Number(item.cmd) === 1008 && item.sid !== undefined) {
                sid = Number(item.sid);
                feed.pendingSid = sid;
                continue;
            }
            if (Number(item.cmd) === 1003 && sid !== null) {
                const result = makeResult(item.sid ?? sid, item.d1, item.d2, item.d3);
                if (result) {
                    results.push(result);
                    sid = null;
                    feed.pendingSid = null;
                }
            }
        }
    }

    const unique = new Map();
    for (const result of results) unique.set(result.Phien, result);
    return Array.from(unique.values()).sort((a, b) => a.Phien - b.Phien);
}

function requestJson(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 14) HIT-Adaptive-Runtime/7.0',
                Accept: 'application/json',
                'Cache-Control': 'no-cache'
            }
        }, res => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { raw += chunk; });
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                try { resolve(JSON.parse(raw)); }
                catch (error) { reject(new Error(`JSON không hợp lệ: ${error.message}`)); }
            });
        });
        req.setTimeout(REQUEST_TIMEOUT, () => req.destroy(new Error('Request timeout')));
        req.on('error', reject);
    });
}

function buildApi(result, decision, engine) {
    const probabilityT = Number.isFinite(decision.probabilityT) ? decision.probabilityT : 0.5;
    return {
        Phien: result.Phien,
        Xuc_xac: [result.Xuc_xac_1, result.Xuc_xac_2, result.Xuc_xac_3],
        Tong: result.Tong,
        Ket_qua: result.Ket_qua,
        Phien_tiep_theo: decision.targetSession,
        Du_doan: decision.prediction,
        Do_tin_cay: Number.isFinite(decision.confidence) ? `${decision.confidence}%` : null,
        Loai_cau: decision.pattern?.type || null,
        Mo_ta_cau: decision.pattern?.description || null,
        Ly_do_du_doan: Array.isArray(decision.reasons) ? decision.reasons : [],
        Trang_thai: decision.action,
        Xac_suat: { Tai: percent(probabilityT), Xiu: percent(1 - probabilityT) },
        Phan_tich: decision.analysis || null,
        Top_models: decision.topModels || [],
        Model_doi_lap: decision.opposingModels || [],
        Model_version: decision.modelVersion || MODEL_VERSION,
        Lich_su: engine.getPublicHistory(80),
        Hieu_suat_model: engine.getPerformanceSummary(),
        Thong_ke: engine.getPublicStats()
    };
}

async function handleResult(feed, result) {
    if (feed.ignoreBeforeSid !== null && result.Phien <= feed.ignoreBeforeSid) return;
    const outcome = feed.engine.addResult(result);
    if (!outcome.accepted) return;
    if (outcome.gap) console.warn(`[CẢNH BÁO] [${feed.name}] Thiếu ${outcome.gap.missingCount} phiên.`);
    feed.latestApi = buildApi(result, outcome.decision, feed.engine);
    console.log(`[KẾT QUẢ] [${feed.name}] ${result.Phien} | ${result.Xuc_xac_1}-${result.Xuc_xac_2}-${result.Xuc_xac_3} | ${result.Ket_qua}`);
    if (outcome.decision.action === 'PREDICT') {
        console.log(`[DỰ ĐOÁN] [${feed.name}] ${outcome.decision.targetSession} | ${outcome.decision.prediction} | ${outcome.decision.confidence}%`);
    } else {
        console.log(`[TRẠNG THÁI] [${feed.name}] ${outcome.decision.action}`);
    }
}

async function pollOnce(feed) {
    if (feed.running || feed.stopped) return;
    feed.running = true;
    try {
        const data = await requestJson(`${SOURCE_BASE}${encodeURIComponent(feed.gid)}`);
        feed.requests += 1;
        const results = extractResults(feed, data);
        for (const result of results) await handleResult(feed, result);
        feed.lastSuccessAt = new Date().toISOString();
        feed.lastError = null;
    } catch (error) {
        feed.lastError = error.message;
        console.error(`[LỖI] [${feed.name}] ${error.message}`);
    } finally {
        feed.running = false;
        if (!feed.stopped) setTimeout(() => pollOnce(feed), POLL_INTERVAL);
    }
}

function dashboard() {
    return {
        Ban_hu: compactApi(feeds.hit.latestApi, feeds.hit.engine.getPublicStats()),
        Ban_md5: compactApi(feeds.md5.latestApi, feeds.md5.engine.getPublicStats())
    };
}


function adminAuthorized(req) {
    if (!ADMIN_ACTION_TOKEN) return false;
    const supplied = String(req.headers['x-admin-token'] || '').trim();
    if (supplied.length !== ADMIN_ACTION_TOKEN.length) return false;
    try {
        return require('crypto').timingSafeEqual(Buffer.from(supplied), Buffer.from(ADMIN_ACTION_TOKEN));
    } catch {
        return false;
    }
}

function requireAdmin(req, res) {
    if (!ADMIN_ACTION_TOKEN) {
        sendJson(res, 503, {
            ok: false,
            code: 'ADMIN_TOKEN_NOT_CONFIGURED',
            message: 'Chưa cấu hình khóa thao tác quản trị trên API.'
        });
        return false;
    }
    if (!adminAuthorized(req)) {
        sendJson(res, 401, { ok: false, code: 'UNAUTHORIZED', message: 'Không có quyền thực hiện thao tác này.' });
        return false;
    }
    return true;
}

function normalizeBoard(value) {
    const board = String(value || '').toLowerCase();
    if (['xanh', 'hit', 'hu', 'hũ'].includes(board)) return 'xanh';
    if (['md5'].includes(board)) return 'md5';
    if (['all', 'both', 'ca-hai', 'cả-hai'].includes(board)) return 'all';
    return null;
}

function normalizeResetTarget(value) {
    const target = String(value || 'all').toLowerCase();
    if (['stats', 'stat', 'statistics', 'thong-ke', 'thống-kê'].includes(target)) return 'stats';
    if (['history', 'cau', 'history-cau', 'lich-su', 'lịch-sử'].includes(target)) return 'history';
    if (['all', 'both', 'everything'].includes(target)) return 'all';
    return null;
}

function resetFeed(feed, target) {
    if (target === 'stats' || target === 'all') {
        feed.engine.resetStats();
    }
    if (target === 'history' || target === 'all') {
        const latestSession = Number(feed.latestApi?.Phien);
        feed.ignoreBeforeSid = Number.isSafeInteger(latestSession) ? latestSession : feed.ignoreBeforeSid;
        feed.engine.clearHistory();
        feed.latestApi = emptyApi();
        feed.pendingSid = null;
    }
    feed.lastError = null;
}

function resetBoards(board, target) {
    if (board === 'xanh' || board === 'all') resetFeed(feeds.hit, target);
    if (board === 'md5' || board === 'all') resetFeed(feeds.md5, target);
    const boardName = board === 'all' ? 'cả hai bàn' : board === 'xanh' ? 'Bàn Hũ' : 'Bàn MD5';
    const message = target === 'stats'
        ? `Đã đặt lại thống kê ${boardName}; lịch sử cầu được giữ nguyên.`
        : target === 'history'
            ? `Đã xóa lịch sử cầu ${boardName}; thống kê được giữ nguyên.`
            : `Đã đặt lại lịch sử và thống kê ${boardName}.`;
    return {
        ok: true,
        board,
        target,
        reset_at: new Date().toISOString(),
        message
    };
}

function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const text = Array.isArray(value) ? value.join('-') : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsForBoard(board) {
    const feed = board === 'xanh' ? feeds.hit : feeds.md5;
    return feed.engine.getPublicHistory(MAX_RUNTIME_HISTORY).map(item => ({
        board,
        session: item.Phien,
        dice: item.Xuc_xac,
        total: item.Tong,
        result: item.Ket_qua,
        prediction: item.Du_doan,
        verdict: item.Thang_thua,
        confidence: item.Do_tin_cay,
        pattern: item.Loai_cau,
        prediction_created_at: item.Du_doan_luc
    }));
}

function exportRows(board) {
    if (board === 'xanh') return rowsForBoard('xanh');
    if (board === 'md5') return rowsForBoard('md5');
    return rowsForBoard('xanh').concat(rowsForBoard('md5'));
}

function rowsToCsv(rows) {
    const columns = [
        'board', 'session', 'dice_1', 'dice_2', 'dice_3', 'total',
        'result', 'prediction', 'verdict', 'confidence', 'pattern', 'prediction_created_at'
    ];
    const lines = [columns.join(',')];
    for (const row of rows) {
        lines.push([
            row.board,
            row.session,
            row.dice?.[0], row.dice?.[1], row.dice?.[2],
            row.total,
            row.result,
            row.prediction,
            row.verdict,
            row.confidence,
            row.pattern,
            row.prediction_created_at
        ].map(csvEscape).join(','));
    }
    return `\uFEFF${lines.join('\n')}\n`;
}

function health() {
    return {
        status: 'ok',
        version: API_VERSION,
        build: API_BUILD,
        engine: ENGINE_NAME,
        runtime_only: true,
        public_api: true,
        authentication: 'public_read_admin_token_for_actions',
        poll_interval_ms: POLL_INTERVAL,
        hit: {
            last_success: feeds.hit.lastSuccessAt,
            last_error: feeds.hit.lastError,
            requests: feeds.hit.requests,
            runtime_history: feeds.hit.engine.history.length,
            status: feeds.hit.latestApi.Trang_thai
        },
        md5: {
            last_success: feeds.md5.lastSuccessAt,
            last_error: feeds.md5.lastError,
            requests: feeds.md5.requests,
            runtime_history: feeds.md5.engine.history.length,
            status: feeds.md5.latestApi.Trang_thai
        }
    };
}

async function handleRequest(req, res) {
    try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const pathname = url.pathname.replace(/\/$/, '') || '/';

        if (req.method === 'GET' && pathname === '/') {
            return sendJson(res, 200, {
                name: 'HIT Adaptive Selective Runtime API',
                version: API_VERSION,
                engine: ENGINE_NAME,
                runtime_only: true,
                persistence: 'none',
                restart_behavior: 'history_and_stats_reset',
                health: '/health'
            });
        }
        if (req.method === 'GET' && pathname === '/health') return sendJson(res, 200, health());


        if (req.method === 'GET' && pathname === '/api/hitxanh') {
            return sendJson(res, 200, compactApi(feeds.hit.latestApi, feeds.hit.engine.getPublicStats()));
        }
        if (req.method === 'GET' && pathname === '/api/hitmd5') {
            return sendJson(res, 200, compactApi(feeds.md5.latestApi, feeds.md5.engine.getPublicStats()));
        }
        if (req.method === 'GET' && pathname === '/api/dashboard') return sendJson(res, 200, dashboard());

        if (req.method === 'GET' && pathname === '/api/hitxanh/history') {
            const limit = parseLimit(url.searchParams.get('limit'), 80, MAX_RUNTIME_HISTORY);
            return sendJson(res, 200, historyApi(feeds.hit.name, feeds.hit.engine.getPublicHistory(limit), feeds.hit.engine.getPublicStats()));
        }
        if (req.method === 'GET' && pathname === '/api/hitmd5/history') {
            const limit = parseLimit(url.searchParams.get('limit'), 80, MAX_RUNTIME_HISTORY);
            return sendJson(res, 200, historyApi(feeds.md5.name, feeds.md5.engine.getPublicHistory(limit), feeds.md5.engine.getPublicStats()));
        }
        if (req.method === 'GET' && pathname === '/api/hitxanh/cau') {
            const limit = parseLimit(url.searchParams.get('limit'), 60, MAX_RUNTIME_HISTORY);
            return sendJson(res, 200, cauApi(feeds.hit.name, feeds.hit.engine.getPublicHistory(limit)));
        }
        if (req.method === 'GET' && pathname === '/api/hitmd5/cau') {
            const limit = parseLimit(url.searchParams.get('limit'), 60, MAX_RUNTIME_HISTORY);
            return sendJson(res, 200, cauApi(feeds.md5.name, feeds.md5.engine.getPublicHistory(limit)));
        }
        if (req.method === 'GET' && pathname === '/api/diagnostics') {
            return sendJson(res, 200, {
                version: API_VERSION,
                engine: ENGINE_NAME,
                runtime_only: true,
                hit: feeds.hit.engine.getDiagnostics(),
                md5: feeds.md5.engine.getDiagnostics()
            });
        }

        if (req.method === 'POST' && pathname === '/api/admin/reset') {
            if (!requireAdmin(req, res)) return;
            const board = normalizeBoard(url.searchParams.get('board'));
            const target = normalizeResetTarget(url.searchParams.get('target') || 'all');
            if (!board) return sendJson(res, 400, { ok: false, code: 'INVALID_BOARD', message: 'Bàn không hợp lệ.' });
            if (!target) return sendJson(res, 400, { ok: false, code: 'INVALID_TARGET', message: 'Phần cần đặt lại không hợp lệ.' });
            return sendJson(res, 200, resetBoards(board, target));
        }

        if (req.method === 'GET' && pathname === '/api/admin/export') {
            if (!requireAdmin(req, res)) return;
            const board = normalizeBoard(url.searchParams.get('board') || 'all');
            const format = String(url.searchParams.get('format') || 'csv').toLowerCase();
            if (!board) return sendJson(res, 400, { ok: false, code: 'INVALID_BOARD', message: 'Bàn không hợp lệ.' });
            const rows = exportRows(board);
            const stamp = new Date().toISOString().slice(0, 10);
            if (format === 'json') {
                return sendJson(res, 200, { ok: true, board, count: rows.length, exported_at: new Date().toISOString(), rows });
            }
            if (format !== 'csv') return sendJson(res, 400, { ok: false, code: 'INVALID_FORMAT', message: 'Định dạng chỉ hỗ trợ csv hoặc json.' });
            return sendText(res, 200, rowsToCsv(rows), 'text/csv; charset=utf-8', {
                'Content-Disposition': `attachment; filename=hit-history-${board}-${stamp}.csv`
            });
        }

        sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: 'Không tìm thấy endpoint.' });
    } catch (error) {
        console.error('[API ERROR]', error);
        sendJson(res, Number(error.status) || 500, {
            ok: false,
            code: 'INTERNAL_ERROR',
            message: Number(error.status) && Number(error.status) < 500 ? error.message : 'Máy chủ gặp lỗi.'
        });
    }
}

const server = http.createServer(handleRequest);

function startRuntime() {
    void pollOnce(feeds.hit);
    void pollOnce(feeds.md5);
}

function shutdown() {
    feeds.hit.stopped = true;
    feeds.md5.stopped = true;
    server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (require.main === module) {
    server.listen(PORT, HOST, () => {
        console.log(`[API] ${API_VERSION} | ${ENGINE_NAME}`);
        console.log(`[SERVER] http://localhost:${PORT}`);
        console.log('[LƯU TRỮ] Chỉ RAM; restart/deploy sẽ reset lịch sử và thống kê.');
        startRuntime();
    });
}

module.exports = {
    server,
    handleRequest,
    feeds,
    makeResult,
    extractResults,
    buildApi,
    health,
    dashboard
};
