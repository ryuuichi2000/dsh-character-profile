// 人物情报库 · HTTP 半边（Host）
// 页面要的东西都从这里出：目录、资料库增删改查、画像卡上传/删除、官方示例、静态文件。
// 单独抽出来是为了能用 scripts/dev-server.mjs 在浏览器里预览，不必启动整个 dsh。
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { cardsDir, dataDir, deleteCard, deleteDossier, dossierFromFile, getCard, listCards, listDossiers, readDossier, saveCard, saveDossier, stats } from './store.js'
import { extractDocx } from './docx.js'

export const BASE = '/character-profile'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

export function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
}

// 只在 dir 里面找文件：拒绝 ..、点文件和目录外的符号链接
export function safeFile(dir, rel) {
  if (!dir || !rel || rel.split('/').some((p) => p.startsWith('.'))) return null
  let base
  try {
    base = realpathSync(dir)
  } catch {
    return null
  }
  const file = normalize(join(base, rel))
  if (!file.startsWith(base + sep) || !existsSync(file)) return null
  const real = realpathSync(file)
  return real.startsWith(base + sep) && statSync(real).isFile() ? real : null
}

// 在系统文件管理器里选中一张卡：Windows 用 explorer /select，macOS 用 open -R，Linux 打开目录
function revealFile(file) {
  const opts = { detached: true, stdio: 'ignore' }
  const child =
    process.platform === 'win32'
      ? spawn('explorer.exe', [`/select,${file}`], opts)
      : process.platform === 'darwin'
        ? spawn('open', ['-R', file], opts)
        : spawn('xdg-open', [dirname(file)], opts)
  child.on('error', () => {})
  child.unref()
}

export function serveFile(req, res, file) {  let stat
  try {
    stat = statSync(file)
  } catch {
    return notFound(res)
  }
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream'
  res.writeHead(200, { 'content-type': type, 'content-length': stat.size, 'cache-control': 'no-cache' })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}

// 只接受同源页面发来的 JSON
export function readJson(req, max = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const origin = req.headers.origin
    if (req.method !== 'POST') return reject(Object.assign(new Error('method'), { status: 405 }))
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('type'), { status: 415 }))
    if (origin && origin.replace(/^https?:\/\//, '') !== req.headers.host) return reject(Object.assign(new Error('origin'), { status: 403 }))
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > max) req.destroy()
      else chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (e) {
        reject(Object.assign(e, { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

export function imageSize(buf) {
  try {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) {
          i++
          continue
        }
        const marker = buf[i + 1]
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) }
        }
        i += 2 + buf.readUInt16BE(i + 2)
      }
    }
  } catch {}
  return null
}

function decodeDataUrl(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''))
  if (!m) throw new Error('只支持 PNG / JPEG / WebP 图片')
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length > 24 * 1024 * 1024) throw new Error('图片超过 24MB')
  if (buf.length < 100) throw new Error('图片内容为空')
  return buf
}

function examples(root) {
  try {
    const list = JSON.parse(readFileSync(join(root, 'examples', 'manifest.json'), 'utf8')).examples || []
    return list.map((e) => ({
      ...e,
      url: e.kind === 'card' ? `${BASE}/media/examples/${e.file}` : null,
      detail: `${BASE}/api/examples/${e.id}`,
    }))
  } catch {
    return []
  }
}

export function catalog(root) {
  let version = '0.0.0'
  try {
    version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  } catch {}
  return {
    version,
    dataDir: dataDir(),
    stats: stats(),
    dossiers: listDossiers(),
    cards: listCards().map((c) => ({ ...c, url: `${BASE}/media/cards/${c.id}.png?v=${c.version}`, detail: `${BASE}/api/cards/${c.id}` })),
    examples: examples(root),
  }
}

// 返回 true 表示这个请求已经处理完
export async function handleApi(req, res, url, root, runner) {
  const rest = url.pathname.slice(BASE.length) || '/'
  const method = req.method || 'GET'

  if (rest === '/api/catalog') return sendJson(res, 200, catalog(root)), true
  if (rest === '/api/health') return sendJson(res, 200, { ok: true, time: new Date().toISOString() }), true

  if (rest === '/api/jobs' && method === 'GET') {
    sendJson(res, 200, { ok: true, jobs: runner ? runner.list() : [] })
    return true
  }
  if (rest === '/api/jobs' && method === 'POST') {
    try {
      const body = await readJson(req, 2 * 1024 * 1024)
      if (!runner) throw new Error('后台执行器没有启动；请重启 dsh')
      const job = runner.start({ kind: body.kind, name: body.name, prompt: body.prompt })
      sendJson(res, 200, { ok: true, job })
    } catch (e) {
      sendJson(res, e.status || 400, { ok: false, error: e.message })
    }
    return true
  }
  if (rest === '/api/jobs/cancel') {
    try {
      const body = await readJson(req)
      sendJson(res, 200, { ok: runner ? runner.cancel(String(body.id || '')) : false })
    } catch (e) {
      sendJson(res, e.status || 400, { ok: false, error: e.message })
    }
    return true
  }

  if (rest === '/api/dossiers' && method === 'GET') return sendJson(res, 200, { dossiers: listDossiers(url.searchParams.get('q') || '') }), true
  if (rest === '/api/dossiers' && method === 'POST') {
    try {
      const body = await readJson(req, 8 * 1024 * 1024)
      sendJson(res, 200, { ok: true, dossier: saveDossier(body) })
    } catch (e) {
      sendJson(res, e.status || 400, { ok: false, error: e.message })
    }
    return true
  }
  if (rest === '/api/dossiers/delete') {
    try {
      const body = await readJson(req)
      sendJson(res, 200, { ok: deleteDossier(String(body.id || '')) })
    } catch (e) {
      sendJson(res, e.status || 400, { ok: false, error: e.message })
    }
    return true
  }
  if (rest === '/api/dossiers/upload') {
    try {
      const body = await readJson(req, 12 * 1024 * 1024)
      const dossier = dossierFromFile(body.filename, body.text)
      sendJson(res, 200, { ok: true, dossier })
    } catch (e) {
      sendJson(res, e.status || 400, { ok: false, error: e.message })
    }
    return true
  }
  let m
  if ((m = rest.match(/^\/api\/dossiers\/([\w-]+)$/)) && method === 'GET') {
    const d = readDossier(m[1])
    if (!d) return notFound(res), true
    return sendJson(res, 200, { ok: true, dossier: d }), true
  }

  if (rest === '/api/extract') {
    try {
      const body = await readJson(req, 24 * 1024 * 1024)
      if (!/\.docx$/i.test(String(body.filename || ''))) throw new Error('只支持 .docx 文件；.md / .txt 直接拖入即可')
      const raw = String(body.dataUrl || '')
      const at = raw.indexOf('base64,')
      if (at < 0) throw new Error('文件数据格式不对')
      const text = await extractDocx(Buffer.from(raw.slice(at + 7), 'base64'))
      if (!text) throw new Error('文档里没有可读文字，可能是扫描件或空文档')
      sendJson(res, 200, { ok: true, text, chars: text.length })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return true
  }
  if (rest === '/api/cards' && method === 'GET') return sendJson(res, 200, { cards: catalog(root).cards }), true
  if (rest === '/api/cards/upload') {
    try {
      const body = await readJson(req, 32 * 1024 * 1024)
      const png = decodeDataUrl(body.dataUrl)
      const size = imageSize(png) || {}
      const card = saveCard({
        png,
        name: body.name || String(body.filename || '').replace(/\.[^.]+$/, ''),
        title: body.title || '',
        subtitle: body.subtitle || '',
        type: body.type || '',
        stars: body.stars || '',
        region: body.region || '',
        period: body.period || '',
        note: body.note || '',
        origin: 'uploaded',
        width: size.width,
        height: size.height,
      })
      sendJson(res, 200, { ok: true, card })
    } catch (e) {
      sendJson(res, e.status || 400, { ok: false, error: e.message })
    }
    return true
  }
  if (rest === '/api/cards/delete') {
    try {
      const body = await readJson(req)
      sendJson(res, 200, { ok: deleteCard(String(body.id || '')) })
    } catch (e) {
      sendJson(res, e.status || 400, { ok: false, error: e.message })
    }
    return true
  }
  if (rest === '/api/cards/reveal') {
    try {
      const body = await readJson(req)
      const card = getCard(String(body.id || ''))
      if (!card) throw new Error('找不到这张画像卡')
      const file = join(cardsDir(), `${card.id}.png`)
      if (!existsSync(file)) throw new Error('图片文件不在了，可能被手动删除了')
      revealFile(file)
      sendJson(res, 200, { ok: true, path: file })
    } catch (e) {
      sendJson(res, e.status || 400, { ok: false, error: e.message })
    }
    return true
  }
  if ((m = rest.match(/^\/api\/cards\/([\w-]+)$/)) && method === 'GET') {
    const c = getCard(m[1])
    if (!c) return notFound(res), true
    return sendJson(res, 200, { ok: true, card: c }), true
  }
  if ((m = rest.match(/^\/api\/examples\/([\w-]+)$/))) {
    const e = examples(root).find((x) => x.id === m[1])
    if (!e) return notFound(res), true
    if (e.kind === 'dossier') {
      const f = safeFile(join(root, 'examples'), e.file)
      if (!f) return notFound(res), true
      return sendJson(res, 200, { ...e, content: readFileSync(f, 'utf8') }), true
    }
    return sendJson(res, 200, e), true
  }
  return false
}

export function createHandler(root, runner) {
  return async function handler(req, res) {
    const url = new URL(req.url || '/', 'http://x')
    const rest = decodeURIComponent(url.pathname.slice(BASE.length)) || '/'
    let m

    if (req.method === 'GET' || req.method === 'HEAD') {
      if ((m = rest.match(/^\/media\/cards\/([\w-]+)\.png$/))) {
        const card = getCard(m[1])
        if (!card) return notFound(res)
        const file = join(cardsDir(), `${card.id}.png`)
        return existsSync(file) ? serveFile(req, res, file) : notFound(res)
      }
      if ((m = rest.match(/^\/media\/examples\/(.+)$/))) {
        const f = safeFile(join(root, 'examples'), m[1])
        return f ? serveFile(req, res, f) : notFound(res)
      }
    }

    if (await handleApi(req, res, url, root, runner)) return
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res)
    const f = safeFile(join(root, 'gallery'), rest === '/' ? 'index.html' : rest.slice(1))
    return f ? serveFile(req, res, f) : notFound(res)
  }
}
