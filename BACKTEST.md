# Backtest trên `hitclub-history-all-2026-08-03.csv`

## Dữ liệu

- Tổng: 2.418 phiên.
- MD5: 1.272 phiên.
- Bàn Hũ (`xanh`): 1.146 phiên.
- Replay theo đúng thứ tự phiên.
- Engine khởi động từ dữ liệu trống, giống hành vi sau deploy.
- Tham số mặc định: `MIN_HISTORY=12`, `MAX_ENGINE_HISTORY=20`, `PREDICT_EDGE=0.014`.

## V6.1 trong CSV

| Chỉ số | Kết quả |
|---|---:|
| Dự đoán có kết quả | 2.396 |
| Thắng | 1.220 |
| Thua | 1.176 |
| Tỷ lệ đúng | 50,92% |

## V7 replay

| Bàn | Phiên | Dự đoán | Độ phủ | Thắng | Thua | Tỷ lệ đúng |
|---|---:|---:|---:|---:|---:|---:|
| MD5 | 1.272 | 1.040 | 82,54% | 539 | 501 | 51,83% |
| Bàn Hũ | 1.146 | 737 | 64,99% | 383 | 354 | 51,97% |
| **Tổng** | **2.418** | **1.777** | **73,49%** | **922** | **855** | **51,89%** |

## Chia theo thời gian

### MD5

| Đoạn | Dự đoán | Tỷ lệ đúng |
|---|---:|---:|
| 60% đầu | 611 | 50,90% |
| 20% tiếp | 207 | 53,62% |
| 20% cuối | 222 | 52,70% |

### Bàn Hũ

| Đoạn | Dự đoán | Tỷ lệ đúng |
|---|---:|---:|
| 60% đầu | 432 | 51,85% |
| 20% tiếp | 157 | 52,23% |
| 20% cuối | 148 | 52,03% |

## Cách hiểu đúng

- V7 tốt hơn V6.1 trên chính file này khoảng 0,97 điểm phần trăm và dự đoán ít phiên hơn.
- Chênh lệch vẫn nhỏ; dữ liệu không chứng minh có lợi thế chắc chắn hoặc bền vững trong tương lai.
- Các tham số V7 được thiết kế sau khi xem bộ dữ liệu này, vì vậy đây không phải kiểm định độc lập hoàn toàn.
- Cần thu thập dữ liệu mới ngoài mẫu và chạy lại `tools/backtest.js` trước khi kết luận thuật toán có cải thiện thật.
