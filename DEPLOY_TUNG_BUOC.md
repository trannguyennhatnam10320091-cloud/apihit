# Chạy API V7 trên Render

1. Tạo repo GitHub mới, ví dụ `hit-api-v7`.
2. Tải toàn bộ file trong thư mục này lên repo.
3. Tạo một chuỗi bí mật dài để bảo vệ thao tác quản trị.
4. Vào Render, chọn **New → Blueprint** và kết nối repo.
5. Render đọc `render.yaml` và tạo Web Service.
6. Điền `ADMIN_ACTION_TOKEN` bằng chuỗi ở bước 3.
7. Deploy.
8. Kiểm tra `https://ten-service.onrender.com/health`.
9. Kiểm tra `https://ten-service.onrender.com/api/dashboard`.

API xem dự đoán không cần khóa. Chỉ hai thao tác sau cần khóa quản trị:

```text
POST /api/admin/reset
GET  /api/admin/export
```

API không dùng PostgreSQL. Lịch sử và thống kê chỉ tồn tại trong RAM; restart hoặc deploy lại sẽ bắt đầu từ đầu.
