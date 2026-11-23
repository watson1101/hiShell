import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useAppStore } from './hooks/store'
import { api, events } from './hooks/api'
import SessionSidebar from './components/SessionSidebar'
import SessionEditor from './components/SessionEditor'
import TerminalView from './components/TerminalView'
import SftpView from './components/SftpView'
import MonitorView from './components/MonitorView'
import BatchPanel from './components/BatchPanel'
import type { Session } from './types'

const SPLIT_STORAGE_KEY = 'hishell.terminal-ratio'
const MIN_RATIO = 0.15
const MAX_RATIO = 0.85
const clampRatio = (v: number) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, v))
function readStoredRatio(): number {
  try {
    const v = Number(localStorage.getItem(SPLIT_STORAGE_KEY))
    return Number.isFinite(v) && v > 0 ? clampRatio(v) : 0.5
  } catch {
    return 0.5
  }
}

export default function App() {
  const {
    sessions, activeSessionId, statuses, error,
    loadSessions, setError, setStatus,
  } = useAppStore()
  const [editing, setEditing] = useState<{ open: boolean; session?: Session }>({ open: false })
  const [batchOpen, setBatchOpen] = useState(false)
  const [version, setVersion] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [terminalRatio, setTerminalRatio] = useState(readStoredRatio)
  const [splitterDragging, setSplitterDragging] = useState(false)
  const workMainRef = useRef<HTMLDivElement>(null)
  const splitterRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const ratioRef = useRef(terminalRatio)

  const saveRatio = (v: number) => {
    const next = clampRatio(v)
    ratioRef.current = next
    setTerminalRatio(next)
    try { localStorage.setItem(SPLIT_STORAGE_KEY, String(next)) } catch { /* ignore */ }
  }

  // 拖动时锁定全局光标并禁止选中文本
  useEffect(() => {
    document.body.classList.toggle('splitter-dragging', splitterDragging)
    return () => document.body.classList.remove('splitter-dragging')
  }, [splitterDragging])

  const updateRatioFromPointer = (clientY: number) => {
    const rect = workMainRef.current?.getBoundingClientRect()
    if (!rect || rect.height <= 0) return
    const splitterHeight = splitterRef.current?.offsetHeight || 4
    const paneHeight = rect.height - splitterHeight
    if (paneHeight <= 0) return
    const ratio = clampRatio((clientY - rect.top) / paneHeight)
    ratioRef.current = ratio
    setTerminalRatio(ratio)
  }

  const onSplitterPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    draggingRef.current = true
    setSplitterDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
    updateRatioFromPointer(e.clientY)
  }
  const onSplitterPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    updateRatioFromPointer(e.clientY)
  }
  const onSplitterPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setSplitterDragging(false)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    saveRatio(ratioRef.current)
  }
  const onSplitterKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const step = e.shiftKey ? 0.1 : 0.02
      saveRatio(ratioRef.current + (e.key === 'ArrowUp' ? -step : step))
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      saveRatio(e.key === 'Home' ? MIN_RATIO : MAX_RATIO)
    }
  }

  useEffect(() => {
    loadSessions()
    api.version().then(setVersion).catch(() => {})
  }, [loadSessions])

  useEffect(() => {
    const off = events.on('ssh:status', (p: { sessionId: string; status: string }) => {
      if (p?.sessionId) {
        const map: Record<string, any> = { connecting: 'connecting', connected: 'connected', disconnected: 'disconnected', error: 'error' }
        if (map[p.status]) setStatus(p.sessionId, map[p.status])
      }
    })
    return off
  }, [setStatus])

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const connected = activeSessionId ? statuses[activeSessionId] === 'connected' : false
  const connectedCount = Object.values(statuses).filter((s) => s === 'connected').length

  return (
    <div className="app-shell">
      <div className="content-row">
        <SessionSidebar
          onEdit={(s) => setEditing({ open: true, session: s })}
          onBatch={() => setBatchOpen(true)}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        />

        {activeSessionId ? (
          <div className="workspace">
            {/* 左侧：系统监控栏（FinalShell 风格），常驻 */}
            <aside className="monitor-column">
              <MonitorView key={activeSessionId} sessionId={activeSessionId} active={connected} title={activeSession?.name} />
            </aside>

            {/* 右侧：上终端 + 可拖动分界线 + 下文件管理 */}
            <div className="work-main" ref={workMainRef}>
              <div className="terminal-pane" style={{ flexGrow: terminalRatio }}>
                <TerminalView key={activeSessionId} sessionId={activeSessionId} active={true} />
              </div>
              <div
                ref={splitterRef}
                className={`pane-splitter${splitterDragging ? ' dragging' : ''}`}
                role="separator"
                aria-orientation="horizontal"
                aria-label="调整终端与文件管理区域高度"
                aria-valuemin={Math.round(MIN_RATIO * 100)}
                aria-valuemax={Math.round(MAX_RATIO * 100)}
                aria-valuenow={Math.round(terminalRatio * 100)}
                tabIndex={0}
                title="拖动调整高度；双击恢复默认；方向键微调"
                onPointerDown={onSplitterPointerDown}
                onPointerMove={onSplitterPointerMove}
                onPointerUp={onSplitterPointerUp}
                onPointerCancel={onSplitterPointerUp}
                onDoubleClick={() => saveRatio(0.5)}
                onKeyDown={onSplitterKeyDown}
              />
              <div className="sftp-pane" style={{ flexGrow: 1 - terminalRatio }}>
                <SftpView key={activeSessionId} sessionId={activeSessionId} active={connected} />
              </div>
            </div>
          </div>
        ) : (
          <div className="welcome">
            <div className="welcome-logo">hiShell</div>
            <div className="welcome-sub">跨平台 SSH 客户端 · 连接 · 文件 · 监控 · 批量</div>
            <div className="welcome-tips">
              <div>1. 点击左侧 <b>＋</b> 新建会话</div>
              <div>2. <b>双击</b>会话连接服务器</div>
              <div>3. 连接后自动打开三区：<b>左侧监控 / 右上终端 / 右下文件管理</b></div>
              <div>4. 左下角「⚡ 批量命令」可向多台服务器同时下发指令</div>
            </div>
          </div>
        )}
      </div>

      {error && <div className="toast error" onClick={() => setError('')}>{error} ×</div>}

      {editing.open && (
        <SessionEditor session={editing.session} onClose={() => setEditing({ open: false })} />
      )}
      {batchOpen && <BatchPanel onClose={() => setBatchOpen(false)} />}

      <div className="status-bar">
        <span>hiShell {version || 'v0.1.0-alpha'}</span>
        <span>{sessions.length} 个会话 · {connectedCount} 个已连接</span>
      </div>
    </div>
  )
}
