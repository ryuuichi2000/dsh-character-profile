// 明暗跟随 dsh：放在 <head> 里同步执行，首帧就是对的颜色。
//   - 嵌在 dsh 里：先读宿主 body 上的 data-ds-dark-theme（dsh 主题插件写的），之后听 client.js 转发的主题切换
//   - 单独在浏览器里打开：跟随系统
(() => {
  const root = document.documentElement
  const set = (dark) => {
    root.dataset.scheme = dark ? 'dark' : 'light'
  }
  let host = null
  try {
    if (parent !== window) host = parent.document.body
  } catch {}
  if (host) set(host.hasAttribute('data-ds-dark-theme'))
  else {
    const media = matchMedia('(prefers-color-scheme: dark)')
    set(media.matches)
    media.addEventListener('change', (e) => set(e.matches))
  }
  addEventListener('message', (e) => {
    if (e.source !== parent || e.origin !== location.origin) return
    if (e.data?.type === 'character-profile:scheme') set(e.data.scheme === 'dark')
  })

  // 字体用外链异步加，断网或网络不通时不挡首屏（本地字体栈已经能看）
  const font = document.createElement('link')
  font.rel = 'stylesheet'
  font.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@200..700&family=Noto+Sans+SC:wght@200..700&family=JetBrains+Mono:wght@400;500&display=swap'
  document.head.appendChild(font)
})()
