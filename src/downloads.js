// Quản lý tải xuống: file thường (will-download) và video qua yt-dlp.
const fs = require('node:fs')
const path = require('node:path')
const { app, shell, dialog } = require('electron')
const { EventEmitter } = require('node:events')
const { getStores } = require('./store')

const MAX_ITEMS = 300

class DownloadManager extends EventEmitter {
  constructor() {
    super()
    this.store = getStores().downloads
    this.live = new Map() // id -> { item?, proc? }
    // Các mục đang dở lúc tắt app coi như bị gián đoạn.
    for (const d of this.store.data) {
      if (d.state === 'progressing') d.state = 'interrupted'
    }
  }

  get dir() {
    const custom = getStores().settings.data.downloadDir
    if (custom && fs.existsSync(custom)) return custom
    return app.getPath('downloads')
  }

  uniquePath(dir, filename) {
    const safe = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200) || 'download'
    const ext = path.extname(safe)
    const base = safe.slice(0, safe.length - ext.length)
    let candidate = path.join(dir, safe)
    for (let i = 1; fs.existsSync(candidate); i++) {
      candidate = path.join(dir, `${base} (${i})${ext}`)
    }
    return candidate
  }

  add(entry) {
    const d = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      state: 'progressing',
      received: 0,
      total: 0,
      percent: 0,
      speed: '',
      startTime: Date.now(),
      ...entry,
    }
    this.store.data.unshift(d)
    if (this.store.data.length > MAX_ITEMS) this.store.data.length = MAX_ITEMS
    this.changed()
    return d
  }

  get(id) {
    return this.store.data.find((d) => d.id === id)
  }

  changed() {
    this.store.save()
    this.emit('changed', this.summary())
  }

  summary() {
    const active = this.store.data.filter((d) => d.state === 'progressing')
    let percent = -1
    if (active.length) {
      const known = active.filter((d) => d.percent > 0)
      percent = known.length ? known.reduce((s, d) => s + d.percent, 0) / known.length : 0
    }
    return { active: active.length, percent, recent: this.store.data.slice(0, 5) }
  }

  list() {
    return this.store.data
  }

  // Gắn vào session.on('will-download').
  handleWillDownload(item) {
    const settings = getStores().settings.data
    if (!settings.askWhereToSave) {
      item.setSavePath(this.uniquePath(this.dir, item.getFilename()))
    }
    const d = this.add({
      kind: 'file',
      url: item.getURL(),
      filename: item.getFilename(),
      path: item.getSavePath(),
      total: item.getTotalBytes(),
    })
    this.live.set(d.id, { item })
    let lastBytes = 0
    let lastTime = Date.now()

    item.on('updated', (_e, state) => {
      const now = Date.now()
      d.path = item.getSavePath() || d.path
      d.filename = path.basename(d.path || item.getFilename())
      d.received = item.getReceivedBytes()
      d.total = item.getTotalBytes()
      d.percent = d.total ? (d.received / d.total) * 100 : 0
      if (now - lastTime >= 1000) {
        d.speed = formatBytes(((d.received - lastBytes) * 1000) / (now - lastTime)) + '/s'
        lastBytes = d.received
        lastTime = now
      }
      d.paused = item.isPaused()
      // 'interrupted' ở đây là tạm thời (mạng chập chờn), Chromium sẽ tự thử lại.
      d.stalled = state === 'interrupted'
      this.changed()
    })
    item.once('done', (_e, state) => {
      d.state = state // completed | cancelled | interrupted
      d.path = item.getSavePath() || d.path
      d.filename = path.basename(d.path || d.filename)
      d.received = item.getReceivedBytes()
      if (state === 'completed') d.percent = 100
      d.speed = ''
      this.live.delete(d.id)
      this.changed()
      if (state === 'completed') this.emit('completed', d)
    })
  }

  // Dùng cho tiến trình yt-dlp.
  attachProcess(id, proc) {
    this.live.set(id, { proc })
  }

  detach(id) {
    this.live.delete(id)
  }

  cancel(id) {
    const live = this.live.get(id)
    if (live?.item) live.item.cancel()
    if (live?.proc) {
      live.proc.kill()
      const d = this.get(id)
      if (d) {
        d.state = 'cancelled'
        this.changed()
      }
    }
  }

  pause(id) {
    const live = this.live.get(id)
    if (!live?.item) return
    if (live.item.isPaused()) live.item.resume()
    else live.item.pause()
  }

  remove(id) {
    this.cancel(id)
    this.store.data = this.store.data.filter((d) => d.id !== id)
    this.changed()
  }

  clear() {
    this.store.data = this.store.data.filter((d) => d.state === 'progressing')
    this.changed()
  }

  open(id) {
    const d = this.get(id)
    if (d?.path && fs.existsSync(d.path)) shell.openPath(d.path)
  }

  show(id) {
    const d = this.get(id)
    if (d?.path && fs.existsSync(d.path)) shell.showItemInFolder(d.path)
    else shell.openPath(this.dir)
  }

  openFolder() {
    shell.openPath(this.dir)
  }

  async chooseDir(win) {
    const res = await dialog.showOpenDialog(win, {
      title: 'Chọn thư mục lưu tải xuống',
      defaultPath: this.dir,
      properties: ['openDirectory', 'createDirectory'],
    })
    if (res.canceled || !res.filePaths[0]) return null
    getStores().settings.data.downloadDir = res.filePaths[0]
    getStores().settings.save()
    return res.filePaths[0]
  }
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`
}

module.exports = { DownloadManager, formatBytes }
