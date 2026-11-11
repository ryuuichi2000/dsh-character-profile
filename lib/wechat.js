// 公众号文章检索：走搜狗微信搜索（weixin.sogou.com），返回标题、摘要、发布时间、公众号名、跳转链接。
// 只做「发现」：搜狗摘要不是全文；mp.weixin.qq.com 正文经常被微信验证页拦截，正文仍要去找
// 区政府 / 区委党校 / 北京组工网 / 北京号 / 融媒体等可访问的同源版本。
// 零第三方依赖，Host 进程直接发 HTTPS 请求；带最小调用间隔，避免被搜狗限流。
import https from 'node:https'
import zlib from 'node:zlib'

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
]

const MIN_INTERVAL_MS = 2000
let lastCallAt = 0

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const pickUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]

function decodeEntities(value) {
  return String(value || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&middot;/g, '·')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\s+/g, ' ')
    .trim()
}

function fetchText(url, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.get(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          'User-Agent': pickUA(),
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Referer: 'https://weixin.sogou.com/',
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
          } catch {}
          resolve({ status: res.statusCode || 0, text: body.toString('utf8') })
        })
      },
    )
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => req.destroy(new Error('搜狗微信检索超时')))
  })
}

function chinaDate(seconds) {
  const d = new Date(seconds * 1000 + 8 * 3600 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return {
    datetime: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
    date_text: `${d.getUTCFullYear()}年${pad(d.getUTCMonth() + 1)}月${pad(d.getUTCDate())}日`,
  }
}

function parseArticles(html, max) {
  const listBlock = String(html || '').match(/<ul[^>]*class="[^"]*news-list[^"]*"[^>]*>([\s\S]*?)<\/ul>/i)
  if (!listBlock) return []
  const out = []
  for (const match of listBlock[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    if (out.length >= max) break
    const li = match[1]
    const h3 = li.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || ''
    const anchor = h3.match(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!anchor) continue
    const title = decodeEntities(anchor[2])
    if (!title) continue
    let url = anchor[1].replace(/&amp;/g, '&')
    if (url.startsWith('/')) url = `https://weixin.sogou.com${url}`
    const summary = decodeEntities(li.match(/<p[^>]*class="[^"]*txt-info[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '')
    const source = decodeEntities(
      li.match(/<span[^>]*class="[^"]*all-time-y2[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ||
        li.match(/<a[^>]*class="[^"]*\baccount\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i)?.[1] ||
        '',
    )
    const timeBlock = li.match(/<span[^>]*class="[^"]*\bs2\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || ''
    const timestamp = timeBlock.match(/(\d{10})/)?.[1]
    const date = timestamp ? chinaDate(Number(timestamp)) : { datetime: '', date_text: '' }
    out.push({ title, url, summary, datetime: date.datetime, date_text: date.date_text, source })
  }
  return out
}

export async function searchWechatArticles(query, num = 8) {
  const q = String(query || '').trim()
  if (!q) throw new Error('搜索关键词不能为空')
  const want = Math.max(1, Math.min(20, Number(num) || 8))
  const pages = Math.min(2, Math.ceil(want / 10))
  const articles = []
  for (let page = 1; page <= pages; page += 1) {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt)
    if (wait > 0) await sleep(wait)
    lastCallAt = Date.now()
    const url = `https://weixin.sogou.com/weixin?query=${encodeURIComponent(q)}&s_from=input&_sug_=n&type=2&page=${page}&ie=utf8`
    let response
    try {
      response = await fetchText(url)
    } catch (error) {
      if (page === 1) throw error
      break
    }
    const list = parseArticles(response.text, want - articles.length)
    if (!list.length) {
      if (page === 1) {
        return { query: q, total: 0, articles: [], note: '搜狗返回空结果或验证页；稍后再试，或换更短的关键词' }
      }
      break
    }
    articles.push(...list)
    if (articles.length >= want) break
    if (page < pages) await sleep(1200)
  }
  return { query: q, total: Math.min(articles.length, want), articles: articles.slice(0, want) }
}
