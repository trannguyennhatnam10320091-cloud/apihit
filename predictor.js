'use strict';

const MODEL_VERSION = '9.0.0';
const ENGINE_NAME = 'FOLLOW_PREVIOUS_FAST_1_1';

function round(value, digits = 2) {
    const factor = 10 ** digits;
    return Math.round((Number(value) || 0) * factor) / factor;
}

function toSymbol(value) {
    if (value === 'Tài' || value === 'T' || value === 'TAI') return 'T';
    if (value === 'Xỉu' || value === 'X' || value === 'XIU') return 'X';
    return null;
}

function toResult(symbol) {
    return symbol === 'T' ? 'Tài' : symbol === 'X' ? 'Xỉu' : null;
}

function opposite(symbol) {
    return symbol === 'T' ? 'X' : symbol === 'X' ? 'T' : null;
}

function alternatingSuffixLength(symbols) {
    if (!Array.isArray(symbols) || symbols.length === 0) return 0;
    let length = 1;
    for (let index = symbols.length - 1; index > 0; index -= 1) {
        if (symbols[index] === symbols[index - 1]) break;
        length += 1;
    }
    return length;
}

function detectRegime(symbols, currentMode = 'FOLLOW_LAST') {
    const last = symbols[symbols.length - 1] || null;
    const alternatingLength = alternatingSuffixLength(symbols);
    const oneOne = currentMode === 'ONE_ONE' || alternatingLength >= 3;
    return {
        type: oneOne ? 'CẦU_1-1' : 'BÁM_PHIÊN_TRƯỚC',
        description: oneOne
            ? 'Theo nhịp đảo 1-1: phiên tới chọn cửa đối diện phiên vừa ra.'
            : 'Bám kết quả phiên vừa ra cho phiên tiếp theo.',
        currentMode: oneOne ? 'ONE_ONE' : 'FOLLOW_LAST',
        lastSymbol: last,
        lastResult: toResult(last),
        alternatingSuffixLength: alternatingLength,
        detectedFast: alternatingLength >= 3
    };
}

function defaultStats() {
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
        Chuoi_hien_tai: { Loai: 'CHƯA_CÓ', So_luong: 0 },
        Model_version: MODEL_VERSION
    };
}

class FollowPreviousOneOneEngineV9 {
    constructor(options = {}) {
        this.minHistory = 1;
        this.maxEngineHistory = Math.max(10, Number(options.maxEngineHistory) || 240);
        this.maxRuntimeHistory = Math.max(this.maxEngineHistory, Number(options.maxRuntimeHistory) || 10000);
        this.board = String(options.board || 'generic').toLowerCase();
        this.modelVersion = String(options.modelVersion || MODEL_VERSION);
        this.history = [];
        this.segmentStart = 0;
        this.mode = 'FOLLOW_LAST';
        this.pendingPrediction = null;
        this.lastDecision = null;
        this.lastSettled = null;
        this.lastModeChange = null;
        this.stats = defaultStats();
    }

    resetStats() {
        this.stats = defaultStats();
    }

    clearHistory() {
        this.history = [];
        this.segmentStart = 0;
        this.mode = 'FOLLOW_LAST';
        this.pendingPrediction = null;
        this.lastDecision = null;
        this.lastSettled = null;
        this.lastModeChange = null;
    }

    resetAll() {
        this.clearHistory();
        this.resetStats();
    }

    getSymbols(limit = this.maxEngineHistory) {
        return this.history.slice(-limit).map(item => item.Symbol);
    }

    getSegmentSymbols(limit = this.maxEngineHistory) {
        return this.history.slice(this.segmentStart).slice(-limit).map(item => item.Symbol);
    }

    settlePrediction(record) {
        if (!this.pendingPrediction || this.pendingPrediction.targetSession !== record.Phien) return null;
        const won = this.pendingPrediction.symbol === record.Symbol;
        this.stats.Tong_du_doan += 1;

        if (won) {
            this.stats.Thang += 1;
            if (this.stats.Chuoi_hien_tai.Loai === 'THẮNG') this.stats.Chuoi_hien_tai.So_luong += 1;
            else this.stats.Chuoi_hien_tai = { Loai: 'THẮNG', So_luong: 1 };
            this.stats.Chuoi_thang_dai_nhat = Math.max(
                this.stats.Chuoi_thang_dai_nhat,
                this.stats.Chuoi_hien_tai.So_luong
            );
        } else {
            this.stats.Thua += 1;
            if (this.stats.Chuoi_hien_tai.Loai === 'THUA') this.stats.Chuoi_hien_tai.So_luong += 1;
            else this.stats.Chuoi_hien_tai = { Loai: 'THUA', So_luong: 1 };
            this.stats.Chuoi_thua_dai_nhat = Math.max(
                this.stats.Chuoi_thua_dai_nhat,
                this.stats.Chuoi_hien_tai.So_luong
            );
        }

        const settled = {
            Du_doan: this.pendingPrediction.prediction,
            Thang_thua: won ? 'THẮNG' : 'THUA',
            Do_tin_cay: this.pendingPrediction.confidence,
            Loai_cau: this.pendingPrediction.pattern,
            Du_doan_luc: this.pendingPrediction.sourceSession,
            strategy: this.pendingPrediction.strategy,
            won
        };
        this.pendingPrediction = null;
        this.lastSettled = settled;
        return settled;
    }

    updateMode(symbols, settled) {
        const previousMode = this.mode;
        const alternatingLength = alternatingSuffixLength(symbols);
        let reason = null;

        if (previousMode === 'ONE_ONE') {
            if (settled?.strategy === 'ONE_ONE' && settled.won === false) {
                this.mode = 'FOLLOW_LAST';
                reason = 'Cầu 1-1 vừa gãy; quay về bám kết quả phiên trước.';
            } else if (alternatingLength < 2) {
                this.mode = 'FOLLOW_LAST';
                reason = 'Nhịp đảo không còn liên tục; quay về bám kết quả phiên trước.';
            }
        } else if (alternatingLength >= 3) {
            this.mode = 'ONE_ONE';
            reason = 'Đã nhận ra nhanh nhịp 1-1 từ mẫu T-X-T hoặc X-T-X.';
        }

        if (previousMode !== this.mode) {
            this.lastModeChange = {
                from: previousMode,
                to: this.mode,
                reason,
                atSession: this.history[this.history.length - 1]?.Phien ?? null
            };
        }

        return { previousMode, mode: this.mode, alternatingLength, reason };
    }

    makeDecision(settled = null) {
        const last = this.history[this.history.length - 1] || null;
        if (!last) {
            const decision = {
                action: 'WAIT_DATA',
                targetSession: null,
                prediction: null,
                confidence: null,
                probabilityT: 0.5,
                probabilityX: 0.5,
                pattern: { type: 'CHỜ_DỮ_LIỆU', description: 'Đang chờ kết quả đầu tiên.' },
                reasons: [],
                analysis: { architecture: 'Bám phiên trước + nhận cầu 1-1 nhanh' },
                topModels: [],
                opposingModels: [],
                componentCount: { primary: 1, total: 1 },
                modelVersion: this.modelVersion
            };
            this.lastDecision = decision;
            return decision;
        }

        const symbols = this.getSegmentSymbols(this.maxEngineHistory);
        const modeState = this.updateMode(symbols, settled);
        const lastSymbol = last.Symbol;
        const predictedSymbol = this.mode === 'ONE_ONE' ? opposite(lastSymbol) : lastSymbol;
        const prediction = toResult(predictedSymbol);
        const pattern = detectRegime(symbols, this.mode);
        const reason = this.mode === 'ONE_ONE'
            ? `Phiên ${last.Phien} ra ${last.Ket_qua}; theo cầu 1-1 nên chọn ${prediction}.`
            : `Phiên ${last.Phien} ra ${last.Ket_qua}; phiên tới tiếp tục bám ${prediction}.`;

        const decision = {
            action: 'PREDICT',
            targetSession: last.Phien + 1,
            prediction,
            symbol: predictedSymbol,
            confidence: 50,
            probabilityT: 0.5,
            probabilityX: 0.5,
            pattern: { type: pattern.type, description: pattern.description },
            reasons: [reason],
            analysis: {
                architecture: 'Bám kết quả phiên trước; chuyển sang cầu 1-1 ngay khi hậu tố có T-X-T hoặc X-T-X',
                mode: this.mode,
                previousMode: modeState.previousMode,
                alternatingSuffixLength: modeState.alternatingLength,
                switched: modeState.previousMode !== this.mode,
                switchReason: modeState.reason,
                lastResult: last.Ket_qua,
                nextRule: this.mode === 'ONE_ONE' ? 'ĐỐI_DIỆN_PHIÊN_TRƯỚC' : 'GIỐNG_PHIÊN_TRƯỚC'
            },
            topModels: [],
            opposingModels: [],
            componentCount: { primary: 1, total: 1 },
            modelVersion: this.modelVersion
        };

        this.pendingPrediction = {
            targetSession: decision.targetSession,
            symbol: predictedSymbol,
            prediction,
            confidence: decision.confidence,
            pattern: pattern.type,
            strategy: this.mode,
            sourceSession: last.Phien
        };
        this.lastDecision = decision;
        return decision;
    }

    addResult(input) {
        const session = Number(input?.Phien);
        const symbol = toSymbol(input?.Ket_qua);
        if (!Number.isSafeInteger(session) || !symbol) return { accepted: false, reason: 'INVALID_RESULT' };

        const last = this.history[this.history.length - 1];
        if (last && session <= last.Phien) {
            return { accepted: false, reason: session === last.Phien ? 'DUPLICATE' : 'OLD_SESSION' };
        }

        let gap = null;
        if (last && session > last.Phien + 1) {
            gap = { from: last.Phien, to: session, missingCount: session - last.Phien - 1 };
            this.pendingPrediction = null;
            this.mode = 'FOLLOW_LAST';
            this.segmentStart = this.history.length;
            this.lastModeChange = {
                from: 'UNKNOWN',
                to: 'FOLLOW_LAST',
                reason: 'Thiếu phiên nên bắt đầu lại bằng chế độ bám phiên trước.',
                atSession: session
            };
        }

        const record = {
            Phien: session,
            Symbol: symbol,
            Ket_qua: toResult(symbol),
            Tong: Number.isFinite(Number(input?.Tong)) ? Number(input.Tong) : null,
            Xuc_xac_1: Number(input?.Xuc_xac_1),
            Xuc_xac_2: Number(input?.Xuc_xac_2),
            Xuc_xac_3: Number(input?.Xuc_xac_3),
            Du_doan: null,
            Thang_thua: null,
            Do_tin_cay: null,
            Loai_cau: null,
            Du_doan_luc: null
        };

        const settled = this.settlePrediction(record);
        if (settled) Object.assign(record, settled);
        this.stats.Tong_phien += 1;
        this.history.push(record);

        if (this.history.length > this.maxRuntimeHistory) {
            const removeCount = this.history.length - this.maxRuntimeHistory;
            this.history.splice(0, removeCount);
            this.segmentStart = Math.max(0, this.segmentStart - removeCount);
        }

        const decision = this.makeDecision(settled);
        return { accepted: true, gap, settled, decision };
    }

    getPublicStats() {
        const total = this.stats.Tong_du_doan;
        const opportunities = total + this.stats.Bo_qua;
        return {
            ...this.stats,
            Ti_le_thang: total ? `${round((this.stats.Thang / total) * 100)}%` : '0%',
            Do_phu: opportunities ? `${round((total / opportunities) * 100)}%` : '0%'
        };
    }

    getPublicHistory(limit = 80) {
        const safeLimit = Math.max(1, Math.min(this.maxRuntimeHistory, Number(limit) || 80));
        return this.history.slice(-safeLimit).map(item => ({
            Phien: item.Phien,
            Xuc_xac: [item.Xuc_xac_1, item.Xuc_xac_2, item.Xuc_xac_3],
            Tong: item.Tong,
            Ket_qua: item.Ket_qua,
            Du_doan: item.Du_doan,
            Thang_thua: item.Thang_thua,
            Do_tin_cay: item.Do_tin_cay,
            Loai_cau: item.Loai_cau,
            Du_doan_luc: item.Du_doan_luc
        }));
    }

    getPerformanceSummary() {
        const total = this.stats.Tong_du_doan;
        return [{
            id: 'follow-previous-fast-1-1',
            name: 'Bám phiên trước / Cầu 1-1',
            predictions: total,
            wins: this.stats.Thang,
            losses: this.stats.Thua,
            accuracy: total ? `${round((this.stats.Thang / total) * 100)}%` : '0%',
            activeMode: this.mode
        }];
    }

    getDiagnostics() {
        const symbols = this.getSegmentSymbols(this.maxEngineHistory);
        return {
            engine: ENGINE_NAME,
            modelVersion: this.modelVersion,
            board: this.board,
            runtimeHistorySize: this.history.length,
            engineWindowSize: symbols.length,
            minHistory: this.minHistory,
            strategy: detectRegime(symbols, this.mode),
            mode: this.mode,
            lastModeChange: this.lastModeChange,
            stats: this.getPublicStats(),
            strategyPerformance: this.getPerformanceSummary(),
            lastDecision: this.lastDecision
        };
    }
}

// Giữ alias để server hiện tại không cần đổi cách khởi tạo.
const AdaptiveSelectiveEngineV7 = FollowPreviousOneOneEngineV9;
const EXPERTS = [];

module.exports = {
    FollowPreviousOneOneEngineV9,
    AdaptiveSelectiveEngineV7,
    MODEL_VERSION,
    ENGINE_NAME,
    EXPERTS,
    alternatingSuffixLength,
    detectRegime,
    toSymbol,
    toResult
};
