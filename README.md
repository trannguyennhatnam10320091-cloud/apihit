# HIT API V8 — Regime Markov Guard

Bản này viết lại bộ dự đoán theo hướng đọc loại cầu + Markov và giảm cược ép. API endpoint vẫn giữ nguyên để bot cũ dùng được.

## Điểm mới

- Nhận diện: bệt, 1-1, 2-2, 3-3, lệch Tài/Xỉu, theo nhịp, đảo nhịp, hỗn hợp.
- Markov bậc 1–4 và so khớp hậu tố 2–6.
- Chuyên gia chỉ được coi là đáng tin sau ít nhất 30 lần chấm và đạt 60% trong 40 lần gần nhất.
- Sau 3 lần sai liên tiếp, tự SKIP 1 phiên.
- Không dùng random fallback.
- Giữ nguyên `/api/hitxanh`, `/api/hitmd5`, `/api/dashboard`, reset/export và cấu trúc bot.

# HIT Adaptive Selective Runtime API V7

Repo API mới hoàn toàn cho hai bàn **Bàn Hũ (`xanh`)** và **Bàn MD5 (`md5`)**.

## Mục tiêu

- Lấy kết quả trực tiếp từ nguồn game hiện tại.
- Dự đoán phiên tiếp theo bằng engine V7 tách cấu hình theo từng bàn.
- Không dùng Mini App, PostgreSQL, trang admin web hoặc dữ liệu user.
- Lưu kết quả, lịch sử và thống kê **chỉ trong RAM**.
- Mỗi lần restart/redeploy, toàn bộ lịch sử và stat trở về 0.
- Có trạng thái `SKIP` khi tín hiệu yếu hoặc sau chuỗi thua.
- Giữ đường dẫn API gần giống dự án cũ để bot mới dễ tích hợp.

## Kiến trúc

```text
Nguồn kết quả Hũ/MD5
        ↓
Collector trong server.js
        ↓
AdaptiveSelectiveEngineV7
        ↓
Lịch sử + stat runtime trong RAM
        ↓
JSON công khai, gọi trực tiếp không cần header xác thực
        ↓
Telegram Bot
```

## Engine V7

V7 dùng một mốc ổn định riêng cho từng bàn và năm nhóm tín hiệu phụ:

1. Mốc ổn định theo bàn.
2. Xu hướng gần ở cửa sổ 6, 10 và 20 phiên.
3. Markov bậc 1–3.
4. Nhịp tiếp tục/đổi bên.
5. Lặp hậu tố và độ dài nhịp.

Tín hiệu phụ không được quyền lật mốc chính ngay lập tức. Chúng chỉ có ảnh hưởng rõ khi đã có đủ lượt đánh giá gần đây và hiệu suất đạt ngưỡng. Xác suất được co về 50% và giới hạn tối đa 54,5%, tránh tình trạng báo 60–64% khi dữ liệu không chứng minh được mức đó.

## Trạng thái trả về

- `WAIT_DATA`: chưa đủ số phiên tối thiểu.
- `PREDICT`: có dự đoán Tài/Xỉu.
- `SKIP`: chủ động bỏ qua vì tín hiệu yếu, đổi chế độ mạnh hoặc đang nghỉ sau chuỗi thua.

## Endpoint

Các endpoint xem dự đoán được gọi trực tiếp, không cần khóa. Hai thao tác quản trị cần `ADMIN_ACTION_TOKEN`.

| Method | Endpoint | Chức năng |
|---|---|---|
| GET | `/health` | Tình trạng dịch vụ, công khai |
| GET | `/api/dashboard` | Hai bàn trong một response |
| GET | `/api/hitxanh` | Kết quả/dự đoán Bàn Hũ |
| GET | `/api/hitmd5` | Kết quả/dự đoán Bàn MD5 |
| GET | `/api/hitxanh/history?limit=80` | Lịch sử runtime Bàn Hũ |
| GET | `/api/hitmd5/history?limit=80` | Lịch sử runtime MD5 |
| GET | `/api/hitxanh/cau?limit=60` | Chuỗi T/X Bàn Hũ |
| GET | `/api/hitmd5/cau?limit=60` | Chuỗi T/X MD5 |
| GET | `/api/diagnostics` | Chi tiết engine và hiệu suất nhóm tín hiệu |

## Ví dụ response

```json
{
  "Phien": 3102500,
  "Xuc_xac": [4, 2, 6],
  "Tong": 12,
  "Ket_qua": "Tài",
  "Phien_tiep_theo": 3102501,
  "Du_doan": "Tài",
  "Do_tin_cay": "52%",
  "Loai_cau": "HỖN_HỢP",
  "Trang_thai": "PREDICT",
  "Xac_suat": {
    "Tai": "52%",
    "Xiu": "48%"
  },
  "Thong_ke": {
    "Tong_phien": 120,
    "Tong_du_doan": 83,
    "Bo_qua": 25,
    "Thang": 44,
    "Thua": 39,
    "Ti_le_thang": "53.01%",
    "Do_phu": "76.85%"
  }
}
```

## Chạy local

Yêu cầu Node.js 18 trở lên.

```bash
cp .env.example .env
# Nạp biến môi trường theo cách của hệ điều hành hoặc dịch vụ chạy bot/API
npm test
npm start
```

Test nhanh:

```bash
node server.js
```

## Backtest CSV

Đặt file lịch sử ngoài thư mục repo hoặc truyền đường dẫn:

```bash
node tools/backtest.js /duong-dan/hitclub-history-all-2026-08-03.csv
```

Kết quả đánh giá mẫu nằm trong [BACKTEST.md](BACKTEST.md).

## Deploy Render

1. Tạo GitHub repo mới và tải toàn bộ thư mục này lên.
2. Trên Render chọn **New Web Service** và kết nối repo.
3. Render đọc `render.yaml` hoặc cấu hình thủ công:
   - Build: `npm install`
   - Start: `npm start`
   - Health check: `/health`
4. Deploy. API hoạt động công khai và không cần cấu hình secret.

Không cần các biến cũ:

```text
DATABASE_URL
ADMIN_SECRET
TELEGRAM_BOT_TOKEN
CORS_ORIGINS
```

## Lưu ý về dữ liệu runtime

Dự án cố ý không có lưu trữ bền vững. Những trường hợp sau đều làm lịch sử/stat reset:

- deploy commit mới;
- Render restart service;
- process crash;
- service bị nền tảng tái tạo instance.

Đây là hành vi đúng theo thiết kế dự án mới.

## Thao tác quản trị dành cho bot

Thiết lập biến môi trường `ADMIN_ACTION_TOKEN` trên Render. Bot gửi cùng giá trị qua header `X-Admin-Token`.

| Method | Endpoint | Chức năng |
|---|---|---|
| POST | `/api/admin/reset?board=xanh` | Đặt lại Bàn Hũ |
| POST | `/api/admin/reset?board=md5` | Đặt lại Bàn MD5 |
| POST | `/api/admin/reset?board=all` | Đặt lại cả hai bàn |
| GET | `/api/admin/export?board=all&format=csv` | Xuất lịch sử runtime |

Các endpoint xem dự đoán vẫn công khai. Nếu chưa cấu hình khóa quản trị, endpoint reset/xuất file sẽ từ chối hoạt động.
