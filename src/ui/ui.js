// Giao diện thanh trên của trình duyệt.
const $ = (sel) => document.querySelector(sel)
const I = window.ICONS
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// Cửa sổ ẩn danh được mở với ?incognito=1.
const INCOGNITO = new URLSearchParams(location.search).has('incognito')
if (INCOGNITO) {
  document.body.classList.add('incognito', 'dark')
  const badge = document.getElementById('incognito-badge')
  badge.classList.remove('hidden')
  badge.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11h18"/><path d="M5 11l2-6h10l2 6"/><circle cx="7" cy="16" r="3"/><circle cx="17" cy="16" r="3"/><path d="M10 16h4"/></svg><span>Ẩn danh</span>'
} else {
  // Nút của extension chỉ có ở cửa sổ thường (extension không chạy trong phiên ẩn danh).
  const list = document.createElement('browser-action-list')
  list.id = 'actions'
  list.setAttribute('alignment', 'bottom left')
  document.getElementById('actions-slot').replaceWith(list)
}

let state = { tabs: [], activeId: null, bookmarks: [], downloads: { active: 0, recent: [] } }
const tabEls = new Map()

// ---------- Biểu tượng tĩnh ----------
$('#new-tab').innerHTML = I.plus
$('#btn-back').innerHTML = I.back
$('#btn-forward').innerHTML = I.forward
$('#btn-reload').innerHTML = I.reload
$('#btn-home').innerHTML = I.home
$('#btn-star').innerHTML = I.star
$('#btn-media').innerHTML = `${I.download}<span>Tải video</span>`
$('#btn-translate').innerHTML = I.translate
$('#btn-extensions').innerHTML = I.puzzle
$('#btn-menu').innerHTML = I.menu
$('#find-prev').innerHTML = I.up
$('#find-next').innerHTML = I.down
$('#find-close').innerHTML = I.closeBig

const active = () => state.tabs.find((t) => t.id === state.activeId)

// ---------- Chiều cao thanh giao diện ----------
const chrome = $('#chrome')
new ResizeObserver(() => ui.send('ui-height', { height: chrome.offsetHeight })).observe(chrome)

// ---------- Thanh tab ----------
function faviconHtml(t) {
  if (t.crashed) return I.crash
  if (t.loading) return '<div class="spinner"></div>'
  if (t.favicon) return `<img src="${esc(t.favicon)}" alt="" draggable="false">`
  return I.globe
}

function renderTabs() {
  const box = $('#tabs')
  const ids = new Set(state.tabs.map((t) => t.id))
  for (const [id, el] of tabEls) {
    if (!ids.has(id)) {
      el.remove()
      tabEls.delete(id)
    }
  }
  state.tabs.forEach((t, i) => {
    let el = tabEls.get(t.id)
    if (!el) {
      el = document.createElement('div')
      el.className = 'tab'
      el.draggable = true
      el.dataset.id = t.id
      el.innerHTML = '<span class="tab-icon"></span><span class="tab-title"></span><button class="tab-audio hidden"></button><button class="tab-close" title="Đóng tab (Ctrl+W)"></button><span class="ear"></span>'
      el.querySelector('.tab-close').innerHTML = I.close
      bindTab(el)
      tabEls.set(t.id, el)
    }
    if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null)
    el.classList.toggle('active', t.id === state.activeId)
    el.classList.toggle('pinned', t.pinned)
    el.title = t.title + (t.url ? `\n${t.url}` : '')
    const iconKey = `${t.crashed}|${t.loading}|${t.favicon}`
    const icon = el.querySelector('.tab-icon')
    if (icon.dataset.key !== iconKey) {
      icon.dataset.key = iconKey
      icon.innerHTML = faviconHtml(t)
      const img = icon.querySelector('img')
      if (img) img.onerror = () => (icon.innerHTML = I.globe)
    }
    el.querySelector('.tab-title').textContent = t.title
    const audio = el.querySelector('.tab-audio')
    audio.classList.toggle('hidden', !(t.audible || t.muted))
    audio.innerHTML = t.muted ? I.muted : I.speaker
    audio.title = t.muted ? 'Bật tiếng tab' : 'Tắt tiếng tab'
  })
  requestAnimationFrame(() => {
    for (const el of tabEls.values()) el.classList.toggle('narrow', el.offsetWidth < 72)
  })
}

let dragId = null
function bindTab(el) {
  const id = () => Number(el.dataset.id)
  el.addEventListener('mousedown', (e) => {
    if (e.button === 0 && !e.target.closest('button')) ui.send('select-tab', { tabId: id() })
  })
  el.addEventListener('auxclick', (e) => {
    if (e.button === 1) ui.send('close-tab', { tabId: id() })
  })
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    ui.send('tab-menu', { tabId: id() })
  })
  el.querySelector('.tab-close').addEventListener('click', (e) => {
    e.stopPropagation()
    ui.send('close-tab', { tabId: id() })
  })
  el.querySelector('.tab-audio').addEventListener('click', (e) => {
    e.stopPropagation()
    ui.send('mute-tab', { tabId: id() })
  })
  el.addEventListener('dragstart', (e) => {
    dragId = id()
    el.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
  })
  el.addEventListener('dragend', () => {
    dragId = null
    el.classList.remove('dragging')
    document.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before'))
  })
  el.addEventListener('dragover', (e) => {
    if (dragId == null) return
    e.preventDefault()
    document.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before'))
    el.classList.add('drop-before')
  })
  el.addEventListener('drop', (e) => {
    e.preventDefault()
    if (dragId == null || dragId === id()) return
    const target = state.tabs.findIndex((t) => t.id === id())
    const from = state.tabs.findIndex((t) => t.id === dragId)
    ui.send('move-tab', { tabId: dragId, index: from < target ? target - 1 : target })
  })
}

$('#new-tab').addEventListener('click', () => ui.send('new-tab'))
$('#tabs').addEventListener('dblclick', (e) => {
  if (!e.target.closest('.tab')) ui.send('new-tab')
})

// ---------- Thanh công cụ ----------
const address = $('#address')
const omnibox = $('#omnibox')
let editing = false

function renderToolbar() {
  const t = active()
  $('#btn-back').disabled = !t?.canGoBack
  $('#btn-forward').disabled = !t?.canGoForward
  const reload = $('#btn-reload')
  reload.innerHTML = t?.loading ? I.stop : I.reload
  reload.title = t?.loading ? 'Dừng tải (Esc)' : 'Tải lại (F5)'
  if (!editing) address.value = t?.url || ''
  const site = $('#site-icon')
  const req = state.permRequest
  site.classList.toggle('secure', !!t?.secure && !req)
  site.classList.toggle('alert', !!req)
  site.innerHTML = req ? I[req.icon] || I.tune : !t || !t.url ? I.search : t.secure ? I.lock : I.info
  site.title = t?.url && /^https?:/.test(t.url) ? 'Thông tin trang và quyền (vị trí, camera, thông báo…)' : ''
  renderPermChip(req)
  const star = $('#btn-star')
  star.classList.toggle('on', !!state.bookmarked)
  star.innerHTML = state.bookmarked ? I.starFilled : I.star
  star.classList.toggle('hidden', !t?.url)
  const tr = $('#btn-translate')
  tr.classList.toggle('hidden', !t?.url || !/^https?:/.test(t.url))
  tr.classList.toggle('on', !!t?.translated)
  tr.classList.toggle('busy', !!t?.translating)
  tr.title = t?.translated ? 'Đang xem bản dịch — bấm để xem bản gốc' : 'Dịch trang sang Tiếng Việt (đang bôi đen thì dịch đoạn đó)'
  const media = t?.media || {}
  $('#btn-media').classList.toggle('hidden', !(media.count > 0 || media.ytdlp))
  const zoom = $('#btn-zoom')
  zoom.classList.toggle('hidden', !t || t.zoom === 100)
  zoom.textContent = `${t?.zoom}%`

  const ad = $('#btn-adblock')
  ad.classList.toggle('on', !!state.adblock)
  ad.innerHTML = (state.adblock ? I.shield : I.shieldOff) + (state.adblock && state.blockedCount ? `<span class="badge">${state.blockedCount > 999 ? '999+' : state.blockedCount}</span>` : '')
  ad.title = state.adblock ? `Chặn quảng cáo: BẬT — đã chặn ${state.blockedCount || 0} yêu cầu.\nBấm để tắt.` : 'Chặn quảng cáo: TẮT. Bấm để bật.'

  const dl = $('#btn-downloads')
  const d = state.downloads || {}
  dl.classList.toggle('hidden', !(d.recent && d.recent.length))
  let ring = ''
  if (d.active > 0) {
    const pct = Math.max(0, Math.min(100, d.percent || 0))
    const c = 2 * Math.PI * 12
    ring = `<svg class="ring" viewBox="0 0 28 28"><circle cx="14" cy="14" r="12" fill="none" stroke="var(--accent-soft)" stroke-width="2.5"/><circle cx="14" cy="14" r="12" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}" transform="rotate(-90 14 14)" stroke-linecap="round"/></svg>`
  }
  dl.innerHTML = I.download + ring
  dl.title = d.active ? `Đang tải ${d.active} mục...` : 'Tải xuống (Ctrl+J)'

  const actions = $('#actions')
  if (actions && state.activeId != null && actions.getAttribute('tab') !== String(state.activeId)) actions.setAttribute('tab', String(state.activeId))
}

$('#btn-back').addEventListener('click', () => ui.send('back'))
$('#btn-forward').addEventListener('click', () => ui.send('forward'))
$('#btn-reload').addEventListener('click', (e) => (active()?.loading ? ui.send('stop') : ui.send('reload', { hard: e.shiftKey || e.ctrlKey })))
$('#btn-home').addEventListener('click', () => ui.send('home'))
$('#btn-star').addEventListener('click', () => ui.send('toggle-bookmark'))
$('#btn-translate').addEventListener('click', () => ui.send('translate-page'))
$('#btn-zoom').addEventListener('click', () => ui.send('zoom', { dir: 0 }))
$('#btn-extensions').addEventListener('click', () => ui.send('open-internal', { page: 'extensions' }))
$('#btn-adblock').addEventListener('click', () => ui.send('toggle-adblock'))
$('#btn-menu').addEventListener('click', () => {
  const r = $('#btn-menu').getBoundingClientRect()
  ui.send('app-menu', { x: r.right - 260, y: r.bottom + 2 })
})
$('#btn-downloads').addEventListener('click', () => openDownloadsPanel())
$('#btn-media').addEventListener('click', () => openMediaPanel())

// ---------- Lớp phủ ----------
const backdrop = $('#backdrop')
let openPanel = null

function showOverlay(panel, { dim = false } = {}) {
  if (openPanel && openPanel !== panel) closePanel(openPanel)
  openPanel = panel
  panel.classList.remove('hidden')
  backdrop.classList.remove('hidden')
  backdrop.classList.toggle('dim', dim)
  ui.send('overlay', { on: true })
}

// Đóng một bảng; hộp thoại bị đóng ngang coi như bấm Huỷ.
function closePanel(panel) {
  panel.classList.add('hidden')
  if (panel === dialogEl && dialogEl.dataset.id) {
    ui.send('dialog-result', { id: dialogEl.dataset.id, button: null })
    dialogEl.dataset.id = ''
    setTimeout(showNextDialog, 0)
  }
}

function hideOverlay() {
  if (!openPanel) return
  const panel = openPanel
  openPanel = null
  closePanel(panel)
  if (openPanel) return // closePanel đã mở hộp thoại kế tiếp
  backdrop.classList.add('hidden')
  backdrop.classList.remove('dim')
  ui.send('overlay', { on: false })
}

backdrop.addEventListener('mousedown', () => {
  // Hộp thoại phải bấm nút mới đóng.
  if (openPanel === dialogEl) return
  hideOverlay()
  if (editing) address.blur()
})
window.addEventListener('blur', () => {
  // Hộp thoại và hỏi lưu mật khẩu giữ nguyên khi chuyển sang cửa sổ khác.
  if (openPanel && !['suggestions', 'dialog', 'password-panel'].includes(openPanel.id)) hideOverlay()
})

function placeUnder(panel, anchor, width, alignRight = false) {
  const r = anchor.getBoundingClientRect()
  panel.style.width = `${width}px`
  panel.style.top = `${r.bottom + 6}px`
  const left = alignRight ? r.right - width : r.left
  panel.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`
}

// ---------- Thanh địa chỉ & gợi ý ----------
const sugBox = $('#suggestions')
let suggestions = []
let selIndex = -1
let typed = ''
let sugSeq = 0

address.addEventListener('focus', () => {
  editing = true
  omnibox.classList.add('focused')
  setTimeout(() => address.select(), 0)
})
address.addEventListener('blur', () => {
  editing = false
  omnibox.classList.remove('focused')
  setTimeout(() => {
    if (!editing && openPanel === sugBox) hideOverlay()
    renderToolbar()
  }, 120)
})
address.addEventListener('input', () => {
  editing = true
  typed = address.value
  selIndex = -1
  fetchSuggestions(typed)
})
address.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const value = selIndex >= 0 ? suggestionValue(suggestions[selIndex]) : address.value
    go(value, e.altKey)
    e.preventDefault()
  } else if (e.key === 'Escape') {
    if (openPanel === sugBox) hideOverlay()
    address.value = active()?.url || ''
    ui.send('focus-page')
    e.preventDefault()
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!suggestions.length) return
    e.preventDefault()
    selIndex = (selIndex + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length + 1) % (suggestions.length + 1)
    if (selIndex === suggestions.length) selIndex = -1
    address.value = selIndex >= 0 ? suggestionValue(suggestions[selIndex]) : typed
    renderSuggestions()
  }
})

function suggestionValue(s) {
  return s.type === 'search' ? s.text : s.url
}

function go(value, newTab = false) {
  if (!value.trim()) return
  hideOverlay()
  editing = false
  address.blur()
  ui.send('navigate', { input: value, newTab })
}

async function fetchSuggestions(q) {
  const seq = ++sugSeq
  if (!q.trim()) {
    suggestions = []
    hideOverlay()
    return
  }
  const list = await ui.invoke('suggest', { q })
  if (seq !== sugSeq || !editing) return
  suggestions = list || []
  renderSuggestions()
}

function renderSuggestions() {
  if (!suggestions.length) {
    if (openPanel === sugBox) hideOverlay()
    return
  }
  sugBox.innerHTML = suggestions
    .map((s, i) => {
      const cls = `sug${i === selIndex ? ' sel' : ''}`
      if (s.type === 'search') return `<div class="${cls}" data-i="${i}"><span class="ico">${I.search}</span><span class="main">${esc(s.text)}</span></div>`
      const icon = s.favicon ? `<img src="${esc(s.favicon)}" alt="">` : s.type === 'bookmark' ? I.star : I.history
      return `<div class="${cls}" data-i="${i}"><span class="ico">${icon}</span><span class="main">${esc(s.title || s.url)}</span><span class="sub">${esc(s.url)}</span></div>`
    })
    .join('')
  const r = omnibox.getBoundingClientRect()
  sugBox.style.left = `${r.left}px`
  sugBox.style.top = `${r.bottom + 4}px`
  sugBox.style.width = `${r.width}px`
  if (openPanel !== sugBox) showOverlay(sugBox)
}

sugBox.addEventListener('mousedown', (e) => {
  const row = e.target.closest('.sug')
  if (!row) return
  e.preventDefault()
  go(suggestionValue(suggestions[Number(row.dataset.i)]), e.button === 1 || e.ctrlKey)
})

// ---------- Bảng tải video (giống Cốc Cốc Savior) ----------
const mediaPanel = $('#media-panel')

async function openMediaPanel() {
  mediaPanel.innerHTML = '<div class="panel-head">Đang tìm video trên trang…</div>'
  const anchor = $('#btn-media').classList.contains('hidden') ? omnibox : $('#btn-media')
  placeUnder(mediaPanel, anchor, 420, true)
  showOverlay(mediaPanel)
  const res = await ui.invoke('scan-media')
  if (openPanel !== mediaPanel) return
  const items = res.items || []
  const quality = `<select id="yt-quality" title="Chất lượng khi tải luồng (HLS/DASH) hoặc tải qua yt-dlp">
      <option value="best">Chất lượng cao nhất</option>
      <option value="1080">1080p</option>
      <option value="720">720p</option>
      <option value="480">480p</option>
      <option value="audio">Chỉ âm thanh (MP3)</option>
    </select>`
  const nVideo = items.filter((m) => m.type !== 'audio').length
  const nAudio = items.length - nVideo
  const found = [nVideo ? `${nVideo} video` : '', nAudio ? `${nAudio} nhạc` : ''].filter(Boolean).join(' · ')
  let html = `<div class="panel-head">Tải video / nhạc <small>${found}</small></div><div class="panel-body">`
  if (res.ytdlp || items.some((m) => m.stream)) {
    html += `<div class="ytdlp-box">
      <div class="row">${quality}${res.ytdlp ? '<button class="btn" id="yt-go">Tải video trang này</button>' : ''}</div>
      ${!items.length && res.streaming ? '<div class="panel-note" style="padding:6px 2px 0">Trang đang phát video dạng luồng nhưng giấu link — bấm <b>Tải video trang này</b>.</div>' : ''}
    </div>`
  }
  const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : '')
  for (const [i, m] of items.entries()) {
    let name = m.url
    try {
      const u = new URL(m.url)
      name = decodeURIComponent(u.pathname.split('/').pop() || u.hostname)
    } catch {}
    if (m.stream) name = m.title || res.title || name
    const det = [
      m.player || '',
      m.label || '',
      m.stream ? 'Video đầy đủ (ghép thành MP4)' : '',
      m.width && m.height ? `${m.width}×${m.height}` : '',
      m.duration ? `${Math.floor(m.duration / 60)}:${String(m.duration % 60).padStart(2, '0')}` : '',
      fmtSize(m.size),
    ].filter(Boolean).join(' · ')
    html += `<div class="media-item"><span class="ico">${m.type === 'audio' ? I.audio : I.video}</span>
      <div class="meta"><div class="name" title="${esc(m.url)}">${esc(name)}</div><div class="det">${esc(det || (m.type === 'audio' ? 'Âm thanh' : 'Video'))}</div></div>
      <button class="btn ghost" data-i="${i}">Tải</button></div>`
  }
  if (!items.length && !res.ytdlp) html += '<div class="panel-note">Chưa thấy video. Bấm phát video vài giây rồi mở lại bảng này.</div>'
  html += '</div>'
  mediaPanel.innerHTML = html
  const chosenQuality = () => mediaPanel.querySelector('#yt-quality')?.value || 'best'
  mediaPanel.querySelector('#yt-go')?.addEventListener('click', () => {
    ui.send('download-media', { quality: chosenQuality() })
    hideOverlay()
  })
  mediaPanel.querySelectorAll('.media-item .btn').forEach((b) =>
    b.addEventListener('click', () => {
      ui.send('download-media', { index: Number(b.dataset.i), quality: chosenQuality() })
      hideOverlay()
    })
  )
}

// ---------- Hỏi lưu mật khẩu ----------
const pwPanel = $('#password-panel')

ui.on('password-prompt', (p) => {
  let host = p.origin
  try {
    host = new URL(p.origin).hostname
  } catch {}
  pwPanel.innerHTML = `<div class="panel-head">${p.update ? 'Cập nhật mật khẩu?' : 'Lưu mật khẩu?'} <small>${esc(host)}</small></div>
    <div class="pw-body">
      <label>Tên đăng nhập<input id="pw-user" type="text" spellcheck="false" value="${esc(p.username)}" placeholder="(không có)"></label>
      <label>Mật khẩu<input type="password" value="••••••••••" disabled></label>
      <div class="panel-note" style="padding:2px 0 0">🔒 Mật khẩu được mã hoá bằng tài khoản Windows và chỉ lưu trên máy này.</div>
    </div>
    <div class="panel-foot">
      ${p.update ? '' : '<button class="btn ghost" data-a="never">Không bao giờ</button>'}
      <button class="btn ghost" data-a="dismiss">Bỏ qua</button>
      <button class="btn" data-a="save">${p.update ? 'Cập nhật' : 'Lưu'}</button>
    </div>`
  placeUnder(pwPanel, omnibox, 340, true)
  showOverlay(pwPanel)
  pwPanel.querySelectorAll('[data-a]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.send('password-save', { action: b.dataset.a, username: pwPanel.querySelector('#pw-user').value })
      hideOverlay()
    })
  )
})

// ---------- Hỏi quyền trên thanh địa chỉ ----------
function renderPermChip(req) {
  const chip = $('#perm-chip')
  if (!req) {
    chip.classList.add('hidden')
    chip.dataset.id = ''
    return
  }
  if (chip.dataset.id === req.id) return
  chip.dataset.id = req.id
  chip.innerHTML = `<span class="txt" title="${esc(req.host)} muốn ${esc(req.text)}">${esc(req.host)} muốn ${esc(req.text)}</span>
    <button class="allow">Cho phép</button><button class="block">Chặn</button><button class="x" title="Để sau">${I.close}</button>`
  chip.classList.remove('hidden')
  chip.querySelector('.allow').onclick = () => ui.send('permission-answer', { id: req.id, decision: 'allow' })
  chip.querySelector('.block').onclick = () => ui.send('permission-answer', { id: req.id, decision: 'block' })
  chip.querySelector('.x').onclick = () => ui.send('permission-answer', { id: req.id, decision: 'dismiss' })
}

// ---------- Thông tin trang & quyền ----------
const sitePanel = $('#site-panel')
const PERM_CHOICES = [['default', 'Mặc định'], ['ask', 'Hỏi'], ['allow', 'Cho phép'], ['block', 'Chặn']]
const CHOICE_LABEL = { ask: 'Hỏi', allow: 'Cho phép', block: 'Chặn' }

$('#site-icon').addEventListener('click', async () => {
  const info = await ui.invoke('site-info')
  if (!info) return
  sitePanel.innerHTML = `<div class="site-head"><div class="big ${info.secure ? 'secure' : ''}">${info.secure ? I.lock : I.info}</div>
      <div><div class="host">${esc(info.host)}</div><div class="sub">${info.secure ? 'Kết nối an toàn (HTTPS)' : 'Kết nối không được mã hoá — đừng nhập mật khẩu'}</div></div></div>
    <div class="site-facts"><span>${I.cookie} ${info.cookies} cookie</span>${info.passwords ? `<span>${I.key} ${info.passwords} mật khẩu đã lưu</span>` : ''}</div>
    <div class="panel-body">${info.perms
      .map((p) => `<div class="perm-row ${p.value !== 'default' ? 'custom' : ''}"><span class="pi">${I[p.icon] || I.tune}</span><span class="pl">${esc(p.label)}</span>
        <select data-key="${p.key}">${PERM_CHOICES.map(([v, l]) => `<option value="${v}" ${p.value === v ? 'selected' : ''}>${v === 'default' ? `${l} (${CHOICE_LABEL[p.fallback]})` : l}</option>`).join('')}</select></div>`)
      .join('')}</div>
    <div class="panel-foot"><button class="btn text" id="site-settings">Cài đặt quyền…</button><button class="btn ghost" id="site-reset">Đặt lại quyền</button></div>`
  sitePanel.querySelectorAll('select').forEach((sel) =>
    sel.addEventListener('change', () => {
      ui.send('site-permission', { origin: info.origin, key: sel.dataset.key, value: sel.value })
      sel.closest('.perm-row').classList.toggle('custom', sel.value !== 'default')
    })
  )
  sitePanel.querySelector('#site-reset').onclick = () => {
    ui.send('site-reset', { origin: info.origin })
    hideOverlay()
  }
  sitePanel.querySelector('#site-settings').onclick = () => {
    hideOverlay()
    ui.send('open-internal', { page: 'settings' })
  }
  const r = $('#site-icon').getBoundingClientRect()
  sitePanel.style.width = '340px'
  sitePanel.style.left = `${Math.max(8, r.left - 6)}px`
  sitePanel.style.top = `${r.bottom + 8}px`
  sitePanel.style.transformOrigin = 'top left'
  showOverlay(sitePanel)
})

// ---------- Hộp thoại (thay cho hộp thoại Windows) ----------
const dialogEl = $('#dialog')
const dialogQueue = []

ui.on('dialog', (d) => {
  dialogQueue.push(d)
  if (!dialogEl.dataset.id) showNextDialog()
})

function showNextDialog() {
  const d = dialogQueue.shift()
  if (!d) return
  dialogEl.dataset.id = d.id
  const icon = !d.icon ? I.infoBig : d.icon.startsWith('data:') ? `<img src="${esc(d.icon)}" alt="">` : I[d.icon === 'info' ? 'infoBig' : d.icon] || I.infoBig
  dialogEl.innerHTML = `<div class="d-top"><div class="d-icon ${esc(d.icon || '')}">${icon}</div><div style="min-width:0">
      <div class="d-title">${esc(d.title || '')}</div><div class="d-msg">${esc(d.message || '')}</div>
      ${d.list?.length ? `<ul>${d.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div></div>
    <div class="d-buttons">${(d.buttons || [{ id: 'ok', label: 'OK', primary: true }])
      .map((b) => `<button class="btn ${b.primary ? '' : b.danger ? 'danger' : 'text'}" data-b="${esc(b.id)}">${esc(b.label)}</button>`)
      .join('')}</div>`
  dialogEl.querySelectorAll('[data-b]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = dialogEl.dataset.id
      dialogEl.dataset.id = ''
      ui.send('dialog-result', { id, button: btn.dataset.b })
      hideOverlay()
      showNextDialog()
    })
  )
  showOverlay(dialogEl, { dim: true })
  dialogEl.querySelector('.btn:not(.text)')?.focus()
}

// ---------- Bảng tải xuống ----------
const dlPanel = $('#downloads-panel')

function renderDownloadsPanel() {
  const list = state.downloads?.recent || []
  const stateText = (d) => {
    if (d.state === 'progressing') return `${Math.round(d.percent || 0)}%${d.speed ? ` · ${d.speed}` : ''}${d.sizeText ? ` · ${d.sizeText}` : ''}`
    if (d.state === 'completed') return 'Đã xong — bấm để mở'
    if (d.state === 'cancelled') return 'Đã huỷ'
    return `Lỗi${d.error ? `: ${d.error}` : ''}`
  }
  dlPanel.innerHTML = `<div class="panel-head">Tải xuống gần đây</div><div class="panel-body">${list
    .map(
      (d) => `<div class="dl-item" data-id="${esc(d.id)}"><span class="ico">${I.file}</span><div class="meta">
        <div class="name" title="${esc(d.filename)}">${esc(d.filename)}</div><div class="det${d.state === 'interrupted' ? ' err' : ''}" title="${esc(d.error || '')}">${esc(stateText(d))}</div>
        ${d.state === 'progressing' ? `<div class="bar"><i style="width:${d.percent || 0}%"></i></div>` : ''}</div>
        <button class="icon-btn" data-show="${esc(d.id)}" title="Mở thư mục chứa">${I.folder}</button></div>`
    )
    .join('')}</div><div class="panel-foot"><button class="btn ghost" id="dl-all">Xem tất cả</button></div>`
  dlPanel.querySelectorAll('.dl-item').forEach((row) =>
    row.addEventListener('click', (e) => {
      const show = e.target.closest('[data-show]')
      if (show) ui.send('show-download', { id: show.dataset.show })
      else ui.send('open-download', { id: row.dataset.id })
    })
  )
  dlPanel.querySelector('#dl-all').addEventListener('click', () => {
    hideOverlay()
    ui.send('open-downloads')
  })
}

function openDownloadsPanel() {
  renderDownloadsPanel()
  placeUnder(dlPanel, $('#btn-downloads'), 360, true)
  showOverlay(dlPanel)
}

// ---------- Thanh dấu trang ----------
function renderBookmarks() {
  const bar = $('#bookmarks-bar')
  const show = !!state.showBookmarksBar
  bar.classList.toggle('hidden', !show)
  chrome.classList.toggle('has-bookmarks', show)
  if (!show) return
  const key = JSON.stringify(state.bookmarks.map((b) => [b.id, b.title, b.favicon]))
  if (bar.dataset.key === key) return
  bar.dataset.key = key
  if (!state.bookmarks.length) {
    bar.innerHTML = '<span class="empty">Nhấn ☆ trên thanh địa chỉ (Ctrl+D) để thêm dấu trang vào đây.</span>'
    return
  }
  bar.innerHTML = state.bookmarks
    .map((b) => `<button class="bm" data-id="${esc(b.id)}" title="${esc(b.title)}\n${esc(b.url)}">${b.favicon ? `<img src="${esc(b.favicon)}" alt="">` : `<span class="fallback">${I.globe}</span>`}<span>${esc(b.title)}</span></button>`)
    .join('')
  bar.querySelectorAll('img').forEach((img) => (img.onerror = () => img.replaceWith(Object.assign(document.createElement('span'), { className: 'fallback', innerHTML: I.globe }))))
}

$('#bookmarks-bar').addEventListener('click', (e) => {
  const btn = e.target.closest('.bm')
  if (!btn) return
  const b = state.bookmarks.find((x) => x.id === btn.dataset.id)
  if (b) ui.send('open-bookmark', { url: b.url, newTab: e.ctrlKey })
})
$('#bookmarks-bar').addEventListener('auxclick', (e) => {
  const btn = e.target.closest('.bm')
  if (!btn || e.button !== 1) return
  const b = state.bookmarks.find((x) => x.id === btn.dataset.id)
  if (b) ui.send('open-bookmark', { url: b.url, newTab: true })
})
$('#bookmarks-bar').addEventListener('contextmenu', (e) => {
  const btn = e.target.closest('.bm')
  if (!btn) return
  e.preventDefault()
  ui.send('bookmark-menu', { id: btn.dataset.id })
})

// ---------- Tìm trong trang ----------
const findbar = $('#findbar')
const findInput = $('#find-input')

function openFind() {
  findbar.classList.remove('hidden')
  findInput.focus()
  findInput.select()
  if (findInput.value) ui.send('find', { text: findInput.value })
}
function closeFind() {
  findbar.classList.add('hidden')
  $('#find-count').textContent = ''
  ui.send('find', { text: '' })
  ui.send('focus-page')
}
findInput.addEventListener('input', () => ui.send('find', { text: findInput.value }))
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') ui.send('find', { text: findInput.value, next: true, forward: !e.shiftKey })
  if (e.key === 'Escape') closeFind()
})
$('#find-next').addEventListener('click', () => ui.send('find', { text: findInput.value, next: true }))
$('#find-prev').addEventListener('click', () => ui.send('find', { text: findInput.value, next: true, forward: false }))
$('#find-close').addEventListener('click', closeFind)

ui.on('find-open', openFind)
ui.on('find-result', (r) => {
  if (!r.finalUpdate) return
  $('#find-count').textContent = findInput.value ? `${r.matches ? r.activeMatchOrdinal : 0}/${r.matches}` : ''
  findInput.classList.toggle('notfound', !!findInput.value && r.matches === 0)
})

// ---------- Nhận trạng thái từ tiến trình chính ----------
let lastActiveId = null
ui.on('state', (s) => {
  state = s
  document.body.classList.toggle('dark', !!s.dark || INCOGNITO)
  if (s.activeId !== lastActiveId) {
    lastActiveId = s.activeId
    if (!findbar.classList.contains('hidden')) closeFind()
  }
  renderTabs()
  renderToolbar()
  renderBookmarks()
  if (openPanel === dlPanel) renderDownloadsPanel()
})

ui.on('focus-address', (prefix) => {
  address.focus()
  if (prefix) {
    address.value = ''
    typed = ''
  }
  address.select()
})
ui.on('open-media', () => openMediaPanel())

// Phím Esc trong UI đóng bảng đang mở.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openPanel && openPanel !== sugBox) hideOverlay()
  if (e.key === 'Enter' && openPanel === dialogEl) dialogEl.querySelector('.btn:not(.text)')?.click()
})
