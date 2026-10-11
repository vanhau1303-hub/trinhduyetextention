// Dịch cả trang ngay tại chỗ (không chuyển sang trang translate.goog): gom các đoạn chữ trên trang,
// dịch hàng loạt qua Google Translate, thay vào đúng chỗ. Bấm lần nữa để xem lại bản gốc.
const { net } = require('electron')
const { log } = require('./logger')

const WORLD = 1003

// Chạy trong isolated world: gom các nút chữ cần dịch, lưu lại để thay/khôi phục.
const COLLECT = `(() => {
  const st = (window.__metalTr = window.__metalTr || { nodes: [], originals: [], translated: false })
  if (st.translated) return { already: true }
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'SVG', 'MATH', 'KBD', 'SAMP', 'VAR'])
  const nodes = []
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const t = n.nodeValue
      if (!t || t.trim().length < 2 || !/\\p{L}/u.test(t)) return NodeFilter.FILTER_REJECT
      for (let p = n.parentElement; p; p = p.parentElement) {
        if (SKIP.has(p.tagName) || p.isContentEditable || p.getAttribute('translate') === 'no' || p.classList.contains('notranslate')) return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  while (walker.nextNode() && nodes.length < 4000) nodes.push(walker.currentNode)
  st.nodes = nodes
  st.originals = nodes.map((n) => n.nodeValue)
  return { texts: st.originals.map((t) => t.trim()) }
})()`

// Áp dụng một phần bản dịch (theo từng lô) để trang đổi dần từ trên xuống.
const applyScript = (indices, values) => `(() => {
  const st = window.__metalTr
  if (!st) return 0
  const idx = ${JSON.stringify(indices)}
  const val = ${JSON.stringify(values)}
  let n = 0
  idx.forEach((i, k) => {
    const node = st.nodes[i]
    const t = val[k]
    if (!node || typeof t !== 'string' || !t) return
    const orig = st.originals[i]
    // Giữ khoảng trắng đầu/cuối của đoạn gốc để chữ không dính vào nhau.
    node.nodeValue = orig.match(/^\\s*/)[0] + t + orig.match(/\\s*$/)[0]
    n++
  })
  st.translated = true
  document.documentElement.setAttribute('data-metal-translated', '1')
  return n
})()`

const RESTORE = `(() => {
  const st = window.__metalTr
  if (!st || !st.translated) return false
  st.nodes.forEach((node, i) => { node.nodeValue = st.originals[i] })
  st.translated = false
  document.documentElement.removeAttribute('data-metal-translated')
  return true
})()`

const SELECTION = `(() => { const s = getSelection(); return s ? s.toString().trim() : '' })()`

// Dịch một mảng chuỗi, chia lô ~3500 ký tự để không vượt giới hạn của Google.
// onBatch(indices, values) được gọi ngay khi mỗi lô xong (lô đầu là phần đầu trang).
async function translateBatch(texts, target, onBatch) {
  const out = new Array(texts.length).fill('')
  const batches = []
  let cur = []
  let len = 0
  texts.forEach((t, i) => {
    if (cur.length && (len + t.length > 3500 || cur.length >= 120)) {
      batches.push(cur)
      cur = []
      len = 0
    }
    cur.push(i)
    len += t.length
  })
  if (cur.length) batches.push(cur)

  let next = 0
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++]
      const body = batch.map((i) => `q=${encodeURIComponent(texts[i])}`).join('&')
      const res = await net.fetch(`https://translate.googleapis.com/translate_a/t?client=gtx&sl=auto&tl=${encodeURIComponent(target)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body,
      })
      if (!res.ok) throw new Error(`Google Translate trả về HTTP ${res.status}`)
      const data = await res.json()
      batch.forEach((idx, k) => {
        const item = data[k]
        out[idx] = Array.isArray(item) ? item[0] : typeof item === 'string' ? item : ''
      })
      if (onBatch) await onBatch(batch, batch.map((i) => out[i]))
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  return out
}

async function getSelection(wc) {
  try {
    return await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: SELECTION }])
  } catch {
    return ''
  }
}

// Trả về true nếu trang đang ở trạng thái đã dịch sau khi gọi.
async function togglePage(wc, target) {
  const restored = await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: RESTORE }]).catch(() => false)
  if (restored) return false
  const collected = await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: COLLECT }])
  if (!collected?.texts?.length) return false
  const started = Date.now()
  let n = 0
  await translateBatch(collected.texts, target, async (indices, values) => {
    if (wc.isDestroyed()) return
    n += await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: applyScript(indices, values) }]).catch(() => 0)
  })
  log.info('translate', `Dịch ${n}/${collected.texts.length} đoạn sang ${target} trong ${Date.now() - started} ms`)
  return true
}

module.exports = { togglePage, getSelection }
