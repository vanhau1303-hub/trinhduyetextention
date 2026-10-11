// Tạo build/icon.png (512px) từ SVG bằng Electron. Chạy: npx electron scripts/make-icon.js
const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#22c55e"/><stop offset="1" stop-color="#0e7a3a"/>
    </linearGradient>
    <linearGradient id="h" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fde047"/><stop offset="1" stop-color="#f59e0b"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#g)"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#fff" stroke-width="28" opacity=".95"/>
  <path d="M106 256h300M256 106c-60 70-60 230 0 300M256 106c60 70 60 230 0 300" fill="none" stroke="#fff" stroke-width="20" opacity=".55" stroke-linecap="round"/>
  <path d="M330 320a18 18 0 0 1 18-18h34v-40a18 18 0 0 1 36 0v40h34a18 18 0 0 1 0 36h-34v40a18 18 0 0 1-36 0v-40h-34a18 18 0 0 1-18-18z" fill="url(#h)" stroke="#0e7a3a" stroke-width="10"/>
</svg>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } })
  await win.loadURL(`data:text/html,<html><body style="margin:0;background:transparent">${encodeURIComponent(SVG)}</body></html>`)
  await new Promise((r) => setTimeout(r, 300))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })
  const out = path.join(__dirname, '..', 'build')
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, 'icon.png'), img.resize({ width: 512, height: 512 }).toPNG())
  fs.writeFileSync(path.join(out, 'icon.svg'), SVG)
  console.log('Đã tạo build/icon.png')
  app.quit()
})
