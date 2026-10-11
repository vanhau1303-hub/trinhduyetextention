// Preload chạy trong mọi trang của phiên duyệt web (sandbox, isolated world — script của trang không thấy).
// - Trang nội bộ metal:// được cấp API `metal`.
// - Trang http(s): trình quản lý mật khẩu (đề nghị lưu khi đăng nhập, tự điền tài khoản đã lưu).
const { contextBridge, ipcRenderer } = require('electron')

if (location.protocol === 'metal:') {
  contextBridge.exposeInMainWorld('metal', {
    invoke: (name, ...args) => ipcRenderer.invoke('page:invoke', name, ...args),
    on: (name, cb) => ipcRenderer.on(`page:${name}`, (_e, ...args) => cb(...args)),
  })
} else if (/^https?:$/.test(location.protocol)) {
  setupPasswordManager()
}

function setupPasswordManager() {
  const USERNAME_SEL = 'input[autocomplete~="username"], input[type="email"], input[type="text"], input[type="tel"], input:not([type])'

  const visible = (el) => {
    if (!el || el.disabled || el.readOnly) return false
    const r = el.getBoundingClientRect()
    const st = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'
  }
  const passwordFields = (root = document) => [...root.querySelectorAll('input[type="password"]')].filter(visible)

  // Ô tên đăng nhập: ưu tiên autocomplete=username, không thì ô chữ/email đứng ngay trước ô mật khẩu.
  function usernameFieldFor(pwd) {
    const scope = pwd.form || document
    const explicit = [...scope.querySelectorAll('input[autocomplete~="username"]')].find((el) => el.value || visible(el))
    if (explicit) return explicit
    const inputs = [...scope.querySelectorAll(`${USERNAME_SEL}, input[type="password"]`)]
    const idx = inputs.indexOf(pwd)
    for (let i = idx - 1; i >= 0; i--) {
      const el = inputs[i]
      if (el.type !== 'password' && (visible(el) || el.value) && !/search|captcha|otp|code/i.test(`${el.name} ${el.id} ${el.placeholder}`)) return el
    }
    return null
  }

  // ---- Bắt thông tin đăng nhập khi gửi form ----
  let lastSent = ''
  function capture(from) {
    const scope = (from && from.closest && from.closest('form')) || document
    const pwds = passwordFields(scope).filter((p) => p.value)
    if (!pwds.length) {
      // Bước 1 của form 2 bước (chỉ có ô email/tên): nhớ tên đăng nhập để ghép ở bước mật khẩu.
      const user = [...scope.querySelectorAll('input[autocomplete~="username"], input[type="email"]')].find((el) => el.value && visible(el))
      if (user) ipcRenderer.send('pw:username', user.value.trim())
      return
    }
    // Form đổi/đăng ký mật khẩu có nhiều ô: lấy ô cuối (mật khẩu mới).
    const pwd = pwds[pwds.length - 1]
    const userEl = usernameFieldFor(pwds[0])
    const username = userEl ? userEl.value.trim() : ''
    const key = `${username}\u0000${pwd.value}`
    if (key === lastSent) return
    lastSent = key
    ipcRenderer.send('pw:captured', { username, password: pwd.value })
  }

  document.addEventListener('submit', (e) => capture(e.target), true)
  document.addEventListener(
    'click',
    (e) => {
      const btn = e.target.closest && e.target.closest('button, input[type="submit"], input[type="button"], [role="button"], a')
      if (btn) capture(btn)
    },
    true
  )
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') capture(e.target)
    },
    true
  )

  // ---- Tự điền ----
  let accounts = null
  let loading = null
  const getAccounts = () => {
    if (accounts) return Promise.resolve(accounts)
    if (!loading) loading = ipcRenderer.invoke('pw:get').then((list) => (accounts = list || [])).catch(() => (accounts = []))
    return loading
  }

  // Gán giá trị kiểu "người gõ" để React/Vue… nhận được thay đổi.
  function setValue(el, value) {
    if (!el) return
    el.focus()
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function fill(pwd, acc) {
    setValue(usernameFieldFor(pwd), acc.username)
    setValue(pwd, acc.password)
    ipcRenderer.send('pw:used', acc.id)
    closeMenu()
  }

  // Danh sách chọn tài khoản (shadow DOM đóng để trang không đọc được).
  let menuHost = null
  function closeMenu() {
    if (menuHost) menuHost.remove()
    menuHost = null
  }
  function openMenu(anchor, pwd) {
    closeMenu()
    menuHost = document.createElement('div')
    const root = menuHost.attachShadow({ mode: 'closed' })
    const r = anchor.getBoundingClientRect()
    const dark = matchMedia('(prefers-color-scheme: dark)').matches
    root.innerHTML = `<style>
      .m{position:fixed;z-index:2147483647;min-width:240px;font:13px/1.4 "Segoe UI",system-ui,sans-serif;background:${dark ? '#2b3039' : '#fff'};color:${dark ? '#e6e9ef' : '#1f2633'};border:1px solid ${dark ? '#3a404b' : '#d3d9e3'};border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.2);padding:4px;}
      .h{font-size:11px;color:#7b8794;padding:6px 10px 4px}
      button{display:flex;flex-direction:column;align-items:flex-start;width:100%;border:0;background:none;color:inherit;padding:7px 10px;border-radius:7px;cursor:pointer;font:inherit;text-align:left}
      button:hover{background:${dark ? '#3a4150' : '#eef2f8'}}
      small{color:#7b8794;letter-spacing:2px}
    </style><div class="m"><div class="h">🔑 Mật khẩu đã lưu — Metal Browser</div></div>`
    const box = root.querySelector('.m')
    for (const acc of accounts) {
      const b = document.createElement('button')
      b.innerHTML = '<span></span><small>••••••••</small>'
      b.firstChild.textContent = acc.username || '(không có tên đăng nhập)'
      b.addEventListener('mousedown', (e) => {
        e.preventDefault()
        fill(pwd, acc)
      })
      box.appendChild(b)
    }
    box.style.left = `${Math.max(4, r.left)}px`
    box.style.top = `${r.bottom + 4}px`
    document.documentElement.appendChild(menuHost)
  }

  document.addEventListener(
    'focusin',
    async (e) => {
      const el = e.target
      if (!el || el.tagName !== 'INPUT') return
      const pwd = el.type === 'password' ? el : passwordFields(el.form || document).find((p) => usernameFieldFor(p) === el)
      if (!pwd) return
      const list = await getAccounts()
      if (list.length && document.activeElement === el) openMenu(el, pwd)
    },
    true
  )
  document.addEventListener('focusout', () => setTimeout(closeMenu, 150), true)
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu(), true)

  // Có đúng 1 tài khoản và các ô còn trống thì điền luôn khi trang có ô mật khẩu (như Chrome).
  let autoFilled = false
  async function tryAutoFill() {
    if (autoFilled) return
    const pwd = passwordFields()[0]
    if (!pwd || pwd.value) return
    const list = await getAccounts()
    if (list.length !== 1) return
    const user = usernameFieldFor(pwd)
    if (user && user.value && user.value !== list[0].username) return
    autoFilled = true
    setValue(user, list[0].username)
    setValue(pwd, list[0].password)
    pwd.blur()
  }
  window.addEventListener('DOMContentLoaded', () => {
    tryAutoFill()
    // Trang SPA vẽ form sau: theo dõi một lúc.
    let n = 0
    const timer = setInterval(() => {
      if (autoFilled || ++n > 20) return clearInterval(timer)
      if (passwordFields().length) tryAutoFill()
    }, 500)
  })
}
