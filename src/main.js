// Metal Browser — trình duyệt nền Chromium (Electron) chạy được extension Chrome,
// kèm các tính năng kiểu Cốc Cốc: tải video, dịch nhanh, chặn quảng cáo, chế độ tối...
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  app, session, protocol, net, ipcMain, Menu, MenuItem, BaseWindow, BrowserWindow,
  clipboard, dialog, nativeTheme, shell, Notification,
} = require('electron')

app.setName('Metal Browser')
app.setAppUserModelId('com.metal.browser')
// Dành cho kiểm thử: dùng thư mục dữ liệu riêng để không đụng vào hồ sơ thật.
if (process.env.METAL_USER_DATA) app.setPath('userData', process.env.METAL_USER_DATA)

const { getStores, flushAll, SEARCH_ENGINES, DNS_PROVIDERS } = require('./store')
const stores = getStores()
const settings = stores.settings

// ---- Cờ Chromium (phải đặt trước khi app sẵn sàng) ----
const features = ['PlatformHEVCDecoderSupport']
if (settings.data.forceDarkPages) features.push('WebContentsForceDark')
app.commandLine.appendSwitch('enable-features', features.join(','))
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling')
nativeTheme.themeSource = settings.data.uiTheme || 'system'

protocol.registerSchemesAsPrivileged([
  { scheme: 'metal', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

const { ElectronChromeExtensions } = require('electron-chrome-extensions')
const { installChromeWebStore, installExtension, uninstallExtension, updateExtensions } = require('electron-chrome-web-store')
const { BrowserWin } = require('./window')
const { DownloadManager, formatBytes } = require('./downloads')
const { MediaTools } = require('./media')

const PAGES_DIR = path.join(__dirname, 'pages')
const PAGE_PRELOAD = path.join(__dirname, 'preload', 'page-preload.js')
const EXTENSIONS_DIR = path.join(app.getPath('userData'), 'Extensions')
const INTERNAL_PAGES = ['newtab', 'settings', 'extensions', 'history', 'downloads', 'bookmarks', 'error', 'about']

// ---------------------------------------------------------------------------
// Lịch sử & dấu trang
// ---------------------------------------------------------------------------
const history = {
  store: stores.history,
  skip: (url) => !url || !/^https?:/i.test(url),
  add(url, title) {
    if (this.skip(url)) return
    const list = this.store.data
    const now = Date.now()
    // Gộp các lượt truy cập liên tiếp cùng URL.
    const last = list.find((h) => h.url === url)
    if (last && now - last.time < 30 * 60 * 1000) {
      last.time = now
      last.visits = (last.visits || 1) + 1
      if (title) last.title = title
      list.splice(list.indexOf(last), 1)
      list.unshift(last)
    } else {
      list.unshift({ id: `${now}${Math.random().toString(36).slice(2, 6)}`, url, title: title || url, time: now, visits: (last?.visits || 0) + 1, favicon: last?.favicon || '' })
    }
    if (list.length > 20000) list.length = 20000
    this.store.save()
  },
  updateTitle(url, title) {
    const h = this.store.data.find((x) => x.url === url)
    if (h && title) {
      h.title = title
      this.store.save()
    }
  },
  updateFavicon(url, favicon) {
    const h = this.store.data.find((x) => x.url === url)
    if (h && favicon) {
      h.favicon = favicon
      this.store.save()
    }
  },
  search(q, limit = 200) {
    q = (q || '').toLowerCase().trim()
    const list = this.store.data
    if (!q) return list.slice(0, limit)
    return list.filter((h) => h.url.toLowerCase().includes(q) || (h.title || '').toLowerCase().includes(q)).slice(0, limit)
  },
  topSites(limit = 12) {
    const byHost = new Map()
    for (const h of this.store.data) {
      let host
      try {
        host = new URL(h.url).hostname
      } catch {
        continue
      }
      const cur = byHost.get(host)
      if (cur) cur.score += h.visits || 1
      else byHost.set(host, { url: `${new URL(h.url).origin}/`, title: host.replace(/^www\./, ''), favicon: h.favicon, score: h.visits || 1 })
    }
    return [...byHost.values()].sort((a, b) => b.score - a.score).slice(0, limit)
  },
  remove(ids) {
    const set = new Set(ids)
    this.store.data = this.store.data.filter((h) => !set.has(h.id))
    this.store.save()
  },
  clear(sinceMs) {
    this.store.data = sinceMs ? this.store.data.filter((h) => h.time < Date.now() - sinceMs) : []
    this.store.save()
  },
}

const bookmarks = {
  store: stores.bookmarks,
  has(url) {
    return !!url && this.store.data.some((b) => b.url === url)
  },
  list() {
    return this.store.data
  },
  add(url, title, favicon) {
    if (!url || this.has(url)) return
    this.store.data.push({ id: `${Date.now()}`, url, title: title || url, favicon: favicon || '', added: Date.now() })
    this.store.save()
  },
  remove(url) {
    this.store.data = this.store.data.filter((b) => b.url !== url && b.id !== url)
    this.store.save()
  },
  update(id, patch) {
    const b = this.store.data.find((x) => x.id === id)
    if (b) Object.assign(b, patch)
    this.store.save()
  },
  move(id, toIndex) {
    const list = this.store.data
    const from = list.findIndex((b) => b.id === id)
    if (from < 0) return
    const [b] = list.splice(from, 1)
    list.splice(Math.max(0, Math.min(toIndex, list.length)), 0, b)
    this.store.save()
  },
  toggle(url, title, favicon) {
    if (this.has(url)) this.remove(url)
    else this.add(url, title, favicon)
  },
}

// ---------------------------------------------------------------------------
// Ngữ cảnh chung của ứng dụng (truyền vào từng cửa sổ)
// ---------------------------------------------------------------------------
const ctx = {
  session: null,
  extensions: null,
  windows: new Set(),
  byBaseWindow: new Map(),
  lastFocused: null,
  closedTabs: [],
  history,
  bookmarks,
  downloads: null,
  media: null,
  blocker: null,
  blockedCount: 0,
  quitting: false,
  sessionTimer: null,

  newTabUrl() {
    const override = this.extensions?.getURLOverrides?.().newtab
    return override || 'metal://newtab/'
  },

  uiExtras() {
    return {
      bookmarks: bookmarks.list().slice(0, 60),
      showBookmarksBar: settings.data.showBookmarksBar,
      downloads: this.downloads?.summary(),
      adblock: settings.data.adblock,
      blockedCount: this.blockedCount,
      dark: nativeTheme.shouldUseDarkColors,
    }
  },

  broadcastState() {
    for (const w of this.windows) w.sendState()
  },

  activeWindow() {
    const focused = BaseWindow.getFocusedWindow()
    return this.byBaseWindow.get(focused) || this.lastFocused || [...this.windows][0]
  },

  createWindow(opts = {}) {
    const w = new BrowserWin(this, opts)
    this.windows.add(w)
    this.byBaseWindow.set(w.win, w)
    this.lastFocused = w
    if (opts.tabs?.length) {
      opts.tabs.forEach((t, i) => w.createTab({ url: t.url, pinned: t.pinned, active: i === (opts.active || 0) }))
    } else if (!opts.empty) {
      w.createTab({ url: opts.url || this.newTabUrl() })
    }
    return w
  },

  onWindowClosing(w) {
    // Cửa sổ cuối cùng: giữ nguyên các tab để mở lại lần sau.
    if (this.windows.size === 1) this.saveSession()
  },

  onWindowClosed(w) {
    for (const t of [...w.tabs]) {
      if (!t.wc.isDestroyed()) t.wc.close()
    }
    if (!w.ui.webContents.isDestroyed()) w.ui.webContents.close()
    this.windows.delete(w)
    this.byBaseWindow.delete(w.win)
    if (this.lastFocused === w) this.lastFocused = [...this.windows][0] || null
    if (this.windows.size > 0) this.scheduleSessionSave()
  },

  scheduleSessionSave() {
    if (this.quitting) return
    clearTimeout(this.sessionTimer)
    this.sessionTimer = setTimeout(() => this.saveSession(), 1000)
  },

  saveSession() {
    const windows = [...this.windows].filter((w) => !w.win.isDestroyed()).map((w) => w.serialize()).filter((w) => w.tabs.length)
    if (!windows.length) return
    stores.session.data = { windows, time: Date.now() }
    stores.session.save()
  },

  reopenClosedTab(win) {
    const last = this.closedTabs.pop()
    if (last) (win || this.activeWindow())?.createTab({ url: last.url })
  },

  moveTabToNewWindow(tab) {
    const url = tab.wc.getURL()
    tab.win.closeTab(tab)
    this.createWindow({ url })
  },

  openUrl(url, { newTab = true, win, background = false } = {}) {
    win = win || this.activeWindow()
    if (!win) return this.createWindow({ url })
    if (!newTab && win.activeTab) return win.activeTab.load(url)
    return win.createTab({ url, active: !background, afterTab: win.activeTab })
  },

  openInternal(page) {
    const win = this.activeWindow()
    if (!win) return this.createWindow({ url: `metal://${page}/` })
    // Chuyển tới tab nội bộ đang mở sẵn thay vì mở thêm.
    const existing = win.tabs.find((t) => t.wc.getURL().startsWith(`metal://${page}`))
    if (existing) return win.selectTab(existing)
    if (win.activeTab && win.activeTab.wc.getURL().startsWith('metal://newtab')) return win.activeTab.load(`metal://${page}/`)
    win.createTab({ url: `metal://${page}/` })
  },

  // Chuyển chữ gõ vào thanh địa chỉ thành URL hoặc tìm kiếm.
  toUrl(input) {
    input = (input || '').trim()
    if (!input) return null
    const lower = input.toLowerCase()
    const internal = lower.match(/^(?:chrome|coccoc|metal|edge|brave):\/\/([a-z-]+)/)
    if (internal) {
      const map = { newtab: 'newtab', settings: 'settings', extensions: 'extensions', history: 'history', downloads: 'downloads', bookmarks: 'bookmarks', about: 'about', version: 'about' }
      if (map[internal[1]]) return `metal://${map[internal[1]]}/`
    }
    if (/^(https?|file|metal|chrome-extension|view-source|about|data|blob):/i.test(input)) return input
    if (/^[a-z]:\\/i.test(input)) return pathToFileURL(input).href
    if (/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?(\/.*)?$/i.test(input)) return `http://${input}`
    if (!/\s/.test(input) && /^[^\s/?#]+\.[a-z¡-￿]{2,}(:\d+)?([/?#].*)?$/i.test(input)) return `https://${input}`
    const engine = SEARCH_ENGINES[settings.data.searchEngine] || SEARCH_ENGINES.google
    return engine.url.replace('%s', encodeURIComponent(input))
  },

  // ---- Phím tắt (gắn vào before-input-event của tab và của UI) ----
  handleShortcut(win, input, fromUi = false) {
    const ctrl = input.control || input.meta
    const key = input.key.length === 1 ? input.key.toLowerCase() : input.key
    const tab = win.activeTab
    const wc = tab?.wc
    const run = (fn) => (fn(), true)

    if (ctrl && input.shift) {
      switch (key) {
        case 't': return run(() => this.reopenClosedTab(win))
        case 'tab': case 'Tab': return run(() => win.cycleTab(-1))
        case 'i': return run(() => wc?.toggleDevTools())
        case 'j': return run(() => wc?.toggleDevTools())
        case 'r': return run(() => wc?.reloadIgnoringCache())
        case 'b': return run(() => this.setSetting('showBookmarksBar', !settings.data.showBookmarksBar))
        case 'delete': case 'Delete': return run(() => this.openInternal('settings'))
        case 'n': return false
      }
    }
    if (ctrl && !input.alt) {
      if (/^[1-8]$/.test(key)) return run(() => win.selectTab(win.tabs[Number(key) - 1]))
      switch (key) {
        case '9': return run(() => win.selectTab(win.tabs[win.tabs.length - 1]))
        case 't': return run(() => win.createTab({ url: this.newTabUrl() }))
        case 'n': return run(() => this.createWindow())
        case 'w': case 'F4': return run(() => win.closeTab(tab))
        case 'Tab': return run(() => win.cycleTab(input.shift ? -1 : 1))
        case 'PageDown': return run(() => win.cycleTab(1))
        case 'PageUp': return run(() => win.cycleTab(-1))
        case 'l': return run(() => win.sendUi('focus-address'))
        case 'k': case 'e': return run(() => win.sendUi('focus-address', '?'))
        case 'r': case 'F5': return run(() => (input.shift ? wc?.reloadIgnoringCache() : wc?.reload()))
        case 'f': return run(() => win.sendUi('find-open'))
        case 'd': return run(() => wc && (bookmarks.toggle(tab.displayUrl(), tab.title, tab.favicon), this.broadcastState()))
        case 'h': return run(() => this.openInternal('history'))
        case 'j': return run(() => this.openInternal('downloads'))
        case 'p': return fromUi ? false : run(() => wc?.print())
        case 'u': return run(() => wc && this.openUrl(`view-source:${wc.getURL()}`))
        case 's': return fromUi ? false : run(() => this.savePage(win))
        case '=': case '+': return run(() => this.zoom(win, 1))
        case '-': return run(() => this.zoom(win, -1))
        case '0': return run(() => this.zoom(win, 0))
      }
    }
    if (input.alt && !ctrl) {
      if (key === 'ArrowLeft') return run(() => wc?.navigationHistory.goBack())
      if (key === 'ArrowRight') return run(() => wc?.navigationHistory.goForward())
      if (key === 'd') return run(() => win.sendUi('focus-address'))
      if (key === 'Home') return run(() => tab?.load(this.homeUrl()))
    }
    if (!ctrl && !input.alt) {
      switch (key) {
        case 'F5': return run(() => (input.shift ? wc?.reloadIgnoringCache() : wc?.reload()))
        case 'F6': return run(() => win.sendUi('focus-address'))
        case 'F11': return run(() => win.win.setFullScreen(!win.win.isFullScreen()))
        case 'F12': return run(() => wc?.toggleDevTools())
        case 'Escape':
          if (win.htmlFullscreen) return false
          if (fromUi) return false
          if (tab?.loading) return run(() => wc.stop())
          return false
        case 'BrowserBack': return run(() => wc?.navigationHistory.goBack())
        case 'BrowserForward': return run(() => wc?.navigationHistory.goForward())
      }
    }
    return false
  },

  homeUrl() {
    const h = settings.data.homepage
    return !h || h === 'metal://newtab' ? this.newTabUrl() : h
  },

  zoom(win, dir) {
    const wc = win.activeTab?.wc
    if (!wc) return
    if (dir === 0) wc.setZoomLevel(0)
    else wc.setZoomLevel(Math.max(-5, Math.min(5, wc.getZoomLevel() + dir * 0.5)))
    win.sendState()
  },

  async savePage(win) {
    const wc = win.activeTab?.wc
    if (!wc) return
    const name = (wc.getTitle() || 'trang').replace(/[<>:"/\\|?*]/g, '_').slice(0, 100)
    const res = await dialog.showSaveDialog(win.win, {
      title: 'Lưu trang',
      defaultPath: path.join(this.downloads.dir, `${name}.html`),
      filters: [
        { name: 'Trang web, hoàn chỉnh', extensions: ['html'] },
        { name: 'Trang web, một file (MHTML)', extensions: ['mhtml'] },
      ],
    })
    if (res.canceled || !res.filePath) return
    const type = res.filePath.endsWith('.mhtml') ? 'MHTML' : 'HTMLComplete'
    wc.savePage(res.filePath, type).catch((err) => dialog.showErrorBox('Không lưu được trang', String(err)))
  },

  setSetting(key, value) {
    settings.data[key] = value
    settings.save()
    if (key === 'uiTheme') {
      nativeTheme.themeSource = value
    }
    if (key === 'adblock') this.applyAdblock()
    if (key === 'secureDns' || key === 'secureDnsCustom') this.applyDns()
    this.broadcastState()
    this.broadcastPages('settings', settings.data)
  },

  broadcastPages(name, ...args) {
    for (const w of this.windows) {
      for (const t of w.tabs) {
        if (!t.wc.isDestroyed() && t.wc.getURL().startsWith('metal://')) t.wc.send(`page:${name}`, ...args)
      }
    }
  },

  // ---- Menu chuột phải tiếng Việt ----
  showContextMenu(tab, params) {
    const wc = tab.wc
    const win = tab.win
    const menu = new Menu()
    const add = (opts) => menu.append(new MenuItem(opts))
    const sep = () => {
      if (menu.items.length && menu.items[menu.items.length - 1].type !== 'separator') add({ type: 'separator' })
    }
    const sel = (params.selectionText || '').trim()
    const short = sel.length > 30 ? `${sel.slice(0, 30)}…` : sel
    const engine = SEARCH_ENGINES[settings.data.searchEngine] || SEARCH_ENGINES.google

    if (params.linkURL) {
      add({ label: 'Mở liên kết trong tab mới', click: () => win.createTab({ url: params.linkURL, active: false, afterTab: tab }) })
      add({ label: 'Mở liên kết trong cửa sổ mới', click: () => this.createWindow({ url: params.linkURL }) })
      sep()
      add({ label: 'Lưu liên kết thành...', click: () => wc.downloadURL(params.linkURL) })
      add({ label: 'Sao chép địa chỉ liên kết', click: () => clipboard.writeText(params.linkURL) })
      if (params.linkText && !params.srcURL) add({ label: 'Sao chép văn bản liên kết', click: () => clipboard.writeText(params.linkText) })
      sep()
    }

    if (params.mediaType === 'image') {
      add({ label: 'Mở hình ảnh trong tab mới', click: () => win.createTab({ url: params.srcURL, active: false, afterTab: tab }) })
      add({ label: 'Lưu hình ảnh thành...', click: () => wc.downloadURL(params.srcURL) })
      add({ label: 'Sao chép hình ảnh', click: () => wc.copyImageAt(params.x, params.y) })
      add({ label: 'Sao chép địa chỉ hình ảnh', click: () => clipboard.writeText(params.srcURL) })
      if (/^https?:/.test(params.srcURL)) {
        add({ label: 'Tìm hình ảnh bằng Google Lens', click: () => win.createTab({ url: `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(params.srcURL)}`, afterTab: tab }) })
      }
      sep()
    } else if (params.mediaType === 'video' || params.mediaType === 'audio') {
      const isVideo = params.mediaType === 'video'
      if (/^https?:/.test(params.srcURL)) {
        add({ label: isVideo ? '⬇  Tải video này xuống' : '⬇  Tải âm thanh này xuống', click: () => wc.downloadURL(params.srcURL) })
        add({ label: isVideo ? 'Mở video trong tab mới' : 'Mở âm thanh trong tab mới', click: () => win.createTab({ url: params.srcURL, afterTab: tab }) })
        add({ label: 'Sao chép địa chỉ', click: () => clipboard.writeText(params.srcURL) })
      } else {
        add({ label: isVideo ? '⬇  Tải video trên trang này (yt-dlp)' : '⬇  Tải âm thanh trên trang này (yt-dlp)', click: () => this.downloadBestMedia(tab, isVideo ? 'best' : 'audio') })
      }
      if (isVideo) {
        add({
          label: 'Hình trong hình (xem video nổi)',
          click: () => wc.executeJavaScript(`(() => { const v = document.elementFromPoint(${params.x}, ${params.y}); const vid = v && v.closest ? (v.closest('video') || document.querySelector('video')) : document.querySelector('video'); if (vid) vid.requestPictureInPicture().catch(() => {}) })()`, true),
        })
        add({ label: 'Lặp lại', type: 'checkbox', checked: !!params.mediaFlags?.isLooping, click: () => wc.executeJavaScript(`(() => { const v = document.elementFromPoint(${params.x}, ${params.y}); const vid = (v && v.closest && v.closest('video')) || document.querySelector('video'); if (vid) vid.loop = !vid.loop })()`, true) })
      }
      sep()
    }

    if (params.isEditable) {
      if (params.misspelledWord) {
        for (const s of params.dictionarySuggestions.slice(0, 5)) add({ label: s, click: () => wc.replaceMisspelling(s) })
        if (!params.dictionarySuggestions.length) add({ label: 'Không có gợi ý chính tả', enabled: false })
        add({ label: 'Thêm vào từ điển', click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) })
        sep()
      }
      add({ label: 'Hoàn tác', accelerator: 'Ctrl+Z', enabled: params.editFlags.canUndo, click: () => wc.undo() })
      add({ label: 'Làm lại', accelerator: 'Ctrl+Y', enabled: params.editFlags.canRedo, click: () => wc.redo() })
      sep()
      add({ label: 'Cắt', accelerator: 'Ctrl+X', enabled: params.editFlags.canCut, click: () => wc.cut() })
      add({ label: 'Sao chép', accelerator: 'Ctrl+C', enabled: params.editFlags.canCopy, click: () => wc.copy() })
      add({ label: 'Dán', accelerator: 'Ctrl+V', enabled: params.editFlags.canPaste, click: () => wc.paste() })
      add({ label: 'Dán dạng văn bản thuần', accelerator: 'Ctrl+Shift+V', enabled: params.editFlags.canPaste, click: () => wc.pasteAndMatchStyle() })
      add({ label: 'Chọn tất cả', accelerator: 'Ctrl+A', enabled: params.editFlags.canSelectAll, click: () => wc.selectAll() })
      if (app.isEmojiPanelSupported()) add({ label: 'Biểu tượng cảm xúc (Emoji)', click: () => app.showEmojiPanel() })
      sep()
    } else if (sel) {
      add({ label: 'Sao chép', accelerator: 'Ctrl+C', click: () => wc.copy() })
      sep()
    }

    if (sel) {
      add({ label: `Dịch "${short}" sang Tiếng Việt`, click: () => this.quickTranslate(tab, sel, params) })
      add({ label: `Tìm "${short}" bằng ${engine.name}`, click: () => win.createTab({ url: engine.url.replace('%s', encodeURIComponent(sel)), afterTab: tab }) })
      sep()
    }

    const extItems = this.extensions.getContextMenuItems(wc, params)
    if (extItems.length) {
      extItems.forEach((item) => menu.append(item))
      sep()
    }

    if (!params.linkURL && params.mediaType === 'none' && !params.isEditable && !sel) {
      add({ label: 'Quay lại', accelerator: 'Alt+Left', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() })
      add({ label: 'Tiến tới', accelerator: 'Alt+Right', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() })
      add({ label: 'Tải lại', accelerator: 'Ctrl+R', click: () => wc.reload() })
      sep()
      const url = wc.getURL()
      if (/^https?:/.test(url)) {
        add({ label: 'Dịch trang này sang Tiếng Việt', click: () => this.translatePage(tab) })
        if (tab.media.count || tab.media.ytdlp) add({ label: '⬇  Tải video/nhạc trên trang...', click: () => win.sendUi('open-media') })
      }
      add({ label: 'Lưu trang thành...', accelerator: 'Ctrl+S', click: () => this.savePage(win) })
      add({ label: 'In...', accelerator: 'Ctrl+P', click: () => wc.print() })
      add({ label: 'Xem nguồn trang', accelerator: 'Ctrl+U', click: () => this.openUrl(`view-source:${url}`) })
      sep()
    }
    add({ label: 'Kiểm tra (Inspect)', accelerator: 'Ctrl+Shift+I', click: () => wc.inspectElement(params.x, params.y) })
    menu.popup({ window: win.win })
  },

  // Tải video của trang: ưu tiên luồng HLS/DASH bắt được (JW Player...), không có thì để yt-dlp tự tìm.
  async downloadBestMedia(tab, quality) {
    const res = await this.media.scan(tab.wc)
    const stream = res.items.find((m) => m.stream)
    const task = stream && !this.media.isYtdlpSite(tab.wc.getURL())
      ? this.media.downloadItem(tab.wc, stream, quality)
      : this.media.downloadWithYtdlp(tab.wc.getURL(), tab.wc.getTitle(), quality)
    return task.catch(showError)
  },

  // ---- Dịch nhanh đoạn chọn (giống Cốc Cốc): hiện bong bóng dịch ngay trên trang ----
  async quickTranslate(tab, text, params) {
    const target = settings.data.translateTarget || 'vi'
    let translated = ''
    let detected = ''
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(text.slice(0, 4500))}`
      const res = await net.fetch(url)
      const data = await res.json()
      translated = (data[0] || []).map((p) => p[0]).join('')
      detected = data[2] || ''
    } catch {
      tab.win.createTab({ url: `https://translate.google.com/?sl=auto&tl=${target}&text=${encodeURIComponent(text)}&op=translate`, afterTab: tab })
      return
    }
    const payload = JSON.stringify({ text: translated, src: detected, x: params.x, y: params.y, target })
    const code = `(() => {
      const d = ${payload};
      document.getElementById('__metal_translate')?.remove();
      const host = document.createElement('div');
      host.id = '__metal_translate';
      const root = host.attachShadow({ mode: 'closed' });
      const sel = window.getSelection();
      let rect = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
      if (!rect || (!rect.width && !rect.height)) rect = { left: d.x, bottom: d.y, top: d.y };
      const dark = matchMedia('(prefers-color-scheme: dark)').matches;
      root.innerHTML = '<style>.b{position:fixed;z-index:2147483647;max-width:420px;min-width:200px;font:14px/1.5 "Segoe UI",system-ui,sans-serif;background:' + (dark ? '#2a2f38' : '#fff') + ';color:' + (dark ? '#e8eaed' : '#1f2329') + ';border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.25);padding:12px 14px 10px;border:1px solid ' + (dark ? '#3c4350' : '#e3e6eb') + '}.h{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#5b8def;margin-bottom:6px;font-weight:600}.x{cursor:pointer;border:0;background:none;color:inherit;font-size:16px;opacity:.6}.x:hover{opacity:1}.t{white-space:pre-wrap;user-select:text}.f{margin-top:8px;display:flex;gap:8px}.f button{border:0;border-radius:6px;padding:4px 10px;cursor:pointer;background:' + (dark ? '#3a4150' : '#eef2f8') + ';color:inherit;font:12px "Segoe UI",sans-serif}</style><div class="b"><div class="h"><span></span><button class="x" title="Đóng">✕</button></div><div class="t"></div><div class="f"><button data-a="copy">Sao chép</button><button data-a="speak">Đọc</button></div></div>';
      const box = root.querySelector('.b');
      root.querySelector('.h span').textContent = 'Dịch ' + (d.src ? d.src.toUpperCase() + ' → ' : '') + d.target.toUpperCase();
      root.querySelector('.t').textContent = d.text;
      const close = () => { host.remove(); document.removeEventListener('mousedown', outside, true); };
      const outside = (e) => { if (!e.composedPath().includes(host)) close(); };
      root.querySelector('.x').onclick = close;
      root.querySelector('[data-a=copy]').onclick = () => navigator.clipboard.writeText(d.text);
      root.querySelector('[data-a=speak]').onclick = () => { const u = new SpeechSynthesisUtterance(d.text); u.lang = d.target; speechSynthesis.speak(u); };
      document.documentElement.appendChild(host);
      const w = box.offsetWidth, h = box.offsetHeight;
      let left = Math.min(Math.max(8, rect.left), innerWidth - w - 8);
      let top = rect.bottom + 8;
      if (top + h > innerHeight - 8) top = Math.max(8, rect.top - h - 8);
      box.style.left = left + 'px'; box.style.top = top + 'px';
      setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
    })()`
    tab.wc.executeJavaScriptInIsolatedWorld(1002, [{ code }]).catch(() => {})
  },

  translatePage(tab) {
    const target = settings.data.translateTarget || 'vi'
    const url = tab.wc.getURL()
    tab.load(`https://translate.google.com/translate?sl=auto&tl=${target}&u=${encodeURIComponent(url)}`)
  },

  // ---- DNS bảo mật (DNS-over-HTTPS) ----
  // Truy vấn tên miền qua HTTPS tới Cloudflare/Google… thay vì DNS của nhà mạng, nên các trang bị
  // chặn bằng DNS vẫn vào được. Chế độ "secure": không bao giờ quay về DNS nhà mạng.
  dnsServer() {
    const key = settings.data.secureDns
    if (key === 'custom') {
      const custom = (settings.data.secureDnsCustom || '').trim()
      return custom.startsWith('https://') ? custom : ''
    }
    return DNS_PROVIDERS[key]?.url || ''
  },

  applyDns() {
    const server = this.dnsServer()
    try {
      app.configureHostResolver(
        server
          ? { enableBuiltInResolver: true, secureDnsMode: 'secure', secureDnsServers: [server] }
          : { enableBuiltInResolver: true, secureDnsMode: 'automatic', secureDnsServers: [] }
      )
    } catch (err) {
      console.error('Không cấu hình được DNS:', err)
    }
    // Xoá cache DNS cũ để áp dụng ngay.
    this.session?.clearHostResolverCache().catch(() => {})
  },

  // ---- Chặn quảng cáo ----
  async applyAdblock() {
    const ses = this.session
    if (!settings.data.adblock) {
      if (this.blocker?.isBlockingEnabled(ses)) this.blocker.disableBlockingInSession(ses)
      return
    }
    try {
      if (!this.blocker) {
        const { ElectronBlocker } = require('@ghostery/adblocker-electron')
        const cache = path.join(app.getPath('userData'), 'adblock-engine.bin')
        // Dùng lại bộ lọc đã lưu nếu còn mới (< 3 ngày), tránh tải lại mỗi lần mở.
        let blocker = null
        try {
          const st = fs.statSync(cache)
          if (Date.now() - st.mtimeMs < 3 * 24 * 3600 * 1000) blocker = ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(cache)))
        } catch {}
        if (!blocker) {
          blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking((url, init) => net.fetch(url, init))
          fs.writeFileSync(cache, Buffer.from(blocker.serialize()))
        }
        blocker.on('request-blocked', () => {
          this.blockedCount++
          if (this.blockedCount % 10 === 0) this.broadcastState()
        })
        this.blocker = blocker
      }
      if (!this.blocker.isBlockingEnabled(ses)) this.blocker.enableBlockingInSession(ses)
    } catch (err) {
      console.error('Không bật được chặn quảng cáo:', err)
    }
  },
}

function showError(err) {
  dialog.showErrorBox('Lỗi', String(err?.message || err))
}

// ---------------------------------------------------------------------------
// Quản lý extension
// ---------------------------------------------------------------------------
const extMgr = {
  sesExt: () => ctx.session.extensions || ctx.session,

  readManifest(dir) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^﻿/, ''))
    } catch {
      return null
    }
  },

  // Thay __MSG_xxx__ bằng chuỗi trong _locales (ưu tiên vi, rồi en, rồi default_locale).
  localize(dir, manifest, value) {
    if (typeof value !== 'string' || !value.startsWith('__MSG_')) return value
    const key = value.slice(6, -2)
    const locales = ['vi', manifest.default_locale, 'en', 'en_US'].filter(Boolean)
    for (const loc of locales) {
      try {
        const msgs = JSON.parse(fs.readFileSync(path.join(dir, '_locales', loc, 'messages.json'), 'utf8').replace(/^﻿/, ''))
        const hit = msgs[key] || Object.entries(msgs).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1]
        if (hit?.message) return hit.message
      } catch {}
    }
    return value
  },

  iconPath(dir, manifest) {
    const icons = manifest.icons || manifest.action?.default_icon || manifest.browser_action?.default_icon
    if (!icons) return null
    if (typeof icons === 'string') return path.join(dir, icons)
    const best = Object.keys(icons).map(Number).sort((a, b) => b - a)[0]
    return best ? path.join(dir, icons[best]) : null
  },

  describe(ext, enabled) {
    const m = ext.manifest || this.readManifest(ext.path) || {}
    return {
      id: ext.id,
      name: this.localize(ext.path, m, m.name || ext.name),
      description: this.localize(ext.path, m, m.description || ''),
      version: m.version || ext.version,
      mv: m.manifest_version,
      path: ext.path,
      enabled,
      unpacked: settings.data.unpackedExtensions.some((u) => u.id === ext.id || u.path === ext.path),
      optionsUrl: m.options_ui?.page || m.options_page ? `chrome-extension://${ext.id}/${m.options_ui?.page || m.options_page}` : '',
      icon: `metal://ext-icon/${ext.id}`,
      webstore: `https://chromewebstore.google.com/detail/${ext.id}`,
    }
  },

  list() {
    const loaded = this.sesExt().getAllExtensions().map((e) => this.describe(e, true))
    const disabled = settings.data.disabledExtensions
      .filter((d) => !loaded.some((l) => l.id === d.id))
      .map((d) => this.describe({ id: d.id, path: d.path, name: d.name, manifest: this.readManifest(d.path) }, false))
    return [...loaded, ...disabled].sort((a, b) => a.name.localeCompare(b.name))
  },

  findPath(id) {
    const ext = this.sesExt().getExtension(id)
    if (ext) return ext.path
    return settings.data.disabledExtensions.find((d) => d.id === id)?.path
  },

  async setEnabled(id, enabled) {
    const sesExt = this.sesExt()
    if (enabled) {
      const entry = settings.data.disabledExtensions.find((d) => d.id === id)
      if (!entry) return
      await sesExt.loadExtension(entry.path, { allowFileAccess: true })
      settings.data.disabledExtensions = settings.data.disabledExtensions.filter((d) => d.id !== id)
    } else {
      const ext = sesExt.getExtension(id)
      if (!ext) return
      settings.data.disabledExtensions.push({ id, path: ext.path, name: ext.name })
      sesExt.removeExtension(id)
    }
    settings.save()
  },

  async remove(id) {
    const p = this.findPath(id)
    const unpacked = settings.data.unpackedExtensions.find((u) => u.id === id || u.path === p)
    settings.data.disabledExtensions = settings.data.disabledExtensions.filter((d) => d.id !== id)
    if (unpacked) {
      settings.data.unpackedExtensions = settings.data.unpackedExtensions.filter((u) => u !== unpacked)
      if (this.sesExt().getExtension(id)) this.sesExt().removeExtension(id)
      // Bản sao do trình duyệt tạo (nhập từ Cốc Cốc/Chrome) thì xoá luôn thư mục.
      if (unpacked.copied && p) fs.rmSync(p, { recursive: true, force: true })
    } else {
      if (!this.sesExt().getExtension(id) && p) {
        await this.sesExt().loadExtension(p).catch(() => {})
      }
      await uninstallExtension(id, { session: ctx.session, extensionsPath: EXTENSIONS_DIR }).catch(() => {})
    }
    settings.save()
  },

  async loadUnpacked(win) {
    const res = await dialog.showOpenDialog(win?.win, {
      title: 'Chọn thư mục extension đã giải nén (có file manifest.json)',
      properties: ['openDirectory'],
    })
    if (res.canceled || !res.filePaths[0]) return null
    const dir = res.filePaths[0]
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) throw new Error('Thư mục này không có manifest.json.')
    const ext = await this.sesExt().loadExtension(dir, { allowFileAccess: true })
    settings.data.unpackedExtensions = settings.data.unpackedExtensions.filter((u) => u.path !== dir)
    settings.data.unpackedExtensions.push({ id: ext.id, path: dir })
    settings.save()
    return ext.id
  },

  // Thư mục Extensions của các trình duyệt Chromium khác trên máy.
  otherBrowsers() {
    const local = process.env.LOCALAPPDATA || ''
    return [
      { key: 'coccoc', name: 'Cốc Cốc', dir: path.join(local, 'CocCoc', 'Browser', 'User Data') },
      { key: 'chrome', name: 'Google Chrome', dir: path.join(local, 'Google', 'Chrome', 'User Data') },
      { key: 'edge', name: 'Microsoft Edge', dir: path.join(local, 'Microsoft', 'Edge', 'User Data') },
      { key: 'brave', name: 'Brave', dir: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data') },
    ].filter((b) => fs.existsSync(b.dir))
  },

  // Liệt kê extension đã cài trong trình duyệt khác (mọi profile).
  scanBrowser(key) {
    const b = this.otherBrowsers().find((x) => x.key === key)
    if (!b) return []
    const found = new Map()
    let profiles = []
    try {
      profiles = fs.readdirSync(b.dir).filter((p) => p === 'Default' || /^Profile \d+$/.test(p))
    } catch {}
    for (const prof of profiles) {
      const extRoot = path.join(b.dir, prof, 'Extensions')
      let ids = []
      try {
        ids = fs.readdirSync(extRoot).filter((id) => /^[a-p]{32}$/.test(id))
      } catch {}
      for (const id of ids) {
        if (found.has(id)) continue
        let versions = []
        try {
          versions = fs.readdirSync(path.join(extRoot, id)).sort()
        } catch {}
        const v = versions[versions.length - 1]
        if (!v) continue
        const dir = path.join(extRoot, id, v)
        const m = this.readManifest(dir)
        if (!m) continue
        // Bỏ qua app/theme và extension nội bộ của Cốc Cốc (không có trên Chrome Web Store).
        if (m.theme || m.app) continue
        const updateUrl = m.update_url || ''
        found.set(id, {
          id,
          dir,
          name: this.localize(dir, m, m.name),
          version: m.version,
          mv: m.manifest_version,
          fromStore: !updateUrl || updateUrl.includes('google.com'),
          installed: !!this.sesExt().getExtension(id),
        })
      }
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
  },

  // Cài từ Chrome Web Store theo ID; nếu không có trên store thì chép bản cài sẵn trên máy.
  async importOne(item) {
    if (this.sesExt().getExtension(item.id)) return { id: item.id, ok: true, how: 'đã có' }
    if (item.fromStore) {
      try {
        await installExtension(item.id, { session: ctx.session, extensionsPath: EXTENSIONS_DIR, loadExtensionOptions: { allowFileAccess: true } })
        return { id: item.id, ok: true, how: 'Chrome Web Store' }
      } catch {}
    }
    try {
      const dest = path.join(app.getPath('userData'), 'ImportedExtensions', item.id)
      fs.rmSync(dest, { recursive: true, force: true })
      fs.cpSync(item.dir, dest, { recursive: true })
      // Chữ ký _metadata của trình duyệt gốc không hợp lệ ở đây.
      fs.rmSync(path.join(dest, '_metadata'), { recursive: true, force: true })
      const ext = await this.sesExt().loadExtension(dest, { allowFileAccess: true })
      settings.data.unpackedExtensions.push({ id: ext.id, path: dest, copied: true })
      settings.save()
      return { id: item.id, ok: true, how: 'chép từ máy' }
    } catch (err) {
      return { id: item.id, ok: false, error: String(err.message || err) }
    }
  },
}

// ---------------------------------------------------------------------------
// Giao thức metal:// cho các trang nội bộ
// ---------------------------------------------------------------------------
function registerMetalProtocol(ses) {
  ses.protocol.handle('metal', async (request) => {
    const url = new URL(request.url)
    const host = url.hostname
    if (host === 'ext-icon') {
      const id = url.pathname.slice(1)
      const dir = extMgr.findPath(id)
      const m = dir && extMgr.readManifest(dir)
      const icon = m && extMgr.iconPath(dir, m)
      if (icon && fs.existsSync(icon)) return net.fetch(pathToFileURL(icon).href)
      return net.fetch(pathToFileURL(path.join(PAGES_DIR, 'puzzle.svg')).href)
    }
    if (host === 'favicon') {
      // Favicon cho trang nội bộ (tránh tải tài nguyên ngoài).
      return net.fetch(pathToFileURL(path.join(__dirname, '..', 'build', 'icon.png')).href)
    }
    if (!INTERNAL_PAGES.includes(host)) return new Response('Không tìm thấy trang', { status: 404 })
    let rel = url.pathname === '/' ? `${host}.html` : decodeURIComponent(url.pathname.slice(1))
    const file = path.normalize(path.join(PAGES_DIR, rel))
    if (!file.startsWith(PAGES_DIR) || !fs.existsSync(file)) return new Response('Không tìm thấy', { status: 404 })
    return net.fetch(pathToFileURL(file).href)
  })
}

// ---------------------------------------------------------------------------
// IPC: thanh giao diện (UI)
// ---------------------------------------------------------------------------
function winFromUi(event) {
  for (const w of ctx.windows) if (w.ui.webContents === event.sender) return w
  return null
}

ipcMain.on('ui:action', (event, type, p = {}) => {
  const win = winFromUi(event)
  if (!win) return
  const tab = p.tabId != null ? win.getTab(p.tabId) : win.activeTab
  const wc = tab?.wc
  switch (type) {
    case 'new-tab': return win.createTab({ url: ctx.newTabUrl() })
    case 'select-tab': return win.selectTab(tab)
    case 'close-tab': return win.closeTab(tab)
    case 'move-tab': return tab && win.moveTab(tab, p.index)
    case 'tab-menu': return tab && win.showTabMenu(tab)
    case 'mute-tab': if (wc) { wc.setAudioMuted(!wc.isAudioMuted()); win.sendState() } return
    case 'navigate': {
      const url = ctx.toUrl(p.input)
      if (!url) return
      if (p.newTab || !tab) win.createTab({ url, afterTab: tab })
      else {
        tab.load(url)
        tab.wc.focus()
      }
      return
    }
    case 'back': return wc?.navigationHistory.goBack()
    case 'forward': return wc?.navigationHistory.goForward()
    case 'reload': return p.hard ? wc?.reloadIgnoringCache() : wc?.reload()
    case 'stop': return wc?.stop()
    case 'home': return tab?.load(ctx.homeUrl())
    case 'focus-page': return wc?.focus()
    case 'ui-height': return win.setUiHeight(p.height)
    case 'overlay': return win.setOverlay(p.on)
    case 'toggle-bookmark':
      if (tab && tab.displayUrl()) bookmarks.toggle(tab.displayUrl(), tab.title, tab.favicon)
      return ctx.broadcastState()
    case 'open-bookmark': return p.newTab ? win.createTab({ url: p.url, active: false, afterTab: tab }) : tab?.load(p.url)
    case 'bookmark-menu': return showBookmarkMenu(win, p.id)
    case 'find': return p.text ? wc?.findInPage(p.text, { forward: p.forward !== false, findNext: !!p.next, matchCase: false }) : wc?.stopFindInPage('clearSelection')
    case 'find-stop': return wc?.stopFindInPage('keepSelection')
    case 'zoom': return ctx.zoom(win, p.dir)
    case 'open-internal': return ctx.openInternal(p.page)
    case 'open-url': return ctx.openUrl(p.url, { win })
    case 'translate-page': return tab && ctx.translatePage(tab)
    case 'toggle-adblock': return ctx.setSetting('adblock', !settings.data.adblock)
    case 'app-menu': return showAppMenu(win, p)
    case 'minimize': return win.win.minimize()
    case 'shortcut': return ctx.handleShortcut(win, p, true)
    case 'download-media': {
      if (!tab) return
      // Mục trong bảng tải video (theo lần quét gần nhất của cửa sổ này).
      const item = typeof p.index === 'number' ? win.lastMediaScan?.items?.[p.index] : null
      if (item) return ctx.media.downloadItem(wc, item, p.quality || 'best').catch(showError)
      return ctx.media.downloadWithYtdlp(wc.getURL(), wc.getTitle(), p.quality || 'best').catch(showError)
    }
    case 'open-downloads': return ctx.openInternal('downloads')
    case 'open-download': return ctx.downloads.open(p.id)
    case 'show-download': return ctx.downloads.show(p.id)
  }
})

ipcMain.handle('ui:invoke', async (event, type, p = {}) => {
  const win = winFromUi(event)
  if (!win) return null
  switch (type) {
    case 'suggest': {
      const q = (p.q || '').trim()
      if (!q) return []
      const local = history.search(q, 8).map((h) => ({ type: 'history', url: h.url, title: h.title, favicon: h.favicon }))
      const marks = bookmarks.list().filter((b) => b.url.includes(q) || b.title.toLowerCase().includes(q.toLowerCase())).slice(0, 3).map((b) => ({ type: 'bookmark', url: b.url, title: b.title, favicon: b.favicon }))
      let remote = []
      try {
        const res = await net.fetch(`https://suggestqueries.google.com/complete/search?client=firefox&hl=vi&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(1500) })
        const data = JSON.parse(Buffer.from(await res.arrayBuffer()).toString('utf8'))
        remote = (data[1] || []).slice(0, 6).map((s) => ({ type: 'search', text: s }))
      } catch {}
      const seen = new Set()
      return [...marks, ...local].filter((s) => !seen.has(s.url) && seen.add(s.url)).slice(0, 7).concat(remote)
    }
    case 'scan-media': {
      const tab = win.activeTab
      if (!tab) return { items: [] }
      const res = await ctx.media.scan(tab.wc)
      win.lastMediaScan = res
      return { ...res, hasYtdlp: ctx.media.hasYtdlp(), hasFfmpeg: !!(await ctx.media.findFfmpeg()) }
    }
    case 'search-engine': return SEARCH_ENGINES[settings.data.searchEngine] || SEARCH_ENGINES.google
  }
  return null
})

function showAppMenu(win, { x, y }) {
  const tab = win.activeTab
  const wc = tab?.wc
  const zoom = wc ? Math.round(wc.getZoomFactor() * 100) : 100
  Menu.buildFromTemplate([
    { label: `Metal Browser — phiên bản ${app.getVersion()}`, click: () => ctx.openInternal('about') },
    { type: 'separator' },
    { label: 'Tab mới', accelerator: 'Ctrl+T', click: () => win.createTab({ url: ctx.newTabUrl() }) },
    { label: 'Cửa sổ mới', accelerator: 'Ctrl+N', click: () => ctx.createWindow() },
    { type: 'separator' },
    { label: 'Lịch sử', accelerator: 'Ctrl+H', click: () => ctx.openInternal('history') },
    { label: 'Tải xuống', accelerator: 'Ctrl+J', click: () => ctx.openInternal('downloads') },
    { label: 'Dấu trang', click: () => ctx.openInternal('bookmarks') },
    { label: 'Tiện ích mở rộng (Extension)', click: () => ctx.openInternal('extensions') },
    { label: 'Cửa hàng Chrome Web Store', click: () => ctx.openUrl('https://chromewebstore.google.com/') },
    { type: 'separator' },
    {
      label: `Thu phóng: ${zoom}%`,
      submenu: [
        { label: 'Phóng to', accelerator: 'Ctrl+=', click: () => ctx.zoom(win, 1) },
        { label: 'Thu nhỏ', accelerator: 'Ctrl+-', click: () => ctx.zoom(win, -1) },
        { label: 'Mặc định (100%)', accelerator: 'Ctrl+0', click: () => ctx.zoom(win, 0) },
      ],
    },
    { label: 'Toàn màn hình', accelerator: 'F11', click: () => win.win.setFullScreen(!win.win.isFullScreen()) },
    { type: 'separator' },
    { label: 'Dịch trang sang Tiếng Việt', enabled: !!wc && /^https?:/.test(wc.getURL()), click: () => ctx.translatePage(tab) },
    { label: 'Tìm trong trang...', accelerator: 'Ctrl+F', click: () => win.sendUi('find-open') },
    { label: 'In...', accelerator: 'Ctrl+P', enabled: !!wc, click: () => wc.print() },
    { label: 'Lưu trang thành...', accelerator: 'Ctrl+S', enabled: !!wc, click: () => ctx.savePage(win) },
    {
      label: 'Công cụ khác',
      submenu: [
        {
          label: 'DNS bảo mật (chống chặn web)',
          submenu: Object.entries(DNS_PROVIDERS).map(([key, p]) => ({
            label: p.name,
            type: 'radio',
            checked: settings.data.secureDns === key,
            click: () => (key === 'custom' ? ctx.openInternal('settings') : ctx.setSetting('secureDns', key)),
          })),
        },
        { label: 'Chặn quảng cáo', type: 'checkbox', checked: settings.data.adblock, click: () => ctx.setSetting('adblock', !settings.data.adblock) },
        { label: 'Hiện thanh dấu trang', type: 'checkbox', accelerator: 'Ctrl+Shift+B', checked: settings.data.showBookmarksBar, click: () => ctx.setSetting('showBookmarksBar', !settings.data.showBookmarksBar) },
        { type: 'separator' },
        { label: 'Xoá dữ liệu duyệt web...', accelerator: 'Ctrl+Shift+Delete', click: () => ctx.openInternal('settings') },
        { label: 'Công cụ cho nhà phát triển', accelerator: 'F12', enabled: !!wc, click: () => wc.toggleDevTools() },
        { label: 'DevTools của giao diện trình duyệt', click: () => win.ui.webContents.openDevTools({ mode: 'detach' }) },
      ],
    },
    { type: 'separator' },
    { label: 'Cài đặt', click: () => ctx.openInternal('settings') },
    { label: 'Giới thiệu Metal Browser', click: () => ctx.openInternal('about') },
    { type: 'separator' },
    { label: 'Thoát', click: () => app.quit() },
  ]).popup({ window: win.win, x: Math.round(x), y: Math.round(y) })
}

function showBookmarkMenu(win, id) {
  const b = bookmarks.list().find((x) => x.id === id)
  if (!b) return
  Menu.buildFromTemplate([
    { label: 'Mở trong tab mới', click: () => win.createTab({ url: b.url, afterTab: win.activeTab }) },
    { label: 'Mở trong cửa sổ mới', click: () => ctx.createWindow({ url: b.url }) },
    { type: 'separator' },
    { label: 'Sao chép địa chỉ', click: () => clipboard.writeText(b.url) },
    { label: 'Quản lý dấu trang', click: () => ctx.openInternal('bookmarks') },
    { label: 'Xoá dấu trang', click: () => { bookmarks.remove(b.id); ctx.broadcastState() } },
  ]).popup({ window: win.win })
}

// ---------------------------------------------------------------------------
// IPC: trang nội bộ metal://
// ---------------------------------------------------------------------------
ipcMain.handle('page:invoke', async (event, name, ...args) => {
  const url = event.senderFrame?.url || ''
  if (!url.startsWith('metal://')) throw new Error('Không được phép')
  const win = [...ctx.windows].find((w) => w.tabs.some((t) => t.wc === event.sender)) || ctx.activeWindow()
  const [a, b] = args
  switch (name) {
    case 'getSettings': return { ...settings.data, engines: SEARCH_ENGINES, dnsProviders: DNS_PROVIDERS, version: app.getVersion(), versions: { chrome: process.versions.chrome, electron: process.versions.electron } }
    case 'setSetting': return ctx.setSetting(a, b)
    case 'getTopSites': return history.topSites(a || 12)
    case 'getHistory': return history.search(a, b || 300)
    case 'removeHistory': return history.remove(a)
    case 'clearHistory': return history.clear(a)
    case 'getBookmarks': return bookmarks.list()
    case 'addBookmark': bookmarks.add(a, b); return ctx.broadcastState()
    case 'removeBookmark': bookmarks.remove(a); return ctx.broadcastState()
    case 'updateBookmark': bookmarks.update(a, b); return ctx.broadcastState()
    case 'moveBookmark': bookmarks.move(a, b); return ctx.broadcastState()
    case 'getDownloads': return ctx.downloads.list()
    case 'openDownload': return ctx.downloads.open(a)
    case 'showDownload': return ctx.downloads.show(a)
    case 'cancelDownload': return ctx.downloads.cancel(a)
    case 'pauseDownload': return ctx.downloads.pause(a)
    case 'removeDownload': return ctx.downloads.remove(a)
    case 'clearDownloads': return ctx.downloads.clear()
    case 'openDownloadsFolder': return ctx.downloads.openFolder()
    case 'chooseDownloadDir': return ctx.downloads.chooseDir(win?.win)
    case 'getDownloadDir': return ctx.downloads.dir
    case 'getExtensions': return extMgr.list()
    case 'setExtensionEnabled': await extMgr.setEnabled(a, b); return extMgr.list()
    case 'removeExtension': await extMgr.remove(a); return extMgr.list()
    case 'loadUnpacked': await extMgr.loadUnpacked(win); return extMgr.list()
    case 'installById': {
      const id = String(a || '').match(/[a-p]{32}/)?.[0]
      if (!id) throw new Error('Không tìm thấy ID extension hợp lệ (32 ký tự a–p).')
      await installExtension(id, { session: ctx.session, extensionsPath: EXTENSIONS_DIR, loadExtensionOptions: { allowFileAccess: true } })
      return extMgr.list()
    }
    case 'updateExtensions': await updateExtensions(ctx.session).catch(() => {}); return extMgr.list()
    case 'otherBrowsers': return extMgr.otherBrowsers().map(({ key, name }) => ({ key, name }))
    case 'scanBrowser': return extMgr.scanBrowser(a)
    case 'importExtensions': {
      const all = extMgr.scanBrowser(a)
      const chosen = all.filter((x) => (b || []).includes(x.id))
      const results = []
      for (const item of chosen) results.push({ ...(await extMgr.importOne(item)), name: item.name })
      return results
    }
    case 'openOptions': return a && ctx.openUrl(a, { win })
    case 'openUrl': return ctx.openUrl(a, { win, newTab: b !== false })
    case 'clearBrowsingData': {
      const opts = a || {}
      if (opts.history) history.clear()
      if (opts.cache) await ctx.session.clearCache()
      const storages = []
      if (opts.cookies) storages.push('cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage')
      if (storages.length) await ctx.session.clearStorageData({ storages })
      if (opts.downloads) ctx.downloads.clear()
      return true
    }
    case 'setDefaultBrowser': {
      app.setAsDefaultProtocolClient('http')
      app.setAsDefaultProtocolClient('https')
      // Windows 10/11 bắt người dùng tự chọn trong Cài đặt.
      shell.openExternal('ms-settings:defaultapps')
      return true
    }
    case 'mediaToolsStatus': return { ytdlp: ctx.media.hasYtdlp(), ffmpeg: await ctx.media.findFfmpeg() }
    case 'installYtdlp': await ctx.media.installYtdlp(); return true
    case 'installFfmpeg': await ctx.media.installFfmpeg(); return true
    case 'updateYtdlp': await ctx.media.updateYtdlp(); return true
    case 'restart': app.relaunch(); return app.quit()
    case 'chooseBackground': {
      const res = await dialog.showOpenDialog(win?.win, { title: 'Chọn ảnh nền', filters: [{ name: 'Ảnh', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }], properties: ['openFile'] })
      if (res.canceled || !res.filePaths[0]) return null
      const ext = path.extname(res.filePaths[0])
      const dest = path.join(app.getPath('userData'), `newtab-bg${ext}`)
      fs.copyFileSync(res.filePaths[0], dest)
      const data = `data:image/${ext.slice(1).replace('jpg', 'jpeg')};base64,${fs.readFileSync(dest).toString('base64')}`
      ctx.setSetting('newtabBackground', data)
      return data
    }
    case 'formatBytes': return formatBytes(a)
  }
  throw new Error(`Không rõ lệnh: ${name}`)
})

// ---------------------------------------------------------------------------
// Khởi động
// ---------------------------------------------------------------------------
function cleanUserAgent(ua) {
  return ua.replace(/\sElectron\/\S+/, '').replace(new RegExp(`\\s${app.getName()}\\/\\S+`, 'i'), '').replace(/\strinhduyetextention\/\S+/i, '')
}

function urlFromArgs(argv) {
  return argv.slice(1).find((a) => /^(https?|file):/i.test(a) || (/\.(html?|pdf|svg|xml)$/i.test(a) && fs.existsSync(a)))
}

app.on('second-instance', (_e, argv) => {
  const url = urlFromArgs(argv)
  const win = ctx.activeWindow()
  if (url) ctx.openUrl(ctx.toUrl(url))
  else if (win) win.createTab({ url: ctx.newTabUrl() })
  else ctx.createWindow()
  if (win) {
    if (win.win.isMinimized()) win.win.restore()
    win.win.focus()
  }
})

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  const ses = session.fromPartition('persist:metal')
  ctx.session = ses

  const ua = cleanUserAgent(ses.getUserAgent())
  ses.setUserAgent(ua)
  app.userAgentFallback = ua

  // Kiểm tra chính tả tiếng Việt + tiếng Anh.
  try {
    const langs = ['vi', 'en-US'].filter((l) => ses.availableSpellCheckerLanguages.includes(l))
    if (langs.length) ses.setSpellCheckerLanguages(langs)
  } catch {}

  // Cho phép quyền thông thường (thông báo, micro, camera hỏi người dùng).
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const auto = ['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'notifications', 'mediaKeySystem', 'window-management', 'idle-detection']
    if (auto.includes(permission)) return callback(true)
    if (['media', 'geolocation', 'clipboard-read', 'midi', 'midiSysex', 'display-capture'].includes(permission)) {
      const win = [...ctx.windows].find((w) => w.tabs.some((t) => t.wc === wc))
      let origin = details.requestingUrl
      try {
        origin = new URL(details.requestingUrl).host
      } catch {}
      const names = { media: 'dùng micro/camera', geolocation: 'biết vị trí của bạn', 'clipboard-read': 'đọc bộ nhớ tạm (clipboard)', midi: 'dùng thiết bị MIDI', midiSysex: 'dùng thiết bị MIDI', 'display-capture': 'chia sẻ màn hình' }
      const choice = dialog.showMessageBoxSync(win?.win, {
        type: 'question',
        buttons: ['Cho phép', 'Chặn'],
        defaultId: 0,
        cancelId: 1,
        title: 'Yêu cầu quyền',
        message: `${origin} muốn ${names[permission] || permission}.`,
      })
      return callback(choice === 0)
    }
    callback(true)
  })

  registerMetalProtocol(ses)
  ctx.applyDns()
  ses.registerPreloadScript({ id: 'metal-page-preload', type: 'frame', filePath: PAGE_PRELOAD })

  ctx.downloads = new DownloadManager()
  ctx.media = new MediaTools(ctx.downloads, ses)
  ctx.media.attachSniffer()
  // Bắt được link media mới từ mạng: cập nhật nút "Tải video" của tab đó.
  ctx.media.on('found', (wcId) => {
    for (const w of ctx.windows) w.tabs.find((t) => t.id === wcId)?.scheduleMediaScan()
  })
  ses.on('will-download', (_e, item) => ctx.downloads.handleWillDownload(item))
  let dlTimer = null
  ctx.downloads.on('changed', () => {
    if (dlTimer) return
    dlTimer = setTimeout(() => {
      dlTimer = null
      ctx.broadcastState()
      ctx.broadcastPages('downloads', ctx.downloads.list())
    }, 250)
  })
  ctx.downloads.on('completed', (d) => {
    if (Notification.isSupported()) {
      const n = new Notification({ title: 'Đã tải xong', body: d.filename || '', silent: true })
      n.on('click', () => ctx.downloads.show(d.id))
      n.show()
    }
  })

  // ---- Hỗ trợ API extension Chrome ----
  ctx.extensions = new ElectronChromeExtensions({
    license: 'GPL-3.0',
    session: ses,
    async createTab(details) {
      let win = details.windowId ? ctx.byBaseWindow.get(BaseWindow.fromId(details.windowId)) : null
      win = win || ctx.activeWindow() || ctx.createWindow({ empty: true })
      const tab = win.createTab({ url: details.url || ctx.newTabUrl(), active: details.active !== false, index: details.index })
      return [tab.wc, win.win]
    },
    selectTab(wc) {
      for (const w of ctx.windows) {
        const t = w.tabs.find((x) => x.wc === wc)
        if (t) {
          w.selectTab(t)
          w.win.focus()
        }
      }
    },
    removeTab(wc) {
      for (const w of ctx.windows) {
        const t = w.tabs.find((x) => x.wc === wc)
        if (t) w.closeTab(t)
      }
    },
    async createWindow(details) {
      const urls = Array.isArray(details.url) ? details.url : details.url ? [details.url] : []
      const w = ctx.createWindow({
        tabs: urls.map((url) => ({ url })),
        bounds: details.width ? { width: details.width, height: details.height, x: details.left, y: details.top } : undefined,
      })
      return w.win
    },
    removeWindow(baseWin) {
      ctx.byBaseWindow.get(baseWin)?.win.close()
    },
  })
  ElectronChromeExtensions.handleCRXProtocol(ses)
  const aliasPreload = path.join(__dirname, 'preload', 'crx-browser-alias.js')
  ses.registerPreloadScript({ id: 'metal-browser-alias-frame', type: 'frame', filePath: aliasPreload })
  ses.registerPreloadScript({ id: 'metal-browser-alias-sw', type: 'service-worker', filePath: aliasPreload })
  ctx.extensions.on('url-overrides-updated', () => ctx.broadcastState())

  // Cài/cập nhật extension từ Chrome Web Store (cho phép cả Manifest V2 mà Chrome đã bỏ).
  try {
    await installChromeWebStore({
      session: ses,
      extensionsPath: EXTENSIONS_DIR,
      minimumManifestVersion: 2,
      autoUpdate: true,
      async beforeInstall(details) {
        const win = ctx.activeWindow()
        const perms = [...(details.manifest.permissions || []), ...(details.manifest.host_permissions || [])]
        const { response } = await dialog.showMessageBox(win?.win, {
          type: 'question',
          icon: details.icon,
          buttons: ['Thêm tiện ích', 'Huỷ'],
          defaultId: 0,
          cancelId: 1,
          title: 'Thêm tiện ích mở rộng',
          message: `Thêm "${details.localizedName}"?`,
          detail: perms.length ? `Tiện ích này có thể:\n• ${perms.slice(0, 8).join('\n• ')}` : '',
        })
        return { action: response === 0 ? 'allow' : 'deny' }
      },
    })
  } catch (err) {
    console.error('Không khởi tạo được Chrome Web Store:', err)
  }

  // Extension giải nén / nhập từ trình duyệt khác.
  for (const u of settings.data.unpackedExtensions) {
    if (settings.data.disabledExtensions.some((d) => d.path === u.path)) continue
    if (!fs.existsSync(u.path)) continue
    await ses.extensions.loadExtension(u.path, { allowFileAccess: true }).catch((err) => console.error('Không nạp được extension', u.path, err.message))
  }
  // Gỡ các extension đang bị tắt.
  for (const d of settings.data.disabledExtensions) {
    if (ses.extensions.getExtension(d.id)) ses.extensions.removeExtension(d.id)
  }

  ses.extensions.on('extension-loaded', () => ctx.broadcastPages('extensions-changed'))
  ses.extensions.on('extension-unloaded', () => ctx.broadcastPages('extensions-changed'))

  ctx.applyAdblock()

  nativeTheme.on('updated', () => {
    for (const w of ctx.windows) w.applyTheme()
    ctx.broadcastState()
  })

  // ---- Mở cửa sổ: khôi phục phiên trước hoặc tab mới ----
  const startUrl = urlFromArgs(process.argv)
  const saved = stores.session.data.windows || []
  if (settings.data.restoreSession && saved.length) {
    saved.forEach((w) => ctx.createWindow(w))
    if (startUrl) ctx.openUrl(ctx.toUrl(startUrl))
  } else {
    ctx.createWindow({ url: startUrl ? ctx.toUrl(startUrl) : ctx.homeUrl() })
  }

  // Dành cho kiểm thử tự động: METAL_TEST=<file .js> nhận ctx để điều khiển trình duyệt.
  if (process.env.METAL_TEST) {
    require(path.resolve(process.env.METAL_TEST))({ ctx, extMgr, installExtension, EXTENSIONS_DIR }).catch((err) => {
      console.error('TEST ERROR', err)
      app.exit(1)
    })
  }

  // Dành cho phát triển: METAL_SHOT=<thư mục> chụp giao diện + tab đang mở sau vài giây.
  if (process.env.METAL_SHOT) {
    setTimeout(async () => {
      const w = ctx.activeWindow()
      if (!w) return
      fs.mkdirSync(process.env.METAL_SHOT, { recursive: true })
      fs.writeFileSync(path.join(process.env.METAL_SHOT, 'ui.png'), (await w.ui.webContents.capturePage()).toPNG())
      if (w.activeTab) fs.writeFileSync(path.join(process.env.METAL_SHOT, 'tab.png'), (await w.activeTab.wc.capturePage()).toPNG())
      console.log('METAL_SHOT done', JSON.stringify(w.tabs.map((t) => t.state().url)))
      if (process.env.METAL_SHOT_QUIT) app.quit()
    }, Number(process.env.METAL_SHOT_DELAY || 8000))
  }
})

app.on('web-contents-created', (_e, wc) => {
  // Popup của extension và cửa sổ phụ cũng dùng menu chuột phải tiếng Việt cơ bản.
  wc.on('context-menu', (_ev, params) => {
    const isTab = [...ctx.windows].some((w) => w.tabs.some((t) => t.wc === wc) || w.ui.webContents === wc)
    if (isTab) return
    const items = []
    if (params.isEditable) {
      items.push({ label: 'Cắt', role: 'cut' }, { label: 'Sao chép', role: 'copy' }, { label: 'Dán', role: 'paste' }, { label: 'Chọn tất cả', role: 'selectAll' })
    } else if (params.selectionText) items.push({ label: 'Sao chép', role: 'copy' })
    if (params.linkURL) items.push({ label: 'Mở liên kết trong tab mới', click: () => ctx.openUrl(params.linkURL) }, { label: 'Sao chép địa chỉ liên kết', click: () => clipboard.writeText(params.linkURL) })
    if (items.length) items.push({ type: 'separator' })
    items.push({ label: 'Kiểm tra (Inspect)', click: () => wc.inspectElement(params.x, params.y) })
    Menu.buildFromTemplate(items).popup()
  })
})

app.on('before-quit', () => {
  ctx.saveSession()
  ctx.quitting = true
  flushAll()
})

app.on('window-all-closed', () => {
  flushAll()
  app.quit()
})

process.on('uncaughtException', (err) => console.error('Lỗi chưa xử lý:', err))
process.on('unhandledRejection', (err) => {
  // Bộ chặn quảng cáo chèn script lọc vào trang mà không bắt lỗi; trang chặn script thì bỏ qua.
  if (/Script failed to execute/.test(String(err?.message))) return
  console.error('Promise bị từ chối:', err)
})
