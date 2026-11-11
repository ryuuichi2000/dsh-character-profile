// 人物情报库 · 插件页面
// 读 /character-profile/api/catalog，按 #/路由 渲染：
//   人物资料库  看 / 搜 / 传 / 改 / 删 / 一键去做画像卡
//   人物画像库  一行两张，点开放大；可上传、删除；画像制作出的卡自动出现在这里
//   资料搜集    填空 → 完整度提示 → 生成 prompt → 复制或直接开新对话
//   画像制作    资料库选人 / 上传资料 / 只输姓名 → 生成画像卡 prompt → 开新对话 → 自动预览
//   官方示例    两份脱敏示例，可打开、可一键做同款
const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...el.querySelectorAll(s)]
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const icon = (n) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`
const date = (iso) => (iso ? new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replaceAll('/', '.') : '')
const time = (iso) => (iso ? new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replaceAll('/', '.') : '')
const bytes = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`)
const safeFilename = (s, fallback = '人物画像卡') => String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || fallback
const downloadName = (c) => `${safeFilename(c.name, '人物画像卡')}-人物画像卡.png`

const ICONS = {
  library: '<path d="M4 4.5h4.5V20H4zM10.5 4.5h4V20h-4zM17 5.5l3 13.6"/>',
  cards: '<rect x="3" y="4" width="18" height="16"/><path d="M3 15.5l5-5 4 4 3-3 6 6"/><circle cx="9" cy="8.5" r="1.4"/>',
  research: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5M8.5 11h5M11 8.5v5"/>',
  create: '<path d="M4 20l4.2-1 11-11-3.2-3.2L5 15.8z"/><path d="M14.5 6.5l3.2 3.2"/>',
  book: '<path d="M4 5.5C7 4.5 9.5 4.5 12 6.5c2.5-2 5-2 8-1V19c-3-1-5.5-1-8 1-2.5-2-5-2-8-1zM12 6.5V20"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L20 8l-4-4L4 16zM14 6l4 4"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  folder: '<path d="M3 6.5h6l2 2h10v11H3z"/>',
  arrow: '<path d="M7 17 17 7M8 7h9v9"/>',
  right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  zoom: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5M8.5 11h5M11 8.5v5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.3M20 4v7h-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5 10 17 19 7"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
}

// ---------------- 状态 ----------------
const DEFAULT = {
  view: 'dossiers',
  q: '',
  level: 'all',
  origin: 'all',
  cardQ: '',
  cardOrigin: 'all',
  research: { mode: 'person', name: '', region: '', department: '', org: '', precision: 'full' },
  create: { mode: 'dossier', name: '', region: '', department: '', role: '', period: '', focus: '', material: '', dossierId: '', pickQ: '' },
  pending: null,
  lastCardId: '',
  hiddenJob: '',
  banner: '',
}
const LS = 'character-profile/state/v2'
function readState() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS) || 'null')
    if (!saved || typeof saved !== 'object') return null
    return {
      ...DEFAULT,
      ...saved,
      research: { ...DEFAULT.research, ...(saved.research || {}) },
      create: { ...DEFAULT.create, ...(saved.create || {}) },
    }
  } catch {
    return null
  }
}
const state = readState() || structuredClone(DEFAULT)
let saveTimer = 0
function persist() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const { research, create, pending, lastCardId, banner } = state
      localStorage.setItem(LS, JSON.stringify({ research, create, pending, lastCardId, banner }))
    } catch {}
  }, 160)
}

let data = null
let searchHits = null

// ---------------- 数据 ----------------
async function load({ quiet } = {}) {
  try {
    data = await fetch('api/catalog', { cache: 'no-store' }).then((r) => r.json())
  } catch (e) {
    if (!quiet) toast(`读不到资料库：${e.message}`)
    return
  }
  if (!searchHits || !state.q) searchHits = data.dossiers
  paintCounts()
  render({ keepFocus: true })
  checkPending()
  if (state.q.trim()) refreshDossierList()
}

function paintCounts() {
  if (!data) return
  $$('[data-count="dossiers"]').forEach((el) => (el.textContent = data.stats.dossiers || ''))
  $$('[data-count="cards"]').forEach((el) => (el.textContent = data.stats.cards || ''))
  const foot = $('#rail-foot')
  if (foot)
    foot.innerHTML = `<div class="v-head">插件 v${esc(data.version)}</div>
      <div class="v-row"><span>人物资料</span><span>${data.stats.dossiers} 份</span></div>
      <div class="v-row"><span>画像卡</span><span>${data.stats.cards} 张</span></div>
      <div class="v-row"><span>数据位置</span><span title="${esc(data.dataDir || '本机')}">本机</span></div>`
}

// ---------------- 通用块 ----------------
function head(eyebrow, title, desc, actions = '') {
  return `<header class="head"><span class="eyebrow">${esc(eyebrow)}</span><h1>${esc(title)}</h1>${desc ? `<p>${esc(desc)}</p>` : ''}${actions ? `<div class="head-actions">${actions}</div>` : ''}</header>`
}
function secHead(num, title, more) {
  return `<div class="sec-head"><span class="num">${num}</span><h2>${esc(title)}</h2>${more ? `<a class="more" href="${more}">查看全部${icon('right')}</a>` : ''}</div>`
}
function banner() {
  if (!state.banner) return ''
  return `<div class="banner-note"><span class="mono">提示</span><span>${esc(state.banner)} <button data-dismiss-banner>知道了</button></span></div>`
}
function pendingNote(kind) {
  const p = state.pending
  if (!p || p.kind !== kind || p.background) return ''
  return `<div class="banner-note"><span class="mono">进行中</span><span>任务已在新对话里发出（${time(p.at)}）。模型保存后，这里会自动提示，并且弹出预览。<button data-refresh>刷新</button></span></div>`
}

// ---------------- 后台任务 ----------------
let jobs = []
let lastJobStatus = new Map()

const JOB_LABEL = { queued: '排队中', running: '进行中', done: '已完成', error: '失败', canceled: '已取消' }

function latestJob(kind) {
  const p = state.pending
  if (p?.jobId) {
    const hit = jobs.find((j) => j.id === p.jobId)
    if (hit) return hit
  }
  const hit = jobs.find((j) => j.kind === kind) || null
  return hit && hit.id !== state.hiddenJob ? hit : null
}

function clientProgress(job) {
  if (job.status === 'done' || job.status === 'error' || job.status === 'canceled') return 100
  if (job.status === 'queued') return 4
  const elapsed = job.startedAt ? Math.max(0, (Date.now() - new Date(job.startedAt).getTime()) / 1000) : 0
  const tau = job.kind === 'card' ? 360 : job.kind === 'import' ? 240 : 600
  return Math.max(6, Math.min(94, Math.round(8 + 86 * (1 - Math.exp(-elapsed / tau)) + Math.min(6, (job.steps || 0) * 0.2))))
}
function jobPanel(kind) {
  const job = latestJob(kind)
  if (!job) return ''
  const elapsed = job.startedAt ? Math.max(0, Math.round((new Date(job.finishedAt || Date.now()) - new Date(job.startedAt)) / 1000)) : 0
  const mm = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
  const running = job.status === 'running' || job.status === 'queued'
  const result = job.resultIds?.[0]
  const pct = clientProgress(job)
  return `<div class="job-panel st-${esc(job.status)}" id="job-panel">
    <div class="job-top">
      <span class="job-dot"></span>
      <span class="job-title">${esc(job.kindLabel)}${job.name ? ` · ${esc(job.name)}` : ''}</span>
      <span class="mono job-state">${esc(JOB_LABEL[job.status] || job.status)}</span>
      <span class="mono job-elapsed">${running ? `已跑 ${mm}` : time(job.finishedAt || job.updatedAt)}</span>
    </div>
    <div class="job-line">${esc(job.phase || '')}${job.steps ? ` · 第 ${job.steps} 步` : ''}${job.lastTool ? ` · ${esc(job.lastTool)}` : ''}${job.agentPreset ? ` · preset ${esc(job.agentPreset)}` : ''}</div>
    <div class="job-progress-row">
      <div class="job-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="任务进度"><i style="width:${pct}%"></i></div>
      <span class="mono job-pct">约 ${pct}%</span>
    </div>
    ${job.error ? `<div class="job-error">${esc(job.error)}</div>` : ''}
    ${job.text && !running ? `<div class="job-text">${esc(job.text.slice(0, 600))}</div>` : ''}
    <div class="job-actions">
      ${running ? `<button class="btn ghost sm" data-cancel-job="${job.id}">取消任务</button>` : ''}
      ${result ? `<button class="btn sm" data-open-job-result="${esc(result.id)}" data-result-kind="${esc(result.kind)}">查看结果</button>` : ''}
      ${running ? '' : `<button class="btn ghost sm" data-dismiss-job="${job.id}">收起</button>`}
      <button class="btn ghost sm" data-refresh>刷新状态</button>
    </div>
  </div>`
}

function paintJobPanel() {
  const kind = state.pending?.kind || (state.view === 'create' ? 'card' : state.view === 'dossiers' ? 'import' : 'research')
  const box = $('#job-panel')
  if (!box) {
    const active = jobs.some((j) => j.kind === kind && (j.status === 'running' || j.status === 'queued'))
    if (state.pending?.jobId || active) render()
    return
  }
  const html = jobPanel(kind)
  if (html) box.outerHTML = html
  else box.remove()
}

async function refreshJobs() {
  try {
    const r = await fetch('api/jobs', { cache: 'no-store' }).then((x) => x.json())
    jobs = r.jobs || []
  } catch {
    jobs = []
  }
  // 有任务刚结束：把资料库刷新一遍
  let finished = false
  for (const j of jobs) {
    const prev = lastJobStatus.get(j.id)
    if (prev && prev !== j.status && (j.status === 'done' || j.status === 'error' || j.status === 'canceled')) finished = true
    lastJobStatus.set(j.id, j.status)
  }
  paintJobPanel()
  if (finished) await load({ quiet: true })
  return jobs
}
function toast(text) {
  const t = $('#toast')
  t.textContent = text
  t.classList.add('show')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => t.classList.remove('show'), 3200)
}

const LEVELS = ['省级', '地市级', '区县级', '其他']
const LEVEL_HINT = '直辖市按省级归类：北京市级 = 省级，北京市朝阳区 = 区县级；苏州市级 = 地市级。'
const ORIGINS = [
  ['all', '全部'],
  ['researched', '调研'],
  ['uploaded', '上传'],
]
const originLabel = (o) => ({ researched: '调研', uploaded: '上传', manual: '上传' })[o] || '上传'

// ---------------- 人物资料库 ----------------
function dossierMatches(d) {
  if (state.level !== 'all' && d.level !== state.level) return false
  if (state.origin !== 'all' && d.origin !== state.origin) return false
  return true
}
function coverageLine(d) {
  const c = d.coverage
  if (!c) return ''
  if (d.kind === 'institution') return `${c.persons || 0} 位人物 · ${c.activities || 0} 活动 · ${c.sources || 0} 源`
  return `${c.activities || 0} 活动 · ${c.sources || 0} 源 · ${c.official || 0} 官方`
}
function dossierRows() {
  const list = (searchHits || data.dossiers).filter(dossierMatches)
  if (!list.length)
    return `<div class="empty"><div class="empty-title">${state.q ? '没有匹配的档案' : '还没有人物 / 机构档案'}</div>${
      state.q ? '换个姓名、地区、单位或正文里的词再搜。' : '去「资料搜集」让模型按 skill 建一份，或把现成的 Markdown 拖进来。'
    }</div>`
  return `<div class="row-head mono"><span>名称 / 摘要</span><span>地区 · 单位</span><span>层级</span><span>篇幅</span><span>操作</span></div>
    <div class="table">${list
      .map(
        (d) => `<div class="row">
      <div>
        <div class="r-title">${esc(d.name)} ${d.kind === 'institution' ? '<span class="tag">机构</span>' : ''}<span class="tag ${d.origin === 'researched' ? 'blue' : ''}">${originLabel(d.origin)}</span></div>
        <div class="r-sub">${esc(d.excerpt || d.summary || '—')}</div>
        <div class="r-cov mono">${esc(coverageLine(d))}${d.coverage?.forced ? ' · 覆盖度已说明' : ''}</div>
      </div>
      <div class="r-unit">${esc([d.region, d.department].filter(Boolean).join(' · ') || '未填')}</div>
      <div>${d.level ? `<span class="tag">${esc(d.level)}</span>` : '<span class="tag">—</span>'}</div>
      <div class="r-num">${d.chars} 字<br>${date(d.updatedAt)}</div>
      <div class="r-act">
        <button class="btn ghost sm" data-open-dossier="${d.id}">查看</button>
        <button class="btn ghost sm" data-edit-dossier="${d.id}">编辑</button>
        <button class="btn sm" data-make-card="${d.id}" ${d.kind === 'institution' ? 'hidden' : ''}>做画像卡</button>
        <button class="ibtn sm" data-del-dossier="${d.id}" title="删除" aria-label="删除">${icon('trash')}</button>
      </div>
    </div>`,
      )
      .join('')}</div>`
}
function viewDossiers() {
  return `${head('人物资料库', '人物资料库', '过去调研过的、主动上传的人物与机构档案都在这里。上传、检索、编辑、删除都在这页；人物档案可以直接拿去做画像卡。', `<button class="btn" data-upload-dossier>${icon('upload')}上传资料</button><button class="btn ghost" data-new-dossier>${icon('plus')}新建档案</button>`)}
    ${pendingNote('import')}${jobPanel('import')}
    <div class="toolbar">
      <label class="search">${icon('search')}<input id="dq" type="search" placeholder="搜姓名、地区、单位，或正文里的词" value="${esc(state.q)}"></label>
      <div class="pills">${['all', ...LEVELS].map((l) => `<button class="pill" data-level="${l}" aria-pressed="${state.level === l}" title="${esc(LEVEL_HINT)}">${l === 'all' ? '全部层级' : l}</button>`).join('')}</div>
    </div>
    <div class="toolbar" style="margin-top:-8px">
      <span class="mono" style="color:var(--text-helper)">来源</span>
      <div class="pills" style="margin-left:0">${ORIGINS.map(([k, l]) => `<button class="pill" data-origin="${k}" aria-pressed="${state.origin === k}">${l}</button>`).join('')}</div>
      <span class="mono" style="margin-left:auto;color:var(--text-helper)" id="dossier-count">${(searchHits || data.dossiers).filter(dossierMatches).length} 份</span>
    </div>
    <p class="list-note" style="margin-top:-4px;margin-bottom:12px">${esc(LEVEL_HINT)}</p>
    <div id="dossier-list">${dossierRows()}</div>`
}

async function refreshDossierList() {
  const q = state.q.trim()
  try {
    const r = await fetch(`api/dossiers${q ? `?q=${encodeURIComponent(q)}` : ''}`, { cache: 'no-store' }).then((x) => x.json())
    searchHits = r.dossiers || []
  } catch {
    searchHits = data.dossiers
  }
  const box = $('#dossier-list')
  if (box) box.innerHTML = dossierRows()
  const c = $('#dossier-count')
  if (c) c.textContent = `${(searchHits || []).filter(dossierMatches).length} 份`
}

// ---------------- 人物画像库 ----------------
function cardMatches(c) {
  if (state.cardOrigin !== 'all' && c.origin !== state.cardOrigin) return false
  const q = state.cardQ.trim().toLowerCase()
  if (!q) return true
  return [c.name, c.title, c.subtitle, c.type, c.region].join(' ').toLowerCase().includes(q)
}
function cardTile(c) {
  const img = c.missing
    ? `<div class="tile-missing">图片已不在原位置</div>`
    : `<img src="${esc(c.url)}" alt="${esc(c.name)} 的人物画像卡" loading="lazy">`
  return `<article class="tile">
    <div class="tile-bar">
      <span class="mono">${c.width || 1080}×${c.height || 1440}</span>
      <a class="ibtn" href="${esc(c.url)}" download="${esc(downloadName(c))}" title="下载 PNG" aria-label="下载 PNG">${icon('download')}</a>
      <button class="ibtn" data-reveal-card="${c.id}" title="在系统文件夹中选中这张卡" aria-label="打开文件夹">${icon('folder')}</button>
    </div>
    <button class="tile-open" data-open-card="${c.id}" title="点击放大">${img}<span class="tile-zoom"><span class="mono">${c.width || 1080}×${c.height || 1440}</span><span>点击放大</span></span></button>
    <div class="tile-body">
      <div class="tile-kicker mono"><span>${esc(c.type || '未标类型')}</span><span class="sep">·</span><span>${c.stars ? `${esc(c.stars)} 星` : '支持度未标'}</span><span class="sep">·</span><span>${c.origin === 'uploaded' ? '上传' : '生成'}</span></div>
      <div class="tile-title">${esc(c.title || `${c.name}｜人物画像卡`)}</div>
      <div class="tile-sub">${esc(c.subtitle || c.region || '—')}</div>
    </div>
    <div class="tile-foot">
      <span class="date">${date(c.createdAt)}</span>
      <button class="btn ghost sm" data-open-card="${c.id}">打开</button>
      <button class="ibtn sm" data-del-card="${c.id}" title="删除" aria-label="删除">${icon('trash')}</button>
    </div>
  </article>`
}
function viewCards() {
  const list = data.cards.filter(cardMatches)
  return `${head('人物画像库', '人物画像库', '画像制作出的卡会自动出现在这里；也可以把别处做的卡传进来。点开可以放大看细节。', `<button class="btn" data-upload-card>${icon('upload')}上传画像卡</button><a class="btn ghost" href="#/create">${icon('create')}去做一张</a>`)}
    <div class="toolbar">
      <label class="search">${icon('search')}<input id="cq" type="search" placeholder="搜姓名、类型、地区" value="${esc(state.cardQ)}"></label>
      <div class="pills">${[['all', '全部'], ['generated', '生成'], ['uploaded', '上传']].map(([k, l]) => `<button class="pill" data-card-origin="${k}" aria-pressed="${state.cardOrigin === k}">${l}</button>`).join('')}</div>
      <span class="mono" style="color:var(--text-helper)">${list.length} 张</span>
    </div>
    ${list.length ? `<div class="cards2">${list.map(cardTile).join('')}</div>` : `<div class="empty"><div class="empty-title">${state.cardQ || state.cardOrigin !== 'all' ? '没有匹配的画像卡' : '还没有画像卡'}</div>${state.cardQ ? '换个词再搜。' : '去「画像制作」选一位人物，生成后会自动存到这里。'}</div>`}
    <p class="list-note">卡片固定 1080×1440。点开是原尺寸预览，按 Esc 或点右上角关闭；每张卡可以「下载」PNG，或「打开文件夹」在系统里定位源文件。</p>`
}

// ---------------- 资料搜集 ----------------
function precisionHint(f, mode) {
  if (f.precision === 'brief') {
    return mode === 'institution'
      ? '粗略：机构概况 + 领导班子名单与分工；每位人物只保留岗位、任期、履历要点，公开活动只收最近 1—3 条。'
      : '粗略：只保留基本信息、岗位、任期、履历等关键信息；公开活动只收最近 1—3 条，不逐阶段回溯。'
  }
  return mode === 'institution'
    ? '全面：机构概况、内设机构与下属单位；主要人物逐人五章，按任职阶段回溯公开活动，信源尽量铺开。'
    : '全面：完整五章；按任职阶段逐段回溯公开活动与发言，每阶段尽量 3—8 条，多信源交叉核验。'
}
function viewResearch() {
  const f = state.research
  const mode = f.mode === 'institution' ? 'institution' : 'person'
  const prompt = PS_PROMPTS.research({ ...f, mode })
  const ready = mode === 'institution' ? Boolean(f.org.trim()) : Boolean(f.name.trim() || f.department.trim() || f.region.trim())
  const busy = jobs.some((j) => j.kind === 'research' && (j.status === 'running' || j.status === 'queued'))
  const people = [...new Set(data.dossiers.filter((d) => d.kind !== 'institution').map((d) => d.name))].slice(0, 8)
  return `${head('资料搜集', '资料搜集', '查人物，或者查一个机构里的主要人物。选好检索精度，点「开始搜集」就在后台跑，不用跳对话。公众号原文被验证页拦截时，会先用元宝 / 搜狗搜线索，再改用政府 / 党校 / 北京号同源版本。')}
    ${banner()}${pendingNote('research')}${jobPanel('research')}
    <div class="grid2">
      <div class="panel">
        <span class="mono">检索任务单</span>
        <h3>查什么</h3>
        <div class="seg" data-seg="research-mode" style="margin-bottom:18px">
          <button data-research-mode="person" aria-pressed="${mode === 'person'}">搜人物</button>
          <button data-research-mode="institution" aria-pressed="${mode === 'institution'}">搜机构</button>
        </div>
        <div class="stack">
          ${
            mode === 'person'
              ? `<div class="form-row">
                  <label class="field"><span class="label">地区</span><input class="input" data-r="region" placeholder="例如：江州市云溪区" value="${esc(f.region)}"></label>
                  <label class="field"><span class="label">部门／单位</span><input class="input" data-r="department" placeholder="例如：区经济和信息化局" value="${esc(f.department)}"></label>
                </div>
                <label class="field"><span class="label">人物姓名</span><input class="input" data-r="name" placeholder="不确定全名就先留空，按地区 / 单位反查" value="${esc(f.name)}"></label>
                ${people.length ? `<div class="people-chips"><span class="mono" style="color:var(--text-helper);align-self:center">资料库里已有：</span>${people.map((n) => `<button class="chip" data-fill-name="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}`
              : `<label class="field"><span class="label">机构名称 <b>*</b></span><input class="input" data-r="org" placeholder="例如：北京市朝阳区经济和信息化局" value="${esc(f.org)}"></label>
                <p class="hint">会先写机构概况（职能、领导班子、内设机构），再为其中主要人物逐人建档，通常收录 3—5 人。</p>`
          }
          <div class="field"><span class="label">检索精度</span>
            <div class="seg" data-seg="precision">
              <button data-precision="brief" aria-pressed="${f.precision === 'brief'}">粗略搜索</button>
              <button data-precision="full" aria-pressed="${f.precision !== 'brief'}">全面搜索</button>
            </div>
          </div>
          <p class="hint" id="precision-hint">${precisionHint(f, mode)}</p>
        </div>
      </div>
      <div class="stack">
        <div class="panel tight">
          <span class="mono">生成的任务 prompt</span>
          <h3>在后台执行，或复制 prompt</h3>
          <div class="actions" style="margin-top:0;margin-bottom:14px">
            <button class="btn accent" data-start-research ${ready && !busy ? '' : 'disabled'}>${icon('arrow')}${busy ? '后台任务进行中' : '开始搜集'}</button>
            <button class="btn ghost" data-copy-research>${icon('download')}复制 prompt</button>
            <button class="btn ghost" data-reset-research>重置</button>
          </div>
          <div class="prompt-box" id="prompt-out" style="margin-top:0;max-height:300px">${esc(prompt)}</div>
          <p class="hint" style="margin-top:14px">点「开始搜集」在后台直接跑，不用跳到对话、也不用再点发送；任务结束后档案自动出现在「人物资料库」。要自己盯着改，也可以复制 prompt 到对话里发。</p>
        </div>
      </div>
    </div>
    <section class="sec">${secHead('01', '最近入库')}
      ${
        data.dossiers.length
          ? `<div class="table">${data.dossiers
              .slice(0, 5)
              .map(
                (d) => `<div class="row" style="grid-template-columns:minmax(0,1.2fr) minmax(0,1.4fr) 96px auto">
            <div><div class="r-title">${esc(d.name)} ${d.kind === 'institution' ? '<span class="tag">机构</span>' : ''}</div><div class="r-sub">${esc(d.summary || '')}</div></div>
            <div class="r-unit">${esc([d.region, d.department].filter(Boolean).join(' · ') || '未填')}</div>
            <div class="r-num">${date(d.updatedAt)}</div>
            <div class="r-act"><button class="btn ghost sm" data-open-dossier="${d.id}">查看</button><button class="btn sm" data-make-card="${d.id}" ${d.kind === 'institution' ? 'hidden' : ''}>做画像卡</button></div>
          </div>`,
              )
              .join('')}</div>`
          : `<div class="empty">资料库还是空的。上面填一个人名或机构，跑第一份档案。</div>`
      }
    </section>`
}

// ---------------- 画像制作 ----------------
function createReady() {
  const c = state.create
  if (c.mode === 'dossier') return Boolean(c.dossierId)
  if (c.mode === 'material') return Boolean(c.material.trim())
  return Boolean(c.name.trim())
}
function pickList() {
  const q = state.create.pickQ.trim().toLowerCase()
  const people = data.dossiers.filter((d) => d.kind !== 'institution')
  const list = people.filter((d) => !q || [d.name, d.region, d.department].join(' ').toLowerCase().includes(q))
  if (!people.length) return `<div class="empty" style="padding:32px">资料库里还没有人物档案。<a href="#/research" style="text-decoration:underline">先去资料搜集</a>，或改用「只输姓名」；机构档案里的人物请用「只输姓名」填名字。</div>`
  if (!list.length) return `<div class="empty" style="padding:24px">没有匹配的人物档案</div>`
  return `<div class="pick-list">${list
    .map(
      (d) => `<button class="pick" data-pick="${d.id}" aria-pressed="${state.create.dossierId === d.id}">
      <span class="pick-box">${state.create.dossierId === d.id ? '✓' : ''}</span>
      <span><span class="pick-name">${esc(d.name)}</span><span class="pick-sub" style="display:block">${esc([d.region, d.department].filter(Boolean).join(' · ') || '未填地区')}</span></span>
      <span class="pick-meta">${d.chars} 字</span>
    </button>`,
    )
    .join('')}</div>`
}
function viewCreate() {
  const c = state.create
  const prompt = PS_PROMPTS.card(c)
  const recent = c.mode === 'material' ? data.cards[0] : c.name.trim() ? data.cards.find((x) => x.name === c.name.trim()) || data.cards[0] : data.cards[0]
  const busy = jobs.some((j) => j.kind === 'card' && (j.status === 'running' || j.status === 'queued'))
  return `${head('画像制作', '画像制作', '从资料库选一位、上传一份材料，或只给一个名字。点「生成画像卡」就在后台跑，保存后自动进画像库并在这里预览。')}
    ${banner()}${pendingNote('card')}${jobPanel('card')}
    <div class="grid2">
      <div class="panel">
        <span class="mono">画像任务</span>
        <h3>用哪份资料</h3>
        <div class="seg" data-seg="create-mode" style="margin-bottom:16px">
          <button data-mode="dossier" aria-pressed="${c.mode === 'dossier'}">用资料库</button>
          <button data-mode="material" aria-pressed="${c.mode === 'material'}">上传资料</button>
          <button data-mode="name" aria-pressed="${c.mode === 'name'}">只输姓名</button>
        </div>
        ${
          c.mode === 'dossier'
            ? `<label class="search" style="flex:1 1 auto;margin-bottom:10px">${icon('search')}<input id="pq" type="search" placeholder="在资料库里找人" value="${esc(c.pickQ)}"></label>${pickList()}<p class="hint" style="margin-top:8px">选中后姓名、地区、单位会自动填到下面。</p>`
            : c.mode === 'material'
              ? `<div class="stack">
                  <label class="field"><span class="label">贴资料 <b>*</b></span><textarea class="textarea" data-c="material" rows="11" placeholder="把履历、公开活动报道、会议纪要贴进来……">${esc(c.material)}</textarea></label>
                  <button class="drop" data-upload-material>${icon('upload')}<span>上传 .md / .txt<small>读进上面的输入框，不会上传到别处</small></span></button>
                  <p class="hint">不用另外填姓名、职务和地区：模型会从资料里识别要画像的人，识别不出来会先回来问你。</p>
                </div>`
              : `<p class="hint" style="padding:14px;border:1px solid var(--line-subtle);background:var(--grey-1)">只给姓名时，模型会先按公开信息确认身份；重名或信息不足时，它会先回来问你，不会硬造一张卡。有地区或单位时最好一起填上。</p>`
        }
        ${
          c.mode === 'material'
            ? ''
            : `<div class="stack" style="margin-top:20px">
                <div class="form-row">
                  <label class="field"><span class="label">姓名 <b>*</b></span><input class="input" data-c="name" placeholder="例如：沈望舒" value="${esc(c.name)}"></label>
                  <label class="field"><span class="label">当前职务</span><input class="input" data-c="role" placeholder="例如：党组书记、局长" value="${esc(c.role)}"></label>
                </div>
                <div class="form-row">
                  <label class="field"><span class="label">地区</span><input class="input" data-c="region" placeholder="例如：江州市云溪区" value="${esc(c.region)}"></label>
                  <label class="field"><span class="label">部门／单位</span><input class="input" data-c="department" placeholder="例如：区经济和信息化局" value="${esc(c.department)}"></label>
                </div>
                <div class="form-row">
                  <label class="field"><span class="label">观察期</span><input class="input" data-c="period" placeholder="例如：2026.10—11" value="${esc(c.period)}"></label>
                  <label class="field"><span class="label">关注方向</span><input class="input" data-c="focus" placeholder="例如：游戏电竞、营商环境" value="${esc(c.focus)}"></label>
                </div>
              </div>`
        }
      </div>
      <div class="stack">
        <div class="panel tight">
          <span class="mono">生成的任务 prompt</span>
          <h3>在后台执行，或复制 prompt</h3>
          <div class="actions" style="margin-top:0;margin-bottom:14px">
            <button class="btn accent" data-start-card ${createReady() && !busy ? '' : 'disabled'}>${icon('create')}${busy ? '后台任务进行中' : '生成画像卡'}</button>
            <button class="btn ghost" data-copy-card>${icon('download')}复制 prompt</button>
          </div>
          <div class="prompt-box" id="card-prompt" style="margin-top:0;max-height:300px">${esc(prompt)}</div>
          <p class="hint" style="margin-top:14px">点「生成画像卡」在后台直接跑，不用跳对话、不用再点发送；保存成功后页面自动弹出预览，并提示「已存到人物画像库」。</p>
        </div>
        <div class="panel tight">
          <span class="mono">临时预览</span>
          <div class="recent" style="margin-top:12px">
            ${
              recent
                ? `<button data-open-card="${recent.id}" style="padding:0;border:0;background:none"><img src="${esc(recent.url)}" alt=""></button>
                   <div><div class="r-name">${esc(recent.name)}</div><div class="r-sub">${esc(recent.type || '未标类型')} · ${date(recent.createdAt)}</div><div class="r-actions"><button class="btn ghost sm" data-open-card="${recent.id}">放大</button><a class="btn ghost sm" href="#/cards">去画像库</a></div></div>`
                : `<div class="recent-empty">还没有<br>生成过</div><div><div class="r-name">—</div><div class="r-sub">生成后会出现在这里</div></div>`
            }
          </div>
        </div>
      </div>
    </div>`
}

// ---------------- 官方示例 ----------------
function exampleCover(e) {
  if (e.kind === 'card') return `<img src="${esc(e.url)}" alt="${esc(e.title)}">`
  return `<div class="doc-cover"><span class="dc-tag">DOSSIER · 示例</span><div class="dc-title">${esc(e.name)}</div><div class="dc-meta">${esc(e.meta || '')}</div><div class="dc-rule"></div><div class="dc-line w40"></div><div class="dc-line w85"></div><div class="dc-line w70"></div><div class="dc-line w85"></div><div class="dc-line w70"></div><div class="dc-line w40"></div><div class="dc-foot">基本信息 / 现任职务 / 任免 / 履历 / 公开活动</div></div>`
}
function viewExamples() {
  const list = data.examples || []
  return `${head('官方示例', '官方示例', '两份脱敏示例：一份完整人物档案、一张 1080×1440 画像卡。点「打开」看细节，点「做同款」会带着同样的检索框架去对应的工作台。')}
    <div class="examples">
      ${list
        .map(
          (e) => `<article class="example">
        <button class="example-thumb" data-open-example="${e.id}" title="打开查看">${exampleCover(e)}</button>
        <div class="example-body">
          <div class="example-kicker mono"><span>${e.kind === 'card' ? '画像卡' : '人物资料'}</span><span>·</span><span>${esc(e.meta || '')}</span></div>
          <div class="example-title">${esc(e.title)}</div>
          <div class="example-sub">${esc(e.summary || '')}</div>
        </div>
        <div class="example-foot">
          <span class="tag blue">示例 · 人物为虚构</span>
          <button class="btn ghost" data-open-example="${e.id}">打开</button>
          <button class="btn" data-copy-example="${e.id}">做同款</button>
        </div>
      </article>`,
        )
        .join('')}
    </div>
    <p class="list-note">示例里的地区、单位、职务、日期、引语、链接全部虚构，只用来展示格式和版式；「做同款」不会复制这些人名。</p>`
}

// ---------------- 渲染 ----------------
const VIEWS = { dossiers: viewDossiers, cards: viewCards, research: viewResearch, create: viewCreate, examples: viewExamples }
const route = () => (location.hash.replace(/^#\/?/, '') || 'dossiers').split('?')[0]

function render({ keepFocus } = {}) {
  if (!data) return
  const view = VIEWS[route()] ? route() : 'dossiers'
  state.view = view
  $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === view))
  const active = document.activeElement
  const focusId = keepFocus && active && (active.id === 'dq' || active.id === 'cq' || active.id === 'pq') ? active.id : null
  const caret = focusId ? active.selectionStart : null
  $('#app').innerHTML = VIEWS[view]()
  document.title = `人物情报库 · ${({ dossiers: '人物资料库', cards: '人物画像库', research: '资料搜集', create: '画像制作', examples: '官方示例' })[view]}`
  if (focusId) {
    const el = $(`#${focusId}`)
    if (el) {
      el.focus()
      try {
        el.setSelectionRange(caret, caret)
      } catch {}
    }
  }
}

// ---------------- 消息：唤起新对话 ----------------
function postStart(prompt) {
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'character-profile:start', prompt }, location.origin)
    return true
  }
  navigator.clipboard?.writeText(prompt)
  return false
}
addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data) return
  if (e.data.type === 'character-profile:start-failed') toast(`没能开新对话：${e.data.message}`)
})

function startJob(kind, name, prompt) {
  if (jobs.some((j) => j.kind === kind && (j.status === 'running' || j.status === 'queued'))) {
    toast('这类任务还有一个在跑，等它结束或先取消')
    return
  }
  const at = new Date().toISOString()
  state.pending = { kind, name, at, background: true, jobId: '' }
  state.hiddenJob = ''
  persist()
  render()
  fetch('api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, name, prompt }) })
    .then(async (res) => {
      if (!res.ok) throw new Error(`后台接口不可用（HTTP ${res.status}）`)
      return res.json()
    })
    .then(async (r) => {
      if (!r.ok) throw new Error(r.error || '后台执行器不可用')
      state.pending.jobId = r.job.id
      persist()
      toast('已在后台开始，不用等在这里；完成后会自动入库')
      lastJobStatus.set(r.job.id, r.job.status)
      await refreshJobs()
      render()
    })
    .catch((e) => {
      // 后台执行器不可用时退回旧路径：开一个新对话并填好 prompt
      state.pending = { kind, name, at, background: false }
      persist()
      const opened = postStart(prompt)
      toast(opened ? `后台执行没启动（${e.message}），已在新对话里填好任务` : '已复制 prompt，粘贴到对话里就能用')
      render()
    })
}

// 回到页面时看有没有新东西入库
function checkPending() {
  const p = state.pending
  if (!p || !data) return
  // 超过 3 小时就当作放弃了，免得一直轮询
  if (Date.now() - new Date(p.at).getTime() > 3 * 3600 * 1000) {
    state.pending = null
    persist()
    return
  }
  if (p.jobId) {
    const job = jobs.find((j) => j.id === p.jobId)
    if (!job) {
      // Host 重启后任务表会清空；超过 10 分钟还没有这条任务就当作丢了
      if (Date.now() - new Date(p.at).getTime() > 10 * 60 * 1000) {
        state.pending = null
        persist()
      }
      return
    }
    if (job.status === 'done') {
      const first = job.resultIds?.[0]
      state.pending = null
      persist()
      if (first?.kind === 'card') {
        const card = data.cards.find((c) => c.id === first.id)
        if (card) {
          state.lastCardId = card.id
          toast(`「${card.name}」的画像卡已存到人物画像库`)
          openCardPreview(card)
        }
      } else if (first) {
        toast(`「${first.name}」的资料已存到人物资料库（${job.steps} 步完成）`)
      } else {
        toast('任务完成，但没有新增档案；点任务面板里的「查看结果」看日志')
      }
    } else if (job.status === 'error' || job.status === 'canceled') {
      state.pending = null
      persist()
      toast(job.status === 'error' ? `后台任务失败：${job.error || '未知错误'}` : '后台任务已取消')
    }
    return
  }
  const at = p.at
  if (p.kind === 'card') {
    const hit = data.cards.find((c) => c.createdAt >= at && (!p.name || c.name.includes(p.name) || p.name.includes(c.name)))
    if (hit) {
      state.pending = null
      state.lastCardId = hit.id
      persist()
      toast(`「${hit.name}」的画像卡已存到人物画像库`)
      openCardPreview(hit)
    }
  } else {
    const hit = data.dossiers.find((d) => d.createdAt >= at && (!p.name || d.name.includes(p.name) || p.name.includes(d.name)))
    if (hit) {
      state.pending = null
      persist()
      toast(`「${hit.name}」的资料已存到人物资料库`)
    }
  }
}

// ---------------- 查看层 ----------------
const viewer = $('#viewer')
function openViewer({ title, note = '', mode, html, actions = '' }) {
  $('#viewer-title').textContent = title
  $('#viewer-note').textContent = note
  const bar = $('#viewer-actions')
  bar.innerHTML = actions
  bar.hidden = !actions
  const body = $('#viewer-body')
  body.className = `viewer-body ${mode}`
  body.innerHTML = html
  viewer.hidden = false
  const frame = body.querySelector('iframe')
  if (frame) frame.addEventListener('load', () => frame.focus(), { once: true })
  else $('[data-viewer="close"]', viewer)?.focus()
}
function closeViewer() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  viewer.hidden = true
  $('#viewer-body').innerHTML = ''
  const bar = $('#viewer-actions')
  if (bar) {
    bar.innerHTML = ''
    bar.hidden = true
  }
}
function openCardViewer(c) {
  openViewer({
    title: c.title || `${c.name}｜人物画像卡`,
    note: `${c.type || '未标类型'} · ${c.stars ? `${c.stars} 星` : '支持度未标'} · ${date(c.createdAt)}`,
    mode: 'image',
    html: `<img src="${esc(c.url)}" alt="${esc(c.name)}" title="点一下看原尺寸">`,
    actions: `<a class="btn ghost sm" href="${esc(c.url)}" download="${esc(downloadName(c))}" title="下载 PNG">${icon('download')}下载</a><button class="btn ghost sm" data-reveal-card="${c.id}" title="在系统文件夹中选中这张卡">${icon('folder')}打开文件夹</button>`,
  })
}
async function openDossier(id) {
  try {
    const r = await fetch(`api/dossiers/${encodeURIComponent(id)}`, { cache: 'no-store' }).then((x) => x.json())
    const d = r.dossier
    const meta = `<div class="doc-meta"><span class="tag ${d.origin === 'researched' ? 'blue' : ''}">${originLabel(d.origin)}</span>${d.kind === 'institution' ? '<span class="tag">机构</span>' : ''}${d.level ? `<span class="tag">${esc(d.level)}</span>` : ''}${coverageLine(d) ? `<span class="tag" title="公开活动 / 独立信源 / 官方域名">${esc(coverageLine(d))}</span>` : ''}${d.coverage?.forced ? '<span class="tag">覆盖度已说明</span>' : ''}<span class="mono" style="color:#737373">${esc([d.region, d.department].filter(Boolean).join(' · ') || '')}</span><span class="mono" style="color:#a3a3a3;margin-left:auto">${d.chars} 字 · ${date(d.updatedAt)}</span><button class="btn ghost sm" data-edit-dossier="${d.id}">编辑</button>${d.kind === 'institution' ? '' : `<button class="btn sm" data-make-card="${d.id}">做画像卡</button>`}</div>`
    openViewer({ title: d.name, note: '人物资料 · 查看', mode: 'doc', html: `<div class="doc-page">${meta}<div class="md">${PS_MD.render(d.content)}</div></div>` })
  } catch (e) {
    toast(`打开失败：${e.message}`)
  }
}
function openCardPreview(c) {
  openModal(
    `<div class="modal-head"><h2>已存到人物画像库</h2><span class="mono">CARD ${esc(c.id)}</span></div>
     <p class="modal-sub">${esc(c.name)}${c.type ? ` · ${esc(c.type)}` : ''}${c.stars ? ` · ${esc(c.stars)} 星` : ''}。这张卡已经进「人物画像库」，随时可以在侧栏找到它。</p>
     <div class="modal-preview"><img src="${esc(c.url)}" alt=""></div>
     <div class="modal-actions"><button class="btn ghost left" data-goto="#/cards">去画像库</button><a class="btn ghost" href="${esc(c.url)}" download="${esc(downloadName(c))}">${icon('download')}下载</a><button class="btn ghost" data-reveal-card="${c.id}">${icon('folder')}打开文件夹</button><button class="btn" data-open-card="${c.id}">放大查看</button></div>`,
  )
}

// ---------------- 弹层 ----------------
const modal = $('#modal')
function openModal(html, wide) {
  const card = $('#modal-card')
  card.className = `modal-card${wide ? ' wide' : ''}`
  card.innerHTML = html
  modal.hidden = false
  setTimeout(() => card.querySelector('input, textarea, select')?.focus(), 30)
}
function closeModal() {
  modal.hidden = true
  $('#modal-card').innerHTML = ''
}


async function openDossierEditor(id) {
  const isNew = !id
  let d = { name: '', kind: 'person', region: state.research.region, department: state.research.department, level: '', role: '', tags: [], content: '' }
  if (id) {
    try {
      d = (await fetch(`api/dossiers/${encodeURIComponent(id)}`, { cache: 'no-store' }).then((x) => x.json())).dossier
    } catch (e) {
      return toast(`打不开：${e.message}`)
    }
  }
  const dropZone = isNew
    ? `<div class="drop dossier-drop" id="dossier-drop" role="button" tabindex="0">
         ${icon('upload')}
         <span>拖入 Markdown / TXT / DOCX，或点击选择</span>
         <small>读出正文并识别姓名；可以智能整理，也可以直接保存原文</small>
       </div>
       <p class="hint" id="dossier-ingest"></p>`
    : ''
  openModal(
    `<div class="modal-head"><h2>${id ? '编辑档案' : '新建档案'}</h2><span class="mono">DOSSIER</span></div>
     <p class="modal-sub">${isNew ? '把材料拖进来，插件会读出正文并识别姓名；点「智能整理并建档」让模型按五章格式整理入库。也可以手动填写后直接保存。' : '正文按「人物资料搜集」skill 的格式写；不确定的字段写「未公开」。'}</p>
     ${dropZone}
     <div class="form-row three">
       <label class="field"><span class="label">姓名 / 机构名称 <b>*</b></span><input class="input" name="name" value="${esc(d.name)}"></label>
       <label class="field"><span class="label">类型</span><select class="select" name="kind"><option value="person" ${d.kind !== 'institution' ? 'selected' : ''}>人物</option><option value="institution" ${d.kind === 'institution' ? 'selected' : ''}>机构</option></select></label>
       <label class="field"><span class="label">层级</span><select class="select" name="level">${['', ...LEVELS].map((l) => `<option value="${l}" ${d.level === l ? 'selected' : ''}>${l || '未填'}</option>`).join('')}</select></label>
     </div>
     <div class="form-row three" style="margin-top:12px">
       <label class="field"><span class="label">现任职务</span><input class="input" name="role" placeholder="机构档案可留空" value="${esc(d.role || '')}"></label>
       <label class="field"><span class="label">地区</span><input class="input" name="region" value="${esc(d.region || '')}"></label>
       <label class="field"><span class="label">部门／单位</span><input class="input" name="department" value="${esc(d.department || '')}"></label>
     </div>
     <p class="hint" style="margin-top:8px">${esc(LEVEL_HINT)}</p>
     <label class="field" style="margin-top:12px"><span class="label">关注方向 / 主要人物（逗号分隔）</span><input class="input" name="tags" value="${esc((d.tags || []).join('、'))}"></label>
     <label class="field" style="margin-top:12px"><span class="label">档案正文（Markdown）<b>*</b></span><textarea class="textarea" name="content" rows="12" spellcheck="false">${esc(d.content || '')}</textarea></label>
     <div class="modal-actions">
       ${isNew ? `<button class="btn left" data-smart-import>${icon('create')}智能整理并建档</button>` : ''}
       <button class="btn ghost" data-close>取消</button>
       <button class="btn ghost" data-save-dossier="${id || ''}">${isNew ? '直接保存' : '保存'}</button>
     </div>`,
    true,
  )
  if (isNew) wireDossierDrop()
}

function detectDossierName(text, filename = '') {
  const heading = (String(text).match(/^#\s+(.+)$/m) || [])[1] || ''
  const first = String(text).split('\n').map((l) => l.trim()).find(Boolean) || ''
  const byColon = (heading.match(/[：:]\s*([^·|｜]+)/) || [])[1] || (first.match(/[：:]\s*([^·|｜]+)/) || [])[1]
  const byChapter = (heading.match(/^[一二三四五六七八九十\d]+[、.．]\s*(.+)/) || [])[1] || (first.match(/^[一二三四五六七八九十\d]+[、.．]\s*(.+)/) || [])[1]
  const base = String(filename || '').replace(/\.[^.]+$/, '')
  return String(byColon || byChapter || heading || base).trim().slice(0, 60)
}

function wireDossierDrop() {
  const zone = $('#dossier-drop')
  if (!zone) return
  zone.addEventListener('click', () => pickFile('.md,.markdown,.txt,.docx', ingestDossierFiles))
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      zone.click()
    }
  })
  zone.addEventListener('dragover', (e) => {
    e.preventDefault()
    zone.classList.add('over')
  })
  zone.addEventListener('dragleave', () => zone.classList.remove('over'))
  zone.addEventListener('drop', (e) => {
    e.preventDefault()
    zone.classList.remove('over')
    ingestDossierFiles([...(e.dataTransfer?.files || [])])
  })
}

async function ingestDossierFiles(files) {
  const f = files?.[0]
  if (!f) return
  const status = $('#dossier-ingest')
  const setStatus = (text) => {
    if (!status) return
    status.textContent = text
  }
  try {
    let text = ''
    if (/\.docx$/i.test(f.name)) {
      setStatus(`正在解析 ${f.name}…`)
      const dataUrl = await readDataUrl(f)
      const r = await fetch('api/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: f.name, dataUrl }),
      }).then((x) => x.json())
      if (!r.ok) throw new Error(r.error || '解析失败')
      text = r.text
    } else if (/\.(md|markdown|txt)$/i.test(f.name)) {
      text = await f.text()
    } else {
      throw new Error('只支持 .md / .txt / .docx')
    }
    text = String(text || '').replace(/\r\n/g, '\n').trim()
    if (!text) throw new Error('文件里没有可读文字')
    const ta = $('.modal-card textarea[name="content"]')
    if (ta) ta.value = text
    const name = detectDossierName(text, f.name)
    const nameInput = $('.modal-card input[name="name"]')
    if (name && nameInput && !nameInput.value.trim()) nameInput.value = name
    if (status) status.dataset.filename = f.name
    setStatus(`已读入 ${f.name}（${text.length.toLocaleString()} 字）${name ? `，识别姓名：${name}` : ''}。点「智能整理并建档」按五章格式整理，或直接保存原文。`)
  } catch (e) {
    setStatus(`读入失败：${e.message}`)
  }
}

function openCardUpload(dataUrl, filename) {
  const name = String(filename || '').replace(/\.[^.]+$/, '')
  openModal(
    `<div class="modal-head"><h2>上传画像卡</h2><span class="mono">CARD</span></div>
     <p class="modal-sub">把别处做的画像卡存进画像库，会和生成卡放在一起。建议 1080×1440。</p>
     <div class="modal-preview"><img src="${esc(dataUrl)}" alt=""></div>
     <div class="form-row" style="margin-top:16px">
       <label class="field"><span class="label">姓名 <b>*</b></span><input class="input" name="cname" value="${esc(name)}"></label>
       <label class="field"><span class="label">类型</span><input class="input" name="ctype" placeholder="事务推进型 / 系统部署型…"></label>
     </div>
     <div class="form-row" style="margin-top:12px">
       <label class="field"><span class="label">卡片标题</span><input class="input" name="ctitle" placeholder="留空用「姓名｜人物画像卡」"></label>
       <label class="field"><span class="label">副标题</span><input class="input" name="csubtitle" placeholder="地区 · 单位 · 观察期"></label>
     </div>
     <div class="form-row" style="margin-top:12px">
       <label class="field"><span class="label">支持度（星）</span><input class="input" name="cstars" placeholder="例如 4 / 4.5 / 未知"></label>
       <label class="field"><span class="label">观察期</span><input class="input" name="cperiod" placeholder="例如 2026.10—11"></label>
     </div>
     <input type="hidden" name="dataurl" value="${esc(dataUrl)}">
     <input type="hidden" name="filename" value="${esc(filename || '')}">
     <div class="modal-actions"><button class="btn ghost" data-close>取消</button><button class="btn" data-save-card>存入画像库</button></div>`,
    true,
  )
}

// ---------------- 文件选择 ----------------
const fileInput = $('#file')
let fileHandler = null
function pickFile(accept, handler, multiple = false) {
  fileInput.accept = accept
  fileInput.multiple = multiple
  fileHandler = handler
  fileInput.value = ''
  fileInput.click()
}
fileInput.addEventListener('change', () => {
  const files = [...(fileInput.files || [])]
  const handler = fileHandler
  fileHandler = null
  if (files.length && handler) handler(files)
})
const readText = (f) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result || '')); r.onerror = () => reject(r.error); r.readAsText(f) })
const readDataUrl = (f) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result || '')); r.onerror = () => reject(r.error); r.readAsDataURL(f) })

async function uploadDossiers(files) {
  let ok = 0
  for (const f of files) {
    try {
      const text = await readText(f)
      const r = await fetch('api/dossiers/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename: f.name, text }) }).then((x) => x.json())
      if (r.ok) ok++
      else toast(`${f.name}：${r.error}`)
    } catch (e) {
      toast(`${f.name}：${e.message}`)
    }
  }
  if (ok) {
    toast(`已存入 ${ok} 份人物资料`)
    await load()
  }
}

// ---------------- 交互 ----------------
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button, a')
  if (!b) return

  // 查看层 / 弹层
  if (b.dataset.viewer === 'close') return closeViewer()
  if (b.dataset.viewer === 'full') return viewer.requestFullscreen?.().catch(() => toast('这个窗口不允许全屏'))
  if (b.dataset.close !== undefined) return closeModal()
  if (b.dataset.dismissBanner !== undefined) { state.banner = ''; persist(); return render() }
  if (b.dataset.goto) { closeModal(); location.hash = b.dataset.goto; return }
  if (b.dataset.openCard) {
    const c = data.cards.find((x) => x.id === b.dataset.openCard)
    if (!c) return
    closeModal()
    return openCardViewer(c)
  }
  if (b.dataset.openDossier) return openDossier(b.dataset.openDossier)
  if (b.dataset.openExample) return openExample(b.dataset.openExample)

  if (!data) return

  // 画像卡：在系统文件夹里显示
  if (b.dataset.revealCard) {
    const r = await fetch('api/cards/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: b.dataset.revealCard }) })
      .then((x) => x.json())
      .catch((e) => ({ ok: false, error: e.message }))
    toast(r.ok ? '已在文件夹中显示这张卡' : `打不开文件夹：${r.error || ''}`)
    return
  }

  // 后台任务
  if (b.dataset.cancelJob) {
    await fetch('api/jobs/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: b.dataset.cancelJob }) }).catch(() => {})
    toast('已请求取消任务')
    await refreshJobs()
    return
  }
  if (b.dataset.dismissJob) {
    state.hiddenJob = b.dataset.dismissJob
    persist()
    paintJobPanel()
    return
  }
  if (b.dataset.openJobResult) {
    if (b.dataset.resultKind === 'card') {
      const c = data.cards.find((x) => x.id === b.dataset.openJobResult)
      if (!c) return toast('结果还在刷新，稍后再点')
      return openCardViewer(c)
    }
    return openDossier(b.dataset.openJobResult)
  }

  // 资料库
  if (b.dataset.uploadDossier !== undefined) return pickFile('.md,.markdown,.txt,text/markdown,text/plain', uploadDossiers, true)
  if (b.dataset.newDossier !== undefined) return openDossierEditor(null)
  if (b.dataset.editDossier) return openDossierEditor(b.dataset.editDossier)
  if (b.dataset.makeCard) return makeCardFromDossier(b.dataset.makeCard)
  if (b.dataset.delDossier) {
    const d = data.dossiers.find((x) => x.id === b.dataset.delDossier)
    if (!d || !confirm(`删除「${d.name}」的资料档案？文件会从本机删掉。`)) return
    const r = await fetch('api/dossiers/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: d.id }) }).then((x) => x.json())
    if (r.ok) { toast('已删除'); if (state.create.dossierId === d.id) state.create.dossierId = ''; await load() }
    else toast(`删除失败：${r.error || ''}`)
    return
  }
  if (b.dataset.level) {
    state.level = b.dataset.level
    return render()
  }
  if (b.dataset.origin) { state.origin = b.dataset.origin; return render() }
  if (b.dataset.cardOrigin) { state.cardOrigin = b.dataset.cardOrigin; return render() }

  // 画像库
  if (b.dataset.uploadCard !== undefined) {
    return pickFile('image/png,image/jpeg,image/webp', async (files) => {
      try {
        const url = await readDataUrl(files[0])
        openCardUpload(url, files[0].name)
      } catch (err) {
        toast(`读图失败：${err.message}`)
      }
    })
  }
  if (b.dataset.delCard) {
    const c = data.cards.find((x) => x.id === b.dataset.delCard)
    if (!c || !confirm(`从画像库删除「${c.title || c.name}」？图片文件会一起删掉。`)) return
    const r = await fetch('api/cards/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: c.id }) }).then((x) => x.json())
    if (r.ok) { toast('已删除'); await load() }
    else toast(`删除失败：${r.error || ''}`)
    return
  }

  // 资料搜集
  if (b.dataset.researchMode) { state.research.mode = b.dataset.researchMode; return render() }
  if (b.dataset.precision) { state.research.precision = b.dataset.precision; return render() }
  if (b.dataset.fillName) { state.research.name = b.dataset.fillName; return render() }
  if (b.dataset.refresh !== undefined) {
    await refreshJobs()
    return load()
  }
  if (b.dataset.copyResearch !== undefined) {
    copy(PS_PROMPTS.research(state.research))
    return
  }
  if (b.dataset.startResearch !== undefined) {
    const f = state.research
    const inst = f.mode === 'institution'
    if (inst && !f.org.trim()) return toast('先填机构名称')
    if (!inst && !f.name.trim() && !f.department.trim() && !f.region.trim()) return toast('至少填一个人名，或填地区 / 单位')
    return startJob('research', inst ? f.org.trim() : f.name.trim(), PS_PROMPTS.research(f))
  }
  if (b.dataset.resetResearch !== undefined) {
    state.research = structuredClone(DEFAULT.research)
    return render()
  }

  // 画像制作
  if (b.dataset.mode) { state.create.mode = b.dataset.mode; return render() }
  if (b.dataset.pick) {
    const d = data.dossiers.find((x) => x.id === b.dataset.pick)
    if (!d) return
    state.create.dossierId = d.id
    state.create.name = d.name
    state.create.region = d.region || ''
    state.create.department = d.department || ''
    state.create.role = d.role || ''
    return render()
  }
  if (b.dataset.uploadMaterial !== undefined) {
    return pickFile('.md,.markdown,.txt,text/markdown,text/plain', async (files) => {
      try {
        const text = await readText(files[0])
        state.create.material = text.slice(0, 60000)
        const ta = $('[data-c="material"]')
        if (ta) ta.value = state.create.material
        updateCardPrompt()
        toast(`已读入 ${files[0].name}`)
      } catch (err) {
        toast(`读取失败：${err.message}`)
      }
    })
  }
  if (b.dataset.copyCard !== undefined) { copy(PS_PROMPTS.card(state.create)); return }
  if (b.dataset.startCard !== undefined) {
    if (!createReady()) return toast(state.create.mode === 'material' ? '先贴资料或上传文件' : '先选一份资料，或填上姓名')
    const pendingName = state.create.mode === 'material' ? '' : state.create.name.trim()
    return startJob('card', pendingName, PS_PROMPTS.card(state.create))
  }

  // 示例
  if (b.dataset.copyExample) return copyExample(b.dataset.copyExample)

  // 弹层内动作
  if (b.dataset.smartImport !== undefined) {
    const ta = $('.modal-card textarea[name="content"]')
    const text = ta?.value.trim() || ''
    if (!text) return toast('先把文件拖进来，或把文字贴到正文里')
    const nameInput = $('.modal-card input[name="name"]')
    const name = nameInput?.value.trim() || detectDossierName(text)
    const filename = $('#dossier-ingest')?.dataset.filename || ''
    const existing = (data.dossiers || []).find((d) => d.name === name)
    closeModal()
    return startJob('import', name, PS_PROMPTS.importDoc({ text, name, filename, existingId: existing?.id || '' }))
  }
  if (b.dataset.saveDossier !== undefined) return saveDossier(b.dataset.saveDossier)
  if (b.dataset.saveCard !== undefined) return saveCardFromForm()
})

function copy(text) {
  navigator.clipboard?.writeText(text).then(() => toast('已复制，粘贴到对话输入框就能用'), () => toast('复制失败，可以手动选中复制'))
}

function makeCardFromDossier(id) {
  const d = data.dossiers.find((x) => x.id === id)
  if (!d) return
  if (d.kind === 'institution') return toast('机构档案里有多位人物，请到「画像制作」按姓名出卡')
  state.create = {
    ...DEFAULT.create,
    mode: 'dossier',
    dossierId: d.id,
    name: d.name,
    region: d.region || '',
    department: d.department || '',
    role: d.role || '',
    period: '',
    focus: (d.tags || []).join('、'),
  }
  state.banner = `已选好「${d.name}」的资料，确认后生成画像卡。`
  closeViewer()
  if (location.hash === '#/create') render()
  else location.hash = '#/create'
}

async function openExample(id) {
  try {
    const e = (data.examples || []).find((x) => x.id === id)
    if (!e) return
    if (e.kind === 'card') {
      return openViewer({ title: e.title, note: '官方示例 · 画像卡', mode: 'image', html: `<img src="${esc(e.url)}" alt="${esc(e.title)}" title="点一下看原尺寸">`, actions: `<a class="btn ghost sm" href="${esc(e.url)}" download="${esc(safeFilename(e.name, '官方示例'))}-人物画像卡.png">${icon('download')}下载</a>` })
    }
    const r = await fetch(`api/examples/${encodeURIComponent(id)}`, { cache: 'no-store' }).then((x) => x.json())
    openViewer({
      title: e.title,
      note: '官方示例 · 人物资料',
      mode: 'doc',
      html: `<div class="doc-page"><div class="doc-meta"><span class="tag blue">示例 · 人物为虚构</span><span class="mono" style="color:#737373">${esc(e.meta || '')}</span><span class="mono" style="color:#a3a3a3;margin-left:auto">${(r.content || '').length} 字</span><button class="btn sm" data-copy-example="${e.id}">做同款</button></div><div class="md">${PS_MD.render(r.content || '')}</div></div>`,
    })
  } catch (err) {
    toast(`打开示例失败：${err.message}`)
  }
}

function copyExample(id) {
  const e = (data.examples || []).find((x) => x.id === id)
  if (!e) return
  closeViewer()
  const target = e.kind === 'card' ? '#/create' : '#/research'
  if (e.kind === 'card') {
    state.create = {
      ...DEFAULT.create,
      mode: 'name',
      name: '',
      region: '云溪区',
      department: '区经济和信息化局',
      role: '党组书记、局长',
      period: '2026.10—11',
      focus: '游戏电竞、企业服务',
    }
    state.banner = '已套用示例卡片的框架：地区、单位、观察期和关注方向都填好了，换成你要做的人名即可。'
  } else {
    state.research = {
      ...DEFAULT.research,
      mode: 'person',
      region: '云溪区',
      department: '区经济和信息化局',
      name: '',
      precision: 'full',
    }
    state.banner = '已套用示例档案的检索框架：地区、单位填好了，换成你要查的人名即可。'
  }
  persist()
  if (location.hash === target) render()
  else location.hash = target
}

async function saveDossier(id) {
  const card = $('#modal-card')
  const get = (n) => card.querySelector(`[name="${n}"]`)?.value ?? ''
  const body = {
    name: get('name').trim(),
    kind: get('kind') || 'person',
    region: get('region').trim(),
    department: get('department').trim(),
    level: get('level'),
    role: get('role').trim(),
    tags: get('tags'),
    content: get('content'),
  }
  if (!body.name) return toast('先填姓名或机构名称')
  if (!body.content.trim()) return toast('正文不能为空')
  if (id) body.id = id
  const r = await fetch('api/dossiers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json())
  if (!r.ok) return toast(`保存失败：${r.error || ''}`)
  closeModal()
  closeViewer()
  toast('已保存')
  await load()
}

async function saveCardFromForm() {
  const card = $('#modal-card')
  const get = (n) => card.querySelector(`[name="${n}"]`)?.value ?? ''
  if (!get('cname').trim()) return toast('先填姓名')
  const body = {
    name: get('cname').trim(),
    title: get('ctitle').trim(),
    subtitle: get('csubtitle').trim(),
    type: get('ctype').trim(),
    stars: get('cstars').trim(),
    period: get('cperiod').trim(),
    dataUrl: get('dataurl'),
    filename: get('filename'),
  }
  const r = await fetch('api/cards/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json())
  if (!r.ok) return toast(`上传失败：${r.error || ''}`)
  closeModal()
  toast('已存入人物画像库')
  await load()
}

// ---------------- 实时更新 prompt ----------------
function updateResearchPreview() {
  const f = state.research
  const mode = f.mode === 'institution' ? 'institution' : 'person'
  const out = $('#prompt-out')
  if (out) out.textContent = PS_PROMPTS.research(f)
  const hint = $('#precision-hint')
  if (hint) hint.textContent = precisionHint(f, mode)
  const start = $('[data-start-research]')
  if (start) start.disabled = jobs.some((j) => j.kind === 'research' && (j.status === 'running' || j.status === 'queued')) || (mode === 'institution' ? !f.org.trim() : !(f.name.trim() || f.department.trim() || f.region.trim()))
}
function updateCardPrompt() {
  const out = $('#card-prompt')
  if (out) out.textContent = PS_PROMPTS.card(state.create)
  const start = $('[data-start-card]')
  if (start) start.disabled = jobs.some((j) => j.kind === 'card' && (j.status === 'running' || j.status === 'queued')) || !createReady()
}

document.addEventListener('input', (e) => {
  const t = e.target
  if (t.id === 'dq') {
    state.q = t.value
    clearTimeout(document._dqTimer)
    document._dqTimer = setTimeout(refreshDossierList, 220)
    return
  }
  if (t.id === 'cq') {
    state.cardQ = t.value
    const list = data.cards.filter(cardMatches)
    const box = $('.cards2')
    if (box) box.outerHTML = list.length ? `<div class="cards2">${list.map(cardTile).join('')}</div>` : `<div class="empty">没有匹配的画像卡</div>`
    return
  }
  if (t.id === 'pq') {
    state.create.pickQ = t.value
    const list = $('.pick-list')
    if (list) {
      const wrap = document.createElement('div')
      wrap.innerHTML = pickList()
      const next = wrap.querySelector('.pick-list') || wrap.firstElementChild
      if (next) list.replaceWith(next)
    }
    return
  }
  if (t.dataset.r) {
    state.research[t.dataset.r] = t.value
    persist()
    updateResearchPreview()
    return
  }
  if (t.dataset.c) {
    state.create[t.dataset.c] = t.value
    persist()
    updateCardPrompt()
  }
})
document.addEventListener('change', (e) => {
  if (e.target.dataset.r) {
    state.research[e.target.dataset.r] = e.target.value
    persist()
    updateResearchPreview()
  }
})

// 分段控件（level 与 mode）
// 查看层图片：点一下 1:1
viewer.addEventListener('click', (e) => {
  if (e.target.matches('.viewer-body.image img')) e.target.classList.toggle('actual')
})
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal()
})
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (!modal.hidden) return closeModal()
  if (!viewer.hidden && !document.fullscreenElement) closeViewer()
})
addEventListener('hashchange', () => {
  closeViewer()
  closeModal()
  render()
  scrollTo(0, 0)
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  load({ quiet: true })
  refreshJobs()
})
// 后台任务：页面开着时 2 秒刷新一次状态，不重新渲染整个表单
setInterval(() => {
  if (document.visibilityState !== 'visible') return
  const busy = state.pending?.jobId || jobs.some((j) => j.status === 'running' || j.status === 'queued')
  if (busy) refreshJobs()
}, 2000)
// 旧路径（开新对话）仍然靠 catalog 轮询
setInterval(() => {
  if (state.pending && !state.pending.background && document.visibilityState === 'visible') load({ quiet: true })
}, 8000)

// ---------------- 启动 ----------------
$$('[data-icon]').forEach((el) => (el.outerHTML = icon(el.dataset.icon)))
load().then(() => refreshJobs())
