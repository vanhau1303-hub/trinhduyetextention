// Một cửa sổ trình duyệt: thanh giao diện (UI) phía trên + các tab (WebContentsView) bên dưới.
const path = require('node:path')
const { BaseWindow, WebContentsView, Menu, dialog, nativeTheme } = require('electron')

const UI_HTML = path.join(__dirname, 'ui', 'index.html')
const UI_PRELOAD = path.join(__dirname, 'preload', 'ui-preload.js')
const ICON = path.join(__dirname, '..', 'build', 'icon.png')
const TITLEBAR_HEIGHT = 38

const THEME = {
  light: { color: '#dde3ec', symbolColor: '#2b3340' },
  dark: { color: '#1f232a', symbolColor: '#e6e9ef' },
}

class Tab {
  constructor(win, { webContents, url, pinned = false } = {}) {
    this.win = win
    this.ctx = win.ctx
    this.view = webContents
      ? new WebContentsView({ webContents })
      : new WebContentsView({
          webPreferences: {
            session: this.ctx.session,
            sandbox: true,
            contextIsolation: true,
            spellcheck: true,
            scrollBounce: true,
            autoplayPolicy: 'no-user-gesture-required',
          },
        })
    this.view.setBackgroundColor('#ffffffff')
    this.wc = this.view.webContents
    this.wc.setMaxListeners(50)
    this.id = this.wc.id
    this.title = 'Tab mới'
    this.favicon = ''
    this.loading = false
    this.crashed = false
    this.pinned = pinned
    this.media = { count: 0, ytdlp: false }
    this.initialUrl = url || ''
    this.lastActive = Date.now()
    this.bind()
  }

  bind() {
    const wc = this.wc
    const update = () => this.win.sendState()

    wc.on('page-title-updated', (_e, title) => {
      this.title = title
      this.ctx.history.updateTitle(wc.getURL(), title)
      update()
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      this.favicon = favicons[0] || ''
      this.ctx.history.updateFavicon(wc.getURL(), this.favicon)
      update()
    })
    wc.on('did-start-loading', () => {
      this.loading = true
      update()
    })
    wc.on('did-stop-loading', () => {
      this.loading = false
      update()
      this.scanMedia()
    })
    wc.on('did-navigate', (_e, url, httpCode) => {
      this.ctx.media.clear(wc.id)
      this.crashed = false
      this.favicon = ''
      this.media = { count: 0, ytdlp: false }
      if (httpCode < 400 || httpCode === undefined) this.ctx.history.add(url, wc.getTitle())
      update()
      this.win.scheduleSessionSave()
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return
      this.ctx.history.add(url, wc.getTitle())
      update()
      this.win.scheduleSessionSave()
      setTimeout(() => this.scanMedia(), 1500)
    })
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      // -3 = ERR_ABORTED (người dùng dừng / chuyển trang), không phải lỗi thật.
      if (!isMainFrame || code === -3 || url.startsWith('metal://')) return
      const errorUrl = `metal://error/?code=${code}&desc=${encodeURIComponent(desc)}&u=${encodeURIComponent(url)}`
      wc.loadURL(errorUrl).catch(() => {})
    })
    wc.on('audio-state-changed', update)
    wc.on('media-started-playing', () => this.scanMedia())
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return
      this.crashed = true
      this.loading = false
      update()
    })
    wc.on('unresponsive', () => {
      const choice = dialog.showMessageBoxSync(this.win.win, {
        type: 'warning',
        buttons: ['Chờ', 'Tải lại trang'],
        title: 'Trang không phản hồi',
        message: `Trang "${this.title}" không phản hồi.`,
      })
      if (choice === 1) {
        wc.forcefullyCrashRenderer()
        wc.reload()
      }
    })
    wc.on('enter-html-full-screen', () => this.win.setHtmlFullscreen(true))
    wc.on('leave-html-full-screen', () => this.win.setHtmlFullscreen(false))
    wc.on('found-in-page', (_e, result) => this.win.sendUi('find-result', result))
    wc.on('zoom-changed', (_e, dir) => {
      const level = wc.getZoomLevel() + (dir === 'in' ? 0.5 : -0.5)
      wc.setZoomLevel(Math.max(-5, Math.min(5, level)))
      update()
    })
    wc.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && this.ctx.handleShortcut(this.win, input)) event.preventDefault()
    })
    wc.on('context-menu', (_e, params) => this.ctx.showContextMenu(this, params))
    wc.setWindowOpenHandler((details) => this.handleWindowOpen(details))
    wc.on('destroyed', () => this.win.onTabDestroyed(this))
  }

  handleWindowOpen(details) {
    const { url, disposition, features } = details
    // Cửa sổ popup có kích thước (đăng nhập Google/Facebook, thanh toán...) mở thành cửa sổ riêng như Chrome.
    if (disposition === 'new-window' && features) {
      return {
        action: 'allow',
        outlivesOpener: false,
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          icon: ICON,
          webPreferences: { session: this.ctx.session, sandbox: true, contextIsolation: true },
        },
      }
    }
    if (disposition === 'foreground-tab' || disposition === 'background-tab' || disposition === 'new-window' || disposition === 'other') {
      return {
        action: 'allow',
        outlivesOpener: true,
        createWindow: (options) => {
          const tab = this.win.createTab({
            webContents: options.webContents,
            active: disposition !== 'background-tab',
            afterTab: this,
          })
          return tab.wc
        },
      }
    }
    return { action: 'allow' }
  }

  // Gom nhiều lần bắt được link liên tiếp thành một lần quét.
  scheduleMediaScan() {
    clearTimeout(this.mediaTimer)
    this.mediaTimer = setTimeout(() => this.scanMedia(), 600)
  }

  async scanMedia() {
    if (this.wc.isDestroyed()) return
    const res = await this.ctx.media.scan(this.wc)
    const media = { count: res.items?.length || 0, ytdlp: !!res.ytdlp }
    if (media.count !== this.media.count || media.ytdlp !== this.media.ytdlp) {
      this.media = media
      this.win.sendState()
    }
  }

  displayUrl() {
    const url = this.wc.getURL() || this.initialUrl
    if (url.startsWith('metal://error')) {
      try {
        return new URL(url).searchParams.get('u') || url
      } catch {
        return url
      }
    }
    if (url.startsWith('metal://newtab')) return ''
    return url
  }

  state() {
    const wc = this.wc
    const url = this.displayUrl()
    return {
      id: this.id,
      title: this.title || url || 'Tab mới',
      url,
      rawUrl: wc.getURL(),
      favicon: this.favicon,
      loading: this.loading,
      crashed: this.crashed,
      audible: wc.isCurrentlyAudible(),
      muted: wc.isAudioMuted(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      zoom: Math.round(wc.getZoomFactor() * 100),
      pinned: this.pinned,
      media: this.media,
      secure: url.startsWith('https://'),
      internal: url.startsWith('metal://') || url === '',
    }
  }

  load(url) {
    this.initialUrl = url
    this.wc.loadURL(url).catch(() => {})
  }
}

class BrowserWin {
  constructor(ctx, { bounds, maximized } = {}) {
    this.ctx = ctx
    this.tabs = []
    this.activeTab = null
    this.uiHeight = 112
    this.overlay = false
    this.htmlFullscreen = false
    this.stateTimer = null

    const dark = nativeTheme.shouldUseDarkColors
    this.win = new BaseWindow({
      width: bounds?.width || 1280,
      height: bounds?.height || 820,
      x: bounds?.x,
      y: bounds?.y,
      minWidth: 480,
      minHeight: 320,
      show: false,
      icon: ICON,
      title: 'Metal Browser',
      backgroundColor: dark ? '#1f232a' : '#dde3ec',
      titleBarStyle: 'hidden',
      titleBarOverlay: { ...(dark ? THEME.dark : THEME.light), height: TITLEBAR_HEIGHT },
    })

    this.ui = new WebContentsView({
      webPreferences: {
        session: ctx.session,
        preload: UI_PRELOAD,
        // Preload của UI cần require module của electron-chrome-extensions nên không chạy sandbox.
        sandbox: false,
        contextIsolation: true,
        spellcheck: false,
      },
    })
    this.ui.setBackgroundColor('#00000000')
    this.win.contentView.addChildView(this.ui)
    this.ui.webContents.loadFile(UI_HTML)
    this.ui.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && this.ctx.handleShortcut(this, input, true)) event.preventDefault()
    })
    this.ui.webContents.once('did-finish-load', () => {
      this.sendState()
      if (maximized) this.win.maximize()
      // METAL_HIDDEN: chạy ẩn khi kiểm thử tự động.
      if (!process.env.METAL_HIDDEN) this.win.show()
    })

    this.win.on('resize', () => this.layout())
    this.win.on('maximize', () => this.sendState())
    this.win.on('unmaximize', () => this.sendState())
    this.win.on('focus', () => {
      this.ctx.lastFocused = this
      if (this.activeTab && !this.activeTab.wc.isDestroyed()) {
        try {
          this.ctx.extensions.selectTab(this.activeTab.wc)
        } catch {}
      }
    })
    this.win.on('close', () => {
      this.closing = true
      this.ctx.onWindowClosing(this)
    })
    this.win.on('closed', () => this.ctx.onWindowClosed(this))
    this.applyTheme()
    this.layout()
  }

  applyTheme() {
    const dark = nativeTheme.shouldUseDarkColors
    try {
      this.win.setTitleBarOverlay({ ...(dark ? THEME.dark : THEME.light), height: TITLEBAR_HEIGHT })
    } catch {}
  }

  layout() {
    if (this.win.isDestroyed()) return
    const { width, height } = this.win.getContentBounds()
    const top = this.htmlFullscreen ? 0 : this.uiHeight
    this.ui.setVisible(!this.htmlFullscreen || this.overlay)
    this.ui.setBounds({ x: 0, y: 0, width, height: this.overlay ? height : top })
    if (this.activeTab) {
      this.activeTab.view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) })
    }
  }

  setUiHeight(h) {
    h = Math.max(40, Math.min(400, Math.round(h)))
    if (h === this.uiHeight) return
    this.uiHeight = h
    this.layout()
  }

  setOverlay(on) {
    this.overlay = !!on
    if (this.overlay) {
      // Đưa UI lên trên cùng để menu/gợi ý đè lên trang web.
      this.win.contentView.addChildView(this.ui)
    }
    this.layout()
  }

  setHtmlFullscreen(on) {
    this.htmlFullscreen = on
    this.win.setFullScreen(on)
    this.layout()
  }

  sendUi(channel, ...args) {
    if (!this.ui.webContents.isDestroyed()) this.ui.webContents.send(channel, ...args)
  }

  // Gửi trạng thái cho UI, gom nhiều thay đổi trong 16ms thành một lần gửi.
  sendState() {
    if (this.stateTimer) return
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null
      if (this.win.isDestroyed()) return
      const active = this.activeTab?.state()
      this.sendUi('state', {
        tabs: this.tabs.map((t) => t.state()),
        activeId: this.activeTab?.id ?? null,
        bookmarked: active ? this.ctx.bookmarks.has(active.url) : false,
        maximized: this.win.isMaximized(),
        ...this.ctx.uiExtras(),
      })
      if (this.activeTab) this.win.setTitle(`${this.activeTab.title} - Metal Browser`)
    }, 16)
  }

  scheduleSessionSave() {
    this.ctx.scheduleSessionSave()
  }

  createTab({ url, webContents, active = true, afterTab, index, pinned } = {}) {
    const tab = new Tab(this, { webContents, url, pinned })
    let at = this.tabs.length
    if (typeof index === 'number') at = Math.max(0, Math.min(index, this.tabs.length))
    else if (afterTab) {
      // Tab mở từ một tab khác được đặt ngay sau tab đó (như Chrome).
      const base = this.tabs.indexOf(afterTab)
      if (base >= 0) {
        at = base + 1
        while (at < this.tabs.length && this.tabs[at].openerId === afterTab.id) at++
      }
      tab.openerId = afterTab.id
    }
    this.tabs.splice(at, 0, tab)
    tab.view.setVisible(false)
    this.win.contentView.addChildView(tab.view, 0)
    this.ctx.extensions.addTab(tab.wc, this.win)
    if (url) tab.load(url)
    if (active || !this.activeTab) this.selectTab(tab)
    this.sendState()
    this.scheduleSessionSave()
    return tab
  }

  getTab(id) {
    return this.tabs.find((t) => t.id === id)
  }

  selectTab(tab) {
    if (!tab || tab.win !== this || this.closing || this.win.isDestroyed() || tab.wc.isDestroyed()) return
    if (this.activeTab && this.activeTab !== tab) this.activeTab.view.setVisible(false)
    this.activeTab = tab
    tab.lastActive = Date.now()
    tab.view.setVisible(true)
    this.layout()
    if (tab.crashed) {
      tab.crashed = false
      tab.wc.reload()
    }
    try {
      this.ctx.extensions.selectTab(tab.wc)
    } catch {}
    if (tab.displayUrl() === '') this.sendUi('focus-address')
    else tab.wc.focus()
    this.sendState()
    this.scheduleSessionSave()
  }

  closeTab(tab) {
    if (!tab || tab.win !== this) return
    const url = tab.wc.getURL()
    if (url && !url.startsWith('metal://newtab')) {
      this.ctx.closedTabs.push({ url, title: tab.title })
      if (this.ctx.closedTabs.length > 25) this.ctx.closedTabs.shift()
    }
    const idx = this.tabs.indexOf(tab)
    if (this.activeTab === tab) {
      // Ưu tiên tab mở ra từ tab này, rồi tab bên phải, rồi tab bên trái.
      const next = this.tabs[idx + 1] || this.tabs[idx - 1]
      this.activeTab = null
      if (next) this.selectTab(next)
    }
    this.detachTab(tab)
    tab.wc.close()
    if (this.tabs.length === 0) this.win.close()
  }

  detachTab(tab) {
    const idx = this.tabs.indexOf(tab)
    if (idx >= 0) this.tabs.splice(idx, 1)
    try {
      this.win.contentView.removeChildView(tab.view)
    } catch {}
    this.sendState()
    this.scheduleSessionSave()
  }

  onTabDestroyed(tab) {
    if (this.tabs.includes(tab)) {
      if (this.activeTab === tab) {
        this.activeTab = null
        const next = this.tabs.find((t) => t !== tab)
        this.detachTab(tab)
        if (next) this.selectTab(next)
      } else this.detachTab(tab)
      if (this.tabs.length === 0 && !this.win.isDestroyed()) this.win.close()
    }
  }

  moveTab(tab, toIndex) {
    const from = this.tabs.indexOf(tab)
    if (from < 0) return
    this.tabs.splice(from, 1)
    this.tabs.splice(Math.max(0, Math.min(toIndex, this.tabs.length)), 0, tab)
    this.sendState()
    this.scheduleSessionSave()
  }

  cycleTab(delta) {
    if (!this.tabs.length) return
    const idx = this.tabs.indexOf(this.activeTab)
    this.selectTab(this.tabs[(idx + delta + this.tabs.length) % this.tabs.length])
  }

  showTabMenu(tab) {
    const idx = this.tabs.indexOf(tab)
    const wc = tab.wc
    Menu.buildFromTemplate([
      { label: 'Tab mới bên phải', click: () => this.createTab({ url: this.ctx.newTabUrl(), index: idx + 1 }) },
      { type: 'separator' },
      { label: 'Tải lại', click: () => wc.reload() },
      { label: 'Nhân bản tab', click: () => this.createTab({ url: wc.getURL(), index: idx + 1 }) },
      { label: tab.pinned ? 'Bỏ ghim tab' : 'Ghim tab', click: () => this.togglePin(tab) },
      { label: wc.isAudioMuted() ? 'Bật tiếng trang web' : 'Tắt tiếng trang web', click: () => { wc.setAudioMuted(!wc.isAudioMuted()); this.sendState() } },
      { label: 'Chuyển sang cửa sổ mới', enabled: this.tabs.length > 1, click: () => this.ctx.moveTabToNewWindow(tab) },
      { type: 'separator' },
      { label: 'Đóng tab', accelerator: 'Ctrl+W', click: () => this.closeTab(tab) },
      { label: 'Đóng các tab khác', enabled: this.tabs.length > 1, click: () => this.tabs.filter((t) => t !== tab && !t.pinned).forEach((t) => this.closeTab(t)) },
      { label: 'Đóng các tab bên phải', enabled: idx < this.tabs.length - 1, click: () => this.tabs.slice(idx + 1).forEach((t) => this.closeTab(t)) },
      { type: 'separator' },
      { label: 'Mở lại tab đã đóng', accelerator: 'Ctrl+Shift+T', enabled: this.ctx.closedTabs.length > 0, click: () => this.ctx.reopenClosedTab(this) },
    ]).popup({ window: this.win })
  }

  togglePin(tab) {
    tab.pinned = !tab.pinned
    // Tab ghim luôn nằm bên trái.
    const pinnedCount = this.tabs.filter((t) => t.pinned && t !== tab).length
    this.moveTab(tab, pinnedCount)
  }

  serialize() {
    const bounds = this.win.isMaximized() || this.win.isFullScreen() ? this.normalBounds || this.win.getNormalBounds() : this.win.getBounds()
    return {
      bounds,
      maximized: this.win.isMaximized(),
      active: Math.max(0, this.tabs.indexOf(this.activeTab)),
      tabs: this.tabs
        .map((t) => ({ url: t.wc.getURL() || t.initialUrl, title: t.title, pinned: t.pinned }))
        .filter((t) => t.url && !t.url.startsWith('metal://error')),
    }
  }
}

module.exports = { BrowserWin, Tab, TITLEBAR_HEIGHT }
