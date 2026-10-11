// Tải sẵn những thứ được đóng gói kèm bộ cài để người dùng không phải tải thêm:
//   vendor/extensions/<id>/<version>_0   extension từ Chrome Web Store (danh sách: build/bundled-extensions.json)
//   vendor/bin/yt-dlp.exe, ffmpeg.exe, ffprobe.exe   công cụ tải video
// Chạy bằng Electron (thư viện Web Store cần):  npx electron scripts/fetch-vendor.js [--force]
// Thư mục vendor/ không đưa lên git (file nhị phân lớn, bản quyền của bên thứ ba).
const fs = require('node:fs')
const path = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { app } = require('electron')
const AdmZip = require('adm-zip')
const { downloadExtension } = require('electron-chrome-web-store')

const ROOT = path.join(__dirname, '..')
const VENDOR = path.join(ROOT, 'vendor')
const EXT_DIR = path.join(VENDOR, 'extensions')
const BIN_DIR = path.join(VENDOR, 'bin')
const FORCE = process.argv.includes('--force')

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
const FFMPEG_URL = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(`${dest}.part`))
  fs.renameSync(`${dest}.part`, dest)
}

async function fetchExtensions() {
  const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'bundled-extensions.json'), 'utf8'))
  fs.mkdirSync(EXT_DIR, { recursive: true })
  for (const { id, name } of list) {
    const dir = path.join(EXT_DIR, id)
    if (!FORCE && fs.existsSync(dir) && fs.readdirSync(dir).some((v) => fs.existsSync(path.join(dir, v, 'manifest.json')))) {
      console.log(`✓ ${name} (đã có)`)
      continue
    }
    fs.rmSync(dir, { recursive: true, force: true })
    const out = await downloadExtension(id, EXT_DIR)
    console.log(`↓ ${name} → ${path.relative(ROOT, out)}`)
  }
  // Xoá extension không còn trong danh sách.
  for (const id of fs.readdirSync(EXT_DIR)) {
    if (!list.some((e) => e.id === id)) fs.rmSync(path.join(EXT_DIR, id), { recursive: true, force: true })
  }
}

async function fetchTools() {
  fs.mkdirSync(BIN_DIR, { recursive: true })
  const ytdlp = path.join(BIN_DIR, 'yt-dlp.exe')
  if (FORCE || !fs.existsSync(ytdlp)) {
    await download(YTDLP_URL, ytdlp)
    console.log('↓ yt-dlp.exe')
  } else console.log('✓ yt-dlp.exe (đã có)')

  const ffmpeg = path.join(BIN_DIR, 'ffmpeg.exe')
  if (FORCE || !fs.existsSync(ffmpeg) || !fs.existsSync(path.join(BIN_DIR, 'ffprobe.exe'))) {
    const zip = path.join(BIN_DIR, 'ffmpeg.zip')
    await download(FFMPEG_URL, zip)
    for (const entry of new AdmZip(zip).getEntries()) {
      if (/\/bin\/(ffmpeg|ffprobe)\.exe$/i.test(entry.entryName)) {
        fs.writeFileSync(path.join(BIN_DIR, path.basename(entry.entryName)), entry.getData())
      }
    }
    fs.rmSync(zip, { force: true })
    console.log('↓ ffmpeg.exe, ffprobe.exe')
  } else console.log('✓ ffmpeg.exe, ffprobe.exe (đã có)')
}

app.whenReady().then(async () => {
  try {
    await fetchExtensions()
    await fetchTools()
    app.exit(0)
  } catch (err) {
    console.error('Lỗi chuẩn bị vendor:', err)
    app.exit(1)
  }
})
