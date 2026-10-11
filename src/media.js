// Tải video/nhạc từ trang web (giống Cốc Cốc Savior).
// - File media trực tiếp (mp4, webm, mp3...) tải bằng trình tải xuống có sẵn.
// - YouTube, Facebook, TikTok... (luồng blob/HLS) tải bằng yt-dlp.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, execFile } = require('node:child_process')
const { app, net } = require('electron')
const AdmZip = require('adm-zip')

const FFMPEG_URL = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'

// Trang mà yt-dlp hỗ trợ tốt; trang khác có thẻ <video> vẫn được thử bằng trình trích xuất chung.
const YTDLP_SITES = [
  'youtube.com', 'youtu.be', 'facebook.com', 'fb.watch', 'tiktok.com', 'instagram.com',
  'twitter.com', 'x.com', 'vimeo.com', 'dailymotion.com', 'soundcloud.com', 'bilibili.com',
  'twitch.tv', 'reddit.com', 'threads.net', 'zingmp3.vn', 'nhaccuatui.com', 'vnexpress.net',
  'dantri.com.vn', 'tuoitre.vn', 'pinterest.com', 'bandcamp.com', 'mixcloud.com',
]

// Chạy trong isolated world của trang để liệt kê media; không ảnh hưởng script của trang.
const SCAN_SCRIPT = `(() => {
  const out = new Map()
  const MEDIA_RE = /\\.(mp4|webm|m4v|mov|mkv|flv|m3u8|mpd|mp3|m4a|aac|ogg|oga|opus|wav|flac)(\\?|#|$)/i
  const add = (url, type, info = {}) => {
    if (!url || typeof url !== 'string') return
    if (!/^https?:/i.test(url)) return
    if (/googlevideo\\.com|\\.m4s(\\?|$)|\\/range\\//i.test(url)) return
    const prev = out.get(url)
    out.set(url, { url, type, ...(prev || {}), ...info })
  }
  for (const el of document.querySelectorAll('video, audio')) {
    const info = { tag: el.tagName.toLowerCase(), width: el.videoWidth || 0, height: el.videoHeight || 0,
      duration: Number.isFinite(el.duration) ? Math.round(el.duration) : 0 }
    add(el.currentSrc, info.tag, info)
    add(el.getAttribute('src') && el.src, info.tag, info)
    for (const s of el.querySelectorAll('source')) add(s.src, info.tag, info)
  }
  const blobVideos = [...document.querySelectorAll('video')].filter(v => (v.currentSrc || '').startsWith('blob:')).length
  try {
    for (const e of performance.getEntriesByType('resource')) {
      if (MEDIA_RE.test(e.name) || e.initiatorType === 'video' || e.initiatorType === 'audio') {
        const m = e.name.match(MEDIA_RE)
        add(e.name, m && /mp3|m4a|aac|ogg|oga|opus|wav|flac/i.test(m[1]) ? 'audio' : 'video', { size: e.transferSize || 0 })
      }
    }
  } catch {}
  const videoCount = document.querySelectorAll('video').length
  return { items: [...out.values()].slice(0, 30), blobVideos, videoCount }
})()`

class MediaTools {
  constructor(downloads, session) {
    this.downloads = downloads
    this.session = session
    this.binDir = path.join(app.getPath('userData'), 'bin')
    this.ytdlpPath = path.join(this.binDir, 'yt-dlp.exe')
    this.installing = {}
    this.ffmpeg = undefined
  }

  isYtdlpSite(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\.|^m\./, '')
      return YTDLP_SITES.some((s) => host === s || host.endsWith(`.${s}`))
    } catch {
      return false
    }
  }

  async scan(webContents) {
    if (!webContents || webContents.isDestroyed()) return { items: [], ytdlp: false }
    const url = webContents.getURL()
    if (!/^https?:/i.test(url)) return { items: [], ytdlp: false }
    let result = { items: [], blobVideos: 0, videoCount: 0 }
    try {
      result = await webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: SCAN_SCRIPT }])
    } catch {
      // Trang đang chuyển hướng hoặc bị chặn script.
    }
    const ytdlp = this.isYtdlpSite(url) || result.blobVideos > 0 || result.videoCount > 0
    return { ...result, ytdlp, pageUrl: url, title: webContents.getTitle() }
  }

  hasYtdlp() {
    return fs.existsSync(this.ytdlpPath)
  }

  async findFfmpeg() {
    if (this.ffmpeg) return this.ffmpeg
    const local = path.join(this.binDir, 'ffmpeg.exe')
    if (fs.existsSync(local)) return (this.ffmpeg = local)
    this.ffmpeg = await new Promise((resolve) => {
      execFile('where', ['ffmpeg'], { windowsHide: true }, (err, stdout) => {
        resolve(err ? null : stdout.split(/\r?\n/)[0].trim() || null)
      })
    })
    return this.ffmpeg
  }

  // Tải một file công cụ về đĩa (ghi dần, không giữ cả file trong RAM), hiện tiến trình trong danh sách tải xuống.
  async fetchTool(key, url, dest, label) {
    if (this.installing[key]) return this.installing[key]
    this.installing[key] = (async () => {
      fs.mkdirSync(this.binDir, { recursive: true })
      const d = this.downloads.add({ kind: 'tool', url, filename: label, path: dest })
      const tmp = `${dest}.part`
      try {
        const res = await net.fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        d.total = Number(res.headers.get('content-length')) || 0
        const out = fs.createWriteStream(tmp)
        const reader = res.body.getReader()
        let last = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (!out.write(value)) await new Promise((r) => out.once('drain', r))
          d.received += value.length
          d.percent = d.total ? (d.received / d.total) * 100 : 0
          if (Date.now() - last > 300) {
            last = Date.now()
            this.downloads.changed()
          }
        }
        await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())))
        fs.renameSync(tmp, dest)
        d.state = 'completed'
        d.percent = 100
        this.downloads.changed()
        return dest
      } catch (err) {
        fs.rm(tmp, { force: true }, () => {})
        d.state = 'interrupted'
        d.error = String(err.message || err)
        this.downloads.changed()
        throw err
      } finally {
        delete this.installing[key]
      }
    })()
    return this.installing[key]
  }

  // yt-dlp.exe bản chính thức từ GitHub.
  installYtdlp() {
    return this.fetchTool('ytdlp', YTDLP_URL, this.ytdlpPath, 'yt-dlp.exe (công cụ tải video)')
  }

  // ffmpeg (bản dựng của dự án yt-dlp) để ghép hình + tiếng của YouTube và đổi sang MP3.
  async installFfmpeg() {
    const zip = path.join(this.binDir, 'ffmpeg.zip')
    await this.fetchTool('ffmpeg', FFMPEG_URL, zip, 'ffmpeg (ghép hình + tiếng cho video)')
    try {
      const archive = new AdmZip(zip)
      for (const entry of archive.getEntries()) {
        if (/\/bin\/(ffmpeg|ffprobe)\.exe$/i.test(entry.entryName)) {
          fs.writeFileSync(path.join(this.binDir, path.basename(entry.entryName)), entry.getData())
        }
      }
    } finally {
      fs.rm(zip, { force: true }, () => {})
    }
    this.ffmpeg = undefined
    const found = await this.findFfmpeg()
    if (!found) throw new Error('Không giải nén được ffmpeg.')
    return found
  }

  async updateYtdlp() {
    if (!this.hasYtdlp()) return this.installYtdlp()
    return new Promise((resolve) => {
      execFile(this.ytdlpPath, ['-U'], { windowsHide: true }, () => resolve(true))
    })
  }

  // Xuất cookie của trang (định dạng Netscape) để yt-dlp tải được video cần đăng nhập.
  async writeCookies(pageUrl) {
    let host
    try {
      host = new URL(pageUrl).hostname
    } catch {
      return null
    }
    const base = host.split('.').slice(-2).join('.')
    const cookies = await this.session.cookies.get({ domain: base })
    if (!cookies.length) return null
    const lines = ['# Netscape HTTP Cookie File']
    for (const c of cookies) {
      const domain = c.hostOnly || c.domain.startsWith('.') ? c.domain : `.${c.domain}`
      lines.push([
        domain,
        domain.startsWith('.') ? 'TRUE' : 'FALSE',
        c.path || '/',
        c.secure ? 'TRUE' : 'FALSE',
        Math.round(c.expirationDate || 0),
        c.name,
        c.value,
      ].join('\t'))
    }
    const file = path.join(os.tmpdir(), `metal-cookies-${Date.now()}.txt`)
    fs.writeFileSync(file, lines.join('\n') + '\n')
    return file
  }

  formatArgs(quality, ffmpeg) {
    const h = quality === 'best' || quality === 'audio' ? '' : `[height<=${quality}]`
    if (ffmpeg) {
      if (quality === 'audio') return ['--ffmpeg-location', ffmpeg, '-x', '--audio-format', 'mp3', '-f', 'ba/b']
      return ['--ffmpeg-location', ffmpeg, '-f', `bv*${h}+ba/b${h}/bv*+ba/b`, '--merge-output-format', 'mp4']
    }
    // Không có ffmpeg: chỉ lấy được file đã gộp sẵn hình + tiếng.
    if (quality === 'audio') return ['-f', 'ba[ext=m4a]/ba/b']
    return ['-f', `b${h}[ext=mp4]/b${h}/b`]
  }

  // quality: 'best' | '1080' | '720' | '480' | 'audio'
  async downloadWithYtdlp(pageUrl, title, quality = 'best') {
    const d = this.downloads.add({ kind: 'ytdlp', url: pageUrl, filename: title || pageUrl, path: '' })
    try {
      if (!this.hasYtdlp()) await this.installYtdlp()
      let ffmpeg = await this.findFfmpeg()
      // Đổi sang MP3 bắt buộc cần ffmpeg.
      if (!ffmpeg && quality === 'audio') ffmpeg = await this.installFfmpeg()
      const result = await this.runYtdlp(d, pageUrl, quality, ffmpeg)
      // YouTube không còn định dạng gộp sẵn hình + tiếng: tự tải ffmpeg rồi thử lại.
      if (result.formatMissing && !ffmpeg && d.state !== 'cancelled') {
        d.filename = `${title || pageUrl} (đang chuẩn bị ffmpeg…)`
        this.downloads.changed()
        ffmpeg = await this.installFfmpeg()
        d.filename = title || pageUrl
        await this.runYtdlp(d, pageUrl, quality, ffmpeg)
      }
    } catch (err) {
      if (d.state !== 'cancelled') {
        d.state = 'interrupted'
        d.error = String(err.message || err)
        this.downloads.changed()
      }
    }
    return d
  }

  async runYtdlp(d, pageUrl, quality, ffmpeg) {
    const args = ['--no-playlist', '--newline', '--progress', '--encoding', 'utf-8', '--no-mtime',
      '-P', this.downloads.dir, '-o', '%(title).150B [%(id)s].%(ext)s',
      '--progress-template', 'download:METALPROG %(progress._percent_str)s|%(progress._speed_str)s|%(progress._total_bytes_str)s|%(progress._total_bytes_estimate_str)s',
      '--print', 'after_move:METALFILE %(filepath)s',
      // YouTube cần JS runtime để giải mã chữ ký; dùng chính Electron ở chế độ Node.
      '--js-runtimes', `node:${process.execPath}`,
      ...this.formatArgs(quality, ffmpeg)]
    const cookieFile = await this.writeCookies(pageUrl).catch(() => null)
    if (cookieFile) args.push('--cookies', cookieFile)
    args.push(pageUrl)

    d.state = 'progressing'
    d.error = ''
    const proc = spawn(this.ytdlpPath, args, {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ELECTRON_RUN_AS_NODE: '1' },
    })
    this.downloads.attachProcess(d.id, proc)
    let errText = ''
    const onLine = (line) => {
      line = line.trim()
      if (!line) return
      if (line.startsWith('METALPROG ')) {
        const [pct, speed, total, est] = line.slice(8).split('|').map((s) => s.trim())
        d.percent = parseFloat(pct) || d.percent
        d.speed = speed && !/NA|Unknown/i.test(speed) ? speed : ''
        d.sizeText = !/NA/.test(total) ? total : !/NA/.test(est) ? `~${est}` : ''
        this.downloads.changed()
      } else if (line.startsWith('METALFILE ')) {
        d.path = line.slice(8)
        d.filename = path.basename(d.path)
      } else if (/^\[download\] Destination: /.test(line)) {
        d.filename = path.basename(line.replace('[download] Destination: ', ''))
        this.downloads.changed()
      } else if (/^ERROR/.test(line)) {
        errText = line
      }
    }
    const buf = { out: '', err: '' }
    const pipe = (key) => (chunk) => {
      buf[key] += chunk.toString('utf8')
      const lines = buf[key].split(/\r?\n/)
      buf[key] = lines.pop()
      lines.forEach(onLine)
    }
    proc.stdout.on('data', pipe('out'))
    proc.stderr.on('data', pipe('err'))

    let code = await new Promise((resolve) => {
      proc.on('close', resolve)
      proc.on('error', (err) => {
        errText = String(err.message || err)
        resolve(-1)
      })
    })
    if (cookieFile) fs.rm(cookieFile, () => {})
    this.downloads.detach(d.id)
    if (d.state === 'cancelled') return { code }
    const formatMissing = code !== 0 && /Requested format is not available/i.test(errText)
    // Đôi khi antivirus khoá file tạm làm bước đổi tên báo lỗi dù file cuối đã được tạo.
    const renamed = errText.match(/\.temp\.\w+' -> '(.+?)'$/)
    if (code !== 0 && renamed) {
      const target = renamed[1].replace(/\\\\/g, '\\')
      if (fs.existsSync(target)) {
        d.path = target
        d.filename = path.basename(target)
        code = 0
      }
    }
    if (code === 0) {
      d.state = 'completed'
      d.percent = 100
      if (d.path && fs.existsSync(d.path)) d.received = fs.statSync(d.path).size
      this.downloads.emit('completed', d)
    } else if (!formatMissing || ffmpeg) {
      d.state = 'interrupted'
      d.error = errText || `yt-dlp thoát với mã ${code}`
    }
    d.speed = ''
    this.downloads.changed()
    return { code, formatMissing }
  }
}

module.exports = { MediaTools }
