// Preload cho thanh giao diện trình duyệt (tab, thanh địa chỉ, nút extension).
const { contextBridge, ipcRenderer } = require('electron')
const { injectBrowserAction } = require('electron-chrome-extensions/browser-action')

// Đăng ký thẻ <browser-action-list> hiển thị nút của các extension.
injectBrowserAction()

const CHANNELS = ['state', 'focus-address', 'find-open', 'find-result', 'downloads', 'open-media']

contextBridge.exposeInMainWorld('ui', {
  send: (type, payload) => ipcRenderer.send('ui:action', type, payload),
  invoke: (type, payload) => ipcRenderer.invoke('ui:invoke', type, payload),
  on: (channel, cb) => {
    if (!CHANNELS.includes(channel)) return
    ipcRenderer.on(channel, (_e, ...args) => cb(...args))
  },
})
