// Lưu trữ dữ liệu dạng JSON trong thư mục userData (cài đặt, lịch sử, dấu trang, phiên làm việc).
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')

class JsonStore {
  constructor(name, defaults) {
    this.file = path.join(app.getPath('userData'), `${name}.json`)
    this.defaults = defaults
    this.data = structuredClone(defaults)
    this.timer = null
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      this.data = Array.isArray(defaults) ? raw : { ...structuredClone(defaults), ...raw }
    } catch {
      // Chưa có file hoặc file hỏng: dùng giá trị mặc định.
    }
  }

  // Ghi trễ 500ms để gom nhiều thay đổi liên tiếp thành một lần ghi đĩa.
  save() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 500)
  }

  flush() {
    clearTimeout(this.timer)
    this.timer = null
    const tmp = `${this.file}.tmp`
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data))
      fs.renameSync(tmp, this.file)
    } catch (err) {
      console.error(`Không ghi được ${this.file}:`, err)
    }
  }
}

const DEFAULT_SETTINGS = {
  homepage: 'metal://newtab',
  searchEngine: 'google',
  adblock: true,
  forceDarkPages: false,
  uiTheme: 'system', // system | light | dark
  showBookmarksBar: true,
  restoreSession: true,
  askWhereToSave: false,
  downloadDir: '',
  disabledExtensions: [],
  unpackedExtensions: [],
  translateTarget: 'vi',
  newtabBackground: '',
  // DNS-over-HTTPS để tránh bị nhà mạng chặn web qua DNS: off | cloudflare | google | quad9 | adguard | custom
  secureDns: 'cloudflare',
  secureDnsCustom: '',
}

const DNS_PROVIDERS = {
  off: { name: 'Tắt (dùng DNS của nhà mạng)', url: '' },
  cloudflare: { name: 'Cloudflare 1.1.1.1', url: 'https://cloudflare-dns.com/dns-query' },
  google: { name: 'Google 8.8.8.8', url: 'https://dns.google/dns-query' },
  quad9: { name: 'Quad9 9.9.9.9', url: 'https://dns.quad9.net/dns-query' },
  adguard: { name: 'AdGuard (chặn thêm quảng cáo)', url: 'https://dns.adguard-dns.com/dns-query' },
  custom: { name: 'Tuỳ chỉnh…', url: '' },
}

const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  coccoc: { name: 'Cốc Cốc', url: 'https://coccoc.com/search#query=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  youtube: { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=%s' },
}

let stores = null

function getStores() {
  if (!stores) {
    stores = {
      settings: new JsonStore('settings', DEFAULT_SETTINGS),
      history: new JsonStore('history', []),
      bookmarks: new JsonStore('bookmarks', []),
      session: new JsonStore('session', { windows: [] }),
      downloads: new JsonStore('downloads', []),
    }
  }
  return stores
}

function flushAll() {
  if (!stores) return
  for (const s of Object.values(stores)) s.flush()
}

module.exports = { getStores, flushAll, SEARCH_ENGINES, DEFAULT_SETTINGS, DNS_PROVIDERS }
