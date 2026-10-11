// Trình quản lý mật khẩu: lưu trong passwords.json (userData), mật khẩu được mã hoá bằng
// safeStorage — trên Windows là DPAPI, gắn với tài khoản Windows đang đăng nhập, nên chép file
// sang máy/tài khoản khác cũng không giải mã được. Tên đăng nhập lưu dạng thường để hiển thị (như Chrome).
const crypto = require('node:crypto')
const { safeStorage } = require('electron')
const { getStores } = require('./store')

class PasswordManager {
  constructor() {
    this.store = getStores().passwords
    // webContentsId -> { origin, username }: tên đăng nhập ở bước 1 của form đăng nhập 2 bước (Google...).
    this.pendingUsernames = new Map()
  }

  get data() {
    if (!Array.isArray(this.store.data.entries)) this.store.data.entries = []
    if (!Array.isArray(this.store.data.never)) this.store.data.never = []
    return this.store.data
  }

  available() {
    return safeStorage.isEncryptionAvailable()
  }

  encrypt(text) {
    return safeStorage.encryptString(text).toString('base64')
  }

  decrypt(b64) {
    try {
      return safeStorage.decryptString(Buffer.from(b64, 'base64'))
    } catch {
      return null
    }
  }

  static normOrigin(origin) {
    try {
      const u = new URL(origin)
      return /^https?:$/.test(u.protocol) ? u.origin : null
    } catch {
      return null
    }
  }

  find(origin, username) {
    return this.data.entries.find((e) => e.origin === origin && e.username === username)
  }

  // Tài khoản đã lưu cho 1 origin (có mật khẩu đã giải mã) — chỉ dùng để điền vào đúng trang đó.
  forOrigin(origin) {
    return this.data.entries
      .filter((e) => e.origin === origin)
      .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0))
      .map((e) => ({ id: e.id, username: e.username, password: this.decrypt(e.password) }))
      .filter((e) => e.password != null)
  }

  // Trang vừa gửi form đăng nhập: trả về việc cần hỏi người dùng (lưu mới / cập nhật) hoặc null.
  captured(origin, username, password) {
    origin = PasswordManager.normOrigin(origin)
    if (!origin || !password || !this.available()) return null
    if (this.data.never.includes(origin)) return null
    const existing = this.find(origin, username)
    if (existing) {
      if (this.decrypt(existing.password) === password) {
        existing.lastUsed = Date.now()
        this.store.save()
        return null
      }
      return { origin, username, password, update: true }
    }
    return { origin, username, password, update: false }
  }

  save({ origin, username, password }) {
    if (!this.available()) throw new Error('Windows không cho phép mã hoá dữ liệu trên máy này.')
    const existing = this.find(origin, username)
    if (existing) {
      existing.password = this.encrypt(password)
      existing.updated = Date.now()
      existing.lastUsed = Date.now()
    } else {
      this.data.entries.push({
        id: crypto.randomUUID(),
        origin,
        username,
        password: this.encrypt(password),
        created: Date.now(),
        lastUsed: Date.now(),
      })
    }
    this.store.save()
  }

  never(origin) {
    if (!this.data.never.includes(origin)) this.data.never.push(origin)
    this.store.save()
  }

  touch(id) {
    const e = this.data.entries.find((x) => x.id === id)
    if (e) {
      e.lastUsed = Date.now()
      this.store.save()
    }
  }

  // Danh sách cho trang metal://passwords (không kèm mật khẩu).
  list() {
    return this.data.entries
      .map(({ id, origin, username, created, lastUsed }) => ({ id, origin, username, created, lastUsed }))
      .sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username))
  }

  reveal(id) {
    const e = this.data.entries.find((x) => x.id === id)
    return e ? this.decrypt(e.password) : null
  }

  remove(id) {
    this.data.entries = this.data.entries.filter((e) => e.id !== id)
    this.store.save()
  }

  removeNever(origin) {
    this.data.never = this.data.never.filter((o) => o !== origin)
    this.store.save()
  }

  clear() {
    this.store.data = { entries: [], never: [] }
    this.store.flush()
  }
}

module.exports = { PasswordManager }
