// Tiện ích dùng chung cho các trang nội bộ metal://
const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const api = (name, ...args) => window.metal.invoke(name, ...args)

function toast(msg, ms = 2600) {
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = msg
  document.body.appendChild(el)
  setTimeout(() => el.remove(), ms)
}

// Hộp thoại cùng kiểu với trình duyệt, thay cho confirm()/prompt() mặc định.
// ask('Xoá?', { ok: 'Xoá', danger: true }) -> Promise<boolean>
// ask('Tên mới', { input: 'giá trị cũ' })  -> Promise<string|null>
function ask(title, { message = '', ok = 'OK', cancel = 'Huỷ', danger = false, input = null } = {}) {
  return new Promise((resolve) => {
    const back = document.createElement('div')
    back.className = 'm-backdrop'
    back.innerHTML = `<div class="m-box" role="dialog"><div class="m-title"></div><div class="m-msg"></div>
      ${input != null ? '<input type="text">' : ''}
      <div class="m-buttons"><button class="btn" data-r="0"></button><button class="btn ${danger ? 'danger solid' : 'primary'}" data-r="1"></button></div></div>`
    back.querySelector('.m-title').textContent = title
    back.querySelector('.m-msg').textContent = message
    back.querySelector('[data-r="0"]').textContent = cancel
    back.querySelector('[data-r="1"]').textContent = ok
    const field = back.querySelector('input')
    if (field) field.value = input
    const done = (yes) => {
      back.remove()
      document.removeEventListener('keydown', onKey, true)
      resolve(input != null ? (yes ? field.value : null) : yes)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') done(false)
      if (e.key === 'Enter') done(true)
    }
    back.addEventListener('click', (e) => {
      if (e.target === back) done(false)
      const b = e.target.closest('[data-r]')
      if (b) done(b.dataset.r === '1')
    })
    document.addEventListener('keydown', onKey, true)
    document.body.appendChild(back)
    ;(field || back.querySelector('[data-r="1"]')).focus()
    field?.select()
  })
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`
}

function faviconFor(url, fav) {
  if (fav) return fav
  try {
    return `https://www.google.com/s2/favicons?sz=32&domain=${new URL(url).hostname}`
  } catch {
    return ''
  }
}

const NAV = [
  ['settings', 'Cài đặt', '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'],
  ['extensions', 'Tiện ích mở rộng', '<path d="M10 3h4v3a2 2 0 1 0 4 0V3h3v7h-3a2 2 0 1 0 0 4h3v7h-7v-3a2 2 0 1 0-4 0v3H3v-7h3a2 2 0 1 0 0-4H3V3h7z"/>'],
  ['history', 'Lịch sử', '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 3"/>'],
  ['downloads', 'Tải xuống', '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>'],
  ['bookmarks', 'Dấu trang', '<path d="M6 3h12v18l-6-4-6 4z"/>'],
  ['passwords', 'Mật khẩu', '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.5"/>'],
  ['about', 'Giới thiệu', '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'],
]

function renderShell(current) {
  const side = document.querySelector('.side')
  if (!side) return
  side.innerHTML = `<div class="brand"><img src="metal://favicon/" alt="">Metal Browser</div><nav class="nav">${NAV.map(
    ([key, label, icon]) => `<a href="metal://${key}/" class="${key === current ? 'active' : ''}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>${label}</a>`
  ).join('')}</nav>`
}
