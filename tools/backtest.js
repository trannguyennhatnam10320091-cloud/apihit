'use strict';

const fs = require('fs');
const path = require('path');
const { AdaptiveSelectiveEngineV7 } = require('../predictor');

function parseCsvLine(line) {
    const cells = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') {
            if (quoted && line[index + 1] === '"') {
                value += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if (char === ',' && !quoted) {
            cells.push(value);
            value = '';
        } else {
            value += char;
        }
    }
    cells.push(value);
    return cells;
}

function readCsv(filename) {
    const text = fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter(Boolean);
    const headers = parseCsvLine(lines[0]);
    return lines.slice(1).map(line => {
        const values = parseCsvLine(line);
        return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    });
}

function toInput(row) {
    return {
        Phien: Number(row.session_id),
        Xuc_xac_1: Number(row.die_1),
        Xuc_xac_2: Number(row.die_2),
        Xuc_xac_3: Number(row.die_3),
        Tong: Number(row.total),
        Ket_qua: row.actual_result
    };
}

function evaluateBoard(rows, options = {}) {
    const board = rows[0]?.board || 'generic';
    const engine = new AdaptiveSelectiveEngineV7({ ...options, board });
    const sorted = rows.slice().sort((a, b) => Number(a.session_id) - Number(b.session_id));
    const decisions = [];
    for (const row of sorted) {
        const outcome = engine.addResult(toInput(row));
        if (outcome.accepted && outcome.settled) {
            decisions.push({
                session: Number(row.session_id),
                correct: outcome.settled.Thang_thua === 'THẮNG',
                confidence: outcome.settled.Do_tin_cay
            });
        }
    }
    const stats = engine.getPublicStats();
    return {
        rounds: sorted.length,
        predictions: stats.Tong_du_doan,
        skipped: stats.Bo_qua,
        wins: stats.Thang,
        losses: stats.Thua,
        accuracy: stats.Tong_du_doan ? stats.Thang / stats.Tong_du_doan : 0,
        coverage: (stats.Tong_du_doan + stats.Bo_qua)
            ? stats.Tong_du_doan / (stats.Tong_du_doan + stats.Bo_qua)
            : 0,
        longestWin: stats.Chuoi_thang_dai_nhat,
        longestLoss: stats.Chuoi_thua_dai_nhat,
        decisions
    };
}

function formatPercent(value) {
    return `${(value * 100).toFixed(2)}%`;
}

function splitEvaluation(rows, options) {
    const sorted = rows.slice().sort((a, b) => Number(a.session_id) - Number(b.session_id));
    const cuts = [0, Math.floor(sorted.length * 0.6), Math.floor(sorted.length * 0.8), sorted.length];
    const names = ['train-60%', 'validation-20%', 'test-20%'];
    const output = [];
    for (let index = 0; index < 3; index += 1) {
        const prefix = sorted.slice(0, cuts[index]);
        const segment = sorted.slice(cuts[index], cuts[index + 1]);
        const combined = prefix.concat(segment);
        const result = evaluateBoard(combined, options);
        const prefixResult = prefix.length ? evaluateBoard(prefix, options) : { decisions: [] };
        const previousSessions = new Set(prefixResult.decisions.map(item => item.session));
        const segmentDecisions = result.decisions.filter(item => !previousSessions.has(item.session));
        const wins = segmentDecisions.filter(item => item.correct).length;
        output.push({
            name: names[index],
            rounds: segment.length,
            predictions: segmentDecisions.length,
            accuracy: segmentDecisions.length ? wins / segmentDecisions.length : 0,
            coverage: segment.length ? segmentDecisions.length / segment.length : 0
        });
    }
    return output;
}

const input = process.argv[2]
    || path.resolve(__dirname, '../../hitclub-history-all-2026-08-03.csv');
if (!fs.existsSync(input)) {
    console.error(`Không tìm thấy CSV: ${input}`);
    process.exit(1);
}

const options = {
    minHistory: Number(process.env.MIN_HISTORY) || 20,
    maxEngineHistory: Number(process.env.MAX_ENGINE_HISTORY) || 240,
    maxRuntimeHistory: 20000,
    predictEdge: Number(process.env.PREDICT_EDGE) || 0.014,
    minConsensus: Number(process.env.MIN_CONSENSUS) || 0.56
};

const rows = readCsv(input);
const boards = ['md5', 'xanh'];
let totalPredictions = 0;
let totalWins = 0;
let totalRounds = 0;

console.log(`Backtest V8 Regime-Markov Guard: ${path.basename(input)}`);
console.log(`Tham số: ${JSON.stringify(options)}`);
for (const board of boards) {
    const boardRows = rows.filter(row => row.board === board);
    const result = evaluateBoard(boardRows, options);
    totalPredictions += result.predictions;
    totalWins += result.wins;
    totalRounds += result.rounds;
    console.log(`\n[${board.toUpperCase()}]`);
    console.log(`Phiên: ${result.rounds}`);
    console.log(`Dự đoán: ${result.predictions} | Bỏ qua: ${result.skipped}`);
    console.log(`Độ phủ: ${formatPercent(result.coverage)}`);
    console.log(`Đúng: ${result.wins} | Sai: ${result.losses}`);
    console.log(`Tỷ lệ đúng: ${formatPercent(result.accuracy)}`);
    console.log(`Chuỗi thắng dài nhất: ${result.longestWin} | Chuỗi thua dài nhất: ${result.longestLoss}`);
    for (const split of splitEvaluation(boardRows, options)) {
        console.log(`  ${split.name}: dự đoán ${split.predictions}/${split.rounds}, độ phủ ${formatPercent(split.coverage)}, đúng ${formatPercent(split.accuracy)}`);
    }
}

console.log('\n[TỔNG]');
console.log(`Phiên: ${totalRounds}`);
console.log(`Dự đoán: ${totalPredictions}`);
console.log(`Độ phủ thô: ${formatPercent(totalPredictions / totalRounds)}`);
console.log(`Tỷ lệ đúng: ${formatPercent(totalPredictions ? totalWins / totalPredictions : 0)}`);
