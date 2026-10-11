const DEFAULT_TILES = [
  { url: 'https://www.youtube.com/', title: 'YouTube' },
  { url: 'https://www.facebook.com/', title: 'Facebook' },
  { url: 'https://www.google.com/', title: 'Google' },
  { url: 'https://mail.google.com/', title: 'Gmail' },
  { url: 'https://chat.zalo.me/', title: 'Zalo' },
  { url: 'https://shopee.vn/', title: 'Shopee' },
  { url: 'https://vnexpress.net/', title: 'VnExpress' },
  { url: 'https://chromewebstore.google.com/', title: 'Chrome Web Store' },
]
const HIDDEN_KEY = 'metal-hidden-tiles'

let settings = {}

function tick() {
  const now = new Date()
  $('#clock').textContent = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  const date = now.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  $('#date').textContent = date.charAt(0).toUpperCase() + date.slice(1)
}

function hiddenTiles() {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')
  } catch {
    return []
  }
}

async function renderTiles() {
  const hidden = new Set(hiddenTiles())
  const top = (await api('getTopSites', 16)) || []
  const seen = new Set()
  const tiles = []
  for (const t of [...top, ...DEFAULT_TILES]) {
    let host
    try {
      host = new URL(t.url).hostname
    } catch {
      continue
    }
    if (seen.has(host) || hidden.has(host)) continue
    seen.add(host)
    tiles.push({ ...t, host })
    if (tiles.length >= 12) break
  }
  $('#tiles').innerHTML = tiles
    .map(
      (t) => `<a class="tile" href="${esc(t.url)}" title="${esc(t.url)}"><div class="ic"><img src="${esc(faviconFor(t.url))}" alt=""></div><span>${esc(t.title)}</span><button class="x" data-host="${esc(t.host)}" title="Ẩn ô này">✕</button></a>`
    )
    .join('')
}

$('#tiles').addEventListener('click', (e) => {
  const x = e.target.closest('.x')
  if (!x) return
  e.preventDefault()
  const list = hiddenTiles()
  list.push(x.dataset.host)
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(list))
  renderTiles()
})

function toUrl(input) {
  input = input.trim()
  if (/^(https?|file|metal|chrome-extension):/i.test(input)) return input
  if (!/\s/.test(input) && /^[^\s/?#]+\.[a-z¡-￿]{2,}(:\d+)?([/?#].*)?$/i.test(input)) return `https://${input}`
  if (/^localhost(:\d+)?/i.test(input)) return `http://${input}`
  const engine = settings.engines?.[settings.searchEngine] || { url: 'https://www.google.com/search?q=%s' }
  return engine.url.replace('%s', encodeURIComponent(input))
}

$('#search').addEventListener('submit', (e) => {
  e.preventDefault()
  const q = $('#q').value
  if (q.trim()) location.href = toUrl(q)
})

// Hình nền dạng gradient có sẵn (ảnh riêng của người dùng được ưu tiên nếu có).
const THEMES = {
  aurora: { name: 'Cực quang', css: 'radial-gradient(at 15% 20%, #7f7cff 0, transparent 55%), radial-gradient(at 85% 15%, #ff7eb3 0, transparent 50%), radial-gradient(at 70% 85%, #4fd1ff 0, transparent 55%), radial-gradient(at 20% 85%, #a46bff 0, transparent 50%), #5b5bd6' },
  sunset: { name: 'Hoàng hôn', css: 'linear-gradient(135deg, #ff9a56 0%, #ff6a88 50%, #b84fce 100%)' },
  ocean: { name: 'Đại dương', css: 'linear-gradient(135deg, #0f62fe 0%, #1fb6ff 55%, #6dd5ed 100%)' },
  mint: { name: 'Bạc hà', css: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)' },
  peach: { name: 'Đào', css: 'radial-gradient(at 20% 25%, #ffd1dc 0, transparent 50%), radial-gradient(at 80% 20%, #c2e9fb 0, transparent 50%), radial-gradient(at 60% 85%, #ffe29f 0, transparent 55%), #f6c1e9' },
  night: { name: 'Đêm', css: 'radial-gradient(at 20% 15%, #3a2f8f 0, transparent 50%), radial-gradient(at 85% 80%, #0f5b78 0, transparent 55%), #0b1020' },
  fire: { name: 'Lửa', css: 'linear-gradient(135deg, #f12711 0%, #f5af19 100%)' },
  forest: { name: 'Rừng', css: 'linear-gradient(135deg, #134e5e 0%, #2f8f6b 55%, #71b280 100%)' },
  candy: { name: 'Kẹo ngọt', css: 'radial-gradient(at 10% 20%, #ff9ad5 0, transparent 50%), radial-gradient(at 90% 30%, #8ec5ff 0, transparent 50%), radial-gradient(at 50% 90%, #b9a7ff 0, transparent 55%), #f3a8e0' },
  graphite: { name: 'Than chì', css: 'linear-gradient(135deg, #232526 0%, #414345 100%)' },
}

function applyBackground() {
  const img = settings.newtabBackground
  const theme = THEMES[settings.newtabTheme]
  const body = document.body
  body.classList.toggle('has-bg', !!(img || theme))
  body.style.background = img ? `center / cover no-repeat fixed url("${img}")` : theme ? `${theme.css} fixed` : ''
  for (const el of $$('.swatch')) el.classList.toggle('sel', img ? el.dataset.t === 'image' : el.dataset.t === (settings.newtabTheme || 'none'))
}

function renderSwatches() {
  $('#bg-grid').innerHTML =
    Object.entries(THEMES).map(([k, t]) => `<button class="swatch" data-t="${k}" title="${esc(t.name)}" style="background:${t.css}"></button>`).join('') +
    `<button class="swatch none" data-t="none" title="Không dùng hình nền">✕</button>
     <button class="swatch img" data-t="image" title="Ảnh từ máy của bạn…">🖼</button>`
}

$('#bg').addEventListener('click', (e) => {
  e.stopPropagation()
  $('#bg-panel').classList.toggle('hidden')
})
document.addEventListener('click', (e) => {
  if (!e.target.closest('#bg-panel')) $('#bg-panel').classList.add('hidden')
})
$('#bg-grid').addEventListener('click', async (e) => {
  const sw = e.target.closest('.swatch')
  if (!sw) return
  if (sw.dataset.t === 'image') {
    const data = await api('chooseBackground')
    if (data) settings.newtabBackground = data
  } else {
    settings.newtabTheme = sw.dataset.t
    settings.newtabBackground = ''
    await api('setSetting', 'newtabBackground', '')
    await api('setSetting', 'newtabTheme', sw.dataset.t)
  }
  applyBackground()
})

;(async () => {
  tick()
  setInterval(tick, 1000)
  settings = await api('getSettings')
  if (await api('isIncognito')) {
    document.body.classList.add('incognito')
    document.title = 'Tab ẩn danh mới'
    $('#incognito-note').classList.remove('hidden')
    $('#tiles').classList.add('hidden')
    $('.corner').classList.add('hidden')
    settings.newtabBackground = ''
    settings.newtabTheme = 'none'
  }
  const engine = settings.engines?.[settings.searchEngine]
  $('#version').textContent = `Metal Browser v${settings.version}`
  $('#engine').textContent = engine ? `Tìm kiếm bằng ${engine.name}` : ''
  renderSwatches()
  applyBackground()
  renderTiles()
})()
