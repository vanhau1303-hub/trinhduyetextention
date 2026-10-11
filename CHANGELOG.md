# Nhật ký thay đổi

Số phiên bản hiện ở **Menu ⋮** (dòng trên cùng), góc dưới trái trang **Tab mới** và trang **Giới thiệu**.

## 1.3.0 — 11/10/2026

- **Icon mới** của Metal Browser (cửa sổ, thanh tác vụ, shortcut, bộ cài, trang nội bộ).
- **Khi khởi động** (Cài đặt → Khi khởi động): Mở trang Tab mới / Tiếp tục từ chỗ đã dừng / **Mở một trang hoặc tập hợp các trang cụ thể** — thêm từng trang hoặc bấm **Dùng các trang đang mở**.
- **Trình quản lý mật khẩu:** hỏi lưu khi đăng nhập (sửa được tên đăng nhập, "Không bao giờ" cho trang đó), tự điền khi chỉ có 1 tài khoản, bấm vào ô đăng nhập để chọn tài khoản khi có nhiều. Hỗ trợ form đăng nhập 2 bước (nhập email trước, mật khẩu sau).
- Mật khẩu **mã hoá bằng tài khoản Windows (DPAPI)**, chỉ lưu trên máy; mật khẩu chỉ được điền vào đúng trang đã lưu. Trang **metal://passwords** (Menu ⋮ → Mật khẩu đã lưu): xem, sao chép (tự xoá khỏi bộ nhớ tạm sau 30 giây), xoá.
- **Xoá dữ liệu duyệt web** có thêm mục **Mật khẩu đã lưu**.
- **Giao diện mới:** thanh tab bo cong, thanh địa chỉ dạng viên thuốc, các bảng (tải video, tải xuống, gợi ý, mật khẩu, thông tin trang) cùng một kiểu; hộp thoại (cài extension, trang treo, báo lỗi) vẽ trong trình duyệt thay cho hộp thoại Windows; trang Cài đặt/Tiện ích/Lịch sử… làm mới, hộp xác nhận cùng kiểu.
- **Quyền trang web không còn bật hộp thoại:** lời hỏi hiện gọn trong thanh địa chỉ (Cho phép / Chặn). Bấm biểu tượng 🔒/ⓘ cạnh địa chỉ để chỉnh quyền của trang. Cài đặt → Quyền của trang web: chọn mặc định Hỏi/Cho phép/Chặn cho từng quyền; **Vị trí mặc định Chặn** (Google không đòi nữa).
- **Dịch:** nút Dịch dịch **cả trang ngay tại chỗ** (bấm lần nữa xem bản gốc); đang bôi đen thì chỉ dịch đoạn đó.
- **Hình nền Tab mới:** 10 mẫu gradient (mặc định "Cực quang") hoặc ảnh riêng.
- **Sửa tải video bị lỗi kết nối** (WinError 10061) trên trang bị nhà mạng chặn: yt-dlp nay đi qua proxy nội bộ dùng DNS bảo mật của trình duyệt. Nút "Tải video trang này" ưu tiên luồng đã bắt được; thông báo lỗi tiếng Việt dễ hiểu.
- **Nhật ký lỗi (log):** ghi vào %APPDATA%Metal Browserlogs (giữ 7 ngày). Xuất 1 file để gửi báo lỗi: Menu ⋮ → Công cụ khác → Xuất nhật ký lỗi, hoặc trang Giới thiệu.

## 1.2.1 — 11/10/2026

- **Bảng tải video gọn hơn:** bỏ file rác (tiếng bấm nút, hiệu ứng < 300 KB hoặc < 15 giây); mỗi loại luồng chỉ hiện 1 dòng "Video đầy đủ" mang tên trang, chất lượng chọn ở ô Chất lượng.
- **Bắt video bị giấu link:** kiểm tra nội dung các link khả nghi (vd. `/api/playlist?id=…` trả về text/plain) để nhận ra playlist HLS/DASH; nhận biết trang đang phát luồng video để hiện nút "Tải video trang này".
- Extension mặc định chỉ còn **Google Translate**. Dark Reader, Synology Image Assistant, Google Docs Offline do bản 1.2.0 tự cài sẽ được gỡ (extension tự cài bằng tay không bị đụng tới).

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
