// 极简 Markdown 渲染：标题、表格、引用、列表、代码块、链接、粗体。
// 只用于展示资料库里的档案（内容来自模型或用户上传），所有文本先转义再拼 HTML。
;(function () {
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

  const safeUrl = (u) => (/^(https?:)?\/\//i.test(u) || /^mailto:/i.test(u) ? u : '#')

  function inline(raw) {
    let s = esc(raw)
    const codes = []
    s = s.replace(/`([^`]+)`/g, (_, code) => {
      codes.push(`<code>${code}</code>`)
      return `\u0001C${codes.length - 1}\u0001`
    })
    const links = []
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
      links.push(`<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener">${label}</a>`)
      return `\u0001L${links.length - 1}\u0001`
    })
    // 裸链接（档案里的「来源：https://…」）
    s = s.replace(/(^|[\s(（])((?:https?:\/\/)[^\s<)）]+)/g, (m, pre, url) => `${pre}<a href="${esc(url)}" target="_blank" rel="noopener">${url}</a>`)
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    s = s.replace(/\u0001C(\d+)\u0001/g, (_, i) => codes[+i])
    s = s.replace(/\u0001L(\d+)\u0001/g, (_, i) => links[+i])
    return s
  }

  function splitRow(line) {
    let l = line.trim()
    if (l.startsWith('|')) l = l.slice(1)
    if (l.endsWith('|')) l = l.slice(0, -1)
    return l.split('|').map((c) => c.trim())
  }

  const isSep = (line) => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-')

  function render(md) {
    const lines = String(md || '').replace(/\r\n/g, '\n').split('\n')
    const out = []
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      if (!line.trim()) {
        i++
        continue
      }
      // 代码块
      if (/^```/.test(line.trim())) {
        const buf = []
        i++
        while (i < lines.length && !/^```/.test(lines[i].trim())) buf.push(lines[i++])
        i++
        out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`)
        continue
      }
      // 分隔线
      if (/^\s*([-*_])\1{2,}\s*$/.test(line) && !line.includes('|')) {
        out.push('<hr>')
        i++
        continue
      }
      // 标题
      const h = /^(#{1,6})\s+(.*)$/.exec(line)
      if (h) {
        out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`)
        i++
        continue
      }
      // 表格：当前行有 |，下一行是分隔行
      if (line.includes('|') && i + 1 < lines.length && isSep(lines[i + 1])) {
        const head = splitRow(line)
        i += 2
        const rows = []
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]))
        out.push(
          `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows
            .map((r) => `<tr>${head.map((_, k) => `<td>${inline(r[k] ?? '')}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`,
        )
        continue
      }
      // 引用
      if (/^\s*>/.test(line)) {
        const buf = []
        while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''))
        out.push(`<blockquote>${buf.map((b) => (b.trim() ? `<p>${inline(b)}</p>` : '')).join('')}</blockquote>`)
        continue
      }
      // 列表
      const li = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(line)
      if (li) {
        const ordered = /\d+\./.test(li[1])
        const items = []
        while (i < lines.length) {
          const m = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(lines[i])
          if (!m || /\d+\./.test(m[1]) !== ordered) break
          items.push(`<li>${inline(m[2])}</li>`)
          i++
        }
        out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`)
        continue
      }
      // 段落：连续非空行，遇到块级结构停下
      const para = [line]
      i++
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*>|\s*([-*+]|\d+\.)\s)/.test(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && isSep(lines[i + 1]))) {
        para.push(lines[i++])
      }
      out.push(`<p>${para.map(inline).join('<br>')}</p>`)
    }
    return out.join('\n')
  }

  window.PS_MD = { render, inline }
})()
