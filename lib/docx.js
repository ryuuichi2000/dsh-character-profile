// 读 .docx 的正文：用 dsh 自带的 Python（python-docx）抽段落和表格，返回纯文本。
// 只用于「新建档案」的拖入导入；.md / .txt 不走这里，页面直接读。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = [
  'import sys, docx',
  'd = docx.Document(sys.argv[1])',
  'parts = []',
  'for p in d.paragraphs:',
  '    if p.text.strip():',
  '        parts.append(p.text)',
  'for t in d.tables:',
  '    for row in t.rows:',
  '        cells = [c.text.strip().replace("\\n", " ") for c in row.cells]',
  '        if any(cells):',
  '            parts.append(" | ".join(cells))',
  'print("\\n".join(parts))',
].join('\n')

function findPython() {
  const candidates = []
  if (process.env.DSH_PYTHON) candidates.push(process.env.DSH_PYTHON)
  const homes = [process.env.DSH_HOME, join(homedir(), '.dsh')].filter(Boolean)
  for (const home of homes) {
    const runtimes = join(home, 'dsh-runtimes')
    try {
      for (const d of readdirSync(runtimes)) {
        candidates.push(join(runtimes, d, 'dependencies', 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3'))
      }
    } catch {}
  }
  for (const p of candidates) if (existsSync(p)) return p
  return process.platform === 'win32' ? 'python' : 'python3'
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('解析文档超时（30 秒）'))
    }, 30_000)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) return resolve(out)
      const detail = err.trim().split('\n').slice(-3).join(' ')
      reject(new Error(detail || `解析失败（退出码 ${code}）`))
    })
  })
}

export async function extractDocx(buffer) {
  const dir = join(tmpdir(), 'character-profile')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${randomUUID()}.docx`)
  writeFileSync(file, buffer)
  try {
    const py = findPython()
    const text = await run(py, ['-c', SCRIPT, file])
    return String(text || '').replace(/\r\n/g, '\n').trim()
  } finally {
    rmSync(file, { force: true })
  }
}
