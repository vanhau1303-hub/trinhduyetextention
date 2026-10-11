// Nhật ký (log) của Metal Browser: %APPDATA%\Metal Browser\logs\metal-YYYY-MM-DD.log, giữ 7 ngày.
// Ghi lại console của tiến trình chính, lỗi trang/giao diện, lỗi tải video (yt-dlp)…
// "Xuất nhật ký" gộp thông tin máy + log gần đây thành 1 file .txt để gửi khi báo lỗi.
// Tham số trong URL (thường chứa token) được cắt bỏ trước khi ghi.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const util = require('node:util')
const { app } = require('electron')

const KEEP_DAYS = 7
const MAX_FILE_BYTES = 5 * 1024 * 1024
let dir = null
const original = { log: console.log, info: console.info, warn: console.warn, error: console.error }

const pad = (n) => String(n).padStart(2, '0')
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const stamp = () => {
  const d = new Date()
  return `${today()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

// Bỏ query string của URL (token, mã phiên…) và mật khẩu nếu lỡ lọt vào.
function sanitize(text) {
  return String(text)
    .replace(/(https?:\/\/[^\s?#'"<>]+)\?[^\s'"<>)]*/g, '$1?…')
    .replace(/("?password"?\s*[:=]\s*)("[^"]*"|\S+)/gi, '$1"***"')
}

function file() {
  return path.join(dir, `metal-${today()}.log`)
}

function write(level, tag, args) {
  if (!dir) return
  const msg = args.map((a) => (typeof a === 'string' ? a : util.inspect(a, { depth: 4, breakLength: 160 }))).join(' ')
  const line = `${stamp()} [${level}]${tag ? ` [${tag}]` : ''} ${sanitize(msg)}\n`
  try {
    const f = file()
    let size = 0
    try {
      size = fs.statSync(f).size
    } catch {}
    if (size < MAX_FILE_BYTES) fs.appendFileSync(f, line)
  } catch {}
}

function init() {
  dir = path.join(app.getPath('userData'), 'logs')
  fs.mkdirSync(dir, { recursive: true })
  // Xoá log cũ hơn KEEP_DAYS ngày.
  const cutoff = Date.now() - KEEP_DAYS * 864e5
  for (const f of fs.readdirSync(dir)) {
    try {
      if (fs.statSync(path.join(dir, f)).mtimeMs < cutoff) fs.rmSync(path.join(dir, f))
    } catch {}
  }
  console.log = (...a) => (original.log(...a), write('INFO', '', a))
  console.info = (...a) => (original.info(...a), write('INFO', '', a))
  console.warn = (...a) => (original.warn(...a), write('WARN', '', a))
  console.error = (...a) => (original.error(...a), write('ERROR', '', a))
  write('INFO', 'app', [`Khởi động Metal Browser ${app.getVersion()} (Electron ${process.versions.electron}, Chromium ${process.versions.chrome}, ${os.platform()} ${os.release()})`])
}

const log = {
  info: (tag, ...a) => write('INFO', tag, a),
  warn: (tag, ...a) => write('WARN', tag, a),
  error: (tag, ...a) => write('ERROR', tag, a),
  dir: () => dir,
}

// Gộp thông tin + log 3 ngày gần nhất (tối đa ~3 MB) vào 1 file trong thư mục đích.
function exportLogs(destDir, extraInfo = {}) {
  const d = new Date()
  const out = path.join(destDir, `Metal-Browser-log-${today()}-${pad(d.getHours())}${pad(d.getMinutes())}.txt`)
  const header = [
    '=== Metal Browser — nhật ký lỗi ===',
    `Thời điểm xuất: ${stamp()}`,
    `Phiên bản: ${app.getVersion()} · Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
    `Hệ điều hành: ${os.type()} ${os.release()} ${os.arch()} · RAM ${Math.round(os.totalmem() / 1073741824)} GB`,
    ...Object.entries(extraInfo).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`),
    '',
  ].join('\n')
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.log'))
    .sort()
    .slice(-3)
  let body = ''
  for (const f of files) {
    let text = fs.readFileSync(path.join(dir, f), 'utf8')
    if (text.length > 1024 * 1024) text = `…(cắt bớt phần đầu)…\n${text.slice(-1024 * 1024)}`
    body += `\n===== ${f} =====\n${text}`
  }
  fs.writeFileSync(out, header + body)
  return out
}

module.exports = { init, log, exportLogs, sanitize }
