// 插件注册给模型的五个工具。它们在 Host 进程里执行，不经过模型的 bash 沙箱：
// 资料库和画像库在工作区外（$DSH_HOME/character-profile），沙箱里的脚本写不进去。
// 工具注册在根上，所有智能体预设都能继承。
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { analyzeDossier, assessCoverage } from './coverage.js'
import { renderCardHtml } from './render.js'
import { getCard, listCards, listDossiers, readDossier, saveCard, saveDossier, stats } from './store.js'
import { searchWechatArticles } from './wechat.js'

const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
const text = (value) => [{ type: 'text', text: value }]

// 参数校验：注册的是原始 JSON Schema，没有 defineTool 帮忙校验，这里自己挡住缺字段和类型错
function check(args, schema) {
  const errs = []
  for (const k of schema.required || []) if (args?.[k] === undefined || args[k] === '') errs.push(`缺少 ${k}`)
  for (const [k, v] of Object.entries(args || {})) {
    const p = schema.properties[k]
    if (!p) errs.push(`未知参数 ${k}`)
    else if (p.enum && !p.enum.includes(v)) errs.push(`${k} 只能是 ${p.enum.join(' / ')}`)
    else if (p.type === 'string' && typeof v !== 'string') errs.push(`${k} 应该是字符串`)
    else if (p.type === 'array' && !Array.isArray(v)) errs.push(`${k} 应该是数组`)
    else if (p.type === 'boolean' && typeof v !== 'boolean') errs.push(`${k} 应该是布尔值`)
  }
  if (errs.length) throw new Error(errs.join('；'))
}

const DOSSIER_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'content'],
  properties: {
    name: str('人物姓名；搜机构时填机构全称'),
    kind: str('person：人物档案；institution：机构档案（机构概况 + 主要人物）。默认 person', { enum: ['person', 'institution'] }),
    content: str('整份档案的 Markdown 原文（按 skill 的 format-spec：基本信息、现任职务、职务任免、履历、公开活动与发言五章；机构档案在开头加「机构概况」）'),
    region: str('地区 / 单位，例如「北京市朝阳区」'),
    department: str('具体部门 / 机构全称，例如「区经济和信息化局」'),
    level: str('层级，只能填：省级 / 地市级 / 区县级 / 其他。直辖市按省级归类：北京市级 = 省级，北京市朝阳区 = 区县级；苏州市级 = 地市级'),
    role: str('现任职务全称（机构档案可留空）'),
    tags: str('关注方向或主要人物，用逗号分隔，例如「游戏电竞,数字经济」'),
    sources: str('主要来源链接，一行一个'),
    summary: str('一句话摘要（可选）'),
    precision: str('本次检索精度：full（全面搜索，默认）/ brief（粗略搜索）。工具会按它检查覆盖度', { enum: ['full', 'brief'] }),
    source: str('research：模型检索生成的档案（默认，会检查覆盖度）；user：用户提供的材料整理入库（跳过覆盖度门槛，origin 记为上传）', { enum: ['research', 'user'] }),
    force: { type: 'boolean', description: '确实多轮检索后仍达不到覆盖度下限时才传 true，并在 note 里说明查过哪些渠道' },
    note: str('force 时必填：说明已经检索过哪些渠道、为什么补不齐'),
    id: str('更新已有档案时传它的 id；新建不传'),
  },
}

export const dossierTool = {
  name: 'character_profile_save_dossier',
  description: '把调研好的人物或机构档案存进「人物情报库」插件的人物资料库。默认 source=research，保存前会按检索精度检查覆盖度（章节、阶段、活动条数、信源、官方源）；不达标会拒绝保存并列出缺口，让你继续检索补齐。整理用户提供的材料时传 source=user，跳过覆盖度门槛、origin 记为上传。同一个人 / 机构更新时传 id 覆盖旧版。',
  parameters: DOSSIER_PARAMS,
  timeoutMs: 60_000,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'saved'],
      properties: {
        ok: { type: 'boolean' },
        saved: { type: 'boolean' },
        id: { type: 'string' },
        name: { type: 'string' },
        chars: { type: 'integer' },
        coverage: { type: 'object', additionalProperties: true },
        gaps: { type: 'array', items: { type: 'string' } },
      },
    },
    render: (_args, v) => {
      if (!v.saved) return text(`未保存：覆盖度不足。\n${(v.gaps || []).map((g) => `- ${g}`).join('\n')}\n补齐后重新调用（同一个 id）；如果确实已多轮检索仍查不到，传 force: true 并在 note 里说明已查渠道。`)
      const c = v.coverage || {}
      const sum = c.kind === 'institution'
        ? `${c.persons || 0} 位人物 / ${c.activities || 0} 条活动 / ${c.sources || 0} 个信源（官方 ${c.official || 0}）`
        : `${c.activities || 0} 条活动 / ${c.sources || 0} 个信源（官方 ${c.official || 0}）/ ${c.stages || 0} 个阶段`
      const warn = v.gaps && v.gaps.length ? `\n注意：这是按 force 保存的，仍有缺口：\n${v.gaps.map((g) => `- ${g}`).join('\n')}` : ''
      const userNote = c.source === 'user' ? '\n（按用户提供的材料整理入库，未套检索覆盖度门槛）' : ''
      return text(`已存入资料库：${v.name}（${v.id}，${v.chars} 字）。覆盖度：${sum}。用户可以在侧栏「人物情报库 → 人物资料库」里看到它。${warn}${userNote}`)
    },
  },
  async execute(args) {
    check(args, DOSSIER_PARAMS)
    if (args.id && !readDossier(args.id)) throw new Error(`找不到档案 ${args.id}，要新建就不要传 id`)
    const kind = args.kind || 'person'
    const precision = args.precision || 'full'
    const source = args.source === 'user' ? 'user' : 'research'
    const coverage = analyzeDossier(args.content, kind)
    const gaps = source === 'user' ? [] : assessCoverage(coverage, { kind, precision })
    if (source === 'research' && gaps.length && !args.force) return { ok: false, saved: false, coverage, gaps }
    if (source === 'research' && gaps.length && args.force && !String(args.note || '').trim()) throw new Error('force 保存时必须在 note 里说明已经检索过哪些渠道、为什么补不齐')
    const d = saveDossier({
      ...args,
      kind,
      coverage: { ...coverage, precision, ...(source === 'user' ? { source: 'user' } : {}), ...(gaps.length ? { forced: true, note: String(args.note || '').trim() } : {}) },
      origin: source === 'user' ? 'uploaded' : 'researched',
    })
    return { ok: true, saved: true, id: d.id, name: d.name, chars: d.chars, coverage: d.coverage, gaps }
  },
}

const CARD_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: str('人物姓名'),
    html: str('卡面 HTML 全文（1080×1440，单文件，内联样式）。传了就在 Host 里渲染成 PNG'),
    imagePath: str('已经有现成 PNG 时给绝对路径（和 html 二选一）'),
    title: str('卡片标题，默认「姓名｜人物画像卡」'),
    subtitle: str('副标题：地区 / 单位 / 职务 / 观察期，一行以内'),
    type: str('治理风格类型：事务推进型 / 协调解题型 / 系统部署型 / 机制整合型 / 证据不足'),
    confidence: str('把握程度：较高 / 中等 / 较低'),
    stars: str('游戏企业支持度，例如「4」「4.5」「未知」'),
    region: str('地区 / 单位'),
    period: str('观察期，例如「2026.10—11」'),
    dossierId: str('这份卡依据的资料库档案 id（有就传）'),
    note: str('底稿备注（可选，卡面上不显示）'),
  },
}

export const cardTool = {
  name: 'character_profile_save_card',
  description: '把做好的 1080×1440 人物画像卡存进「人物情报库」插件的人物画像库。传 html 时由插件在 Host 进程里用浏览器渲染成 PNG，不需要模型自己截图；页面会立即出现这张卡并提供预览。',
  parameters: CARD_PARAMS,
  timeoutMs: 180_000,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'width', 'height'],
      properties: { id: { type: 'string' }, name: { type: 'string' }, width: { type: 'integer' }, height: { type: 'integer' } },
    },
    render: (_args, v) => text(`已存入人物画像库：${v.name}（${v.id}，${v.width}×${v.height}）。用户可以在侧栏「人物情报库 → 人物画像库」里看到它，页面会弹出预览。`),
  },
  async execute(args) {
    check(args, CARD_PARAMS)
    let png
    let width = 1080
    let height = 1440
    if (args.imagePath) {
      if (!isAbsolute(args.imagePath)) throw new Error('imagePath 要用绝对路径')
      if (!existsSync(args.imagePath)) throw new Error(`找不到图片 ${args.imagePath}`)
      if (!/\.(png|jpe?g|webp)$/i.test(args.imagePath)) throw new Error('imagePath 只支持 PNG / JPEG / WebP')
      const size = statSync(args.imagePath)
      if (size.size > 24 * 1024 * 1024) throw new Error('图片超过 24MB')
      png = readFileSync(args.imagePath)
    } else if (args.html) {
      png = await renderCardHtml(args.html, { width, height })
    } else {
      throw new Error('html 和 imagePath 至少给一个')
    }
    const card = saveCard({
      png,
      name: args.name,
      title: args.title || `${args.name}｜人物画像卡`,
      subtitle: args.subtitle || '',
      type: args.type || '',
      confidence: args.confidence || '',
      stars: args.stars || '',
      region: args.region || '',
      period: args.period || '',
      dossierId: args.dossierId || '',
      note: args.note || '',
      html: args.html || '',
      width,
      height,
      origin: 'generated',
    })
    return { id: card.id, name: card.name, width: card.width, height: card.height }
  },
}

const READ_PARAMS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: str('档案 id（d-xxxxxxxx）。有 id 就按 id 读'),
    name: str('人物姓名。没有 id 时按姓名找，重名会列出全部匹配'),
  },
}

export const readDossierTool = {
  name: 'character_profile_read_dossier',
  description: '读取「人物情报库」插件人物资料库里的一份档案全文。做画像卡前先读这里，比重新检索快，也能保证卡面和档案口径一致。',
  parameters: READ_PARAMS,
  output: {
    schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } },
    render: (_args, v) => text(v.text),
  },
  async execute(args) {
    check(args, READ_PARAMS)
    if (args.id) {
      const d = readDossier(args.id)
      if (!d) throw new Error(`找不到档案 ${args.id}`)
      return { text: `档案 ${d.id}｜${d.name}（${d.region}${d.department ? ' · ' + d.department : ''}）\n\n${d.content}` }
    }
    const name = String(args.name || '').trim()
    if (!name) throw new Error('id 和 name 至少给一个')
    const hits = listDossiers(name).filter((d) => d.name === name || d.name.includes(name))
    if (!hits.length) return { text: `资料库里没有「${name}」。可以先按 skill 去公开渠道检索，或用 character_profile_save_dossier 先建档。` }
    if (hits.length > 1) {
      return { text: `资料库里有 ${hits.length} 条匹配，请用 id 指定：\n${hits.map((d) => `- ${d.id}｜${d.name}｜${d.region}${d.department ? ' · ' + d.department : ''}｜更新 ${d.updatedAt.slice(0, 10)}`).join('\n')}` }
    }
    const d = readDossier(hits[0].id)
    return { text: `档案 ${d.id}｜${d.name}\n\n${d.content}` }
  },
}

const LIB_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: str('list：列出资料库 / 画像库；stats：数量统计', { enum: ['list', 'stats'] }),
    kind: str('list 时看哪个库：dossiers（人物资料）/ cards（画像卡）', { enum: ['dossiers', 'cards'] }),
    q: str('按姓名 / 地区 / 单位 / 正文关键字过滤'),
  },
}

export const libraryTool = {
  name: 'character_profile_library',
  description: '查看「人物情报库」插件的资料库和画像库清单（最近更新在前），用来判断某个人有没有做过档案、有没有出过卡。',
  parameters: LIB_PARAMS,
  output: {
    schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } },
    render: (_args, v) => text(v.text),
  },
  async execute(args) {
    check(args, LIB_PARAMS)
    if (args.action === 'stats') {
      const s = stats()
      return { text: `人物资料 ${s.dossiers} 份（${s.people} 位人物），画像卡 ${s.cards} 张。最近更新：${s.updatedAt ? s.updatedAt.slice(0, 16).replace('T', ' ') : '—'}` }
    }
    if (args.kind === 'cards') {
      const cards = listCards().filter((c) => !args.q || [c.name, c.region, c.type].join(' ').includes(args.q))
      if (!cards.length) return { text: '画像库里还没有卡片。' }
      return { text: `画像库共 ${cards.length} 张：\n${cards.slice(0, 40).map((c) => `- ${c.id}｜${c.name}｜${c.type || '未标类型'}｜${c.origin === 'uploaded' ? '上传' : '生成'}｜${c.createdAt.slice(0, 10)}`).join('\n')}` }
    }
    const list = listDossiers(args.q || '')
    if (!list.length) return { text: '资料库里还没有档案。' }
    return { text: `人物资料库共 ${list.length} 份：\n${list.slice(0, 40).map((d) => `- ${d.id}｜${d.name}｜${d.region || '未填地区'}${d.department ? ' · ' + d.department : ''}｜${d.chars} 字｜更新 ${d.updatedAt.slice(0, 10)}`).join('\n')}` }
  },
}

const WECHAT_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    query: str('搜索关键词：人名、活动名、单位 + 年份，或文章标题；越短越容易命中'),
    num: { type: 'number', description: '返回条数，默认 8，最多 20' },
  },
}

export const wechatSearchTool = {
  name: 'character_profile_wechat_search',
  description: '用搜狗微信搜索公众号文章，返回标题、摘要、发布时间、公众号名称和搜狗跳转链接。用来发现公众号线索、确认文章标题 / 日期 / 账号；摘要不是全文、链接是搜狗跳转，不要当原文抓取，也不要直接当档案来源；正文仍要去找区政府 / 区委党校 / 北京组工网 / 北京号 / 融媒体等同源版本。只做公开信息检索，控制频率，一次任务用一两次即可。',
  parameters: WECHAT_PARAMS,
  timeoutMs: 60_000,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'query', 'total', 'articles'],
      properties: {
        ok: { type: 'boolean' },
        query: { type: 'string' },
        total: { type: 'number' },
        note: { type: 'string' },
        articles: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'url', 'summary', 'datetime', 'date_text', 'source'],
            properties: {
              title: { type: 'string' },
              url: { type: 'string' },
              summary: { type: 'string' },
              datetime: { type: 'string' },
              date_text: { type: 'string' },
              source: { type: 'string' },
            },
          },
        },
      },
    },
    render: (_args, v) => {
      if (!v.articles?.length) return text(`搜狗微信没有返回结果。${v.note ? `\n${v.note}` : '换个更短的关键词再试一次。'}`)
      const lines = v.articles.slice(0, 10).map((a, i) => `${i + 1}. ${a.date_text || '日期未知'} · ${a.source || '公众号未知'}\n   ${a.title}\n   ${a.summary || '（无摘要）'}\n   ${a.url}`)
      return text(`搜狗微信「${v.query}」命中 ${v.total} 条。摘要只是线索、链接是搜狗跳转，不要直接引用或抓取；正文请找政府 / 党校 / 北京号 / 融媒体同源版本：\n${lines.join('\n')}`)
    },
  },
  async execute(args) {
    check(args, WECHAT_PARAMS)
    return { ok: true, ...(await searchWechatArticles(args.query, args.num)) }
  },
}

export const TOOLS = [dossierTool, cardTool, readDossierTool, libraryTool, wechatSearchTool]
