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

function applyBackground() {
  const bg = settings.newtabBackground
  document.body.classList.toggle('has-bg', !!bg)
  document.body.style.backgroundImage = bg ? `url("${bg}")` : ''
  $('#bg-clear').classList.toggle('hidden', !bg)
}

$('#bg').addEventListener('click', async () => {
  const data = await api('chooseBackground')
  if (data) {
    settings.newtabBackground = data
    applyBackground()
  }
})
$('#bg-clear').addEventListener('click', async () => {
  await api('setSetting', 'newtabBackground', '')
  settings.newtabBackground = ''
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
  }
  const engine = settings.engines?.[settings.searchEngine]
  $('#version').textContent = `Metal Browser v${settings.version}`
  $('#engine').textContent = engine ? `Tìm kiếm bằng ${engine.name}` : ''
  applyBackground()
  renderTiles()
})()
