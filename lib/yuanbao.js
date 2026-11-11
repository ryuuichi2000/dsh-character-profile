// 元宝搜索（so.qq.com）接入：抓 isearch 的服务端渲染结果，解析出公众号 / 政府 / 媒体卡片。
// 元宝把公众号正文索引进了结果卡片（content 字段），所以这里能拿到公众号正文片段，不必再闯
// mp.weixin.qq.com 的验证页。仍然只做检索线索：引用前用官方同源版本核对。
// 零第三方依赖；带最小调用间隔，避免高频请求。
import https from 'node:https'
import zlib from 'node:zlib'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
const MIN_INTERVAL_MS = 2000
let lastCallAt = 0

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function fetchHtml(url, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.get(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          let body = Buffer.concat(chunks)
          const encoding = String(res.headers['content-encoding'] || '').toLowerCase()
          try {
            if (encoding.includes('gzip')) body = zlib.gunzipSync(body)
            else if (encoding.includes('deflate')) body = zlib.inflateSync(body)
            else if (encoding.includes('br')) body = zlib.brotliDecompressSync(body)
            else if (encoding.includes('zstd') && typeof zlib.zstdDecompressSync === 'function') body = zlib.zstdDecompressSync(body)
          } catch {}
          resolve({ status: res.statusCode || 0, text: body.toString('utf8') })
        })
      },
    )
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => req.destroy(new Error('元宝搜索请求超时')))
  })
}

function unescapeRsc(html) {
  const chunks = [...String(html || '').matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)].map((m) => m[1])
  return chunks
    .map((chunk) => {
      try {
        return JSON.parse('"' + chunk + '"')
      } catch {
        return chunk
      }
    })
    .join('')
}

// 从 start 的 { / [ 开始，找到配对的闭合符号（跳过字符串里的括号）
function balanced(text, start, open, close) {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const c = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === open) depth += 1
    else if (c === close) {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function cleanText(value, limit = 1500) {
  return String(value || '')
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/[\u200b-\u200f\u202a-\u202e]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

function dateOf(value) {
  const s = String(value || '').trim()
  const m = s.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}` : ''
}

function sourceOf(vm) {
  if (vm.sourcename) return cleanText(vm.sourcename, 40)
  if (typeof vm.author === 'string') return cleanText(vm.author, 40)
  if (vm.author?.name) return cleanText(vm.author.name, 40)
  if (vm.source) return cleanText(vm.source, 40)
  return vm.sourceType === 'wechat' ? '公众号' : ''
}

function urlOf(vm) {
  return String(vm.url || vm.h5Url || vm.nativeUrl || vm.originalUrl || '').trim()
}

function normalize(vm, type = '') {
  const title = cleanText(vm.title, 160)
  if (!title) return null
  const content = cleanText(vm.content || vm.summary || '', 1500)
  if (!content) return null
  let source = sourceOf(vm)
  if (source === '公众号') source = cleanText(vm.author?.name || vm.author || '', 40) || '公众号'
  return {
    title,
    url: urlOf(vm),
    source,
    date: dateOf(vm.date || vm.publishTime || vm.time),
    content,
    type: type || (vm.sourceType === 'wechat' ? '公众号' : '网页'),
  }
}

function extractTopLevelObjects(rsc) {
  const results = []
  for (const line of rsc.split('\n')) {
    let from = 0
    while (from < line.length) {
      const start = line.indexOf('{', from)
      if (start < 0) break
      const text = balanced(line, start, '{', '}')
      if (!text) break
      try {
        const obj = JSON.parse(text)
        if (obj && obj.title && (obj.content || obj.summary)) {
          let date = obj.time
          const ts = Number(obj.publish_time)
          if (Number.isFinite(ts) && ts > 0) date = new Date(ts * 1000 + 8 * 3600 * 1000).toISOString().slice(0, 10)
          const r = normalize({
            title: obj.title,
            url: obj.url || obj.h5_url || '',
            source: obj.source,
            author: obj.author,
            date,
            content: obj.content || obj.summary,
            sourceType: obj.source === '公众号' ? 'wechat' : '',
          })
          if (r) results.push(r)
        }
      } catch {}
      from = start + text.length
    }
  }
  return results
}

function extractCards(rsc) {
  const key = '"initialCards":'
  const at = rsc.indexOf(key)
  if (at < 0) return []
  const start = rsc.indexOf('[', at + key.length)
  if (start < 0) return []
  const text = balanced(rsc, start, '[', ']')
  if (!text) return []
  let cards
  try {
    cards = JSON.parse(text)
  } catch {
    return []
  }
  const results = []
  for (const element of Array.isArray(cards) ? cards : []) {
    let card = element
    if (typeof element === 'string') {
      try {
        card = JSON.parse(element)
      } catch {
        continue
      }
    }
    const vm = card?.data?.vm
    if (!vm) continue
    const r = normalize(vm, vm.sourceType === 'wechat' ? '公众号' : '网页')
    if (r) results.push(r)
  }
  return results
}

export async function searchYuanbao(query, num = 10) {
  const q = String(query || '').trim()
  if (!q) throw new Error('搜索关键词不能为空')
  const want = Math.max(1, Math.min(20, Number(num) || 10))
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt)
  if (wait > 0) await sleep(wait)
  lastCallAt = Date.now()
  const url = `https://so.qq.com/isearch?query=${encodeURIComponent(q)}&quick=1&sourceid=16_01_03`
  const { status, text } = await fetchHtml(url)
  if (status !== 200) throw new Error(`元宝搜索返回 HTTP ${status}`)
  const rsc = unescapeRsc(text)
  const all = [...extractTopLevelObjects(rsc), ...extractCards(rsc)]
  // 同名结果合并，保留正文更长的那一条（公众号全文优先）
  const byKey = new Map()
  for (const r of all) {
    const key = `${r.title}|${r.source}`
    const old = byKey.get(key)
    if (!old || r.content.length > old.content.length) byKey.set(key, r)
  }
  const results = [...byKey.values()].slice(0, want)
  return { query: q, total: results.length, results }
}
