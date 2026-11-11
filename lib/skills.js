// skill 提供方：把插件自带的两个 skill（skills/）注册进 DSH 的 skill 目录（ctx.skills）。
// 用户自己在 ~/.dsh/skills 或项目里装了同名 skill 时，那一份优先（本提供方按「随包提供」的 rank 600 排在最后）。
// 加载正文时把 <SKILL_ROOT> 换成实际目录，并在末尾补一段「在这个插件里怎么交付」的说明。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const RANK = 600
const INVOCATION = { modelInvocable: true, userInvocable: true }

function parse(file) {
  const text = readFileSync(file, 'utf8')
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return null
  const field = (k) => (m[1].match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1]?.trim().replace(/^(["'])(.*)\1$/, '$2')
  const name = field('name')
  const description = field('description')
  return name && description ? { name, description, body: text.slice(m[0].length) } : null
}

export function readSkills(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'SKILL.md')))
    .map((d) => ({ dir: join(dir, d.name), file: join(dir, d.name, 'SKILL.md'), ...parse(join(dir, d.name, 'SKILL.md')) }))
    .filter((s) => s.name)
}

// 插件环境下对 skill 原文的补充：照着 skill 做完之后，把成果交给本插件的库，
// 而不是让模型自己在工作区里找地方放。工具在 Host 进程里执行，能写工作区外的数据目录。
function addendum(skill) {
  const lines = [
    '',
    '---',
    '',
    '## 在「人物情报库」插件（DSH）里使用',
    '',
    `- 本 skill 的目录是 \`${skill.dir}\`，上文的 \`references/\`、\`assets/\`、\`templates/\` 都相对这个目录。`,
    '- 用户从侧栏「人物情报库」打开的任务，成果要存进插件的库；下面的工具在 Host 进程里执行，不需要、也不要用 bash 去写数据目录。',
  ]
  if (skill.name === 'person-dossier') {
    lines.push(
      '- 调研完成后，调用 `character_profile_save_dossier` 工具保存整份档案（Markdown 原文放 `content`），用户就能在「人物情报库 → 人物资料库」里看到它。一个人物一份档案；同一个人再次调研时传 `id` 覆盖旧版。',
      '- 公众号 / 官网线索先用 `character_profile_yuanbao_search` 搜（元宝搜索，公众号卡片带正文片段），再用 `character_profile_wechat_search` 补标题 / 摘要 / 日期 / 账号；正文引用前用官方同源版本核对，不要把摘要当全文。',
      '- 用户要查的是机构时：`kind` 填 `institution`，`name` 填机构全称，正文开头加「机构概况」，再按 format-spec 为主要人物逐人建档，最后存成一份机构档案（tags 里填主要人物姓名）。',
      '- 层级只填 `省级` / `地市级` / `区县级` / `其他`，不要写「市级、区级」。直辖市按省级归类：北京市级 = 省级，北京市朝阳区 = 区县级；苏州市级 = 地市级。',
      '- 保存成功后再回复用户，并说明已存到「人物资料库」；如果用户接下来想看画像，可以去「画像制作」页从资料库选人。',
      '- 用户要的若是「画像卡」而不只是档案，接着按 governance-portrait 的规范出卡，最后用 `character_profile_save_card` 保存。',
    )
  }
  if (skill.name === 'governance-portrait') {
    lines.push(
      '- 卡面写成单文件 HTML（固定 1080×1440，字体只用本机有的中文字体），调用 `character_profile_save_card` 工具保存：`html` 传完整 HTML，工具会在 Host 进程里渲染成 PNG、存进「人物画像库」，并返回卡片 id。不要用 bash 自己截图。',
      '- `character_profile_save_card` 也接受 `imagePath`：只有当你已经有现成 PNG 文件时才用。',
      '- 保存成功后回复用户：已存到「人物画像库」，页面会自动弹出预览。不要重复渲染、也不要自己找地方放图片。',
      '- 需要资料时先看「人物资料库」里有没有：调用 `character_profile_library`（action: list）或 `character_profile_read_dossier` 读取，比重新检索快。',
    )
  }
  return lines.join('\n') + '\n'
}

export function createSkillProvider(dir) {
  const candidate = (s) => ({
    name: s.name,
    description: s.description,
    path: s.file,
    invocation: INVOCATION,
    source: 'bundled',
    provider: 'character-profile',
    rank: RANK,
    locator: s.dir,
    resourceBase: { kind: 'directory', path: s.dir },
  })
  return {
    name: 'character-profile',
    async list() {
      return readSkills(dir).map(candidate)
    },
    async get(c) {
      const s = readSkills(dir).find((x) => x.dir === c.locator && x.name === c.name)
      if (!s) return undefined
      const content = s.body.replaceAll('<SKILL_ROOT>', s.dir) + addendum(s)
      const { rank, locator, ...summary } = candidate(s)
      return { ...summary, content }
    },
  }
}
