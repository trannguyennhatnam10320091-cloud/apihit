# Thuật toán V8 — Regime Markov Guard

V8 được viết lại theo hướng bảo thủ:

- nhận diện loại cầu: bệt, 1-1, 2-2, 3-3, lệch Tài/Xỉu, theo nhịp, đảo nhịp và hỗn hợp;
- Markov bậc 1 đến 4;
- so khớp hậu tố dài 2 đến 6;
- từng chuyên gia phải có ít nhất 30 lần được chấm và đạt tối thiểu 60% trong 40 lần gần nhất mới được coi là đáng tin;
- các chuyên gia không được ép dự đoán. Khi toàn bộ tín hiệu mạnh phản đối mốc chính, hệ thống SKIP;
- sau 3 dự đoán sai liên tiếp, nghỉ 1 phiên;
- không có random fallback.

Lưu ý: kết quả Tài/Xỉu có thể gần ngẫu nhiên. Backtest chỉ mô tả dữ liệu đã có, không bảo đảm lợi nhuận tương lai.
