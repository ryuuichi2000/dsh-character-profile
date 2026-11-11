// 重新渲染卡面 PNG：node scripts/render-example.mjs
// 1) 官方示例 examples/portrait-shenwangshu.html → png
// 2) skill 的版式样例 skills/governance-portrait/assets/layout-example.html → png
// 改完 HTML 跑一次，保持卡面文字（比如右上角的 PROFILE）一致。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderCardHtml } from '../lib/render.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const targets = [
  ['examples/portrait-shenwangshu.html', 'examples/portrait-shenwangshu.png'],
  ['skills/governance-portrait/assets/layout-example.html', 'skills/governance-portrait/assets/layout-example.png'],
]
for (const [src, out] of targets) {
  const html = readFileSync(join(root, src), 'utf8')
  const png = await renderCardHtml(html)
  writeFileSync(join(root, out), png)
  console.log(`${out} ok ${png.length} bytes`)
}
