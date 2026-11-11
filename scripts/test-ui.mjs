// 交互自检：node scripts/test-ui.mjs
// 依次点开查看层、编辑弹层、检索、两个工作台、示例做同款，截图到 .shots/，并收集页面报错。
import { mkdirSync, readdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const base = process.env.BASE || 'http://127.0.0.1:4317/character-profile/'
const out = join(root, '.shots')
mkdirSync(out, { recursive: true })

function pw() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  for (const p of [join(root, 'package.json'), join(home, 'profiles', 'desktop', 'package.json')]) {
    try {
      return createRequire(p)('playwright')
    } catch {}
  }
  throw new Error('找不到 playwright')
}
function findChromium() {
  const r = join(process.env.LOCALAPPDATA || '', 'ms-playwright')
  if (existsSync(r)) for (const d of readdirSync(r).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
    const p = join(r, d, 'chrome-win64', 'chrome.exe')
    if (existsSync(p)) return p
  }
  return 'C:/Program Files/Google/Chrome/Application/chrome.exe'
}

const { chromium } = pw()
const browser = await chromium.launch({ executablePath: findChromium() })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

const shot = async (n) => {
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(out, `ui-${n}.png`), fullPage: false })
  console.log('shot', n)
}

await page.goto(`${base}#/dossiers`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)

// 1. 查看档案
await page.click('[data-open-dossier]')
await page.waitForTimeout(700)
await shot('viewer-dossier')
const docText = await page.textContent('.doc-page')
console.log('doc contains table:', docText.includes('基本信息'), 'len', docText.length)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// 2. 编辑弹层
await page.click('[data-edit-dossier]')
await page.waitForTimeout(500)
await shot('modal-edit')
console.log('editor name:', await page.inputValue('.modal-card input[name="name"]'), 'kind:', await page.inputValue('.modal-card select[name="kind"]'))
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// 3. 搜索 + 层级
await page.fill('#dq', '游戏')
await page.waitForTimeout(800)
console.log('search rows:', await page.locator('#dossier-list .row').count())
await shot('search')
await page.fill('#dq', '')
await page.waitForTimeout(600)
const levelPills = await page.locator('[data-level]').allTextContents()
console.log('level pills:', levelPills.join('/'))

// 4. 资料搜集：搜人物 + 粗略
await page.goto(`${base}#/research`, { waitUntil: 'networkidle' })
await page.fill('[data-r="region"]', '江州市云溪区')
await page.fill('[data-r="department"]', '区经济和信息化局')
await page.fill('[data-r="name"]', '沈望舒')
await page.click('[data-precision="brief"]')
await page.waitForTimeout(500)
const personPrompt = await page.textContent('#prompt-out')
console.log('person prompt has 粗略:', personPrompt.includes('粗略搜索'), 'has 层级:', personPrompt.includes('层级：'), 'hint:', await page.textContent('#precision-hint'))
await shot('research-person-brief')

// 5. 资料搜集：搜机构
await page.click('[data-research-mode="institution"]')
await page.waitForTimeout(400)
console.log('institution fields — org:', await page.locator('[data-r="org"]').count(), 'name:', await page.locator('[data-r="name"]').count())
await page.fill('[data-r="org"]', '北京市朝阳区经济和信息化局')
await page.click('[data-precision="full"]')
await page.waitForTimeout(500)
const instPrompt = await page.textContent('#prompt-out')
console.log('institution prompt has 机构概况:', instPrompt.includes('机构概况'), 'has kind:', instPrompt.includes('kind 填 institution'), 'has level rule:', instPrompt.includes('北京市级 = 省级'))
await shot('research-institution')

// 6. 画像制作：上传资料模式（不应有姓名等填空）
await page.goto(`${base}#/create`, { waitUntil: 'networkidle' })
await page.click('[data-mode="material"]')
await page.waitForTimeout(400)
console.log('material mode field count:', await page.locator('[data-c="name"]').count(), 'textarea:', await page.locator('[data-c="material"]').count())
await page.fill('[data-c="material"]', '沈望舒，云溪区经济和信息化局党组书记、局长。2026 年 10 月 16 日调研云溪数字产业园，表示将补齐版号申报辅导、研发空间供给和人才公寓配套。')
await page.waitForTimeout(400)
console.log('material ready:', await page.isEnabled('[data-start-card]'))
const matPrompt = await page.textContent('#card-prompt')
console.log('material prompt has 资料里要画像:', matPrompt.includes('资料里要画像的人物'), 'has 姓名 line:', matPrompt.includes('- 姓名：'))
await shot('create-material')

// 7. 画像制作：只输姓名
await page.click('[data-mode="name"]')
await page.waitForTimeout(300)
await page.fill('[data-c="name"]', '沈望舒')
await page.fill('[data-c="region"]', '云溪区')
await page.waitForTimeout(400)
console.log('create ready:', await page.isEnabled('[data-start-card]'))
await shot('create-name')

// 8. 画像制作：用资料库
await page.click('[data-mode="dossier"]')
await page.waitForTimeout(300)
await page.click('.pick')
await page.waitForTimeout(500)
console.log('picked name:', await page.inputValue('[data-c="name"]'))
await shot('create-picked')

// 9. 画像库放大
await page.goto(`${base}#/cards`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.click('.tile-open')
await page.waitForTimeout(900)
await shot('viewer-card')
console.log('viewer img natural:', await page.$eval('.viewer-body.image img', (i) => i.naturalWidth).catch(() => 0))
await page.keyboard.press('Escape')

// 10. 示例：打开 + 做同款
await page.goto(`${base}#/examples`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await page.click('.example [data-open-example]')
await page.waitForTimeout(800)
await shot('viewer-example')
await page.keyboard.press('Escape')
await page.click('[data-copy-example]')
await page.waitForTimeout(600)
console.log('after 做同款 hash:', await page.evaluate(() => location.hash))
console.log('prefilled region:', await page.inputValue('[data-r="region"]').catch(() => ''))
await shot('example-clone')

console.log('console errors:', errors.length ? errors : 'none')
await browser.close()
