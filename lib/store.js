// 人物情报库 · 本地资料库 / 画像库
// 存在 $DSH_HOME/character-profile（没有 DSH_HOME 时是 ~/.dsh）：
//   dossiers/<id>.json   一份人物档案（元信息 + 完整 Markdown 正文）
//   cards/cards.json     画像卡清单
//   cards/<id>.png       画像卡成品（1080×1440）
//   cards/<id>.html      生成这张卡时用的 HTML（留底，方便改版）
// 只写本机，不上传任何地方。
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { analyzeDossier } from './coverage.js'

export const dataDir = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'character-profile')
export const dossiersDir = () => join(dataDir(), 'dossiers')
export const cardsDir = () => join(dataDir(), 'cards')
export const cardsFile = () => join(cardsDir(), 'cards.json')
export const mediaPath = (rel) => join(dataDir(), rel)

const newId = (p) => `${p}-${randomUUID().slice(0, 8)}`
const now = () => new Date().toISOString()
const ensure = (dir) => mkdirSync(dir, { recursive: true })

function writeAtomic(file, text) {
  ensure(join(file, '..'))
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

const clean = (v, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

// 层级统一成「省级 / 地市级 / 区县级 / 其他」，直辖市按省级归类：
//   北京市级 = 省级；北京市朝阳区 = 区县级；苏州市级 = 地市级。
// 旧数据 / 模型顺手写的「市级、区级、直辖市、副省级」在这里归一，展示层不再出现歧义。
const MUNICIPALITY = /^(北京|上海|天津|重庆)(市)?/
const DISTRICT_TAIL = /(区|县|旗|新区)$/
export function normalizeLevel(value, region = '') {
  const level = clean(value, 20)
  if (!level) return ''
  const place = clean(region, 80)
  if (/^(省级|省)$/.test(level) || /直辖市/.test(level)) return '省级'
  if (/^(市级|地市级|地级|副省级|副省级市)$/.test(level)) {
    if (!MUNICIPALITY.test(place)) return '地市级'
    return DISTRICT_TAIL.test(place) ? '区县级' : '省级'
  }
  if (/^(区级|县级|区县级)$/.test(level)) return '区县级'
  if (level === '其他') return '其他'
  return '其他'
}
const LEVEL_NOTE = '省级 = 省 / 自治区 / 直辖市；地市级 = 地级市 / 副省级市 / 自治州；区县级 = 市辖区 / 县 / 县级市'
export const levelHint = LEVEL_NOTE

const kindOfDossier = (v) => (v === 'institution' ? 'institution' : 'person')

function tagsOf(v) {
  if (Array.isArray(v)) return v.map((x) => clean(x, 40)).filter(Boolean).slice(0, 12)
  return clean(v, 200)
    .split(/[,，、;；\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 12)
}

function sourcesOf(v) {
  if (Array.isArray(v)) return v.map((x) => clean(x, 800)).filter(Boolean).slice(0, 60)
  return clean(v, 8000)
    .split(/\r?\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 60)
}

// 摘要：正文里第一个有内容的段落，压成一行
export function excerptOf(markdown, q) {
  const text = String(markdown || '')
  if (q) {
    const i = text.toLowerCase().indexOf(q.toLowerCase())
    if (i >= 0) {
      const from = Math.max(0, i - 60)
      return `${from > 0 ? '…' : ''}${text.slice(from, i + 140).replace(/\s+/g, ' ').trim()}…`
    }
  }
  for (const block of text.split(/\n{2,}/)) {
    const raw = block.split('\n').map((l) => l.trim()).filter(Boolean)
    // 表格块（基本信息 / 机构概况表）跳过：直接拿表格当前几行摘要很难看
    if (raw.length && raw.filter((l) => l.startsWith('|')).length >= raw.length * 0.6) continue
    const line = block
      .split('\n')
      .map((l) => l.replace(/^[#>\-*\s]+/, '').trim())
      .filter((l) => l && !/^\|?[-: |]+\|?$/.test(l))
      .join(' ')
      .trim()
    if (line.length >= 24) return line.slice(0, 130) + (line.length > 130 ? '…' : '')
  }
  return text.replace(/[#>*\-\s]+/g, ' ').trim().slice(0, 130)
}

function dossierMeta(d, q) {
  const kind = kindOfDossier(d.kind)
  return {
    id: d.id,
    name: d.name,
    kind,
    region: d.region,
    department: d.department,
    level: normalizeLevel(d.level, d.region),
    role: d.role,
    tags: d.tags,
    sources: d.sources.length,
    origin: d.origin === 'manual' ? 'uploaded' : d.origin,
    chars: d.chars,
    coverage: d.coverage || analyzeDossier(d.content, kind),
    summary: d.summary || excerptOf(d.content, q),
    excerpt: q ? excerptOf(d.content, q) : '',
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }
}

export function readDossier(id) {
  if (!/^d-[\w-]+$/.test(String(id))) return null
  const d = readJson(join(dossiersDir(), `${id}.json`), null)
  if (!d) return null
  const kind = kindOfDossier(d.kind)
  return { ...d, kind, level: normalizeLevel(d.level, d.region), coverage: d.coverage || analyzeDossier(d.content, kind) }
}

export function listDossiers(q = '') {
  if (!existsSync(dossiersDir())) return []
  const needle = clean(q, 80).toLowerCase()
  const out = []
  for (const f of readdirSync(dossiersDir())) {
    if (!f.endsWith('.json')) continue
    const d = readJson(join(dossiersDir(), f), null)
    if (!d || !d.id) continue
    if (needle) {
      const hay = [d.name, d.region, d.department, d.level, d.role, d.tags.join(' '), d.content].join('\n').toLowerCase()
      if (!hay.includes(needle)) continue
    }
    out.push(dossierMeta(d, needle))
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

export function saveDossier(input = {}) {
  const old = input.id ? readDossier(input.id) : null
  const content = String(input.content || '').replace(/\r\n/g, '\n').trim()
  if (!content) throw new Error('档案正文不能为空')
  const name = clean(input.name, 60) || (content.match(/^#\s*[一二三四五六七八九十\d]+[、.]\s*(.+)$/m) || [])[1] || (content.match(/^#\s*(.+)$/m) || [])[1] || '未命名人物'
  const region = clean(input.region, 80) || old?.region || ''
  const kind = input.kind !== undefined ? kindOfDossier(input.kind) : kindOfDossier(old?.kind)
  const dossier = {
    id: old?.id || newId('d'),
    name: clean(name, 60),
    kind,
    region,
    department: clean(input.department, 120) || old?.department || '',
    level: normalizeLevel(input.level !== undefined ? input.level : old?.level || '', region),
    role: clean(input.role, 160) || old?.role || '',
    tags: input.tags !== undefined ? tagsOf(input.tags) : old?.tags || [],
    sources: input.sources !== undefined ? sourcesOf(input.sources) : old?.sources || [],
    summary: clean(input.summary, 240),
    coverage: input.coverage && typeof input.coverage === 'object' ? input.coverage : analyzeDossier(content, kind),
    origin: clean(input.origin, 20) || old?.origin || 'uploaded',
    content,
    chars: content.length,
    createdAt: old?.createdAt || now(),
    updatedAt: now(),
  }
  writeAtomic(join(dossiersDir(), `${dossier.id}.json`), JSON.stringify(dossier, null, 2) + '\n')
  return dossier
}

export function deleteDossier(id) {
  const file = join(dossiersDir(), `${String(id)}.json`)
  if (!existsSync(file)) return false
  rmSync(file, { force: true })
  return true
}

// 上传的 Markdown / 纯文本：姓名优先取一级标题，取不到用文件名
export function dossierFromFile(filename, text) {
  const base = String(filename || '').replace(/\.[^.]+$/, '').trim()
  const body = String(text || '').replace(/\r\n/g, '\n').replace(/^\uFEFF/, '')
  if (!body.trim()) throw new Error('文件是空的')
  const heading = (body.match(/^#\s+(.+)$/m) || [])[1] || ''
  const name =
    (heading.match(/[：:]\s*([^·|｜]+)/) || [])[1]?.trim() ||
    (heading.match(/^([^\s·|｜：:]{2,8})\s*[·|｜]/) || [])[1]?.trim() ||
    heading.replace(/^[一二三四五六七八九十\d]+[、.]\s*/, '').trim() ||
    base
  const kind = /机构概况|机构档案|领导班子/.test(body) ? 'institution' : 'person'
  return saveDossier({
    name,
    content: body,
    kind,
    origin: 'uploaded',
    tags: [],
  })
}

// ---------------- 画像卡 ----------------
export function readCards() {
  const data = readJson(cardsFile(), { cards: [] })
  return Array.isArray(data.cards) ? data.cards : []
}

function writeCards(cards) {
  writeAtomic(cardsFile(), JSON.stringify({ cards }, null, 2) + '\n')
}

export function cardVersion(id) {
  const f = join(cardsDir(), `${id}.png`)
  try {
    return String(statSync(f).mtimeMs)
  } catch {
    return '0'
  }
}

export function listCards() {
  return readCards()
    .filter((c) => c && c.id)
    .map((c) => ({
      ...c,
      missing: !existsSync(join(cardsDir(), `${c.id}.png`)),
      version: cardVersion(c.id),
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

export function getCard(id) {
  return readCards().find((c) => c.id === id) || null
}

export function saveCard(input = {}) {
  const png = Buffer.isBuffer(input.png) ? input.png : Buffer.from(input.png || '')
  if (!png.length) throw new Error('缺少画像卡图片')
  const old = input.id ? getCard(input.id) : null
  const id = old?.id || newId('c')
  const card = {
    id,
    name: clean(input.name, 60) || old?.name || '未命名',
    title: clean(input.title, 120) || old?.title || '',
    subtitle: clean(input.subtitle, 200) || old?.subtitle || '',
    type: clean(input.type, 40) || old?.type || '',
    confidence: clean(input.confidence, 20) || old?.confidence || '',
    stars: clean(input.stars, 8) || old?.stars || '',
    region: clean(input.region, 80) || old?.region || '',
    period: clean(input.period, 60) || old?.period || '',
    note: clean(input.note, 300) || old?.note || '',
    origin: clean(input.origin, 20) || old?.origin || 'generated',
    dossierId: clean(input.dossierId, 40) || old?.dossierId || '',
    width: Number(input.width) || old?.width || 1080,
    height: Number(input.height) || old?.height || 1440,
    createdAt: old?.createdAt || now(),
    updatedAt: now(),
  }
  writeAtomic(join(cardsDir(), `${id}.png`), png)
  if (input.html) writeFileSync(join(cardsDir(), `${id}.html`), String(input.html))
  const cards = readCards().filter((c) => c.id !== id)
  writeCards([card, ...cards])
  return card
}

export function deleteCard(id) {
  const cards = readCards()
  if (!cards.some((c) => c.id === id)) return false
  writeCards(cards.filter((c) => c.id !== id))
  rmSync(join(cardsDir(), `${id}.png`), { force: true })
  rmSync(join(cardsDir(), `${id}.html`), { force: true })
  return true
}

export function stats() {
  const dossiers = listDossiers()
  const cards = listCards()
  return {
    dossiers: dossiers.length,
    cards: cards.length,
    people: new Set(dossiers.filter((d) => d.kind !== 'institution').map((d) => d.name)).size,
    institutions: dossiers.filter((d) => d.kind === 'institution').length,
    updatedAt: [...dossiers.map((d) => d.updatedAt), ...cards.map((c) => c.updatedAt)].sort().pop() || '',
  }
}
