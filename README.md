# Metal Browser

Trình duyệt nền Chromium (Electron 44 / Chromium 152) chạy được **extension Chrome**, kèm các tính năng quen thuộc của Cốc Cốc.

## Tính năng

| Nhóm | Chi tiết |
| --- | --- |
| Extension Chrome | Cài thẳng từ **Chrome Web Store** (nút "Thêm vào Chrome"), hỗ trợ Manifest V2 + V3, nút extension + popup trên thanh công cụ, menu chuột phải của extension, trang Tuỳ chọn, bật/tắt/gỡ, tải extension đã giải nén, tự cập nhật |
| Chuyển từ trình duyệt khác | **Nhập extension từ Cốc Cốc / Chrome / Edge / Brave** đang cài trên máy (cài lại bản mới từ Store, hoặc chép bản trên máy nếu không có trên Store) |
| Tải video (kiểu Cốc Cốc Savior) | Nút **"Tải video"** hiện trên thanh địa chỉ khi trang có video. Bắt link từ thẻ video trong mọi khung (iframe), từ API trình phát (**JW Player**, Video.js, Plyr, Flowplayer, hls.js) và từ luồng mạng. File mp4/webm/mp3 trực tiếp tải ngay (kèm Referer); luồng HLS/DASH (m3u8/mpd) được ghép thành MP4; YouTube, Facebook, TikTok, Instagram, X… tải qua **yt-dlp** + **ffmpeg** (tự tải về ở lần đầu dùng), chọn chất lượng 1080p/720p/480p hoặc chỉ MP3 |
| DNS bảo mật | Phân giải tên miền qua **DNS-over-HTTPS** (Cloudflare 1.1.1.1 — mặc định, Google 8.8.8.8, Quad9, AdGuard hoặc địa chỉ tuỳ chỉnh) để vào được các trang bị nhà mạng chặn bằng DNS. Đổi trong Cài đặt hoặc Menu → Công cụ khác, áp dụng ngay |
| Dịch | Bôi đen → chuột phải → **"Dịch sang Tiếng Việt"** hiện bong bóng dịch ngay trên trang (có nút Đọc, Sao chép); nút **Dịch trang** trên thanh địa chỉ |
| Chặn quảng cáo | Tích hợp sẵn (EasyList + EasyPrivacy, bộ lọc Ghostery), bật/tắt bằng nút khiên, hiện số yêu cầu đã chặn |
| Giao diện | Tab kéo-thả, ghim tab, tắt tiếng tab, thanh dấu trang, chủ đề sáng/tối theo Windows, ép trang web sang chế độ tối, trang Tab mới có đồng hồ + ô truy cập nhanh + hình nền tuỳ chọn |
| Ẩn danh | Ctrl+Shift+N — không lưu lịch sử/cookie, xoá sạch khi đóng cửa sổ ẩn danh cuối cùng |
| Có sẵn khi cài | Dark Reader, Google Translate, Google Docs Offline, Synology Image Assistant + yt-dlp, ffmpeg — không cần tải thêm (danh sách ở `build/bundled-extensions.json`) |
| Khác | Khôi phục phiên làm việc, gợi ý tìm kiếm trên thanh địa chỉ, tìm trong trang, thu phóng, quản lý tải xuống, lịch sử, kiểm tra chính tả tiếng Việt, hỏi quyền micro/camera/vị trí, phím tắt giống Chrome |

## Cài đặt & chạy

Yêu cầu: Windows 10/11 x64.

- **Dùng ngay:** chạy `dist\Metal Browser Setup 1.0.0.exe` (sau khi build) để cài.
- **Chạy từ mã nguồn:**

```bash
npm install
npm start
```

- **Đóng gói bộ cài** (tự tải extension + yt-dlp + ffmpeg vào `vendor/` trước):

```bash
npm run dist
```

## Phím tắt

Ctrl+T tab mới · Ctrl+Shift+N cửa sổ ẩn danh · Ctrl+W đóng tab · Ctrl+Shift+T mở lại tab đã đóng · Ctrl+Tab / Ctrl+1…9 chuyển tab · Ctrl+L thanh địa chỉ · Ctrl+F tìm trong trang · Ctrl+D đánh dấu trang · Ctrl+H lịch sử · Ctrl+J tải xuống · Ctrl+Shift+B thanh dấu trang · Ctrl +/−/0 thu phóng · F11 toàn màn hình · F12 DevTools

## Giới hạn đã biết

Electron không phải Chrome đầy đủ, nên một số API extension chưa có hoặc chưa hoạt động:

- **`declarativeNetRequest` không được thực thi.** Extension chặn quảng cáo kiểu MV3 (uBlock Origin Lite, AdGuard MV3…) cài được nhưng *không chặn gì*. Hãy dùng bộ chặn quảng cáo tích hợp.
- Khi bật chặn quảng cáo tích hợp, extension dùng `chrome.webRequest` để chặn/sửa yêu cầu mạng có thể không nhận được sự kiện. Nếu gặp, tắt chặn quảng cáo trong Cài đặt.
- Chưa có: `chrome.commands` (phím tắt của extension), `chrome.identity` (đăng nhập Google trong extension), `chrome.sidePanel`, `tabs.captureVisibleTab`.
- Google có thể chặn đăng nhập tài khoản Google trong trình duyệt nhúng ("Trình duyệt này có thể không an toàn"). Chưa kiểm tra.
- DNS bảo mật chỉ vượt được kiểu chặn bằng DNS; trang bị chặn theo IP hoặc SNI vẫn cần VPN.
- Không có đồng bộ tài khoản (Chrome Sync) và chế độ ẩn danh chưa hỗ trợ extension.

## Cấu trúc

```
src/main.js         Khởi động, extension, Web Store, chặn quảng cáo, menu, phím tắt, IPC
src/window.js       Cửa sổ + quản lý tab (WebContentsView)
src/media.js        Quét video trên trang, yt-dlp, ffmpeg
src/downloads.js    Trình quản lý tải xuống
src/store.js        Lưu cài đặt / lịch sử / dấu trang / phiên (JSON trong %APPDATA%\Metal Browser)
src/ui/             Thanh tab, thanh địa chỉ, bảng tải video
src/pages/          Trang nội bộ metal:// (newtab, settings, extensions, history, downloads, bookmarks)
src/preload/        Preload cho UI, trang nội bộ, và vá namespace `browser` cho extension
```

## Giấy phép

GPL-3.0 (do dùng [electron-chrome-extensions](https://github.com/samuelmaddock/electron-browser-shell) theo giấy phép GPL-3.0).
