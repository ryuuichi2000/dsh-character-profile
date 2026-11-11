// 本地预览：不启动 dsh，直接把插件页面和接口跑起来，用浏览器看效果。
//   node scripts/dev-server.mjs          → http://127.0.0.1:4317/character-profile/
// 数据放在插件的 .devhome/ 里（和真实数据分开，不会碰 ~/.dsh/character-profile）。
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
// 预览数据固定放在插件自己的 .devhome，别写进真实的 ~/.dsh/character-profile
process.env.DSH_HOME = process.env.PS_DEV_HOME || join(root, '.devhome')

const { createHandler } = await import('../lib/http.js')
const { listCards, listDossiers, saveCard, saveDossier } = await import('../lib/store.js')

if (!listDossiers().length) {
  const example = readFileSync(join(root, 'examples', 'dossier-shenwangshu.md'), 'utf8')
  saveDossier({
    name: '沈望舒',
    region: '江州市云溪区',
    department: '区经济和信息化局',
    level: '区县级',
    role: '党组书记、局长',
    tags: '游戏电竞,数字经济,企业服务',
    sources: 'https://yunxi.gov.example/zwgk/2026/1103/1842.html\nhttps://yunxi.gov.example/zwgk/2026/1016/1803.html',
    content: example,
    origin: 'researched',
  })
  saveDossier({
    name: '陆行舟',
    level: '区县级',
    region: '江州市云溪区',
    department: '区政务服务中心',
    role: '主任',
    tags: '政务服务,营商环境',
    origin: 'uploaded',
    content: `# 云溪区重点人物资料：陆行舟

整理日期：2026 年 11 月 8 日（主要事实来自政府官网一手信源）

---

# 一、陆行舟

## 1.1 基本信息

| 项目 | 内容 |
|---|---|
| 姓名 | 陆行舟 |
| 性别 | 男 |
| 民族 | 汉族 |
| 出生日期 | 1980 年 3 月 |
| 籍贯 | 江州省云溪县 |
| 政治面貌 | 中共党员 |
| 入党时间 | 2003 年 11 月 |
| 参加工作时间 | 2004 年 7 月 |
| 最高学历 | 研究生 |
| 学位 | 公共管理硕士 |
| 毕业院校 | 江州大学 |
| 专业 | 行政管理 |
| 其他任职 | 未公开 |

## 1.2 现任职务

云溪区政务服务中心主任

- 分管工作：主持区政务服务中心全面工作
- 是否晋升：平级转任
- 是否本地晋升：本地晋升
- 任职年限：2024.05—

## 1.3 职务任免

| 时间 | 事项 |
|---|---|
| 2024.05.20 | 区政府决定：陆行舟任区政务服务中心主任 |

## 1.4 履历

| 时间 | 职务 |
|---|---|
| 2004.07—2012.09 | 云溪区行政审批服务中心科员 |
| 2012.09—2019.04 | 云溪区政务服务中心业务科科长 |
| 2019.04—2024.05 | 云溪区政务服务管理办公室副主任 |
| 2024.05— | 云溪区政务服务中心主任 |

## 1.5 公开活动与发言

### 一、区政务服务中心任职期（2024.05—）

#### 2026.10.28　推进“一网通办”事项梳理

- 场合：区政务服务中心“一网通办”专题推进会
- 表态内容：
  > 能线上办的事项不要留线下兜底，确需线下跑一次的要写清楚为什么。
- 来源：云溪区人民政府门户网站 https://yunxi.gov.example/zwgk/2026/1028/1820.html
- 交叉验证：无（单一一级官方信源）
`,
  })
  saveDossier({
    name: '云溪区经济和信息化局',
    kind: 'institution',
    level: '区县级',
    region: '江州市云溪区',
    department: '区经济和信息化局',
    tags: '沈望舒,陆行舟',
    summary: '区政府工作部门，主管工业和信息化、数字经济与企业服务；领导班子 5 人。',
    origin: 'researched',
    content: `# 云溪区经济和信息化局机构资料

## 机构概况

| 项目 | 内容 |
|---|---|
| 机构全称 | 江州市云溪区经济和信息化局 |
| 隶属关系 | 云溪区人民政府工作部门 |
| 层级 | 区县级 |
| 主要职能 | 工业和信息化、数字经济、企业服务、产业园区发展 |
| 领导班子 | 党组书记、局长沈望舒；副局长 2 名；党组成员 3 名 |
| 内设机构 | 办公室、产业科、数字经济科、企业服务科 |

---

# 一、沈望舒

## 1.1 基本信息

（示例：完整五章见单独的人物档案）

## 1.2 现任职务

党组书记、局长

## 1.5 公开活动与发言

### 一、区经济和信息化局任职期（2025.12—）

#### 2026.10.16　调研云溪数字产业园

- 场合：园区企业座谈会
- 表态内容：
  > 园区接下来重点补三件事：版号申报的辅导、研发空间的供给、人才公寓的配套。
- 来源：云溪数字产业园官网 https://www.yunxipark.example/news/2026-10-16

---

# 二、陆行舟

## 2.1 基本信息

（示例：完整五章见单独的政务服务中心档案）

## 2.2 现任职务

区政务服务中心主任

---

# 三、顾清和

## 3.1 基本信息

| 项目 | 内容 |
|---|---|
| 姓名 | 顾清和 |
| 性别 | 未公开 |
| 民族 | 未公开 |
| 出生日期 | 未公开 |

## 3.2 现任职务

区经济和信息化局党组成员、副局长，分管数字经济科、企业服务科。

## 3.5 公开活动与发言

### 一、区经济和信息化局任职期（2024.08—）

#### 2026.09.12　出席区数字经济产业链专班第一次会议

- 场合：专班首次全体会议
- 表态内容：会议报道未披露发言内容
- 来源：云溪区人民政府门户网站 https://yunxi.gov.example/zwgk/2026/0912/1663.html

> 这份机构档案是本地预览用的示例：人物与链接均为虚构。
`,
  })
  console.log('seeded 2 dossiers + 1 institution')
}

if (!listCards().length) {
  const png = readFileSync(join(root, 'examples', 'portrait-shenwangshu.png'))
  saveCard({ png, name: '沈望舒', title: '沈望舒｜人物画像卡', subtitle: '云溪区经济和信息化局党组书记、局长 · 观察期 2026.10—11', type: '事务推进型', confidence: '中等', stars: '4', region: '江州市云溪区', period: '2026.10—11', origin: 'generated' })
  console.log('seeded 1 card')
}

// 本地预览用假的后台执行器：模拟排队 → 运行 → 完成，方便看任务面板
const mockJobs = []
let mockSeq = 0
const mockRunner = {
  list: () => mockJobs,
  start({ kind, name }) {
    const k = kind === 'card' ? 'card' : kind === 'import' ? 'import' : 'research'
    const job = {
      id: `job-mock${++mockSeq}`,
      kind: k,
      kindLabel: k === 'card' ? '画像制作' : k === 'import' ? '智能建档' : '资料搜集',
      name: name || '本地预览人物',
      status: 'queued',
      phase: '排队中',
      steps: 0,
      progress: 4,
      lastTool: '',
      error: '',
      resultIds: [],
      sessionId: 'session-mock',
      text: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: '',
      finishedAt: '',
    }
    mockJobs.unshift(job)
    setTimeout(() => {
      job.status = 'running'
      job.phase = '检索公开信息'
      job.progress = 10
      job.startedAt = new Date().toISOString()
      job.lastTool = 'web_search'
    }, 500)
    const tick = setInterval(() => {
      if (job.status !== 'running') return
      job.steps++
      job.progress = Math.min(94, 10 + job.steps * 7)
      job.lastTool = ['web_search', 'web_fetch', 'skill', 'web_search'][job.steps % 4]
      job.updatedAt = new Date().toISOString()
    }, 1400)
    setTimeout(() => {
      clearInterval(tick)
      job.status = 'done'
      job.phase = '已完成'
      job.progress = 100
      job.finishedAt = new Date().toISOString()
      job.updatedAt = job.finishedAt
      job.text = '（本地预览的模拟结果，真实任务会在这里给出覆盖度和缺口说明。）'
    }, 7000)
    return { ...job }
  },
  cancel(id) {
    const job = mockJobs.find((j) => j.id === id)
    if (!job) return false
    job.status = 'canceled'
    job.phase = '已取消'
    job.progress = 100
    job.finishedAt = new Date().toISOString()
    return true
  },
}

const port = Number(process.env.PORT || 4317)
createServer(createHandler(root, mockRunner)).listen(port, '127.0.0.1', () => {
  console.log(`人物情报库 · 本地预览 http://127.0.0.1:${port}/character-profile/`)
})
