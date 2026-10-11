renderShell('passwords')

let data = { entries: [], never: [] }
const shown = new Map() // id -> mật khẩu đang hiện

const host = (origin) => {
  try {
    return new URL(origin).hostname
  } catch {
    return origin
  }
}

function render() {
  const q = $('#q').value.toLowerCase()
  const list = data.entries.filter((e) => !q || e.origin.toLowerCase().includes(q) || e.username.toLowerCase().includes(q))
  $('#list').innerHTML = list.length
    ? list
        .map(
          (e) => `<div class="pw" data-id="${esc(e.id)}">
        <div class="site"><img class="fav" src="${esc(faviconFor(e.origin))}" alt=""><a class="ellipsis" href="${esc(e.origin)}" title="${esc(e.origin)}">${esc(host(e.origin))}</a></div>
        <div class="user ellipsis" title="${esc(e.username)}">${esc(e.username) || '<span class="muted">(không có)</span>'}</div>
        <div class="pass ellipsis">${shown.has(e.id) ? esc(shown.get(e.id)) : '••••••••••'}</div>
        <div class="actions">
          <button class="icon-btn" data-a="reveal" title="${shown.has(e.id) ? 'Ẩn' : 'Hiện'} mật khẩu">${shown.has(e.id) ? '🙈' : '👁'}</button>
          <button class="icon-btn" data-a="copy" title="Sao chép mật khẩu (tự xoá khỏi bộ nhớ tạm sau 30 giây)">⧉</button>
          <button class="icon-btn" data-a="delete" title="Xoá">✕</button>
        </div></div>`
        )
        .join('')
    : `<div class="empty">${data.entries.length ? 'Không có kết quả.' : 'Chưa lưu mật khẩu nào.'}</div>`
  $$('#list img').forEach((img) => (img.onerror = () => (img.style.visibility = 'hidden')))
  $('#never').innerHTML = data.never.length
    ? data.never.map((o) => `<div class="never"><span class="grow ellipsis" style="flex:1">${esc(host(o))}</span><button class="icon-btn" data-never="${esc(o)}" title="Bỏ khỏi danh sách">✕</button></div>`).join('')
    : '<div class="empty" style="padding:20px">Không có trang nào.</div>'
}

async function load() {
  data = await api('getPasswords')
  if (!data.encrypted) $('#tip').innerHTML = '⚠️ Windows không cho phép mã hoá trên máy này nên Metal Browser sẽ không lưu mật khẩu.'
  render()
}

$('#list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-a]')
  if (!btn) return
  const id = btn.closest('.pw').dataset.id
  if (btn.dataset.a === 'reveal') {
    if (shown.has(id)) shown.delete(id)
    else shown.set(id, (await api('revealPassword', id)) ?? '(không giải mã được)')
    render()
  } else if (btn.dataset.a === 'copy') {
    toast((await api('copyPassword', id)) ? 'Đã sao chép mật khẩu' : 'Không giải mã được mật khẩu')
  } else if (btn.dataset.a === 'delete') {
    if (!(await ask('Xoá mật khẩu này?', { ok: 'Xoá', danger: true }))) return
    await api('deletePassword', id)
    shown.delete(id)
    load()
  }
})
$('#never').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-never]')
  if (!btn) return
  await api('removeNeverSite', btn.dataset.never)
  load()
})
$('#clear').addEventListener('click', async () => {
  if (!(await ask('Xoá tất cả mật khẩu đã lưu?', { message: 'Không thể hoàn tác.', ok: 'Xoá tất cả', danger: true }))) return
  await api('clearPasswords')
  shown.clear()
  load()
  toast('Đã xoá tất cả mật khẩu')
})
$('#q').addEventListener('input', render)
load()
