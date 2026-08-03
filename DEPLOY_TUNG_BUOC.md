# Triển khai V9 lên Render và giữ URL cũ

1. Mở đúng repository đang nối với dịch vụ Render hiện tại.
2. Xóa mã nguồn API cũ trong repository.
3. Đưa toàn bộ file bên trong thư mục `API_SIMPLE_11` lên repository.
4. Giữ nguyên biến môi trường `ADMIN_ACTION_TOKEN` trên Render.
5. Chọn Manual Deploy → Deploy latest commit.
6. Kiểm tra `/health`, sau đó kiểm tra `/api/hitmd5` và `/api/hitxanh`.

Nên cập nhật trực tiếp dịch vụ Render cũ để URL API của bot không đổi.
