// Tải video/nhạc từ trang web (giống Cốc Cốc Savior).
// - Bắt link media từ 3 nguồn: thẻ <video>/<audio> trong mọi frame, API của trình phát
//   (JW Player, Video.js, Plyr, Flowplayer, Clappr) và luồng mạng (theo Content-Type).
// - File trực tiếp (mp4, webm, mp3...) tải bằng trình tải xuống có sẵn (kèm Referer).
// - Luồng HLS/DASH (m3u8/mpd) và YouTube, Facebook, TikTok... tải bằng yt-dlp + ffmpeg.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
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

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?|#|$)/i
const MEDIA_EXT = /\.(mp4|webm|m4v|mov|mkv|flv|m3u8|mpd|mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?|#|$)/i
// Mảnh nhỏ của luồng (segment) và YouTube (đã có yt-dlp lo) thì bỏ qua.
const IGNORE_RE = /googlevideo\.com|\.(ts|m4s|aac\.ts)(\?|$)|\/range\/|[?&]range=|\/seg-?\d+|\/segment\d+|\/chunk[-_]?\d+/i

function streamKind(url, contentType = '') {
  const ct = contentType.toLowerCase()
  if (/mpegurl/.test(ct) || /\.m3u8(\?|#|$)/i.test(url)) return 'hls'
  if (/dash\+xml/.test(ct) || /\.mpd(\?|#|$)/i.test(url)) return 'dash'
  return ''
}

// Chạy trong MỌI frame (main world) để đọc được đối tượng của trình phát trên trang.
const FRAME_SCRIPT = `(() => {
  const out = []
  const abs = (u) => { try { return new URL(u, location.href).href } catch { return '' } }
  const add = (url, info = {}) => { url = abs(url); if (/^https?:/i.test(url)) out.push({ url, ...info }) }
  for (const el of document.querySelectorAll('video, audio')) {
    const info = { tag: el.tagName.toLowerCase(), width: el.videoWidth || 0, height: el.videoHeight || 0,
      duration: Number.isFinite(el.duration) ? Math.round(el.duration) : 0 }
    if (el.currentSrc) add(el.currentSrc, info)
    if (el.getAttribute('src')) add(el.getAttribute('src'), info)
    for (const s of el.querySelectorAll('source')) add(s.getAttribute('src'), { ...info, label: s.getAttribute('label') || s.getAttribute('res') || '' })
  }
  // JW Player: lấy playlist (kể cả nhiều chất lượng) trực tiếp từ API của trình phát.
  try {
    if (typeof window.jwplayer === 'function') {
      for (let i = 0; i < 8; i++) {
        const p = window.jwplayer(i)
        if (!p || typeof p.getPlaylist !== 'function') break
        for (const it of p.getPlaylist() || []) {
          const title = it.title || ''
          for (const s of [...(it.sources || []), ...(it.allSources || [])]) add(s.file, { player: 'JW Player', label: s.label && !/^[0-9]+$/.test(String(s.label)) ? String(s.label) : '', title, mime: s.type || '' })
          if (it.file) add(it.file, { player: 'JW Player', title })
        }
      }
    }
  } catch {}
  try { if (window.videojs && videojs.getPlayers) for (const p of Object.values(videojs.getPlayers())) if (p) { const s = p.currentSources ? p.currentSources() : []; for (const x of s) add(x.src, { player: 'Video.js', mime: x.type || '' }); if (p.currentSrc) add(p.currentSrc(), { player: 'Video.js' }) } } catch {}
  try { for (const p of (window.Plyr && Plyr.instances) || []) add(p.source, { player: 'Plyr' }) } catch {}
  try { if (window.flowplayer && flowplayer.instances) for (const p of flowplayer.instances) for (const s of (p.video && p.video.sources) || []) add(s.src, { player: 'Flowplayer' }) } catch {}
  try { for (const k of Object.keys(window)) { const v = window[k]; if (v && v.constructor && v.constructor.name === 'Hls' && v.url) add(v.url, { player: 'hls.js' }) } } catch {}
  const videos = [...document.querySelectorAll('video')]
  return { items: out, videoCount: videos.length, blobVideos: videos.filter((v) => (v.currentSrc || '').startsWith('blob:')).length, frameUrl: location.href }
})()`

class MediaTools extends EventEmitter {
  constructor(downloads, session) {
    super()
    this.downloads = downloads
    this.session = session
    this.binDir = path.join(app.getPath('userData'), 'bin')
    this.ytdlpPath = path.join(this.binDir, 'yt-dlp.exe')
    this.installing = {}
    this.ffmpeg = undefined
    this.sniffed = new Map() // webContentsId -> Map(url -> item)
  }

  // Nghe phản hồi mạng để bắt link media mà trang tải bằng JS (HLS của JW Player, link không có đuôi...).
  // Dùng onResponseStarted vì bộ chặn quảng cáo đã chiếm onBeforeRequest/onHeadersReceived.
  attachSniffer() {
    this.session.webRequest.onResponseStarted({ urls: ['http://*/*', 'https://*/*'] }, (d) => {
      if (!d.webContentsId || d.statusCode >= 400 || IGNORE_RE.test(d.url)) return
      const headers = d.responseHeaders || {}
      const header = (name) => {
        const key = Object.keys(headers).find((k) => k.toLowerCase() === name)
        return key ? String(headers[key][0] || '') : ''
      }
      const ct = header('content-type').toLowerCase()
      const kind = streamKind(d.url, ct)
      let type = ''
      if (kind) type = 'video'
      else if (/^video\/(?!mp2t|iso\.segment)/.test(ct)) type = 'video'
      else if (/^audio\//.test(ct) && !/mp2t/.test(ct)) type = 'audio'
      else if (d.resourceType === 'media' && MEDIA_EXT.test(d.url)) type = AUDIO_EXT.test(d.url) ? 'audio' : 'video'
      if (!type) return
      let size = Number(header('content-length')) || 0
      const range = header('content-range').match(/\/(\d+)$/)
      if (range) size = Number(range[1])
      let list = this.sniffed.get(d.webContentsId)
      if (!list) this.sniffed.set(d.webContentsId, (list = new Map()))
      if (list.size >= 60 && !list.has(d.url)) return
      const prev = list.get(d.url)
      list.set(d.url, { ...prev, url: d.url, type, stream: kind, size: Math.max(size, prev?.size || 0), mime: ct, referer: d.referrer || prev?.referer || '', source: 'network', partial: d.statusCode === 206 })
      if (!prev) this.emit('found', d.webContentsId)
    })
  }

  // Gọi khi tab chuyển sang trang khác.
  clear(webContentsId) {
    this.sniffed.delete(webContentsId)
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
    const merged = new Map()
    const put = (item) => {
      if (!item.url || IGNORE_RE.test(item.url)) return
      const prev = merged.get(item.url) || {}
      const next = { ...prev, ...Object.fromEntries(Object.entries(item).filter(([, v]) => v !== '' && v !== 0 && v != null)) }
      next.stream = next.stream || streamKind(next.url, next.mime)
      next.type = next.type || (AUDIO_EXT.test(next.url) || next.tag === 'audio' ? 'audio' : 'video')
      merged.set(item.url, next)
    }
    let videoCount = 0
    let blobVideos = 0
    let frames = []
    try {
      frames = webContents.mainFrame.framesInSubtree
    } catch {}
    await Promise.all(
      frames.map(async (frame) => {
        try {
          const r = await Promise.race([frame.executeJavaScript(FRAME_SCRIPT), new Promise((res) => setTimeout(() => res(null), 1500))])
          if (!r) return
          videoCount += r.videoCount
          blobVideos += r.blobVideos
          for (const it of r.items) put({ ...it, referer: r.frameUrl })
        } catch {
          // Frame đang tải lại hoặc chặn script.
        }
      })
    )
    for (const it of this.sniffed.get(webContents.id)?.values() || []) put(it)
    let all = [...merged.values()]
    // Đã có manifest HLS/DASH thì các mảnh tải theo byte-range (chỉ hình hoặc chỉ tiếng) là thừa.
    if (all.some((m) => m.stream)) all = all.filter((m) => m.stream || !m.partial)
    // Luồng HLS/DASH lên đầu (thường là bản đầy đủ), rồi đến file lớn.
    const items = all
      .sort((a, b) => (b.stream ? 1 : 0) - (a.stream ? 1 : 0) || (parseInt(b.label) || b.height || 0) - (parseInt(a.label) || a.height || 0) || (b.size || 0) - (a.size || 0))
      .slice(0, 40)
    const ytdlp = this.isYtdlpSite(url) || blobVideos > 0 || videoCount > 0
    return { items, videoCount, blobVideos, ytdlp, pageUrl: url, title: webContents.getTitle() }
  }

  // Tải 1 link media đã bắt được. Link trực tiếp dùng trình tải xuống; luồng HLS/DASH dùng yt-dlp.
  async downloadItem(webContents, item, quality = 'best') {
    const pageUrl = webContents.getURL()
    const referer = item.referer || pageUrl
    if (!item.stream) {
      webContents.downloadURL(item.url, { headers: { Referer: referer } })
      return null
    }
    return this.downloadWithYtdlp(item.url, webContents.getTitle(), quality, { referer, cookieUrls: [pageUrl, item.url] })
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
  async writeCookies(urls) {
    const bases = new Set()
    for (const u of [].concat(urls)) {
      try {
        bases.add(new URL(u).hostname.split('.').slice(-2).join('.'))
      } catch {}
    }
    const cookies = []
    const seen = new Set()
    for (const base of bases) {
      for (const c of await this.session.cookies.get({ domain: base })) {
        const key = `${c.domain}|${c.path}|${c.name}`
        if (!seen.has(key)) seen.add(key), cookies.push(c)
      }
    }
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

  // target: link trang (YouTube, Facebook...) hoặc link luồng m3u8/mpd.
  // quality: 'best' | '1080' | '720' | '480' | 'audio'
  // opts.referer: gửi kèm Referer/Origin (trang dùng JW Player thường chặn tải nếu thiếu).
  async downloadWithYtdlp(target, title, quality = 'best', opts = {}) {
    const d = this.downloads.add({ kind: 'ytdlp', url: target, filename: title || target, path: '' })
    try {
      if (!this.hasYtdlp()) await this.installYtdlp()
      let ffmpeg = await this.findFfmpeg()
      // MP3 và luồng HLS/DASH (ghép hình + tiếng, đổi sang mp4) cần ffmpeg.
      if (!ffmpeg && (quality === 'audio' || opts.referer)) {
        d.filename = `${title || target} (đang chuẩn bị ffmpeg…)`
        this.downloads.changed()
        ffmpeg = await this.installFfmpeg()
        d.filename = title || target
      }
      const result = await this.runYtdlp(d, target, quality, ffmpeg, opts, title)
      // YouTube không còn định dạng gộp sẵn hình + tiếng: tự tải ffmpeg rồi thử lại.
      if (result.formatMissing && !ffmpeg && d.state !== 'cancelled') {
        d.filename = `${title || target} (đang chuẩn bị ffmpeg…)`
        this.downloads.changed()
        ffmpeg = await this.installFfmpeg()
        d.filename = title || target
        await this.runYtdlp(d, target, quality, ffmpeg, opts, title)
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

  // Tên file cho link luồng: lấy theo tiêu đề trang, không trùng file đã có.
  streamOutputName(title, quality) {
    const ext = quality === 'audio' ? 'mp3' : 'mp4'
    const unique = this.downloads.uniquePath(this.downloads.dir, `${(title || 'video').slice(0, 120)}.${ext}`)
    return `${path.basename(unique, `.${ext}`).replace(/%/g, '%%')}.%(ext)s`
  }

  async runYtdlp(d, target, quality, ffmpeg, opts = {}, title = '') {
    const output = opts.referer ? this.streamOutputName(title, quality) : '%(title).150B [%(id)s].%(ext)s'
    const args = ['--no-playlist', '--newline', '--progress', '--encoding', 'utf-8', '--no-mtime',
      '-P', this.downloads.dir, '-o', output,
      '--progress-template', 'download:METALPROG %(progress._percent_str)s|%(progress._speed_str)s|%(progress._total_bytes_str)s|%(progress._total_bytes_estimate_str)s',
      '--print', 'after_move:METALFILE %(filepath)s',
      // YouTube cần JS runtime để giải mã chữ ký; dùng chính Electron ở chế độ Node.
      '--js-runtimes', `node:${process.execPath}`,
      '--user-agent', this.session.getUserAgent(),
      ...this.formatArgs(quality, ffmpeg)]
    if (opts.referer) {
      args.push('--referer', opts.referer)
      try {
        args.push('--add-header', `Origin:${new URL(opts.referer).origin}`)
      } catch {}
      // Tải nhiều mảnh song song cho nhanh.
      args.push('--concurrent-fragments', '4')
      if (ffmpeg && quality !== 'audio') args.push('--remux-video', 'mp4')
    }
    const cookieFile = await this.writeCookies(opts.cookieUrls || [target]).catch(() => null)
    if (cookieFile) args.push('--cookies', cookieFile)
    args.push(target)

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
        const [pct, speed, total, est] = line.slice('METALPROG '.length).split('|').map((s) => s.trim())
        d.percent = parseFloat(pct) || d.percent
        d.speed = speed && !/NA|Unknown/i.test(speed) ? speed : ''
        d.sizeText = !/NA/.test(total) ? total : !/NA/.test(est) ? `~${est}` : ''
        this.downloads.changed()
      } else if (line.startsWith('METALFILE ')) {
        d.path = line.slice('METALFILE '.length)
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
