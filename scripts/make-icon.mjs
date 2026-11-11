// 生成插件图标：node scripts/make-icon.mjs → icon.png（256×256）
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
function load() {
  for (const p of [join(root, 'package.json'), join(homedir(), '.dsh', 'profiles', 'desktop', 'package.json')]) {
    try {
      return createRequire(p)('playwright')
    } catch {}
  }
}
function findChromium() {
  const r = join(process.env.LOCALAPPDATA || '', 'ms-playwright')
  if (existsSync(r)) for (const d of readdirSync(r).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
    const p = join(r, d, 'chrome-win64', 'chrome.exe')
    if (existsSync(p)) return p
  }
  return 'C:/Program Files/Google/Chrome/Application/chrome.exe'
}

const { chromium } = load()
const browser = await chromium.launch({ executablePath: findChromium() })
const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 })
const svg = `<svg width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.35" stroke-linecap="square" stroke-linejoin="round"><rect x="3.5" y="3" width="17" height="18"/><circle cx="12" cy="10" r="2.7"/><path d="M7.4 18.2c.7-2.3 2.5-3.5 4.6-3.5s3.9 1.2 4.6 3.5"/></svg>`
await page.setContent(`<body style="margin:0"><div style="width:256px;height:256px;background:#002FA7;display:grid;place-items:center">${svg}</div></body>`)
await page.waitForTimeout(200)
const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 256, height: 256 } })
writeFileSync(join(root, 'icon.png'), png)
await browser.close()
console.log(`icon.png ${png.length} bytes`)
