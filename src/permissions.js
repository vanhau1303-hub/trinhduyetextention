// Quyền của trang web (vị trí, thông báo, camera, micro…).
// - Mỗi quyền có mặc định: ask (hỏi) | allow | block. Vị trí mặc định là chặn để Google… không đòi mãi.
// - Quyết định riêng cho từng trang lưu trong settings.sitePermissions[origin][quyền].
// - "Hỏi" không bật hộp thoại: thanh địa chỉ của tab hiện lời hỏi gọn, người dùng bấm Cho phép/Chặn.
const crypto = require('node:crypto')
const { getStores } = require('./store')
const { log } = require('./logger')

const PERMS = {
  geolocation: { label: 'Vị trí', ask: 'biết vị trí của bạn', icon: 'location', def: 'block' },
  notifications: { label: 'Thông báo', ask: 'gửi thông báo', icon: 'bell', def: 'ask' },
  camera: { label: 'Camera', ask: 'dùng camera', icon: 'camera', def: 'ask' },
  microphone: { label: 'Micro', ask: 'dùng micro', icon: 'mic', def: 'ask' },
  'clipboard-read': { label: 'Đọc bộ nhớ tạm', ask: 'đọc nội dung đã sao chép', icon: 'clipboard', def: 'ask' },
  midi: { label: 'Thiết bị MIDI', ask: 'dùng thiết bị MIDI', icon: 'midi', def: 'ask' },
  'idle-detection': { label: 'Phát hiện không hoạt động', ask: 'biết khi bạn rời máy', icon: 'idle', def: 'block' },
}
// Luôn cho phép (không cần hỏi, giống Chrome).
const ALWAYS = new Set(['fullscreen', 'pointerLock', 'keyboardLock', 'clipboard-sanitized-write', 'mediaKeySystem', 'window-management', 'openExternal', 'speaker-selection', 'storage-access', 'top-level-storage-access', 'fileSystem'])

function originOf(url) {
  try {
    const u = new URL(url)
    return /^https?:$/.test(u.protocol) ? u.origin : null
  } catch {
    return null
  }
}

// Quyền Electron -> các khoá quyền của mình.
function keysFor(permission, details = {}) {
  if (permission === 'media') {
    const types = details.mediaTypes || (details.mediaType ? [details.mediaType] : [])
    const keys = []
    if (types.includes('video')) keys.push('camera')
    if (types.includes('audio')) keys.push('microphone')
    return keys
  }
  if (permission === 'midiSysex') return ['midi']
  return PERMS[permission] ? [permission] : []
}

class Permissions {
  constructor(ctx) {
    this.ctx = ctx
    this.settings = getStores().settings
  }

  get defaults() {
    return { ...Object.fromEntries(Object.entries(PERMS).map(([k, p]) => [k, p.def])), ...(this.settings.data.permissionDefaults || {}) }
  }

  sites() {
    if (!this.settings.data.sitePermissions || typeof this.settings.data.sitePermissions !== 'object') this.settings.data.sitePermissions = {}
    return this.settings.data.sitePermissions
  }

  decide(origin, key) {
    return this.sites()[origin]?.[key] || this.defaults[key] || 'ask'
  }

  setSite(origin, key, value) {
    const sites = this.sites()
    if (!sites[origin]) sites[origin] = {}
    if (value === 'default' || !value) delete sites[origin][key]
    else sites[origin][key] = value
    if (!Object.keys(sites[origin]).length) delete sites[origin]
    this.settings.save()
  }

  resetSite(origin) {
    delete this.sites()[origin]
    this.settings.save()
  }

  setDefault(key, value) {
    this.settings.data.permissionDefaults = { ...(this.settings.data.permissionDefaults || {}), [key]: value }
    this.settings.save()
  }

  // Cho bảng thông tin trang (bấm biểu tượng cạnh địa chỉ).
  siteInfo(origin) {
    const site = this.sites()[origin] || {}
    const defaults = this.defaults
    return Object.entries(PERMS).map(([key, p]) => ({ key, label: p.label, icon: p.icon, value: site[key] || 'default', fallback: defaults[key] }))
  }

  list() {
    return {
      perms: Object.entries(PERMS).map(([key, p]) => ({ key, label: p.label, icon: p.icon, value: this.defaults[key] })),
      sites: Object.entries(this.sites()).map(([origin, perms]) => ({ origin, perms })),
    }
  }

  // session.setPermissionRequestHandler
  onRequest(wc, permission, callback, details) {
    if (ALWAYS.has(permission)) return callback(true)
    const keys = keysFor(permission, details)
    const url = details.requestingUrl || wc.getURL()
    if (url.startsWith('chrome-extension://') || url.startsWith('metal://') || url.startsWith('file://')) return callback(true)
    if (!keys.length) return callback(true)
    const origin = originOf(url)
    if (!origin) return callback(false)
    const decisions = keys.map((k) => this.decide(origin, k))
    if (decisions.includes('block')) {
      log.info('permission', 'Chặn', keys.join('+'), origin)
      return callback(false)
    }
    if (decisions.every((d) => d === 'allow')) return callback(true)
    const win = [...this.ctx.windows].find((w) => w.tabs.some((t) => t.wc === wc))
    if (!win) return callback(false) // cửa sổ popup/không phải tab: không hỏi được -> từ chối
    // Đã có lời hỏi giống hệt đang chờ: gộp vào.
    const same = win.permRequests.find((r) => r.tabId === wc.id && r.origin === origin && r.keys.join() === keys.join())
    if (same) return same.callbacks.push(callback)
    win.permRequests.push({ id: crypto.randomUUID(), tabId: wc.id, origin, keys, callbacks: [callback] })
    win.sendState()
  }

  // session.setPermissionCheckHandler (navigator.permissions.query, kiểm tra trước khi dùng…)
  onCheck(wc, permission, requestingOrigin, details) {
    if (ALWAYS.has(permission)) return true
    const keys = keysFor(permission, { mediaType: details?.mediaType })
    if (!keys.length) return true
    const origin = originOf(requestingOrigin) || originOf(details?.requestingUrl || '')
    if (!origin) return true
    return keys.every((k) => {
      const d = this.decide(origin, k)
      // "Hỏi": coi như chưa cho phép với thông báo (để trang phải xin), các quyền khác để trang tự xin khi dùng.
      return d === 'allow' || (d === 'ask' && k !== 'notifications')
    })
  }

  // Người dùng bấm trên thanh địa chỉ.
  answer(win, id, decision) {
    const idx = win.permRequests.findIndex((r) => r.id === id)
    if (idx < 0) return
    const [req] = win.permRequests.splice(idx, 1)
    const allow = decision === 'allow'
    if (decision === 'allow' || decision === 'block') for (const k of req.keys) this.setSite(req.origin, k, decision)
    log.info('permission', allow ? 'Cho phép' : decision === 'block' ? 'Chặn' : 'Bỏ qua', req.keys.join('+'), req.origin)
    req.callbacks.forEach((cb) => cb(allow))
    win.sendState()
  }

  // Tab chuyển trang/đóng: các lời hỏi còn chờ coi như từ chối.
  dropForTab(win, tabId) {
    const keep = []
    for (const r of win.permRequests) {
      if (r.tabId === tabId) r.callbacks.forEach((cb) => cb(false))
      else keep.push(r)
    }
    if (keep.length !== win.permRequests.length) {
      win.permRequests = keep
      win.sendState()
    }
  }

  // Lời hỏi đang chờ của tab đang xem (để UI hiện).
  pendingFor(win, tabId) {
    const r = win.permRequests.find((x) => x.tabId === tabId)
    if (!r) return null
    let host = r.origin
    try {
      host = new URL(r.origin).hostname
    } catch {}
    return { id: r.id, host, keys: r.keys, icon: PERMS[r.keys[0]].icon, text: r.keys.map((k) => PERMS[k].ask).join(' và ') }
  }
}

module.exports = { Permissions, PERMS, originOf }
