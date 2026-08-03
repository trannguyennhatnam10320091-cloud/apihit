'use strict';

const MODEL_VERSION = '7.0.0';
const ENGINE_NAME = 'ADAPTIVE_SELECTIVE_RUNTIME_V7';

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
}

function round(value, digits = 4) {
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
    return symbol === 'T' ? 'X' : 'T';
}

function betaMean(successes, trials, prior = 3) {
    return (successes + prior) / (trials + prior * 2);
}

function buildRuns(symbols) {
    const runs = [];
    for (const symbol of symbols) {
        const last = runs[runs.length - 1];
        if (last && last.symbol === symbol) last.length += 1;
        else runs.push({ symbol, length: 1 });
    }
    return runs;
}

function switchRate(symbols) {
    if (!Array.isArray(symbols) || symbols.length < 2) return 0.5;
    let switches = 0;
    for (let index = 1; index < symbols.length; index += 1) {
        if (symbols[index] !== symbols[index - 1]) switches += 1;
    }
    return switches / (symbols.length - 1);
}

function ratioT(symbols) {
    if (!symbols.length) return 0.5;
    return symbols.filter(symbol => symbol === 'T').length / symbols.length;
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

function defaultExpertState() {
    return {
        predictions: 0,
        wins: 0,
        losses: 0,
        ewmaAccuracy: 0.5,
        ewmaBrier: 0.25,
        recent: []
    };
}

function normalizeExpertState(raw = {}) {
    return {
        predictions: Number(raw.predictions) || 0,
        wins: Number(raw.wins) || 0,
        losses: Number(raw.losses) || 0,
        ewmaAccuracy: clamp(raw.ewmaAccuracy ?? 0.5, 0, 1),
        ewmaBrier: clamp(raw.ewmaBrier ?? 0.25, 0, 1),
        recent: Array.isArray(raw.recent) ? raw.recent.slice(-20).map(Number) : []
    };
}

const EXPERTS = [
    { id: 'baseline', name: 'Mốc ổn định theo bàn', baseWeight: 0.64 },
    { id: 'recent', name: 'Xu hướng gần', baseWeight: 0.09 },
    { id: 'markov', name: 'Điều kiện Markov', baseWeight: 0.09 },
    { id: 'switch', name: 'Nhịp đổi bên', baseWeight: 0.06 },
    { id: 'suffix', name: 'Lặp hậu tố', baseWeight: 0.08 },
    { id: 'run', name: 'Độ dài nhịp', baseWeight: 0.04 }
];

function baselineExpert(board, symbols) {
    const last = symbols[symbols.length - 1] || 'T';
    if (board === 'md5') {
        return {
            id: 'baseline',
            probabilityT: last === 'T' ? 0.522 : 0.478,
            evidence: 1,
            samples: symbols.length,
            detail: 'Mốc MD5 ưu tiên khả năng tiếp tục phía của phiên gần nhất.'
        };
    }
    if (board === 'xanh') {
        return {
            id: 'baseline',
            probabilityT: 0.518,
            evidence: 1,
            samples: symbols.length,
            detail: 'Mốc Bàn Hũ dùng thiên lệch Tài rất nhẹ, được hiệu chuẩn từ dữ liệu mẫu.'
        };
    }
    const recent = symbols.slice(-12);
    const probabilityT = betaMean(recent.filter(symbol => symbol === 'T').length, recent.length, 8);
    return {
        id: 'baseline', probabilityT, evidence: 1, samples: recent.length,
        detail: 'Mốc chung dùng tỷ lệ Tài/Xỉu đã làm trơn.'
    };
}

function smoothedRecentProbability(symbols, window) {
    const recent = symbols.slice(-window);
    const successes = recent.filter(symbol => symbol === 'T').length;
    const probabilityT = betaMean(successes, recent.length, 3);
    return {
        probabilityT,
        evidence: Math.min(1, recent.length / window),
        samples: recent.length,
        detail: `Tỷ lệ Tài trong ${recent.length} phiên gần nhất.`
    };
}

function recentExpert(symbols) {
    const estimates = [6, 10, 20]
        .filter(window => symbols.length >= Math.min(6, window))
        .map(window => ({ window, ...smoothedRecentProbability(symbols, window) }));
    if (!estimates.length) return null;
    let numerator = 0;
    let denominator = 0;
    for (const estimate of estimates) {
        const weight = estimate.window === 6 ? 0.42 : estimate.window === 10 ? 0.34 : 0.24;
        numerator += estimate.probabilityT * weight;
        denominator += weight;
    }
    return {
        id: 'recent',
        probabilityT: numerator / denominator,
        evidence: estimates.reduce((sum, item) => sum + item.evidence, 0) / estimates.length,
        samples: Math.max(...estimates.map(item => item.samples)),
        detail: 'Kết hợp tỷ lệ Tài/Xỉu ở cửa sổ 6, 10 và 20 phiên.'
    };
}

function markovOrder(symbols, order) {
    if (symbols.length <= order) return null;
    const suffix = symbols.slice(-order).join('');
    let tWeight = 0;
    let xWeight = 0;
    let samples = 0;
    const start = Math.max(order, symbols.length - 20);
    for (let index = start; index < symbols.length; index += 1) {
        if (symbols.slice(index - order, index).join('') !== suffix) continue;
        const age = symbols.length - 1 - index;
        const weight = 0.5 ** (age / 8);
        if (symbols[index] === 'T') tWeight += weight;
        else xWeight += weight;
        samples += 1;
    }
    const effective = tWeight + xWeight;
    if (!samples || effective <= 0) return null;
    return {
        order,
        probabilityT: (tWeight + 2.5) / (effective + 5),
        samples,
        evidence: Math.min(1, effective / 5)
    };
}

function markovExpert(symbols) {
    const orders = [1, 2, 3].map(order => markovOrder(symbols, order)).filter(Boolean);
    if (!orders.length) return null;
    let numerator = 0;
    let denominator = 0;
    for (const item of orders) {
        const weight = item.evidence * (item.order === 1 ? 0.8 : item.order === 2 ? 1 : 1.08);
        numerator += item.probabilityT * weight;
        denominator += weight;
    }
    return {
        id: 'markov',
        probabilityT: denominator ? numerator / denominator : 0.5,
        evidence: orders.reduce((sum, item) => sum + item.evidence, 0) / orders.length,
        samples: orders.reduce((sum, item) => sum + item.samples, 0),
        detail: `Markov bậc ${orders.map(item => item.order).join(', ')} trong vùng dữ liệu gần.`
    };
}

function switchEstimate(symbols, window) {
    const recent = symbols.slice(-window);
    if (recent.length < 3) return null;
    let switches = 0;
    for (let index = 1; index < recent.length; index += 1) {
        if (recent[index] !== recent[index - 1]) switches += 1;
    }
    const trials = recent.length - 1;
    const probabilitySwitch = betaMean(switches, trials, 3);
    const last = recent[recent.length - 1];
    const probabilityT = last === 'T' ? 1 - probabilitySwitch : probabilitySwitch;
    return {
        probabilityT,
        evidence: Math.min(1, trials / Math.max(5, window - 1)),
        samples: trials
    };
}

function switchExpert(symbols) {
    const estimates = [6, 10, 20].map(window => switchEstimate(symbols, window)).filter(Boolean);
    if (!estimates.length) return null;
    const weights = [0.46, 0.34, 0.2];
    let numerator = 0;
    let denominator = 0;
    for (let index = 0; index < estimates.length; index += 1) {
        const weight = weights[index] * estimates[index].evidence;
        numerator += estimates[index].probabilityT * weight;
        denominator += weight;
    }
    return {
        id: 'switch',
        probabilityT: denominator ? numerator / denominator : 0.5,
        evidence: estimates.reduce((sum, item) => sum + item.evidence, 0) / estimates.length,
        samples: Math.max(...estimates.map(item => item.samples)),
        detail: 'Đo nhịp tiếp tục hoặc đổi bên ở nhiều cửa sổ ngắn.'
    };
}

function suffixEstimate(symbols, length) {
    if (symbols.length <= length) return null;
    const suffix = symbols.slice(-length).join('');
    let tWeight = 0;
    let xWeight = 0;
    let samples = 0;
    const start = Math.max(length, symbols.length - 40);
    for (let index = start; index < symbols.length; index += 1) {
        if (symbols.slice(index - length, index).join('') !== suffix) continue;
        const age = symbols.length - 1 - index;
        const weight = 0.5 ** (age / 14);
        if (symbols[index] === 'T') tWeight += weight;
        else xWeight += weight;
        samples += 1;
    }
    const effective = tWeight + xWeight;
    if (!samples || effective <= 0) return null;
    return {
        length,
        probabilityT: (tWeight + 3) / (effective + 6),
        evidence: Math.min(1, effective / 4),
        samples
    };
}

function suffixExpert(symbols) {
    const estimates = [2, 3, 4].map(length => suffixEstimate(symbols, length)).filter(Boolean);
    if (!estimates.length) return null;
    let numerator = 0;
    let denominator = 0;
    for (const item of estimates) {
        const weight = item.evidence * (item.length === 2 ? 0.85 : item.length === 3 ? 1 : 1.05);
        numerator += item.probabilityT * weight;
        denominator += weight;
    }
    return {
        id: 'suffix',
        probabilityT: denominator ? numerator / denominator : 0.5,
        evidence: estimates.reduce((sum, item) => sum + item.evidence, 0) / estimates.length,
        samples: estimates.reduce((sum, item) => sum + item.samples, 0),
        detail: `So sánh hậu tố độ dài ${estimates.map(item => item.length).join(', ')}.`
    };
}

function runExpert(symbols) {
    if (symbols.length < 6) return null;
    const runs = buildRuns(symbols);
    const current = runs[runs.length - 1];
    const bucket = Math.min(current.length, 4);
    let continuations = 0;
    let samples = 0;

    for (let index = 1; index < symbols.length; index += 1) {
        let runLength = 1;
        for (let cursor = index - 2; cursor >= 0 && symbols[cursor] === symbols[index - 1]; cursor -= 1) {
            runLength += 1;
        }
        if (Math.min(runLength, 4) !== bucket) continue;
        samples += 1;
        if (symbols[index] === symbols[index - 1]) continuations += 1;
    }

    if (!samples) {
        const baseContinue = current.length >= 4 ? 0.43 : 0.5;
        const probabilityT = current.symbol === 'T' ? baseContinue : 1 - baseContinue;
        return {
            id: 'run', probabilityT, evidence: 0.2, samples: 0,
            detail: `Nhịp hiện tại ${current.symbol}-${current.length}, thiếu mẫu tương đồng.`
        };
    }
    const probabilityContinue = betaMean(continuations, samples, 3);
    return {
        id: 'run',
        probabilityT: current.symbol === 'T' ? probabilityContinue : 1 - probabilityContinue,
        evidence: Math.min(1, samples / 5),
        samples,
        detail: `Ước lượng khả năng tiếp tục nhịp ${current.symbol}-${current.length}.`
    };
}

function detectRegime(symbols) {
    const recent = symbols.slice(-6);
    const previous = symbols.slice(-12, -6);
    const runs = buildRuns(symbols.slice(-20));
    const currentRun = runs[runs.length - 1] || { symbol: null, length: 0 };
    const recentRatio = ratioT(recent);
    const previousRatio = previous.length ? ratioT(previous) : recentRatio;
    const recentSwitch = switchRate(recent);
    const previousSwitch = previous.length ? switchRate(previous) : recentSwitch;
    const changeScore = clamp(Math.abs(recentRatio - previousRatio) * 0.58 + Math.abs(recentSwitch - previousSwitch) * 0.42, 0, 1);

    let type = 'HỖN_HỢP';
    if (currentRun.length >= 4) type = `BỆT_${currentRun.symbol}`;
    else if (recentSwitch >= 0.72) type = 'ĐẢO_NHỊP';
    else if (recentSwitch <= 0.28) type = 'THEO_NHỊP';
    else if (changeScore >= 0.48) type = 'ĐỔI_CHẾ_ĐỘ';

    return {
        type,
        changeScore: round(changeScore),
        recentRatioT: round(recentRatio),
        previousRatioT: round(previousRatio),
        recentSwitchRate: round(recentSwitch),
        previousSwitchRate: round(previousSwitch),
        currentRun
    };
}

class AdaptiveSelectiveEngineV7 {
    constructor(options = {}) {
        this.minHistory = Math.max(8, Number(options.minHistory) || 12);
        this.maxEngineHistory = Math.max(12, Number(options.maxEngineHistory) || 20);
        this.maxRuntimeHistory = Math.max(this.maxEngineHistory, Number(options.maxRuntimeHistory) || 10000);
        this.predictEdge = clamp(options.predictEdge ?? 0.014, 0.005, 0.12);
        this.minConsensus = clamp(options.minConsensus ?? 0.56, 0.5, 0.9);
        this.modelVersion = String(options.modelVersion || MODEL_VERSION);
        this.board = String(options.board || 'generic').toLowerCase();
        this.history = [];
        this.pendingPrediction = null;
        this.pendingEvaluation = null;
        this.lastDecision = null;
        this.stats = defaultStats();
        this.expertPerformance = Object.fromEntries(EXPERTS.map(expert => [expert.id, defaultExpertState()]));
        this.consecutiveWins = 0;
        this.consecutiveLosses = 0;
        this.cooldownRounds = 0;
    }

    resetStats() {
        this.stats = defaultStats();
    }

    clearHistory() {
        this.history = [];
        this.pendingPrediction = null;
        this.pendingEvaluation = null;
        this.lastDecision = null;
        this.expertPerformance = Object.fromEntries(EXPERTS.map(expert => [expert.id, defaultExpertState()]));
        this.consecutiveWins = 0;
        this.consecutiveLosses = 0;
        this.cooldownRounds = 0;
    }

    resetAll() {
        this.clearHistory();
        this.resetStats();
    }

    getSymbols(limit = this.maxEngineHistory) {
        return this.history.slice(-limit).map(item => item.Symbol);
    }

    expertMultiplier(id) {
        if (id === 'baseline') return 1;
        const stat = normalizeExpertState(this.expertPerformance[id]);
        if (stat.predictions < 20) return 0.22;
        const recentRate = stat.recent.length
            ? stat.recent.reduce((sum, value) => sum + value, 0) / stat.recent.length
            : 0.5;
        const accuracySignal = clamp((recentRate - 0.5) / 0.1, -1, 1);
        const brierSignal = clamp((0.25 - stat.ewmaBrier) / 0.06, -1, 1);
        if (recentRate < 0.52 && stat.ewmaBrier >= 0.248) return 0.18;
        return clamp(0.35 + accuracySignal * 0.35 + brierSignal * 0.2, 0.18, 1.05);
    }

    updateExpertPerformance(actualSymbol) {
        if (!this.pendingEvaluation?.signals) return;
        for (const signal of this.pendingEvaluation.signals) {
            const stat = normalizeExpertState(this.expertPerformance[signal.id]);
            const actual = actualSymbol === 'T' ? 1 : 0;
            const won = signal.symbol === actualSymbol;
            const brier = (signal.probabilityT - actual) ** 2;
            stat.predictions += 1;
            if (won) stat.wins += 1;
            else stat.losses += 1;
            stat.ewmaAccuracy = stat.ewmaAccuracy * 0.9 + (won ? 1 : 0) * 0.1;
            stat.ewmaBrier = stat.ewmaBrier * 0.9 + brier * 0.1;
            stat.recent.push(won ? 1 : 0);
            if (stat.recent.length > 20) stat.recent.shift();
            this.expertPerformance[signal.id] = stat;
        }
        this.pendingEvaluation = null;
    }

    settlePrediction(record) {
        if (!this.pendingPrediction || this.pendingPrediction.targetSession !== record.Phien) return null;
        const won = this.pendingPrediction.symbol === record.Symbol;
        this.stats.Tong_du_doan += 1;
        if (won) {
            this.stats.Thang += 1;
            this.consecutiveWins += 1;
            this.consecutiveLosses = 0;
            if (this.stats.Chuoi_hien_tai.Loai === 'THẮNG') this.stats.Chuoi_hien_tai.So_luong += 1;
            else this.stats.Chuoi_hien_tai = { Loai: 'THẮNG', So_luong: 1 };
            this.stats.Chuoi_thang_dai_nhat = Math.max(this.stats.Chuoi_thang_dai_nhat, this.stats.Chuoi_hien_tai.So_luong);
        } else {
            this.stats.Thua += 1;
            this.consecutiveLosses += 1;
            this.consecutiveWins = 0;
            if (this.stats.Chuoi_hien_tai.Loai === 'THUA') this.stats.Chuoi_hien_tai.So_luong += 1;
            else this.stats.Chuoi_hien_tai = { Loai: 'THUA', So_luong: 1 };
            this.stats.Chuoi_thua_dai_nhat = Math.max(this.stats.Chuoi_thua_dai_nhat, this.stats.Chuoi_hien_tai.So_luong);
            if (this.consecutiveLosses >= 3) this.cooldownRounds = Math.max(this.cooldownRounds, 1);
        }
        const settled = {
            Du_doan: this.pendingPrediction.prediction,
            Thang_thua: won ? 'THẮNG' : 'THUA',
            Do_tin_cay: this.pendingPrediction.confidence,
            Loai_cau: this.pendingPrediction.regime,
            Du_doan_luc: this.pendingPrediction.sourceSession
        };
        this.pendingPrediction = null;
        return settled;
    }

    buildSignals(symbols) {
        return [
            baselineExpert(this.board, symbols),
            recentExpert(symbols),
            markovExpert(symbols),
            switchExpert(symbols),
            suffixExpert(symbols),
            runExpert(symbols)
        ].filter(Boolean);
    }

    makeDecision() {
        const last = this.history[this.history.length - 1] || null;
        const lastSession = last?.Phien ?? null;
        const symbols = this.getSymbols(this.maxEngineHistory);
        const regime = detectRegime(symbols);

        if (lastSession === null || symbols.length < this.minHistory) {
            const decision = {
                action: 'WAIT_DATA',
                targetSession: lastSession === null ? null : lastSession + 1,
                prediction: null,
                confidence: null,
                probabilityT: 0.5,
                pattern: { type: regime.type, description: 'Đang nạp dữ liệu runtime mới.' },
                reasons: [],
                loading: {
                    Da_nap: symbols.length,
                    Can_toi_thieu: this.minHistory,
                    Con_thieu: Math.max(0, this.minHistory - symbols.length)
                },
                regime,
                modelVersion: this.modelVersion
            };
            this.lastDecision = decision;
            return decision;
        }

        const signals = this.buildSignals(symbols);
        const baseById = Object.fromEntries(EXPERTS.map(expert => [expert.id, expert]));
        const ranked = [];

        for (const signal of signals) {
            const probabilityT = clamp(signal.probabilityT, 0.38, 0.62);
            const expert = baseById[signal.id];
            const stat = normalizeExpertState(this.expertPerformance[signal.id]);
            const recentRate = stat.recent.length
                ? stat.recent.reduce((sum, value) => sum + value, 0) / stat.recent.length
                : 0.5;
            const performanceMultiplier = this.expertMultiplier(signal.id);
            const evidenceFactor = signal.id === 'baseline'
                ? 1
                : clamp(0.25 + signal.evidence * 0.75, 0.25, 1);
            const weight = expert.baseWeight * performanceMultiplier * evidenceFactor;
            ranked.push({
                id: signal.id,
                name: expert.name,
                probabilityT: round(probabilityT),
                side: toResult(probabilityT >= 0.5 ? 'T' : 'X'),
                weight: round(weight),
                evidence: round(signal.evidence),
                samples: signal.samples,
                predictions: stat.predictions,
                recentAccuracy: round(recentRate),
                ewmaBrier: round(stat.ewmaBrier),
                reason: signal.detail
            });
        }

        const baseline = ranked.find(item => item.id === 'baseline');
        const baselineProbabilityT = baseline?.probabilityT ?? 0.5;
        const baselineSymbol = baselineProbabilityT >= 0.5 ? 'T' : 'X';
        const trusted = ranked.filter(item =>
            item.id !== 'baseline' &&
            item.predictions >= 20 &&
            item.recentAccuracy >= 0.55 &&
            item.ewmaBrier <= 0.255 &&
            item.evidence >= 0.42
        );

        let adaptiveProbabilityT = 0.5;
        let adaptiveWeight = 0;
        for (const item of trusted) {
            adaptiveProbabilityT += (item.probabilityT - 0.5) * item.weight;
            adaptiveWeight += item.weight;
        }
        if (adaptiveWeight > 0) {
            adaptiveProbabilityT = 0.5 + (adaptiveProbabilityT - 0.5) / adaptiveWeight;
        }

        const adaptiveSymbol = adaptiveProbabilityT >= 0.5 ? 'T' : 'X';
        const oppositeTrusted = trusted.filter(item => toSymbol(item.side) !== baselineSymbol);
        let adaptiveTrust = Math.min(0.32, adaptiveWeight * 0.9);
        if (adaptiveSymbol !== baselineSymbol && oppositeTrusted.length < 2) adaptiveTrust = Math.min(adaptiveTrust, 0.06);
        if (!trusted.length) adaptiveTrust = 0;

        let rawProbabilityT = baselineProbabilityT * (1 - adaptiveTrust) + adaptiveProbabilityT * adaptiveTrust;
        const regimePenalty = clamp(1 - regime.changeScore * 0.12, 0.86, 1);
        const lossPenalty = this.consecutiveLosses >= 2 ? 0.92 : 1;
        const calibrationShrink = regimePenalty * lossPenalty;
        let probabilityT = 0.5 + (rawProbabilityT - 0.5) * calibrationShrink;
        probabilityT = clamp(probabilityT, 0.455, 0.545);

        const chosenSymbol = probabilityT >= 0.5 ? 'T' : 'X';
        const totalDirectionalWeight = ranked.reduce((sum, item) => sum + item.weight, 0);
        const agreeingWeight = ranked
            .filter(item => toSymbol(item.side) === chosenSymbol)
            .reduce((sum, item) => sum + item.weight, 0);
        const consensus = totalDirectionalWeight ? agreeingWeight / totalDirectionalWeight : 0.5;
        const edge = Math.abs(probabilityT - 0.5);
        let requiredEdge = this.predictEdge;
        if (regime.changeScore >= 0.68) requiredEdge += 0.004;
        if (this.consecutiveLosses >= 2) requiredEdge += 0.002;

        let action = 'PREDICT';
        let skipReason = null;
        if (this.cooldownRounds > 0) {
            action = 'SKIP';
            skipReason = 'Tạm nghỉ một phiên sau chuỗi thua liên tiếp.';
            this.cooldownRounds -= 1;
            this.consecutiveLosses = Math.min(this.consecutiveLosses, 2);
        } else if (edge < requiredEdge) {
            action = 'SKIP';
            skipReason = 'Biên xác suất quá nhỏ.';
        } else if (regime.changeScore >= 0.78 && consensus < 0.54) {
            action = 'SKIP';
            skipReason = 'Chế độ vừa thay đổi và các tín hiệu đang phân tán.';
        }

        const confidence = action === 'PREDICT'
            ? Math.round(clamp(Math.max(probabilityT, 1 - probabilityT) * 100, 51, 57))
            : null;

        ranked.sort((a, b) => b.weight - a.weight);
        const decision = {
            action,
            targetSession: lastSession + 1,
            prediction: action === 'PREDICT' ? toResult(chosenSymbol) : null,
            symbol: action === 'PREDICT' ? chosenSymbol : null,
            confidence,
            probabilityT: round(probabilityT),
            probabilityX: round(1 - probabilityT),
            rawProbabilityT: round(rawProbabilityT),
            pattern: {
                type: regime.type,
                description: skipReason || `Đồng thuận ${Math.round(consensus * 100)}%, biên ${round(edge * 100, 2)}%.`
            },
            reasons: ranked.slice(0, 3).map(item => item.reason),
            regime,
            analysis: {
                runtimeHistory: this.history.length,
                engineWindow: symbols.length,
                edge: round(edge),
                requiredEdge: round(requiredEdge),
                consensus: round(consensus),
                regimePenalty: round(regimePenalty),
                calibrationShrink: round(calibrationShrink),
                baselineProbabilityT: round(baselineProbabilityT),
                trustedExperts: trusted.map(item => item.id),
                adaptiveTrust: round(adaptiveTrust),
                consecutiveWins: this.consecutiveWins,
                consecutiveLosses: this.consecutiveLosses,
                skipReason
            },
            topModels: ranked.filter(item => toSymbol(item.side) === chosenSymbol).slice(0, 3),
            opposingModels: ranked.filter(item => toSymbol(item.side) !== chosenSymbol).slice(0, 3),
            componentCount: { primary: signals.length, total: signals.length },
            modelVersion: this.modelVersion
        };

        this.pendingEvaluation = {
            targetSession: decision.targetSession,
            signals: ranked.map(item => ({
                id: item.id,
                symbol: toSymbol(item.side),
                probabilityT: item.probabilityT
            }))
        };

        if (action === 'PREDICT') {
            this.pendingPrediction = {
                targetSession: decision.targetSession,
                symbol: chosenSymbol,
                prediction: decision.prediction,
                confidence,
                regime: regime.type,
                sourceSession: lastSession
            };
        } else {
            this.stats.Bo_qua += 1;
            this.pendingPrediction = null;
        }

        this.lastDecision = decision;
        return decision;
    }

    addResult(input) {
        const session = Number(input?.Phien);
        const symbol = toSymbol(input?.Ket_qua);
        if (!Number.isSafeInteger(session) || !symbol) {
            return { accepted: false, reason: 'INVALID_RESULT' };
        }

        const last = this.history[this.history.length - 1];
        if (last && session <= last.Phien) {
            return { accepted: false, reason: session === last.Phien ? 'DUPLICATE' : 'OLD_SESSION' };
        }

        let gap = null;
        if (last && session > last.Phien + 1) {
            gap = { from: last.Phien, to: session, missingCount: session - last.Phien - 1 };
            this.pendingPrediction = null;
            this.pendingEvaluation = null;
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

        this.updateExpertPerformance(symbol);
        const settled = this.settlePrediction(record);
        if (settled) Object.assign(record, settled);
        this.stats.Tong_phien += 1;
        this.history.push(record);
        if (this.history.length > this.maxRuntimeHistory) {
            this.history.splice(0, this.history.length - this.maxRuntimeHistory);
        }

        const decision = this.makeDecision();
        return { accepted: true, gap, settled, decision };
    }

    getPublicStats() {
        const total = this.stats.Tong_du_doan;
        const opportunities = total + this.stats.Bo_qua;
        return {
            ...this.stats,
            Ti_le_thang: total ? `${round((this.stats.Thang / total) * 100, 2)}%` : '0%',
            Do_phu: opportunities ? `${round((total / opportunities) * 100, 2)}%` : '0%'
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
        return EXPERTS.map(expert => {
            const stat = normalizeExpertState(this.expertPerformance[expert.id]);
            const recentWins = stat.recent.reduce((sum, value) => sum + value, 0);
            const recentAccuracy = stat.recent.length ? recentWins / stat.recent.length : 0.5;
            return {
                id: expert.id,
                name: expert.name,
                predictions: stat.predictions,
                wins: stat.wins,
                losses: stat.losses,
                accuracy: stat.predictions ? `${round((stat.wins / stat.predictions) * 100, 2)}%` : '0%',
                recentAccuracy: `${round(recentAccuracy * 100, 2)}%`,
                ewmaBrier: round(stat.ewmaBrier),
                weightMultiplier: round(this.expertMultiplier(expert.id))
            };
        });
    }

    getDiagnostics() {
        const symbols = this.getSymbols(this.maxEngineHistory);
        return {
            engine: ENGINE_NAME,
            modelVersion: this.modelVersion,
            runtimeHistorySize: this.history.length,
            engineWindowSize: symbols.length,
            configuredEngineWindow: this.maxEngineHistory,
            maxRuntimeHistory: this.maxRuntimeHistory,
            minHistory: this.minHistory,
            predictEdge: this.predictEdge,
            minConsensus: this.minConsensus,
            regime: detectRegime(symbols),
            stats: this.getPublicStats(),
            expertPerformance: this.getPerformanceSummary(),
            lastDecision: this.lastDecision
        };
    }
}

module.exports = {
    AdaptiveSelectiveEngineV7,
    MODEL_VERSION,
    ENGINE_NAME,
    EXPERTS,
    buildRuns,
    detectRegime,
    toSymbol,
    toResult
};
