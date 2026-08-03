'use strict';

const MODEL_VERSION = '8.0.0';
const ENGINE_NAME = 'REGIME_MARKOV_GUARD_V8';

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

function betaMean(successes, trials, prior = 4) {
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

function detectRegime(symbols) {
    if (!symbols.length) {
        return {
            type: 'CHƯA_CÓ',
            description: 'Chưa có dữ liệu để đọc cầu.',
            strength: 0,
            currentRun: { symbol: null, length: 0 },
            switchRate: 0.5,
            ratioT: 0.5,
            changeScore: 0
        };
    }

    const recent12 = symbols.slice(-12);
    const recent20 = symbols.slice(-20);
    const previous12 = symbols.slice(-24, -12);
    const runs = buildRuns(symbols.slice(-30));
    const currentRun = runs[runs.length - 1] || { symbol: symbols[symbols.length - 1], length: 1 };
    const recentSwitch = switchRate(recent12);
    const previousSwitch = previous12.length >= 6 ? switchRate(previous12) : recentSwitch;
    const recentRatio = ratioT(recent12);
    const previousRatio = previous12.length >= 6 ? ratioT(previous12) : recentRatio;
    const changeScore = clamp(Math.abs(recentSwitch - previousSwitch) * 0.55 + Math.abs(recentRatio - previousRatio) * 0.45, 0, 1);
    const runLengths = runs.slice(-6).map(item => item.length);

    let type = 'CẦU_HỖN_HỢP';
    let description = 'Nhịp cầu chưa tạo cấu trúc đủ rõ; Markov chỉ đóng vai trò kiểm chứng.';
    let strength = 0.2;

    if (recent12.length >= 8 && recentSwitch >= 0.8) {
        type = 'CẦU_1-1';
        strength = clamp((recentSwitch - 0.65) / 0.25, 0, 1);
        description = 'Hai cửa đang đảo đều theo nhịp 1-1.';
    } else if (currentRun.length >= 4) {
        type = 'CẦU_BỆT';
        strength = clamp(currentRun.length / 7, 0, 1);
        description = `Đang bệt ${toResult(currentRun.symbol)} ${currentRun.length} phiên.`;
    } else {
        for (const block of [2, 3]) {
            const completed = runLengths.slice(0, -1).slice(-4);
            const exact = completed.filter(length => length === block).length;
            if (completed.length >= 3 && exact >= 3 && currentRun.length <= block) {
                type = `CẦU_${block}-${block}`;
                strength = exact / completed.length;
                description = `Các nhịp gần đây chủ yếu chạy theo khối ${block}-${block}.`;
                break;
            }
        }

        if (type === 'CẦU_HỖN_HỢP' && recentRatio >= 0.72) {
            type = 'LỆCH_TÀI';
            strength = clamp((recentRatio - 0.6) / 0.3, 0, 1);
            description = `Tài chiếm ${Math.round(recentRatio * 100)}% trong cửa sổ gần.`;
        } else if (type === 'CẦU_HỖN_HỢP' && recentRatio <= 0.28) {
            type = 'LỆCH_XỈU';
            strength = clamp((0.4 - recentRatio) / 0.3, 0, 1);
            description = `Xỉu chiếm ${Math.round((1 - recentRatio) * 100)}% trong cửa sổ gần.`;
        } else if (type === 'CẦU_HỖN_HỢP' && recentSwitch >= 0.68) {
            type = 'ĐẢO_NHỊP';
            strength = clamp((recentSwitch - 0.55) / 0.3, 0, 1);
            description = 'Tần suất đổi cửa đang cao.';
        } else if (type === 'CẦU_HỖN_HỢP' && recentSwitch <= 0.32) {
            type = 'THEO_NHỊP';
            strength = clamp((0.45 - recentSwitch) / 0.3, 0, 1);
            description = 'Tần suất giữ cửa đang cao.';
        }
    }

    return {
        type,
        description,
        strength: round(strength),
        currentRun: { symbol: currentRun.symbol, result: toResult(currentRun.symbol), length: currentRun.length },
        switchRate: round(switchRate(recent20)),
        ratioT: round(ratioT(recent20)),
        changeScore: round(changeScore)
    };
}

function markovOrder(symbols, order, window = 240) {
    if (symbols.length <= order) return null;
    const state = symbols.slice(-order).join('');
    let tWeight = 0;
    let xWeight = 0;
    let samples = 0;
    const start = Math.max(order, symbols.length - window);

    for (let index = start; index < symbols.length; index += 1) {
        if (symbols.slice(index - order, index).join('') !== state) continue;
        const age = symbols.length - 1 - index;
        const weight = 0.5 ** (age / 90);
        if (symbols[index] === 'T') tWeight += weight;
        else xWeight += weight;
        samples += 1;
    }

    if (samples < 3) return null;
    const effective = tWeight + xWeight;
    return {
        order,
        samples,
        probabilityT: (tWeight + 4) / (effective + 8),
        evidence: clamp(samples / 14, 0, 1)
    };
}

function markovExpert(symbols) {
    const rows = [1, 2, 3, 4].map(order => markovOrder(symbols, order)).filter(Boolean);
    if (!rows.length) return null;
    let numerator = 0;
    let denominator = 0;
    for (const row of rows) {
        const weight = row.evidence * (1 + (row.order - 1) * 0.08);
        numerator += row.probabilityT * weight;
        denominator += weight;
    }
    return {
        id: 'markov',
        name: 'Markov bậc 1-4',
        probabilityT: denominator ? numerator / denominator : 0.5,
        evidence: rows.reduce((sum, row) => sum + row.evidence, 0) / rows.length,
        samples: rows.reduce((sum, row) => sum + row.samples, 0),
        detail: `Markov đọc các trạng thái bậc ${rows.map(row => row.order).join(', ')}.`
    };
}

function suffixExpert(symbols) {
    const rows = [];
    for (const length of [2, 3, 4, 5, 6]) {
        if (symbols.length <= length) continue;
        const suffix = symbols.slice(-length).join('');
        let tWeight = 0;
        let xWeight = 0;
        let samples = 0;
        const start = Math.max(length, symbols.length - 360);
        for (let index = start; index < symbols.length; index += 1) {
            if (symbols.slice(index - length, index).join('') !== suffix) continue;
            const age = symbols.length - 1 - index;
            const weight = 0.5 ** (age / 120);
            if (symbols[index] === 'T') tWeight += weight;
            else xWeight += weight;
            samples += 1;
        }
        if (samples < 4) continue;
        const effective = tWeight + xWeight;
        rows.push({
            length,
            samples,
            probabilityT: (tWeight + 4) / (effective + 8),
            evidence: clamp(samples / 18, 0, 1)
        });
    }
    if (!rows.length) return null;
    let numerator = 0;
    let denominator = 0;
    for (const row of rows) {
        const weight = row.evidence * (1 + (row.length - 2) * 0.05);
        numerator += row.probabilityT * weight;
        denominator += weight;
    }
    return {
        id: 'suffix',
        name: 'Lặp chuỗi hậu tố',
        probabilityT: denominator ? numerator / denominator : 0.5,
        evidence: rows.reduce((sum, row) => sum + row.evidence, 0) / rows.length,
        samples: rows.reduce((sum, row) => sum + row.samples, 0),
        detail: `So khớp các chuỗi dài ${rows.map(row => row.length).join(', ')} với lịch sử trước đó.`
    };
}

function regimeExpert(symbols, regime) {
    if (!symbols.length) return null;
    const last = symbols[symbols.length - 1];
    const runLength = regime.currentRun?.length || 1;
    let symbol = null;
    let probability = 0.5;

    if (regime.type === 'CẦU_1-1' || regime.type === 'ĐẢO_NHỊP') {
        symbol = opposite(last);
        probability = 0.5 + 0.045 * regime.strength;
    } else if (regime.type === 'CẦU_BỆT' || regime.type === 'THEO_NHỊP') {
        symbol = last;
        probability = 0.5 + 0.035 * regime.strength;
    } else if (regime.type === 'CẦU_2-2') {
        symbol = runLength < 2 ? last : opposite(last);
        probability = 0.55;
    } else if (regime.type === 'CẦU_3-3') {
        symbol = runLength < 3 ? last : opposite(last);
        probability = 0.55;
    } else if (regime.type === 'LỆCH_TÀI') {
        symbol = 'T';
        probability = 0.54;
    } else if (regime.type === 'LỆCH_XỈU') {
        symbol = 'X';
        probability = 0.54;
    }

    if (!symbol) return null;
    return {
        id: 'regime',
        name: 'Máy đọc loại cầu',
        probabilityT: symbol === 'T' ? probability : 1 - probability,
        evidence: clamp(regime.strength, 0.2, 1),
        samples: symbols.length,
        detail: `${regime.type}: ${regime.description}`
    };
}

const EXPERTS = [
    { id: 'markov', name: 'Markov bậc 1-4' },
    { id: 'suffix', name: 'Lặp chuỗi hậu tố' },
    { id: 'regime', name: 'Máy đọc loại cầu' }
];

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
        recent: [],
        ewmaBrier: 0.25
    };
}

class RegimeMarkovGuardEngineV8 {
    constructor(options = {}) {
        this.minHistory = Math.max(16, Number(options.minHistory) || 20);
        this.maxEngineHistory = Math.max(40, Number(options.maxEngineHistory) || 240);
        this.maxRuntimeHistory = Math.max(this.maxEngineHistory, Number(options.maxRuntimeHistory) || 10000);
        this.board = String(options.board || 'generic').toLowerCase();
        this.modelVersion = String(options.modelVersion || MODEL_VERSION);
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

    expertRecentAccuracy(id) {
        const recent = this.expertPerformance[id]?.recent || [];
        if (!recent.length) return 0.5;
        return recent.reduce((sum, value) => sum + value, 0) / recent.length;
    }

    expertTrusted(id) {
        const state = this.expertPerformance[id] || defaultExpertState();
        return state.predictions >= 30 && state.recent.length >= 30 && this.expertRecentAccuracy(id) >= 0.60 && state.ewmaBrier <= 0.255;
    }

    updateExpertPerformance(actualSymbol) {
        if (!this.pendingEvaluation?.signals) return;
        for (const signal of this.pendingEvaluation.signals) {
            const state = this.expertPerformance[signal.id] || defaultExpertState();
            const won = signal.symbol === actualSymbol;
            const actual = actualSymbol === 'T' ? 1 : 0;
            const brier = (signal.probabilityT - actual) ** 2;
            state.predictions += 1;
            if (won) state.wins += 1;
            else state.losses += 1;
            state.recent.push(won ? 1 : 0);
            if (state.recent.length > 40) state.recent.shift();
            state.ewmaBrier = state.ewmaBrier * 0.92 + brier * 0.08;
            this.expertPerformance[signal.id] = state;
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
            this.consecutiveWins = 0;
            this.consecutiveLosses += 1;
            if (this.stats.Chuoi_hien_tai.Loai === 'THUA') this.stats.Chuoi_hien_tai.So_luong += 1;
            else this.stats.Chuoi_hien_tai = { Loai: 'THUA', So_luong: 1 };
            this.stats.Chuoi_thua_dai_nhat = Math.max(this.stats.Chuoi_thua_dai_nhat, this.stats.Chuoi_hien_tai.So_luong);
            if (this.consecutiveLosses >= 3) {
                this.cooldownRounds = 1;
                this.consecutiveLosses = 2;
            }
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

    baselineSignal(symbols) {
        const last = symbols[symbols.length - 1] || 'T';
        if (this.board === 'md5') {
            return {
                symbol: last,
                probabilityT: last === 'T' ? 0.524 : 0.476,
                detail: 'Mốc MD5 ưu tiên tiếp tục cửa gần nhất; các mô hình cầu chỉ được phép phản biện khi đã tự chứng minh ổn định.'
            };
        }
        if (this.board === 'xanh') {
            return {
                symbol: 'T',
                probabilityT: 0.518,
                detail: 'Mốc Bàn Hũ giữ thiên lệch Tài rất nhẹ; Markov và loại cầu đóng vai trò bộ lọc.'
            };
        }
        const recent = symbols.slice(-20);
        const probabilityT = betaMean(recent.filter(symbol => symbol === 'T').length, recent.length, 8);
        return {
            symbol: probabilityT >= 0.5 ? 'T' : 'X',
            probabilityT,
            detail: 'Mốc chung dùng tỷ lệ đã làm trơn.'
        };
    }

    buildSignals(symbols, regime) {
        return [markovExpert(symbols), suffixExpert(symbols), regimeExpert(symbols, regime)].filter(Boolean);
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
                pattern: { type: regime.type, description: `Đang nạp ${symbols.length}/${this.minHistory} phiên để đọc cầu và Markov.` },
                reasons: [],
                loading: { Da_nap: symbols.length, Can_toi_thieu: this.minHistory, Con_thieu: Math.max(0, this.minHistory - symbols.length) },
                regime,
                modelVersion: this.modelVersion
            };
            this.lastDecision = decision;
            return decision;
        }

        const baseline = this.baselineSignal(symbols);
        const signals = this.buildSignals(symbols, regime);
        const rows = signals.map(signal => {
            const symbol = signal.probabilityT >= 0.5 ? 'T' : 'X';
            return {
                ...signal,
                probabilityT: round(clamp(signal.probabilityT, 0.42, 0.58)),
                symbol,
                side: toResult(symbol),
                recentAccuracy: round(this.expertRecentAccuracy(signal.id)),
                trusted: this.expertTrusted(signal.id)
            };
        });

        this.pendingEvaluation = {
            targetSession: lastSession + 1,
            signals: rows.map(row => ({ id: row.id, symbol: row.symbol, probabilityT: row.probabilityT }))
        };

        const trusted = rows.filter(row => row.trusted);
        const opposing = trusted.filter(row => row.symbol !== baseline.symbol);
        const agreeing = trusted.filter(row => row.symbol === baseline.symbol);
        let action = 'PREDICT';
        let skipReason = null;

        if (this.cooldownRounds > 0) {
            action = 'SKIP';
            skipReason = 'Nghỉ một phiên sau chuỗi thua 3 lần để tránh bám sai cầu.';
            this.cooldownRounds -= 1;
        } else if (opposing.length === 3 && agreeing.length === 0) {
            action = 'SKIP';
            skipReason = 'Markov, lặp chuỗi và máy đọc cầu đều phản đối mốc chính; bỏ qua thay vì đoán ép.';
        } else if (regime.changeScore >= 0.65 && opposing.length >= 2) {
            action = 'SKIP';
            skipReason = 'Cầu đang đổi chế độ và nhiều mô hình phản đối; tạm đứng ngoài.';
        }

        const supportiveStrength = agreeing.reduce((sum, row) => sum + Math.abs(row.probabilityT - 0.5), 0);
        const opposingStrength = opposing.reduce((sum, row) => sum + Math.abs(row.probabilityT - 0.5), 0);
        const baseEdge = Math.abs(baseline.probabilityT - 0.5);
        const displayedEdge = clamp(baseEdge + supportiveStrength * 0.15 - opposingStrength * 0.1, 0.01, 0.06);
        const probabilityT = baseline.symbol === 'T' ? 0.5 + displayedEdge : 0.5 - displayedEdge;
        const confidence = action === 'PREDICT' ? Math.round(clamp(50 + displayedEdge * 100, 51, 56)) : null;

        const ranked = rows.slice().sort((a, b) => {
            if (a.trusted !== b.trusted) return a.trusted ? -1 : 1;
            return Math.abs(b.probabilityT - 0.5) - Math.abs(a.probabilityT - 0.5);
        });
        const description = skipReason || `${regime.description} Mốc chính: ${toResult(baseline.symbol)}; chuyên gia được tin cậy: ${trusted.length}/3.`;
        const decision = {
            action,
            targetSession: lastSession + 1,
            prediction: action === 'PREDICT' ? toResult(baseline.symbol) : null,
            symbol: action === 'PREDICT' ? baseline.symbol : null,
            confidence,
            probabilityT: round(probabilityT),
            probabilityX: round(1 - probabilityT),
            pattern: { type: regime.type, description },
            reasons: [baseline.detail, ...ranked.slice(0, 2).map(row => row.detail)],
            regime,
            analysis: {
                architecture: 'Mốc bảo thủ + đọc loại cầu + Markov 1-4 + lặp hậu tố + bộ lọc chuỗi thua',
                runtimeHistory: this.history.length,
                engineWindow: symbols.length,
                baseline: { side: toResult(baseline.symbol), probabilityT: round(baseline.probabilityT) },
                trustedExperts: trusted.map(row => row.id),
                opposingTrustedExperts: opposing.map(row => row.id),
                consecutiveWins: this.consecutiveWins,
                consecutiveLosses: this.consecutiveLosses,
                skipReason
            },
            topModels: ranked.filter(row => row.symbol === baseline.symbol).slice(0, 3),
            opposingModels: ranked.filter(row => row.symbol !== baseline.symbol).slice(0, 3),
            componentCount: { primary: 4, total: 4 },
            modelVersion: this.modelVersion
        };

        if (action === 'PREDICT') {
            this.pendingPrediction = {
                targetSession: decision.targetSession,
                symbol: baseline.symbol,
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
        if (!Number.isSafeInteger(session) || !symbol) return { accepted: false, reason: 'INVALID_RESULT' };
        const last = this.history[this.history.length - 1];
        if (last && session <= last.Phien) return { accepted: false, reason: session === last.Phien ? 'DUPLICATE' : 'OLD_SESSION' };

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
        if (this.history.length > this.maxRuntimeHistory) this.history.splice(0, this.history.length - this.maxRuntimeHistory);
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
            const state = this.expertPerformance[expert.id] || defaultExpertState();
            const recentAccuracy = this.expertRecentAccuracy(expert.id);
            return {
                id: expert.id,
                name: expert.name,
                predictions: state.predictions,
                wins: state.wins,
                losses: state.losses,
                accuracy: state.predictions ? `${round((state.wins / state.predictions) * 100, 2)}%` : '0%',
                recentAccuracy: `${round(recentAccuracy * 100, 2)}%`,
                ewmaBrier: round(state.ewmaBrier),
                trusted: this.expertTrusted(expert.id)
            };
        });
    }

    getDiagnostics() {
        const symbols = this.getSymbols(this.maxEngineHistory);
        return {
            engine: ENGINE_NAME,
            modelVersion: this.modelVersion,
            board: this.board,
            runtimeHistorySize: this.history.length,
            engineWindowSize: symbols.length,
            minHistory: this.minHistory,
            regime: detectRegime(symbols),
            stats: this.getPublicStats(),
            expertPerformance: this.getPerformanceSummary(),
            lastDecision: this.lastDecision
        };
    }
}

// Alias retained so the existing server/backtest scripts remain compatible.
const AdaptiveSelectiveEngineV7 = RegimeMarkovGuardEngineV8;

module.exports = {
    RegimeMarkovGuardEngineV8,
    AdaptiveSelectiveEngineV7,
    MODEL_VERSION,
    ENGINE_NAME,
    EXPERTS,
    buildRuns,
    detectRegime,
    toSymbol,
    toResult
};
