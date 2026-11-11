// 把画像卡的 HTML 渲染成 PNG（1080×1440，像素比 1）。
// 优先用插件宿主里装好的 playwright；没有就退到 puppeteer-core + 本机 Chrome / Edge。
// 只在 Host 进程里跑，模型的 bash 不用碰浏览器。
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const LAUNCH_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', '--font-render-hinting=none']

// 插件可能是 pnpm link 进来的（真实路径在工作区），这时 import('playwright') 找不到
// dsh profile 里装好的那一份；按 profile 的 package.json 再试一次。
function requireFromProfile(name) {
  const homes = [process.env.DSH_HOME, join(homedir(), '.dsh')].filter(Boolean)
  const roots = [process.cwd()]
  for (const home of homes) {
    const profiles = join(home, 'profiles')
    if (existsSync(profiles)) for (const d of readdirSync(profiles)) roots.push(join(profiles, d))
  }
  for (const root of roots) {
    try {
      return createRequire(join(root, 'package.json'))(name)
    } catch {}
  }
  return null
}

async function loadPlaywright() {
  try {
    return await import('playwright')
  } catch {}
  const mod = requireFromProfile('playwright')
  return mod ? { chromium: mod.chromium } : null
}


function playwrightBrowsers() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(process.env.LOCALAPPDATA || '', 'ms-playwright'),
    join(homedir(), '.cache', 'ms-playwright'),
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),
  ].filter(Boolean)
  const found = []
  const rels = [
    'chrome-win64/chrome.exe',
    'chrome-win/chrome.exe',
    'chrome-linux/chrome',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
    'chrome-headless-shell-win64/chrome-headless-shell.exe',
    'chrome-headless-shell-win/chrome-headless-shell.exe',
  ]
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const d of readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
      for (const rel of rels) {
        const p = join(root, d, rel)
        if (existsSync(p)) found.push(p)
      }
    }
  }
  return found
}

function systemBrowsers() {
  const list = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
  return list.filter(existsSync)
}

async function withPlaywright(htmlFile, outFile) {
  let chromium
  try {
    const mod = await loadPlaywright()
    chromium = mod && mod.chromium
  } catch {}
  if (!chromium) return false
  let browser
  try {
    browser = await chromium.launch({ args: LAUNCH_ARGS })
  } catch (first) {
    for (const executablePath of [...playwrightBrowsers(), ...systemBrowsers()]) {
      try {
        browser = await chromium.launch({ args: LAUNCH_ARGS, executablePath })
        break
      } catch {}
    }
    if (!browser) throw first
  }
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1440 }, deviceScaleFactor: 1 })
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load', timeout: 20000 }).catch(() => {})
    // 字体请求可能一直不返回（外链字体被墙 / 断网），最多等 5 秒就截，别把工具卡死
    await Promise.race([
      page.evaluate(async () => {
        await document.fonts.ready
        await new Promise((r) => setTimeout(r, 220))
      }),
      new Promise((r) => setTimeout(r, 5000)),
    ]).catch(() => {})
    await page.waitForTimeout(300)
    await page.screenshot({ path: outFile, type: 'png', clip: { x: 0, y: 0, width: 1080, height: 1440 } })
    return true
  } finally {
    await browser.close().catch(() => {})
  }
}

async function withPuppeteer(htmlFile, outFile) {
  let puppeteer
  try {
    puppeteer = (await import('puppeteer-core')).default
  } catch {
    puppeteer = requireFromProfile('puppeteer-core')
  }
  if (!puppeteer) return false
  const executablePath = [...systemBrowsers(), ...playwrightBrowsers()][0]
  if (!executablePath) return false
  const browser = await puppeteer.launch({ executablePath, args: LAUNCH_ARGS, headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1080, height: 1440, deviceScaleFactor: 1 })
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load', timeout: 20000 }).catch(() => {})
    await Promise.race([page.evaluate(() => document.fonts.ready), new Promise((r) => setTimeout(r, 5000))]).catch(() => {})
    await new Promise((r) => setTimeout(r, 500))
    await page.screenshot({ path: outFile, type: 'png', clip: { x: 0, y: 0, width: 1080, height: 1440 } })
    return true
  } finally {
    await browser.close().catch(() => {})
  }
}

// 返回 png 的 Buffer；渲染器不可用时抛错，让工具把原因带回给模型
export async function renderCardHtml(html, { width = 1080, height = 1440 } = {}) {
  if (!html || !String(html).trim()) throw new Error('HTML 是空的')
  if (String(html).length > 3 * 1024 * 1024) throw new Error('HTML 超过 3MB，先把图片资源改成外链或去掉')
  const dir = join(tmpdir(), 'character-profile-render')
  mkdirSync(dir, { recursive: true })
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const htmlFile = join(dir, `${stamp}.html`)
  const outFile = join(dir, `${stamp}.png`)
  writeFileSync(htmlFile, String(html), 'utf8')
  try {
    let ok = await withPlaywright(htmlFile, outFile).catch(() => false)
    if (!ok) ok = await withPuppeteer(htmlFile, outFile).catch(() => false)
    if (!ok) throw new Error('本机没有可用的浏览器渲染器（playwright / Chrome）')
    const png = readFileSync(outFile)
    if (png.length < 5000) throw new Error('渲染出来的图太小，卡面可能是空白的')
    return png
  } finally {
    rmSync(htmlFile, { force: true })
    rmSync(outFile, { force: true })
  }
}
