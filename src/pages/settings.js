renderShell('settings')

let s = {}

function fill() {
  $$('[data-key]').forEach((el) => (el.checked = !!s[el.dataset.key]))
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
    if (el.dataset.restart && confirm('Cần khởi động lại trình duyệt để áp dụng. Khởi động lại ngay?')) api('restart')
  })
)
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
  }
  if (!Object.values(opts).some(Boolean)) return toast('Chưa chọn mục nào')
  if (!confirm('Xoá dữ liệu đã chọn? Không thể hoàn tác.')) return
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
