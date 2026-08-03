# Thiết kế thuật toán V7

## Vì sao bỏ hướng V6.1

File lịch sử cung cấp 2.418 phiên. V6.1 dự đoán 2.396 phiên và đạt khoảng 50,92%. Confidence trung bình của V6.1 cao hơn đáng kể tỷ lệ đúng thực tế, nên không thể coi các mức 60–64% là xác suất đã hiệu chuẩn.

V7 thay đổi ba nguyên tắc:

1. Không gán trọng số lớn chỉ vì nhận dạng được tên cầu.
2. Tách hành vi Bàn Hũ và MD5.
3. Không bắt buộc phải dự đoán mọi phiên.

## Mốc theo từng bàn

Kết quả kiểm tra theo thứ tự thời gian cho thấy hai mốc đơn giản ổn định hơn hệ thống tên cầu cũ trong mẫu dữ liệu:

- MD5: ưu tiên tiếp tục phía của phiên gần nhất.
- Bàn Hũ: dùng thiên lệch Tài rất nhẹ làm mốc.

Đây chỉ là mốc xác suất thấp, không phải khẳng định kết quả có quy luật chắc chắn.

## Tín hiệu thích nghi

Mỗi tín hiệu phụ được đánh giá ở mọi phiên bằng:

- số lần dự báo;
- thắng/thua;
- accuracy EWMA;
- Brier score EWMA;
- 20 kết quả gần nhất.

Tín hiệu phải có ít nhất 20 lượt đánh giá, accuracy gần đây từ 55% và Brier score phù hợp mới được xem là `trusted`. Một tín hiệu đơn lẻ không được đảo chiều mốc chính; cần ít nhất hai tín hiệu đáng tin cùng phản đối.

## Phát hiện đổi chế độ

Engine so sánh sáu phiên gần nhất với sáu phiên trước đó bằng:

- tỷ lệ Tài;
- tỷ lệ đổi bên;
- độ dài nhịp hiện tại.

Khi `changeScore` cao, xác suất bị co mạnh hơn và có thể trả `SKIP`.

## Kiểm soát confidence

- Xác suất cuối bị giới hạn trong khoảng 45,5%–54,5%.
- Confidence hiển thị chỉ từ 51%–55%.
- Không dùng random.
- Không dùng dữ liệu tương lai trong quá trình replay/backtest.

## Chuỗi thua

Sau ba dự đoán sai liên tiếp, engine nghỉ một phiên (`SKIP`) rồi tiếp tục với yêu cầu biên cao hơn. Cơ chế này nhằm giảm nhịp đặt lệnh liên tục, không làm tăng xác suất toán học của kết quả.
