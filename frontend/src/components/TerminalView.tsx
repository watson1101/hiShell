import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { api, events } from '../hooks/api'
import { useAppStore } from '../hooks/store'

interface Props {
  sessionId: string
  active: boolean
}

// UTF-8 与 GBK 解码
function decodeData(data: string, encoding: string): string {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
  if (encoding.toLowerCase() === 'gbk' && 'TextDecoder' in window) {
    try {
      return new TextDecoder('gbk').decode(bytes)
    } catch {
      // 浏览器不支持 GBK 时回退 UTF-8
    }
  }
  return new TextDecoder('utf-8').decode(bytes)
}

function encodeData(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  bytes.forEach((b) => { binary += String.fromCharCode(b) })
  return btoa(binary)
}

export default function TerminalView({ sessionId, active }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const encodingRef = useRef('utf-8')
  const session = useAppStore((s) => s.sessions.find((x) => x.id === sessionId))
  const [connecting, setConnecting] = useState(true)

  useEffect(() => {
    if (!containerRef.current) return
    encodingRef.current = session?.encoding || 'utf-8'

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, "Microsoft YaHei", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      theme: {
        background: '#1a1b26',
        foreground: '#c0caf5',
        cursor: '#c0caf5',
        selectionBackground: '#33467c',
        black: '#15161e',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#a9b1d6',
      },
      allowProposedApi: true,
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)
    // 注意：此处不调用 fit.fit()。容器在首次渲染时可能还没有有效尺寸，
    // FitAddon.fit() 会抛异常并中断整个 useEffect（事件监听/连接都没注册），
    // 导致终端一片空白。改为下面的 safeFit 延迟执行。
    termRef.current = term
    fitRef.current = fit

    // 键盘输入 -> Go 后端
    const inputSub = term.onData((data) => {
      api.writeTerminal(sessionId, encodeData(data)).catch((e) => {
        term.writeln(`\r\n[写入失败: ${e}]`)
      })
    })

    // 接收远端输出
    const offData = events.on('ssh:terminal-data', (payload: { sessionId: string; data: string }) => {
      if (payload?.sessionId !== sessionId) return
      term.write(decodeData(payload.data, encodingRef.current))
    })

    const offExit = events.on('ssh:terminal-exit', (payload: { sessionId: string; reason: string }) => {
      if (payload?.sessionId !== sessionId) return
      term.writeln(`\r\n\x1b[33m[连接已关闭: ${payload.reason || '正常退出'}]\x1b[0m`)
    })

    // 窗口尺寸变化 -> 同步 PTY。fit 全部包在 try/catch 内，避免抛异常中断初始化
    const safeFit = () => {
      try { fit.fit() } catch { /* 容器尺寸尚未就绪时忽略 */ }
    }
    const resize = () => {
      try {
        fit.fit()
        api.resizeTerminal(sessionId, term.cols, term.rows).catch(() => {})
      } catch {
        // 容器不可见时忽略
      }
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(containerRef.current)
    window.addEventListener('resize', resize)
    // 延迟一帧等布局稳定后再适配尺寸
    requestAnimationFrame(safeFit)
    setTimeout(safeFit, 100)

    // 初始连接：只有终端视图这一处发起连接，避免与侧边栏重复连接产生竞态。
    // 侧边栏双击会话只负责 openTab，真正的连接在这里、且事件监听已注册完成后发起。
    // 连接状态用覆盖层展示，不往终端写入任何自定义文字，保持终端内容干净。
    connect()

    return () => {
      inputSub.dispose()
      offData()
      offExit()
      resizeObserver.disconnect()
      window.removeEventListener('resize', resize)
      term.dispose()
      termRef.current = null
    }
  }, [sessionId])

  // 标签激活时重新适配尺寸并聚焦
  useEffect(() => {
    if (active && termRef.current && fitRef.current) {
      setTimeout(() => {
        try {
          fitRef.current?.fit()
          termRef.current?.focus()
          api.resizeTerminal(sessionId, termRef.current?.cols || 80, termRef.current?.rows || 24).catch(() => {})
        } catch { /* ignore */ }
      }, 50)
    }
  }, [active, sessionId])

  async function connect(password = '', passphrase = '', remember = false) {
    const term = termRef.current
    setConnecting(true)
    try {
      if (password || passphrase) {
        await api.connectWithCredential(sessionId, password, passphrase, remember)
      } else {
        await api.connect(sessionId)
      }
      useAppStore.getState().setStatus(sessionId, 'connected')
      setConnecting(false)
      if (term) {
        try {
          await api.resizeTerminal(sessionId, term.cols, term.rows)
        } catch { /* ignore */ }
      }
    } catch (e: any) {
      const msg = typeof e === 'string' ? e : e.message || String(e)
      useAppStore.getState().setStatus(sessionId, 'error')
      setConnecting(false)
      if (msg.includes('NEED_CREDENTIAL')) {
        const pwd = window.prompt('请输入 SSH 密码（密钥认证请输入 passphrase，留空则无）：')
        if (pwd !== null) {
          setConnecting(true)
          const rememberPwd = window.confirm('是否记住凭据到系统钥匙串？')
          await connect(pwd, pwd, rememberPwd)
          return
        }
      }
      term?.writeln(`\x1b[31m[连接失败: ${msg}]\x1b[0m`)
      useAppStore.getState().setError(msg)
    }
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', background: '#1a1b26', padding: 4, boxSizing: 'border-box' }}
        onClick={() => termRef.current?.focus()}
      />
      {connecting && (
        <div className="terminal-connecting">
          <span className="connect-spinner" /> 正在连接...
        </div>
      )}
    </div>
  )
}
