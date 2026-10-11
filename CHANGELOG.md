# Nhật ký thay đổi

Số phiên bản hiện ở **Menu ⋮** (dòng trên cùng), góc dưới trái trang **Tab mới** và trang **Giới thiệu**.

## 1.2.0 — 11/10/2026

- **Chế độ ẩn danh** (Ctrl+Shift+N, Menu ⋮ → Cửa sổ ẩn danh mới, chuột phải liên kết → Mở trong cửa sổ ẩn danh): phiên chỉ nằm trong bộ nhớ, không lưu lịch sử, không lưu vào phiên khôi phục; đóng cửa sổ ẩn danh cuối cùng là xoá sạch cookie, cache, dữ liệu trang. Giao diện tông tím tối có nhãn "Ẩn danh". Extension không chạy trong ẩn danh (giống Chrome); chặn quảng cáo, DNS bảo mật, tải video vẫn hoạt động.
- **Đóng gói sẵn, không cần tải thêm:** Dark Reader, Google Translate, Google Docs Offline, Synology Image Assistant được cài sẵn ở lần chạy đầu (vẫn tự cập nhật qua Chrome Web Store; gỡ rồi thì không tự cài lại). yt-dlp + ffmpeg nằm sẵn trong bộ cài nên tải video được ngay.
- Danh sách extension đóng gói: `build/bundled-extensions.json`; `npm run vendor` tải chúng (và công cụ) vào `vendor/` trước khi build.

## 1.1.0 — 11/10/2026

- **Tải video JW Player:** quét video trong mọi khung (iframe), đọc danh sách phát của JW Player / Video.js / Plyr / Flowplayer / hls.js, và bắt link video trong dữ liệu trang tải về (kể cả link không có đuôi file).
- Bảng tải video hiện từng lựa chọn: luồng HLS, luồng DASH, MP4 theo chất lượng (1080p, 720p…). Luồng m3u8/mpd được ghép thành MP4, đặt tên theo tiêu đề trang; tải có gửi kèm Referer nên trang không chặn.
- **DNS bảo mật (DNS-over-HTTPS):** Cloudflare 1.1.1.1 (mặc định), Google 8.8.8.8, Quad9, AdGuard hoặc địa chỉ tuỳ chỉnh — vào được các trang bị nhà mạng chặn bằng DNS. Đổi trong Cài đặt hoặc Menu → Công cụ khác.
- Hiện số phiên bản trong menu và trang Tab mới.
- Sửa: đường dẫn file tải bằng yt-dlp bị ghi sai sau khi đổi tên sang Metal Browser.
- Thêm `scripts/install-local.js`: build và cài lại bản mới lên máy để kiểm tra.

## 1.0.0 — 11/10/2026

- Phiên bản đầu tiên: chạy extension Chrome (cài từ Chrome Web Store, nhập từ Cốc Cốc/Chrome/Edge), tải video qua yt-dlp, dịch nhanh, chặn quảng cáo, tab/dấu trang/lịch sử/tải xuống, giao diện tiếng Việt.
