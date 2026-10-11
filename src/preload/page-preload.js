// Preload chạy trong mọi trang của phiên duyệt web (sandbox).
// Chỉ các trang nội bộ metal:// mới được cấp API `metal`.
const { contextBridge, ipcRenderer } = require('electron')

if (location.protocol === 'metal:') {
  contextBridge.exposeInMainWorld('metal', {
    invoke: (name, ...args) => ipcRenderer.invoke('page:invoke', name, ...args),
    on: (name, cb) => ipcRenderer.on(`page:${name}`, (_e, ...args) => cb(...args)),
  })
}
