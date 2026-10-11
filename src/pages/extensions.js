renderShell('extensions')

async function load(list) {
  list = list || (await api('getExtensions'))
  $('#count').textContent = `Đã cài (${list.length})`
  if (!list.length) {
    $('#list').innerHTML = '<div class="card empty" style="grid-column:1/-1">Chưa có tiện ích nào. Mở Chrome Web Store để thêm.</div>'
    return
  }
  $('#list').innerHTML = list
    .map(
      (e) => `<div class="card ext ${e.enabled ? '' : 'off'}" data-id="${esc(e.id)}">
      <div class="top">
        <img src="${esc(e.icon)}" alt="">
        <div style="min-width:0">
          <div class="name">${esc(e.name)}<span class="ver">${esc(e.version)}</span>${e.mv === 2 ? '<span class="tag mv2">MV2</span>' : ''}${e.unpacked ? '<span class="tag">Giải nén</span>' : ''}</div>
          <div class="desc">${esc(e.description)}</div>
          <div class="id">ID: ${esc(e.id)}</div>
        </div>
      </div>
      <div class="bottom">
        ${e.optionsUrl && e.enabled ? `<button class="btn" data-act="options">Tuỳ chọn</button>` : ''}
        ${!e.unpacked ? `<button class="btn" data-act="store">Xem trên Store</button>` : ''}
        <button class="btn danger" data-act="remove">Gỡ bỏ</button>
        <span class="grow"></span>
        <label class="switch" title="${e.enabled ? 'Tắt' : 'Bật'}"><input type="checkbox" data-act="toggle" ${e.enabled ? 'checked' : ''}><span></span></label>
      </div>
    </div>`
    )
    .join('')
  $$('#list img').forEach((img) => (img.onerror = () => (img.src = 'puzzle.svg')))
  window.__exts = list
}

$('#list').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-act]')
  if (!btn || btn.dataset.act === 'toggle') return
  const card = btn.closest('.ext')
  const ext = window.__exts.find((x) => x.id === card.dataset.id)
  if (btn.dataset.act === 'options') api('openOptions', ext.optionsUrl)
  if (btn.dataset.act === 'store') api('openUrl', ext.webstore)
  if (btn.dataset.act === 'remove') {
    if (!confirm(`Gỡ bỏ "${ext.name}"?`)) return
    load(await api('removeExtension', ext.id))
    toast(`Đã gỡ ${ext.name}`)
  }
})

$('#list').addEventListener('change', async (ev) => {
  const input = ev.target.closest('[data-act="toggle"]')
  if (!input) return
  const id = input.closest('.ext').dataset.id
  try {
    load(await api('setExtensionEnabled', id, input.checked))
  } catch (err) {
    toast(`Không thực hiện được: ${err.message}`)
    load()
  }
})

$('#open-store').addEventListener('click', () => api('openUrl', 'https://chromewebstore.google.com/', false))
$('#store-link').addEventListener('click', (e) => {
  e.preventDefault()
  api('openUrl', 'https://chromewebstore.google.com/', false)
})
$('#load-unpacked').addEventListener('click', async () => {
  try {
    load(await api('loadUnpacked'))
  } catch (err) {
    toast(err.message.replace(/^Error invoking remote method '.*?': (Error: )?/, ''))
  }
})
$('#update').addEventListener('click', async (e) => {
  e.target.disabled = true
  e.target.textContent = 'Đang kiểm tra…'
  load(await api('updateExtensions'))
  e.target.disabled = false
  e.target.textContent = 'Cập nhật tất cả'
  toast('Đã kiểm tra cập nhật')
})
$('#install-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const value = $('#install-id').value
  if (!value.trim()) return
  try {
    toast('Đang cài đặt…')
    load(await api('installById', value))
    $('#install-id').value = ''
    toast('Đã cài đặt')
  } catch (err) {
    toast(`Không cài được: ${err.message.replace(/^Error invoking remote method '.*?': (Error: )?/, '')}`, 5000)
  }
})

// ---------- Nhập từ trình duyệt khác ----------
let importFrom = null
let importItems = []

async function initImport() {
  const browsers = await api('otherBrowsers')
  if (!browsers.length) return
  $('#import-section').classList.remove('hidden')
  $('#browser-buttons').innerHTML = browsers.map((b) => `<button class="btn" data-key="${esc(b.key)}">Từ ${esc(b.name)}</button>`).join('')
}

$('#browser-buttons').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-key]')
  if (!btn) return
  importFrom = btn.dataset.key
  importItems = await api('scanBrowser', importFrom)
  $('#import-box').classList.remove('hidden')
  $('#import-status').textContent = importItems.length ? `${importItems.length} extension tìm thấy` : 'Không tìm thấy extension nào.'
  $('#import-list').innerHTML = importItems
    .map(
      (x) => `<label class="import-item"><input type="checkbox" value="${esc(x.id)}" ${x.installed ? 'disabled' : x.fromStore ? 'checked' : ''}>
      <div class="grow"><div class="ellipsis"><b>${esc(x.name)}</b> <span class="muted">${esc(x.version)}${x.mv === 2 ? ' · MV2' : ''}</span></div>
      <div class="muted">${x.installed ? 'Đã có trong Metal Browser' : x.fromStore ? 'Có trên Chrome Web Store' : 'Không có trên Store — sẽ chép bản trên máy'}</div></div>
      <span data-result="${esc(x.id)}"></span></label>`
    )
    .join('')
})

$('#import-cancel').addEventListener('click', () => $('#import-box').classList.add('hidden'))
$('#import-go').addEventListener('click', async (e) => {
  const ids = $$('#import-list input:checked').map((i) => i.value)
  if (!ids.length) return toast('Chưa chọn extension nào')
  e.target.disabled = true
  $('#import-status').textContent = `Đang nhập ${ids.length} extension…`
  const results = await api('importExtensions', importFrom, ids)
  for (const r of results) {
    const cell = $(`[data-result="${r.id}"]`)
    if (cell) cell.innerHTML = r.ok ? `<span class="result-ok">✓ ${esc(r.how)}</span>` : `<span class="result-bad" title="${esc(r.error)}">✕ Lỗi</span>`
  }
  const ok = results.filter((r) => r.ok).length
  $('#import-status').textContent = `Xong: ${ok}/${results.length} thành công.`
  e.target.disabled = false
  load()
})

window.metal.on('extensions-changed', () => load())
load()
initImport()
