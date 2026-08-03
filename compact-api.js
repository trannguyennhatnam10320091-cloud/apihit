'use strict';

function parseLimit(value, fallback = 80, maximum = 1000) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, maximum);
}

function percent(value) {
    return `${Math.round((Number(value) || 0) * 100)}%`;
}

function compactStats(stats = {}) {
    return {
        Tong_phien: Number(stats.Tong_phien) || 0,
        Tong_du_doan: Number(stats.Tong_du_doan) || 0,
        Bo_qua: Number(stats.Bo_qua) || 0,
        Thang: Number(stats.Thang) || 0,
        Thua: Number(stats.Thua) || 0,
        Ti_le_thang: stats.Ti_le_thang || '0%',
        Do_phu: stats.Do_phu || '0%',
        Chuoi_thang_dai_nhat: Number(stats.Chuoi_thang_dai_nhat) || 0,
        Chuoi_thua_dai_nhat: Number(stats.Chuoi_thua_dai_nhat) || 0,
        Chuoi_hien_tai: stats.Chuoi_hien_tai || { Loai: 'CHƯA_CÓ', So_luong: 0 }
    };
}

function compactApi(latest = {}, stats = {}) {
    return {
        Phien: latest.Phien ?? null,
        Xuc_xac: Array.isArray(latest.Xuc_xac) ? latest.Xuc_xac.slice(0, 3) : [],
        Tong: latest.Tong ?? null,
        Ket_qua: latest.Ket_qua ?? null,
        Phien_tiep_theo: latest.Phien_tiep_theo ?? null,
        Du_doan: latest.Du_doan ?? null,
        Do_tin_cay: latest.Do_tin_cay ?? null,
        Loai_cau: latest.Loai_cau ?? null,
        Mo_ta_cau: latest.Mo_ta_cau ?? null,
        Ly_do: Array.isArray(latest.Ly_do_du_doan) ? latest.Ly_do_du_doan.slice(0, 3) : [],
        Trang_thai: latest.Trang_thai || 'WAIT_DATA',
        Xac_suat: latest.Xac_suat || { Tai: '50%', Xiu: '50%' },
        Model_version: latest.Model_version || null,
        Thong_ke: compactStats(stats)
    };
}

function historyApi(name, history, stats) {
    return {
        Ban: name,
        Phien_moi_nhat: history.length ? history[history.length - 1].Phien : null,
        So_luong: history.length,
        Lich_su: history,
        Thong_ke: compactStats(stats)
    };
}

function cauApi(name, history) {
    return {
        Ban: name,
        Phien_moi_nhat: history.length ? history[history.length - 1].Phien : null,
        So_luong: history.length,
        Cau: history.map(item => [item.Phien, item.Ket_qua === 'Tài' ? 'T' : 'X'])
    };
}

module.exports = { parseLimit, percent, compactStats, compactApi, historyApi, cauApi };
