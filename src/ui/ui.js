// Giao diện thanh trên của trình duyệt.
const $ = (sel) => document.querySelector(sel)
const I = window.ICONS
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

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
      el.innerHTML = '<span class="tab-icon"></span><span class="tab-title"></span><button class="tab-audio hidden"></button><button class="tab-close" title="Đóng tab (Ctrl+W)"></button>'
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
  site.classList.toggle('secure', !!t?.secure)
  site.innerHTML = !t || !t.url ? I.search : t.secure ? I.lock : I.info
  site.title = t?.secure ? 'Kết nối an toàn (HTTPS)' : t?.url ? 'Kết nối không được mã hoá' : ''
  const star = $('#btn-star')
  star.classList.toggle('on', !!state.bookmarked)
  star.innerHTML = state.bookmarked ? I.starFilled : I.star
  star.classList.toggle('hidden', !t?.url)
  $('#btn-translate').classList.toggle('hidden', !t?.url || !/^https?:/.test(t.url))
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
  if (state.activeId != null && actions.getAttribute('tab') !== String(state.activeId)) actions.setAttribute('tab', String(state.activeId))
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

function showOverlay(panel) {
  if (openPanel && openPanel !== panel) openPanel.classList.add('hidden')
  openPanel = panel
  panel.classList.remove('hidden')
  backdrop.classList.remove('hidden')
  ui.send('overlay', { on: true })
}

function hideOverlay() {
  if (!openPanel) return
  openPanel.classList.add('hidden')
  openPanel = null
  backdrop.classList.add('hidden')
  ui.send('overlay', { on: false })
}

backdrop.addEventListener('mousedown', () => {
  hideOverlay()
  if (editing) address.blur()
})
window.addEventListener('blur', () => {
  if (openPanel && openPanel !== $('#suggestions')) hideOverlay()
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
  let html = `<div class="panel-head">Tải video / nhạc <small>${items.length} tệp tìm thấy</small></div><div class="panel-body">`
  if (res.ytdlp || items.some((m) => m.stream)) {
    html += `<div class="ytdlp-box">
      <div class="row">${quality}${res.ytdlp ? '<button class="btn" id="yt-go">Tải video trang này</button>' : ''}</div>
      <div class="panel-note" style="padding:6px 2px 0">${res.ytdlp ? 'Hỗ trợ YouTube, Facebook, TikTok, Instagram, X… ' : ''}Luồng HLS/DASH (JW Player…) được ghép thành MP4. ${res.hasYtdlp && res.hasFfmpeg ? '' : 'Lần đầu sẽ tự tải công cụ yt-dlp / ffmpeg.'}</div>
    </div>`
  }
  const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : '')
  for (const [i, m] of items.entries()) {
    let name = m.url
    try {
      const u = new URL(m.url)
      name = decodeURIComponent(u.pathname.split('/').pop() || u.hostname)
    } catch {}
    if (m.title && m.stream) name = m.title
    const det = [
      m.player || '',
      m.label || '',
      m.stream === 'hls' ? 'Luồng HLS (m3u8)' : m.stream === 'dash' ? 'Luồng DASH (mpd)' : '',
      m.width && m.height ? `${m.width}×${m.height}` : '',
      m.duration ? `${Math.floor(m.duration / 60)}:${String(m.duration % 60).padStart(2, '0')}` : '',
      fmtSize(m.size),
    ].filter(Boolean).join(' · ')
    html += `<div class="media-item"><span class="ico">${m.type === 'audio' ? I.audio : I.video}</span>
      <div class="meta"><div class="name" title="${esc(m.url)}">${esc(name)}</div><div class="det">${esc(det || (m.type === 'audio' ? 'Âm thanh' : 'Video'))}</div></div>
      <button class="btn ghost" data-i="${i}">Tải</button></div>`
  }
  if (!items.length && !res.ytdlp) html += '<div class="panel-note">Không tìm thấy video hoặc âm thanh trên trang này. Hãy bấm phát video vài giây rồi mở lại bảng này.</div>'
  else if (!items.length) html += '<div class="panel-note">Chưa bắt được link video. Nếu tải bằng nút trên không được, hãy bấm phát video vài giây rồi mở lại bảng này.</div>'
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
        <div class="name" title="${esc(d.filename)}">${esc(d.filename)}</div><div class="det">${esc(stateText(d))}</div>
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
  document.body.classList.toggle('dark', !!s.dark)
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
})
