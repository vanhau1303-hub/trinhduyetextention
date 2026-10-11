// Proxy HTTP nội bộ cho yt-dlp/ffmpeg: phân giải tên miền bằng DNS bảo mật (DoH) của trình duyệt
// thay vì DNS của nhà mạng — trang vào được trong trình duyệt thì yt-dlp cũng tải được.
// Chỉ nghe trên 127.0.0.1 và đòi mật khẩu ngẫu nhiên (đổi mỗi lần mở trình duyệt).
const http = require('node:http')
const net = require('node:net')
const crypto = require('node:crypto')
const { log } = require('./logger')

class DohProxy {
  constructor(session) {
    this.session = session
    this.server = null
    this.port = 0
    this.user = 'metal'
    this.pass = crypto.randomBytes(12).toString('hex')
    this.cache = new Map() // host -> { ip, until }
  }

  get url() {
    return this.port ? `http://${this.user}:${this.pass}@127.0.0.1:${this.port}` : ''
  }

  authorized(req) {
    const expected = `Basic ${Buffer.from(`${this.user}:${this.pass}`).toString('base64')}`
    return req.headers['proxy-authorization'] === expected
  }

  async resolve(host) {
    if (net.isIP(host)) return host
    const hit = this.cache.get(host)
    if (hit && hit.until > Date.now()) return hit.ip
    try {
      const { endpoints } = await this.session.resolveHost(host)
      const ep = endpoints.find((e) => e.family === 'ipv4') || endpoints[0]
      if (ep) {
        this.cache.set(host, { ip: ep.address, until: Date.now() + 5 * 60 * 1000 })
        return ep.address
      }
    } catch (err) {
      log.warn('doh-proxy', 'Không phân giải được', host, err.message)
    }
    return host // để hệ thống tự phân giải
  }

  start() {
    if (this.server) return Promise.resolve(this.url)
    this.server = http.createServer((req, res) => this.onRequest(req, res))
    this.server.on('connect', (req, socket, head) => this.onConnect(req, socket, head))
    this.server.on('clientError', (_err, socket) => socket.destroy())
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        this.port = this.server.address().port
        log.info('doh-proxy', 'Đang chạy ở cổng', this.port)
        resolve(this.url)
      })
    })
  }

  stop() {
    this.server?.close()
    this.server = null
    this.port = 0
  }

  // HTTPS: đường hầm CONNECT host:port
  async onConnect(req, socket, head) {
    if (!this.authorized(req)) {
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic\r\n\r\n')
      return
    }
    const [host, portStr] = req.url.split(':')
    const ip = await this.resolve(host)
    const upstream = net.connect(Number(portStr) || 443, ip, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head?.length) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    const fail = (err) => {
      log.warn('doh-proxy', 'Kết nối thất bại', host, ip, err.code || err.message)
      socket.destroy()
      upstream.destroy()
    }
    upstream.on('error', fail)
    socket.on('error', () => upstream.destroy())
  }

  // HTTP thường: GET http://host/path
  async onRequest(req, res) {
    if (!this.authorized(req)) {
      res.writeHead(407, { 'Proxy-Authenticate': 'Basic' })
      return res.end()
    }
    let target
    try {
      target = new URL(req.url)
    } catch {
      res.writeHead(400)
      return res.end()
    }
    const ip = await this.resolve(target.hostname)
    const headers = { ...req.headers, host: target.host }
    delete headers['proxy-authorization']
    delete headers['proxy-connection']
    const upstream = http.request({ host: ip, port: target.port || 80, path: target.pathname + target.search, method: req.method, headers }, (up) => {
      res.writeHead(up.statusCode, up.headers)
      up.pipe(res)
    })
    upstream.on('error', (err) => {
      log.warn('doh-proxy', 'HTTP thất bại', target.host, err.code || err.message)
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    req.pipe(upstream)
  }
}

module.exports = { DohProxy }
