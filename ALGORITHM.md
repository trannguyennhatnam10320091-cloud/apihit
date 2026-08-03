# THUẬT TOÁN V9 — BÁM PHIÊN TRƯỚC + CẦU 1-1 NHANH

Thuật toán chỉ có hai chế độ.

## 1. Bám phiên trước

Mặc định, phiên tiếp theo chọn cùng cửa với kết quả vừa ra.

- Phiên vừa ra Tài → dự đoán Tài.
- Phiên vừa ra Xỉu → dự đoán Xỉu.

## 2. Cầu 1-1

Ngay khi ba kết quả cuối tạo thành một nhịp đảo:

- `T-X-T`, hoặc
- `X-T-X`

bot chuyển sang cầu 1-1 và chọn cửa đối diện kết quả vừa ra.

Ví dụ chuỗi `T-T-T-X-T` có hậu tố `T-X-T`, vì vậy phiên tiếp theo dự đoán `X`.

Khi đang theo cầu 1-1:

- dự đoán đúng → tiếp tục đảo cửa;
- dự đoán sai → coi là cầu gãy và quay về bám kết quả phiên vừa ra.

Thuật toán không dùng Markov, mô hình chuyên gia, ngẫu nhiên, lịch sử dài hay cơ chế bỏ phiên.
