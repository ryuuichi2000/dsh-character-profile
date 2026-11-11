// 后台任务执行器：在 Host 进程里直接起一个 Agent 跑完整个任务，不跳对话、不用手动发送。
// 用的是 dsh 自己的 agents 服务（和 headless runner 同一条路）：
//   agents.create() → 拿到一个独立会话的 agent → followup(prompt) → whenIdle() 等它跑完
// 任务结束后关掉 agent；结果已经通过 character_profile_* 工具写进资料库 / 画像库，
// 页面轮询 /api/jobs 和 /api/catalog 就能看到进度和成品。
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, listCards, listDossiers } from './store.js'

const MAX_RUNNING = 2
const MAX_JOBS = 40
const TIMEOUT_MS = 45 * 60 * 1000

const KIND_LABEL = { research: '资料搜集', card: '画像制作', import: '智能建档' }

const BACKGROUND = [
  '',
  '【后台执行约束】',
  '- 这是插件在后台自动跑的任务，没有人会实时回答你的问题：不要调用 ask_user_question，不要等待用户确认。',
  '- 开始前先用 skill 工具加载 person-dossier（画像任务用 governance-portrait）的完整说明，按它执行。',
  '- 必须做到能交付：检索 → 写作 → 调用保存工具。保存工具返回「未保存：覆盖度不足」时，按缺口继续检索补齐后重新调用；确实查不到的才用 force。',
  '- 最终回复控制在 5 行内：存了什么、覆盖多少条活动 / 信源、还缺什么。',
].join('\n')

const now = () => new Date().toISOString()
const deepFreeze = (v) => {
  if (!v || typeof v !== 'object' || Object.isFrozen(v)) return v
  for (const x of Object.values(v)) deepFreeze(x)
  return Object.freeze(v)
}
// 粗略进度：不追求准确，只给一个大概的位置。用「时间为主的饱和曲线 + 少量步数」：
//   前期走得很慢，越往后越慢，正常 10 分钟的调研到 10 分钟时大约 67%，不会一分钟就 50%、
//   也不会提前卡在 90% 以上。结束一律 100%；运行中最高 94%。
function progressOf(job) {
  if (job.status === 'done' || job.status === 'error' || job.status === 'canceled') return 100
  if (job.status === 'queued') return 4
  const elapsed = job.startedAt ? Math.max(0, (Date.now() - new Date(job.startedAt).getTime()) / 1000) : 0
  // 调研一般 10 分钟上下，画像卡一般 5—6 分钟；时间常数取预期时长，曲线不会太陡
  const tau = job.kind === 'card' ? 360 : job.kind === 'import' ? 240 : 600
  const timePart = 86 * (1 - Math.exp(-elapsed / tau))
  const stepPart = Math.min(6, job.steps * 0.2)
  return Math.max(6, Math.min(94, Math.round(8 + timePart + stepPart)))
}

const snap = (job) => ({
  id: job.id,
  kind: job.kind,
  kindLabel: KIND_LABEL[job.kind] || job.kind,
  name: job.name,
  status: job.status,
  phase: job.phase,
  steps: job.steps,
  progress: progressOf(job),
  lastTool: job.lastTool,
  error: job.error,
  resultIds: job.resultIds,
  sessionId: job.sessionId,
  agentPreset: job.agentPreset,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  startedAt: job.startedAt,
  finishedAt: job.finishedAt,
  text: job.text ? job.text.slice(0, 2000) : '',
})

export function createRunner(ctx) {
  const jobs = new Map()
  const queue = []
  let active = 0

  function prune() {
    if (jobs.size <= MAX_JOBS) return
    const done = [...jobs.values()].filter((j) => j.status !== 'running' && j.status !== 'queued').sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)))
    for (const j of done.slice(0, jobs.size - MAX_JOBS)) jobs.delete(j.id)
  }

  function start({ kind, name = '', prompt }) {
    const text = String(prompt || '').trim()
    if (!text) throw new Error('prompt 不能为空')
    const job = {
      id: `job-${randomUUID().slice(0, 8)}`,
      kind: kind === 'card' ? 'card' : kind === 'import' ? 'import' : 'research',
      name: String(name || '').trim().slice(0, 80),
      status: 'queued',
      phase: '排队中',
      steps: 0,
      lastTool: '',
      error: '',
      resultIds: [],
      sessionId: '',
      text: '',
      createdAt: now(),
      updatedAt: now(),
      startedAt: '',
      finishedAt: '',
      promptText: text,
      _agent: null,
      _cancelled: false,
    }
    jobs.set(job.id, job)
    prune()
    queue.push(job)
    pump()
    return snap(job)
  }

  function pump() {
    while (active < MAX_RUNNING && queue.length) {
      const job = queue.shift()
      if (!job || job._cancelled) continue
      active++
      run(job)
        .catch((error) => {
          job.status = 'error'
          job.error = String(error?.message || error)
          job.finishedAt = now()
          job.updatedAt = now()
        })
        .finally(() => {
          active--
          pump()
        })
    }
  }

  async function run(job) {
    job.status = 'running'
    job.startedAt = now()
    job.phase = '启动 agent'
    job.updatedAt = now()

    const agents = ctx.get('agents')
    const sessions = ctx.get('sessions')
    const defaultModel = ctx.get('agentDefaultModel')
    const subagents = ctx.get('subagents')
    const presets = ctx.get('agentPresets')
    if (!agents || !sessions) throw new Error('后台执行需要 dsh 的 agents / sessions 服务；请重启 dsh 后再试')
    // 关键：后台 agent 必须挂上和普通会话同一个 preset。web_search / web_fetch / fs / bash / skill
    // 都在 preset 的子插件里，不在根上；没挂 preset 时 agent 只能看到根级插件工具（B站、人物库、IM）。
    let agentPreset = typeof presets?.defaultId === 'string' && presets.defaultId ? presets.defaultId : 'standard'
    // 用户如果选了 minimal 这类不含 web 工具的 preset，后台任务会自动退回 standard
    try {
      const doc = presets?.readDocument ? await presets.readDocument(agentPreset) : null
      if (doc?.content && !/tool-web/.test(doc.content)) agentPreset = 'standard'
    } catch {}
    if (typeof presets?.mount !== 'function') throw new Error('agent preset 服务不可用（缺少 mount），后台任务无法挂载 web / fs / skill 工具；请重启 dsh')
    const selection = defaultModel?.currentSelection?.() || {}
    if (!selection.provider || !selection.model) throw new Error('没有解析到默认模型；请先在 dsh 里选一个模型')

    const cwd = join(dataDir(), 'workspace')
    mkdirSync(cwd, { recursive: true })
    const beforeDossiers = new Map(listDossiers().map((d) => [d.id, d.updatedAt]))
    const beforeCards = new Map(listCards().map((c) => [c.id, c.updatedAt]))

    const sessionId = `session-${randomUUID()}`
    job.sessionId = sessionId
    const agentOptions = {
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
    }
    // 关键：meta.agentPreset 只记录会话头，preset 的插件树要显式 mount 到 agent ctx 上，
    // 否则 web_search / web_fetch / fs / bash / skill 这些 preset 内的工具不会出现在 agent 的工具表里。
    const setup = async (agentCtx) => {
      const service = agentCtx.get?.('agentPresets') || presets
      if (typeof service?.mount !== 'function') throw new Error('agent preset 服务不可用（缺少 mount），后台任务无法挂载 web / fs / skill 工具')
      await service.mount(agentCtx, agentPreset)
    }
    const handle = await agents.create({ sessionId, meta: { cwd, agentPreset }, agentOptions, setup })
    const agent = handle.agent
    job._agent = agent
    job.agentPreset = agentPreset
    let finalText = ''
    let lastEnd = null
    let lastError = ''
    let timedOut = false
    const off = ctx.on('session/event', (session, event) => {
      if (session !== agent.session) return
      if (event.type === 'step/start') {
        job.steps++
        job.phase = '检索 / 写作中'
      } else if (event.type === 'tool/call') {
        job.lastTool = String(event.data?.name || '')
        job.phase = TOOL_PHASE[job.lastTool] || `调用 ${job.lastTool || '工具'}`
      } else if (event.type === 'assistant/message') {
        const joined = (event.data?.message?.content || [])
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('')
        if (joined) finalText = joined
      } else if (event.type === 'turn/end') {
        lastEnd = event.data?.reason || null
      }
      job.updatedAt = now()
    })
    const offError = ctx.on('agent/error', ({ agent: subject, error }) => {
      if (subject !== agent) return
      lastError = String(error?.message || error)
      job.error = lastError
      job.updatedAt = now()
    })
    const timer = setTimeout(() => {
      timedOut = true
      job.phase = '超时，正在取消'
      job.error = '任务超过 45 分钟，已自动取消'
      try {
        agent.cancel({ kind: 'user' })
      } catch {}
    }, TIMEOUT_MS)

    try {
      await agent.whenIdle()
      job.phase = '已提交任务'
      const message = deepFreeze({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: `${jobPrompt(job.kind, job.name, job.promptText)}${BACKGROUND}` }], source: { kind: 'user' } })
      agent.followup(message)
      for (;;) {
        await agent.whenIdle()
        const idleSeq = agent.session.seq
        const children = await subagents?.waitForChildren?.(agent)
        if (!children && agent.status === 'idle' && agent.session.seq === idleSeq) break
      }
      await sessions.flush?.(agent.session)
      job.text = finalText
      const newDossiers = listDossiers().filter((d) => beforeDossiers.get(d.id) !== d.updatedAt).map((d) => ({ id: d.id, kind: 'dossier', name: d.name }))
      const newCards = listCards().filter((c) => beforeCards.get(c.id) !== c.updatedAt).map((c) => ({ id: c.id, kind: 'card', name: c.name }))
      job.resultIds = [...newDossiers, ...newCards]
      if (job._cancelled) {
        job.status = 'canceled'
      } else if (timedOut) {
        job.status = 'error'
      } else if (!lastEnd) {
        job.status = 'error'
        job.error = '任务没有产生有效的对话回合'
      } else if (lastEnd.kind === 'error') {
        job.status = 'error'
        job.error = lastError || String(lastEnd.error?.message || '任务在对话里报错结束')
      } else {
        job.status = 'done'
        job.error = ''
      }
    } finally {
      clearTimeout(timer)
      off()
      offError()
      job.finishedAt = now()
      job.updatedAt = now()
      job._agent = null
      try {
        await handle.dispose?.()
      } catch {}
    }
  }

  function cancel(id) {
    const job = jobs.get(id)
    if (!job) return false
    job._cancelled = true
    if (job.status === 'queued') {
      job.status = 'canceled'
      job.phase = '已取消'
      job.finishedAt = now()
      job.updatedAt = now()
      return true
    }
    try {
      job._agent?.cancel({ kind: 'user' })
      job.phase = '正在取消'
      return true
    } catch {
      return false
    }
  }

  return {
    start,
    cancel,
    list: () => [...jobs.values()].map(snap).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    get: (id) => {
      const job = jobs.get(id)
      return job ? snap(job) : null
    },
    count: () => jobs.size,
  }
}

const TOOL_PHASE = {
  web_search: '检索公开信息',
  web_fetch: '读取网页',
  skill: '加载 skill',
  character_profile_save_dossier: '保存资料档案',
  character_profile_save_card: '渲染画像卡',
  character_profile_read_dossier: '读取资料库',
  character_profile_library: '查看资料库',
  ask_user_question: '等待用户（后台任务不应出现）',
}

function jobPrompt(kind, name, prompt) {
  return kind === 'card'
    ? `${prompt}\n\n【任务来源】人物情报库插件 · 画像制作${name ? ` · ${name}` : ''}`
    : `${prompt}\n\n【任务来源】人物情报库插件 · 资料搜集${name ? ` · ${name}` : ''}`
}
