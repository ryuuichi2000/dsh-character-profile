// 人物情报库 · DeepSeek Harness 插件：Host 半边
// 1. 把插件自带的两个 skill（skills/）注册进 ctx.skills，模型和 /skill 命令都能用
//    「人物资料搜集」：按履历逐段检索、双源核验、输出五章档案
//    「governance-portrait」：三元框架 + 两轴编码，出 1080×1440 克莱因蓝画像卡
// 2. 给模型五个工具（lib/tools.js）：存资料、存画像卡、读资料、看库、搜公众号
// 3. 后台任务执行器（lib/runner.js）：页面里点「开始」直接在 Host 进程起一个 agent 跑完，
//    不跳对话、不用手动发送；结果由上面的工具写进库，页面轮询任务状态。
// 4. /character-profile/           插件页面（gallery/，侧栏「人物情报库」打开的就是它）
//    /character-profile/api/...     资料库 / 画像库 / 官方示例 / 后台任务接口
//    /character-profile/media/...   画像卡图片、示例图片
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE, createHandler } from './http.js'
import { createRunner } from './runner.js'
import { createSkillProvider } from './skills.js'
import { TOOLS } from './tools.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKILL_DIR = join(ROOT, 'skills')

export const name = 'character-profile'
export const inject = ['webServer', 'skills', 'tools']

export function apply(ctx) {
  ctx.effect(() => ctx.skills.registerProvider(() => createSkillProvider(SKILL_DIR)))
  for (const tool of TOOLS) ctx.tools.register(tool)
  const runner = createRunner(ctx)
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: BASE,
      handler: createHandler(ROOT, runner),
    }),
  )
}
