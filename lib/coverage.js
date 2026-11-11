// 档案覆盖度：把一份 Markdown 拆成可核对的数字（章节、阶段、活动、信源、官方源、人数），
// 用来做两件事：
//   1. 保存前卡住「看起来很多、其实没查几条」的档案，逼模型继续检索；
//   2. 在资料库里直接显示「12 活动 · 9 源」，让覆盖度是看得见的。
// 只做结构统计，不判断内容质量；内容真假仍由 skill 的双源核验约束。

const OFFICIAL_HOST = /(^|\.)gov\.cn$|(^|\.)gov$|bj148\.org$|(^|\.)npc\.gov\.cn$|(^|\.)cppcc\.gov\.cn$|court\.gov\.cn$|spp\.gov\.cn$/i

function uniqueUrls(text) {
  const found = String(text).match(/https?:\/\/[^\s)）\]>，。；]+/g) || []
  const seen = new Set()
  for (const raw of found) {
    const url = raw.replace(/[.,;:]+$/, '')
    seen.add(url)
  }
  return [...seen]
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function sectionFlags(text) {
  const has = (re) => re.test(text)
  return {
    basic: has(/^##\s*[\d一二三四五六七八九十]+\.?1\s|^##\s*基本信息/m),
    current: has(/^##\s*[\d一二三四五六七八九十]+\.?2\s|^##\s*现任职务/m),
    appointments: has(/^##\s*[\d一二三四五六七八九十]+\.?3\s|^##\s*职务任免/m),
    career: has(/^##\s*[\d一二三四五六七八九十]+\.?4\s|^##\s*履历/m),
    activities: has(/^##\s*[\d一二三四五六七八九十]+\.?5\s|^##\s*公开活动/m),
  }
}

function tableRows(text, headingRe) {
  const lines = String(text).split('\n')
  const start = lines.findIndex((l) => headingRe.test(l))
  if (start < 0) return 0
  let rows = 0
  let inTable = false
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (/^##\s/.test(line)) break
    if (!/^\s*\|/.test(line)) {
      if (inTable && line.trim() === '') break
      continue
    }
    if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) continue
    inTable = true
    rows++
  }
  return Math.max(0, rows - 1) // 去掉表头
}

// 每个任职阶段收了几条活动；标了「该阶段未见公开活动记录」的阶段不算缺口
function stageCounts(text) {
  const stages = []
  let current = null
  for (const line of String(text).split('\n')) {
    if (/^###\s+[一二三四五六七八九十]+、/.test(line)) {
      current = { title: line.replace(/^###\s+/, '').trim(), activities: 0, empty: false }
      stages.push(current)
      continue
    }
    if (!current) continue
    if (/^####\s+/.test(line)) current.activities++
    if (/该阶段(未见|无)公开活动记录|该阶段未见公开活动/.test(line)) current.empty = true
  }
  return stages
}

/**
 * @param {string} markdown 档案正文
 * @param {"person"|"institution"} kind
 */
export function analyzeDossier(markdown, kind = 'person') {
  const text = String(markdown || '')
  const stageHeads = text.match(/^###\s+[一二三四五六七八九十]+、/gm) || []
  const h4 = text.match(/^####\s+/gm) || []
  const datedH3 = text.match(/^###\s+\d{4}(?:[.\-年])\d{1,2}/gm) || []
  const urls = uniqueUrls(text)
  const hosts = urls.map(hostOf)
  const official = hosts.filter((h) => OFFICIAL_HOST.test(h)).length
  const wechat = hosts.filter((h) => h === 'mp.weixin.qq.com').length
  const persons = (text.match(/^#\s+[一二三四五六七八九十]+、/gm) || []).length
  return {
    kind,
    sections: sectionFlags(text),
    stages: stageHeads.length,
    stageList: stageCounts(text),
    activities: h4.length || datedH3.length,
    sources: urls.length,
    official,
    wechat,
    persons,
    overview: /机构概况/.test(text),
    careerRows: tableRows(text, /^##\s*[\d一二三四五六七八九十]+\.?4\s|^##\s*履历/),
    appointmentRows: tableRows(text, /^##\s*[\d一二三四五六七八九十]+\.?3\s|^##\s*职务任免/),
    signedArticle: /署名文章|署名：|（署名）/.test(text),
    roster: /名单|领导小组|指挥部|协调小组/.test(text),
  }
}

// 全面 / 粗略的入库下限。数字故意留出余量：低于它基本撑不起后续画像分析。
const FLOOR = {
  person: {
    brief: { activities: 3, stages: 1, sources: 3, official: 1, careerRows: 1 },
    full: { activities: 12, stages: 2, sources: 10, official: 3, careerRows: 2 },
  },
  institution: {
    brief: { persons: 2, activities: 3, sources: 3, official: 1, overview: true },
    full: { persons: 3, activities: 8, sources: 8, official: 2, overview: true },
  },
}

/**
 * 对比下限，返回还缺什么（空数组表示达标）。
 * @param {ReturnType<typeof analyzeDossier>} cov
 * @param {{kind?: "person"|"institution", precision?: "brief"|"full"}} opts
 */
export function assessCoverage(cov, { kind = 'person', precision = 'full' } = {}) {
  const k = kind === 'institution' ? 'institution' : 'person'
  const p = precision === 'brief' ? 'brief' : 'full'
  const floor = FLOOR[k][p]
  const gaps = []
  const label = k === 'institution' ? '机构档案' : '人物档案'
  const mode = p === 'brief' ? '粗略搜索' : '全面搜索'

  if (k === 'institution') {
    if (floor.overview && !cov.overview) gaps.push('缺少「机构概况」：机构全称、隶属与层级、主要职能、领导班子、内设机构都要写。')
    if (cov.persons < floor.persons) gaps.push(`${label}只收录了 ${cov.persons} 位主要人物，${mode}至少要 ${floor.persons} 位（一把手、分管副职、党组成员等）。`)
  } else {
    const missing = Object.entries(cov.sections).filter(([, ok]) => !ok).map(([k2]) => ({ basic: '1.1 基本信息', current: '1.2 现任职务', appointments: '1.3 职务任免', career: '1.4 履历', activities: '1.5 公开活动与发言' })[k2])
    if (missing.length) gaps.push(`缺少章节：${missing.join('、')}。五章必须齐全。`)
    if (cov.careerRows < floor.careerRows) gaps.push(`履历只有 ${cov.careerRows} 行，至少要 ${floor.careerRows} 段任职经历；参加工作时间之前的经历查不到时也要写明。`)
  }

  if (cov.activities < floor.activities) gaps.push(`公开活动与发言只有 ${cov.activities} 条，${mode}至少要 ${floor.activities} 条${k === 'person' ? `，且每个任职阶段 ≥ 3 条（当前 ${cov.stages} 个阶段）` : ''}。`)
  if (k === 'person' && cov.stages < floor.stages) gaps.push(`只分出 ${cov.stages} 个任职阶段，${mode}至少要 ${floor.stages} 个；按履历逐段回溯，没有记录的阶段写明「该阶段未见公开活动记录」。`)
  for (const stage of cov.stageList || []) {
    const need = p === 'brief' ? 1 : 3
    if (!stage.empty && stage.activities < need) gaps.push(`「${stage.title}」只有 ${stage.activities} 条活动，${mode}下每个阶段至少要 ${need} 条；确实查不到就写明「该阶段未见公开活动记录」。`)
  }
  if (cov.sources < floor.sources) gaps.push(`独立信源只有 ${cov.sources} 个，${mode}至少要 ${floor.sources} 个（同一篇文章的转载只算一个）。`)
  if (cov.official < floor.official) gaps.push(`政府 / 人大 / 政协 / 法院 / 检察院等官方域名只有 ${cov.official} 个，至少要 ${floor.official} 个；公众号、媒体转载不能替代官方源。`)
  return gaps
}

export const coverageSummary = (c) => {
  if (!c) return ''
  if (c.kind === 'institution') return `${c.persons || 0} 位人物 · ${c.activities || 0} 活动 · ${c.sources || 0} 源`
  return `${c.activities || 0} 活动 · ${c.sources || 0} 源${c.stages ? ` · ${c.stages} 阶段` : ''}`
}
