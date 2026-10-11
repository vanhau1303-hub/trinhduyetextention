renderShell('settings')

let s = {}

function fill() {
  $$('[data-key]').forEach((el) => (el.checked = !!s[el.dataset.key]))
  for (const r of $$('input[name="startup"]')) r.checked = r.value === s.startup
  $('#startup-pages').classList.toggle('hidden', s.startup !== 'pages')
  renderStartupPages()
  $('#homepage').value = s.homepage === 'metal://newtab' ? '' : s.homepage || ''
  $('#searchEngine').innerHTML = Object.entries(s.engines || {})
    .map(([k, e]) => `<option value="${esc(k)}" ${k === s.searchEngine ? 'selected' : ''}>${esc(e.name)}</option>`)
    .join('')
  $('#uiTheme').value = s.uiTheme || 'system'
  $('#translateTarget').value = s.translateTarget || 'vi'
  $('#secureDns').innerHTML = Object.entries(s.dnsProviders || {})
    .map(([k, p]) => `<option value="${esc(k)}" ${k === s.secureDns ? 'selected' : ''}>${esc(p.name)}</option>`)
    .join('')
  $('#secureDnsCustom').value = s.secureDnsCustom || ''
  $('#dns-custom-row').classList.toggle('hidden', s.secureDns !== 'custom')
}

async function refreshTools() {
  const st = await api('mediaToolsStatus')
  $('#ytdlp-status').innerHTML = st.ytdlp
    ? '<span class="ok">✓ Đã cài.</span> Tải video YouTube, Facebook, TikTok… bằng nút "Tải video" trên thanh địa chỉ.'
    : 'Chưa cài. Sẽ tự tải (~18 MB, từ trang GitHub chính thức của yt-dlp) khi bạn tải video lần đầu.'
  $('#ytdlp-btn').textContent = st.ytdlp ? 'Cập nhật' : 'Cài đặt ngay'
  $('#ffmpeg-status').innerHTML = st.ffmpeg
    ? `<span class="ok">✓ Đã có:</span> <span class="path">${esc(st.ffmpeg)}</span>`
    : '<span class="warn">Chưa có.</span> Cần để ghép hình + tiếng khi tải YouTube và đổi sang MP3. Sẽ tự tải (~150 MB) ở lần đầu cần dùng.'
  $('#ffmpeg-btn').classList.toggle('hidden', !!st.ffmpeg)
}

$('#ffmpeg-btn').addEventListener('click', async (e) => {
  e.target.disabled = true
  e.target.textContent = 'Đang tải… (xem tiến trình ở Tải xuống)'
  try {
    await api('installFfmpeg')
    toast('Đã cài ffmpeg')
  } catch (err) {
    toast(`Lỗi: ${err.message}`, 5000)
  }
  e.target.disabled = false
  e.target.textContent = 'Cài đặt ngay'
  refreshTools()
})

$$('[data-key]').forEach((el) =>
  el.addEventListener('change', async () => {
    await api('setSetting', el.dataset.key, el.checked)
    if (el.dataset.restart && (await ask('Khởi động lại trình duyệt?', { message: 'Cần khởi động lại để áp dụng thay đổi này.', ok: 'Khởi động lại' }))) api('restart')
  })
)
// ---- Quyền của trang web ----
const PERM_LABEL = { ask: 'Hỏi', allow: 'Cho phép', block: 'Chặn' }
async function renderPermissions(data) {
  data = data || (await api('getPermissions'))
  const labels = Object.fromEntries(data.perms.map((p) => [p.key, p.label]))
  $('#perm-defaults').innerHTML = data.perms
    .map((p) => `<div class="perm"><span class="pl">${esc(p.label)}</span><select data-perm="${esc(p.key)}">${['ask', 'allow', 'block']
      .map((v) => `<option value="${v}" ${p.value === v ? 'selected' : ''}>${PERM_LABEL[v]}</option>`)
      .join('')}</select></div>`)
    .join('')
  $('#perm-sites').innerHTML = data.sites.length
    ? data.sites
        .map((site) => `<div class="perm"><img class="fav" src="${esc(faviconFor(site.origin))}" alt=""><span class="ellipsis" style="width:220px">${esc(new URL(site.origin).hostname)}</span>
          <span class="chips">${Object.entries(site.perms).map(([k, v]) => `<span class="${v}">${esc(labels[k] || k)}: ${PERM_LABEL[v] || v}</span>`).join('')}</span>
          <button class="icon-btn" data-reset="${esc(site.origin)}" title="Đặt lại quyền của trang này">✕</button></div>`)
        .join('')
    : '<div class="perm muted">Chưa có trang nào.</div>'
  $$('#perm-sites img').forEach((img) => (img.onerror = () => (img.style.visibility = 'hidden')))
}
$('#perm-defaults').addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-perm]')
  if (sel) renderPermissions(await api('setPermissionDefault', sel.dataset.perm, sel.value))
})
$('#perm-sites').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-reset]')
  if (b) renderPermissions(await api('resetSitePermissions', b.dataset.reset))
})
renderPermissions()

// ---- Khi khởi động ----
function renderStartupPages() {
  const pages = s.startupPages || []
  $('#startup-list').innerHTML = pages.length
    ? pages.map((u, i) => `<div class="sp"><img class="fav" src="${esc(faviconFor(u))}" alt=""><div class="grow ellipsis" title="${esc(u)}">${esc(u)}</div><button class="icon-btn" data-del="${i}" title="Xoá">✕</button></div>`).join('')
    : '<div class="sp muted">Chưa có trang nào — thêm trang hoặc bấm "Dùng các trang đang mở".</div>'
  $$('#startup-list img').forEach((img) => (img.onerror = () => (img.style.visibility = 'hidden')))
}
async function saveStartupPages(pages) {
  s.startupPages = pages
  await api('setSetting', 'startupPages', pages)
  renderStartupPages()
}
$$('input[name="startup"]').forEach((r) =>
  r.addEventListener('change', () => {
    s.startup = r.value
    $('#startup-pages').classList.toggle('hidden', s.startup !== 'pages')
    api('setSetting', 'startup', r.value)
  })
)
$('#startup-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-del]')
  if (b) saveStartupPages((s.startupPages || []).filter((_, i) => i !== Number(b.dataset.del)))
})
$('#startup-add').addEventListener('submit', (e) => {
  e.preventDefault()
  let v = $('#startup-url').value.trim()
  if (!v) return
  if (!/^[a-z-]+:/i.test(v)) v = `https://${v}`
  $('#startup-url').value = ''
  saveStartupPages([...(s.startupPages || []), v])
})
$('#startup-current').addEventListener('click', async () => {
  const open = await api('getOpenPages')
  if (!open.length) return toast('Không có trang web nào đang mở')
  await saveStartupPages([...new Set(open.map((p) => p.url))])
  toast(`Đã dùng ${open.length} trang đang mở`)
})

$('#homepage').addEventListener('change', (e) => {
  let v = e.target.value.trim()
  if (v && !/^[a-z-]+:/i.test(v)) v = `https://${v}`
  api('setSetting', 'homepage', v || 'metal://newtab')
})
$('#searchEngine').addEventListener('change', (e) => api('setSetting', 'searchEngine', e.target.value))
$('#uiTheme').addEventListener('change', (e) => api('setSetting', 'uiTheme', e.target.value))
$('#secureDns').addEventListener('change', (e) => {
  s.secureDns = e.target.value
  $('#dns-custom-row').classList.toggle('hidden', s.secureDns !== 'custom')
  api('setSetting', 'secureDns', e.target.value)
  toast(e.target.value === 'off' ? 'Đã tắt DNS bảo mật' : 'Đã bật DNS bảo mật')
})
$('#secureDnsCustom').addEventListener('change', (e) => {
  const v = e.target.value.trim()
  if (v && !v.startsWith('https://')) return toast('Địa chỉ phải bắt đầu bằng https://')
  api('setSetting', 'secureDnsCustom', v)
  toast('Đã lưu DNS tuỳ chỉnh')
})
$('#dns-test').addEventListener('click', () => api('openUrl', 'https://one.one.one.one/help/'))
$('#translateTarget').addEventListener('change', (e) => api('setSetting', 'translateTarget', e.target.value))

$('#choose-dir').addEventListener('click', async () => {
  const dir = await api('chooseDownloadDir')
  if (dir) $('#download-dir').textContent = dir
})

$('#ytdlp-btn').addEventListener('click', async (e) => {
  e.target.disabled = true
  e.target.textContent = 'Đang tải…'
  try {
    const st = await api('mediaToolsStatus')
    await api(st.ytdlp ? 'updateYtdlp' : 'installYtdlp')
    toast('Xong')
  } catch (err) {
    toast(`Lỗi: ${err.message}`, 5000)
  }
  e.target.disabled = false
  refreshTools()
})

$('#clear').addEventListener('click', async () => {
  const opts = {
    history: $('#c-history').checked,
    cache: $('#c-cache').checked,
    cookies: $('#c-cookies').checked,
    downloads: $('#c-downloads').checked,
    passwords: $('#c-passwords').checked,
  }
  if (!Object.values(opts).some(Boolean)) return toast('Chưa chọn mục nào')
  if (!(await ask('Xoá dữ liệu đã chọn?', { message: 'Không thể hoàn tác.', ok: 'Xoá dữ liệu', danger: true }))) return
  await api('clearBrowsingData', opts)
  toast('Đã xoá dữ liệu duyệt web')
})

$('#default-browser').addEventListener('click', () => api('setDefaultBrowser'))

window.metal.on('settings', (ns) => {
  s = { ...s, ...ns }
  fill()
})

;(async () => {
  s = await api('getSettings')
  fill()
  $('#download-dir').textContent = await api('getDownloadDir')
  refreshTools()
})()
