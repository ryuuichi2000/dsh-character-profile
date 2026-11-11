// 给页面拍截图：node scripts/shoot.mjs [baseUrl]
// 用 dsh profile 里的 playwright；截 1440×900，输出到 .shots/。
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const base = process.argv[2] || 'http://127.0.0.1:4317/character-profile/'

function loadPlaywright() {
  try {
    return createRequire(join(root, 'package.json'))('playwright')
  } catch {}
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const profiles = join(home, 'profiles')
  if (existsSync(profiles)) {
    for (const d of readdirSync(profiles)) {
      try {
        return createRequire(join(profiles, d, 'package.json'))('playwright')
      } catch {}
    }
  }
  throw new Error('找不到 playwright')
}

const { chromium } = loadPlaywright()
const out = join(root, '.shots')
mkdirSync(out, { recursive: true })

// 本机装的 playwright 版本可能比浏览器快照新，直接 launch 会找不到对应版本；
// 退到 ms-playwright 缓存里现有的 Chromium 或系统 Chrome。
function findChromium() {
  const roots = [process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ms-playwright'), join(homedir(), '.cache', 'ms-playwright')].filter(Boolean)
  const rels = ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const d of readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
      for (const rel of rels) {
        const p = join(root, d, rel)
        if (existsSync(p)) return p
      }
    }
  }
  for (const p of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']) if (existsSync(p)) return p
  return undefined
}

const browser = await chromium.launch({ executablePath: findChromium() })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
page.on('console', (m) => m.type() === 'error' && console.log('[page]', m.text()))
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

const routes = (process.argv[3] || 'dossiers,cards,research,create,examples').split(',')
for (const r of routes) {
  await page.goto(`${base}#/${r}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(out, `${r}.png`), fullPage: true })
  console.log('shot', r)
}
await browser.close()
