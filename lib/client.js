// 人物情报库 · DeepSeek Harness 插件：浏览器半边
//   - 侧栏加一个「人物情报库」入口，主区域是插件页面（/character-profile/，iframe）
//   - 页面里点「开始搜集」「生成画像卡」「做同款」：页面 postMessage 一段 prompt，
//     这里开一个新对话并把 prompt 填进输入框（不直接发送，用户可以改完再发）
//   - 明暗跟随 dsh：主题服务在的话，把当前配色转发给 iframe
window.__ModuleLoader__.load({
  id: 'dsh-character-profile',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const PANEL = 'character-profile'
    const SRC = '/character-profile/'

    // 侧栏图标：一张带人像的卡片
    function PortraitIcon(props) {
      const s = (props && props.size) || 18
      return h(
        'svg',
        { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'square', strokeLinejoin: 'round' },
        h('rect', { x: 3.5, y: 3, width: 17, height: 18 }),
        h('circle', { cx: 12, cy: 10, r: 2.6 }),
        h('path', { d: 'M7.5 18c.7-2.2 2.4-3.4 4.5-3.4s3.8 1.2 4.5 3.4' }),
      )
    }

    function apply(ctx) {
      const frames = new Set()
      let scheme = null
      const post = (frame) => scheme && frame.contentWindow && frame.contentWindow.postMessage({ type: 'character-profile:scheme', scheme }, location.origin)
      ctx.inject(['theme'], (c) => {
        const push = (snap) => {
          scheme = snap.active.colorScheme
          frames.forEach(post)
        }
        push(c.theme.getTheme())
        c.on('theme/change', push)
      })

      function PortraitPanel() {
        const ref = React.useRef(null)
        React.useEffect(() => {
          const self = ref.current
          if (self) frames.add(self)
          function onMessage(e) {
            const frame = ref.current
            if (!frame || e.source !== frame.contentWindow || e.origin !== location.origin) return
            const m = e.data
            if (!m || m.type !== 'character-profile:start' || typeof m.prompt !== 'string') return
            try {
              ctx.uiWorkspace.startSession(undefined, { prompt: m.prompt, whenDraftExists: 'replace' })
            } catch (err) {
              console.error('[character-profile] 开新对话失败', err)
              frame.contentWindow.postMessage({ type: 'character-profile:start-failed', message: String((err && err.message) || err) }, location.origin)
            }
          }
          addEventListener('message', onMessage)
          return () => {
            removeEventListener('message', onMessage)
            frames.delete(self)
          }
        }, [])
        return h('iframe', {
          ref,
          src: SRC,
          title: '人物情报库',
          allow: 'fullscreen',
          onLoad: (e) => post(e.currentTarget),
          style: { width: '100%', height: '100%', border: 0, display: 'block' },
        })
      }

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 7, label: () => '人物情报库' }, PortraitIcon),
      )
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, PortraitPanel))
    }

    exports.isPlugin = true
    exports.inject = ['slots', 'uiWorkspace']
    exports.apply = apply
    return module.exports
  },
})
