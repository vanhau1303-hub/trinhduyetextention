// Chromium mới có sẵn namespace `browser` (giống Firefox) nhưng electron-chrome-extensions chỉ
// bổ sung API vào `chrome`. Extension dùng `self.browser || self.chrome` (vd. uBlock Origin Lite)
// sẽ thiếu chrome.permissions, chrome.tabs... Trỏ `browser` về `chrome` đã được bổ sung.
// Phải đăng ký SAU preload của electron-chrome-extensions.
const { contextBridge } = require('electron')

const isExtensionContext =
  process.type === 'service-worker' || (typeof location !== 'undefined' && location.href.startsWith('chrome-extension://'))

if (isExtensionContext && 'executeInMainWorld' in contextBridge) {
  try {
    contextBridge.executeInMainWorld({
      func: () => {
        const chrome = globalThis.chrome
        if (!chrome || globalThis.browser === chrome) return
        try {
          Object.defineProperty(globalThis, 'browser', { value: chrome, writable: true, configurable: true, enumerable: false })
        } catch {
          // Không ghi đè được thì để nguyên.
        }
      },
    })
  } catch {}
}
