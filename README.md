# HIT API V9 — FOLLOW PREVIOUS + FAST 1-1

API dự đoán Tài/Xỉu cho Bàn Hũ và Bàn MD5 bằng đúng một chiến lược đơn giản:

1. Mặc định bám kết quả phiên trước.
2. Nhận cầu 1-1 ngay khi hậu tố xuất hiện `T-X-T` hoặc `X-T-X`.
3. Khi cầu 1-1 gãy, quay về bám kết quả phiên trước.

## Endpoint

- `/health`
- `/api/dashboard`
- `/api/hitxanh`
- `/api/hitxanh/history`
- `/api/hitxanh/cau`
- `/api/hitmd5`
- `/api/hitmd5/history`
- `/api/hitmd5/cau`
- `/api/diagnostics`

## Chạy

```bash
npm install
npm start
```

Thuật toán dự đoán ngay sau kết quả đầu tiên, không cần chờ đủ 20 phiên.
