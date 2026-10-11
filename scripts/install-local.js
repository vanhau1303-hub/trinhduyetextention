// Build và cài Metal Browser lên máy này để test.
//   node scripts/install-local.js              build + cài lại ngay
//   node scripts/install-local.js --if-changed chỉ chạy khi mã nguồn đổi so với lần cài trước
//
// Lần đầu (chưa cài) dùng bộ cài NSIS chạy im lặng; các lần sau build bản "dir" rồi chép đè vào
// thư mục cài cho nhanh. Trình duyệt đang mở sẽ được đóng nhẹ nhàng (giữ phiên) và mở lại.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync, spawn, spawnSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const PRODUCT = 'Metal Browser'
const EXE = `${PRODUCT}.exe`
const INSTALL_DIR = path.join(process.env.LOCALAPPDATA, 'Programs', PRODUCT)
const STAMP = path.join(ROOT, 'dist', '.install-stamp')
const LOCK = path.join(ROOT, 'dist', '.install-lock')
const LOG = path.join(ROOT, 'dist', 'install-local.log')
const INPUTS = ['src', 'build', 'package.json', 'package-lock.json']
const VENDOR_MARK = path.join(ROOT, 'vendor', 'bin', 'ffmpeg.exe')

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true })

function log(msg) {
  const line = `[${new Date().toLocaleString('vi-VN')}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG, line + '\n')
}

function hashInputs() {
  const h = crypto.createHash('sha256')
  const walk = (p) => {
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(p).sort()) walk(path.join(p, f))
    } else {
      h.update(path.relative(ROOT, p))
      h.update(fs.readFileSync(p))
    }
  }
  for (const i of INPUTS) {
    const p = path.join(ROOT, i)
    if (fs.existsSync(p)) walk(p)
  }
  return h.digest('hex')
}

function isRunning() {
  const out = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${EXE}`, '/NH'], { encoding: 'utf8', windowsHide: true }).stdout || ''
  return out.toLowerCase().includes(EXE.toLowerCase())
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// Đóng như bấm nút X để trình duyệt kịp lưu phiên; quá 15 giây mới buộc tắt.
function closeBrowser() {
  if (!isRunning()) return false
  spawnSync('taskkill', ['/IM', EXE], { windowsHide: true })
  for (let i = 0; i < 30 && isRunning(); i++) sleep(500)
  if (isRunning()) {
    log('Trình duyệt không tự đóng, buộc tắt.')
    spawnSync('taskkill', ['/F', '/T', '/IM', EXE], { windowsHide: true })
    for (let i = 0; i < 10 && isRunning(); i++) sleep(500)
  }
  return true
}

function builder(target) {
  const cli = path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js')
  execFileSync(process.execPath, [cli, '--win', target], { cwd: ROOT, stdio: ['ignore', fs.openSync(LOG, 'a'), fs.openSync(LOG, 'a')], windowsHide: true })
}

function main() {
  const onlyIfChanged = process.argv.includes('--if-changed')
  const installed = fs.existsSync(path.join(INSTALL_DIR, EXE))
  const hash = hashInputs()
  if (onlyIfChanged && installed && fs.existsSync(STAMP) && fs.readFileSync(STAMP, 'utf8') === hash) return

  // Chỉ một lần cài chạy tại một thời điểm (bỏ qua khoá cũ hơn 15 phút).
  try {
    const st = fs.statSync(LOCK)
    if (Date.now() - st.mtimeMs < 15 * 60 * 1000) return log('Đang có lần cài khác chạy, bỏ qua.')
  } catch {}
  fs.writeFileSync(LOCK, String(process.pid))

  try {
    const started = Date.now()
    // Extension + yt-dlp + ffmpeg đóng gói sẵn: tải về một lần (lần sau dùng lại).
    if (!fs.existsSync(VENDOR_MARK) || !fs.existsSync(path.join(ROOT, 'vendor', 'extensions'))) {
      log('Chuẩn bị extension + công cụ đóng gói sẵn…')
      const electron = require(path.join(ROOT, 'node_modules', 'electron'))
      execFileSync(electron, [path.join(ROOT, 'scripts', 'fetch-vendor.js')], { cwd: ROOT, stdio: ['ignore', fs.openSync(LOG, 'a'), fs.openSync(LOG, 'a')], windowsHide: true })
    }
    if (!installed) {
      log('Chưa cài: build bộ cài NSIS…')
      builder('nsis')
      const setup = fs.readdirSync(path.join(ROOT, 'dist')).find((f) => /Setup .*\.exe$/.test(f))
      closeBrowser()
      execFileSync(path.join(ROOT, 'dist', setup), ['/S'], { windowsHide: true })
    } else {
      log('Mã nguồn đã đổi: build bản mới…')
      builder('dir')
      const wasRunning = closeBrowser()
      // Bỏ qua file y hệt (cùng kích thước, không mới hơn) để khỏi chép lại ~350 MB công cụ mỗi lần.
      const unchanged = (src, dest) => {
        try {
          const a = fs.statSync(src)
          if (a.isDirectory()) return false
          const b = fs.statSync(dest)
          // electron-builder ghi lại mọi file mỗi lần build nên mtime luôn mới; với công cụ đóng gói
          // (resources/vendor) chỉ so kích thước.
          if (src.includes(`${path.sep}resources${path.sep}vendor${path.sep}`)) return a.size === b.size
          return a.size === b.size && a.mtimeMs <= b.mtimeMs
        } catch {
          return false
        }
      }
      // Danh sách extension đóng gói có thể bớt đi: xoá bản cũ để trình duyệt thấy đúng danh sách mới.
      fs.rmSync(path.join(INSTALL_DIR, 'resources', 'vendor', 'extensions'), { recursive: true, force: true })
      fs.cpSync(path.join(ROOT, 'dist', 'win-unpacked'), INSTALL_DIR, { recursive: true, force: true, filter: (src, dest) => !unchanged(src, dest) })
      if (wasRunning) {
        spawn(path.join(INSTALL_DIR, EXE), [], { detached: true, stdio: 'ignore' }).unref()
        log('Đã mở lại trình duyệt.')
      }
    }
    fs.writeFileSync(STAMP, hash)
    log(`Đã cài bản mới vào ${INSTALL_DIR} (${Math.round((Date.now() - started) / 1000)} giây).`)
  } catch (err) {
    log(`LỖI: ${err.message}`)
    process.exitCode = 1
  } finally {
    fs.rmSync(LOCK, { force: true })
  }
}

main()
