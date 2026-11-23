import { useState, useEffect } from 'react'
import type { BatchResult, Session } from '../types'
import { api } from '../hooks/api'
import { useAppStore } from '../hooks/store'

interface Props {
  onClose: () => void
}

const presetCommands = [
  { label: '系统信息', cmd: 'uname -a && hostname' },
  { label: '资源概览', cmd: 'uptime && free -h | head -2 && df -h /' },
  { label: '磁盘使用', cmd: 'df -h' },
  { label: '内存占用 Top5', cmd: 'ps -eo pid,pmem,rss,comm --sort=-pmem | head -6' },
  { label: '监听端口', cmd: 'ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null' },
]

export default function BatchPanel({ onClose }: Props) {
  const { sessions, statuses } = useAppStore()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [command, setCommand] = useState('')
  const [timeout, setTimeoutSec] = useState(30)
  const [results, setResults] = useState<BatchResult[]>([])
  const [running, setRunning] = useState(false)

  const connected = sessions.filter((s) => statuses[s.id] === 'connected')

  useEffect(() => {
    api.connectedSessions().then((ids) => {
      // 用后端返回的连接状态校正
      setSelected((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.add(id))
        return next
      })
    }).catch(() => {})
  }, [])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function execute() {
    if (selected.size === 0 || !command.trim()) return
    setRunning(true)
    setResults([])
    try {
      const res = await api.batchExec(Array.from(selected), command, timeout)
      setResults(res)
    } catch (e: any) {
      setResults([{ sessionId: '', sessionName: '错误', success: false, output: '', error: e.message || String(e), duration: '' }])
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="batch-panel">
      <div className="batch-header">
        <h3>⚡ 多服务器批量命令</h3>
        <button className="icon-btn" onClick={onClose}>×</button>
      </div>

      <div className="batch-body">
        <div className="batch-left">
          <div className="batch-section-title">选择服务器（仅已连接）</div>
          <div className="batch-server-list">
            {connected.length === 0 && <div className="batch-hint">当前没有已连接的会话，请先连接服务器</div>}
            {connected.map((s: Session) => (
              <label key={s.id} className="batch-server-item">
                <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                <span className="status-dot" style={{ background: '#9ece6a' }} />
                <span>{s.name} <small>({s.host})</small></span>
              </label>
            ))}
          </div>
          <div className="batch-select-actions">
            <button onClick={() => setSelected(new Set(connected.map((s) => s.id)))}>全选</button>
            <button onClick={() => setSelected(new Set())}>清空</button>
          </div>

          <div className="batch-section-title">快捷命令</div>
          <div className="preset-list">
            {presetCommands.map((p) => (
              <button key={p.label} onClick={() => setCommand(p.cmd)}>{p.label}</button>
            ))}
          </div>
        </div>

        <div className="batch-right">
          <div className="batch-section-title">命令</div>
          <textarea
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="输入要在所有选中服务器上执行的命令..."
            rows={3}
          />
          <div className="batch-exec-row">
            <label>超时 <input type="number" value={timeout} min={1} max={300} onChange={(e) => setTimeoutSec(Number(e.target.value))} /> 秒</label>
            <button className="btn primary" onClick={execute} disabled={running || selected.size === 0 || !command.trim()}>
              {running ? '执行中...' : `执行 (${selected.size} 台)`}
            </button>
          </div>

          <div className="batch-section-title">执行结果</div>
          <div className="batch-results">
            {results.length === 0 && <div className="batch-hint">尚无结果</div>}
            {results.map((r, i) => (
              <div key={i} className={`batch-result ${r.success ? 'success' : 'failed'}`}>
                <div className="result-header">
                  <span className="result-status">{r.success ? '✓' : '✗'}</span>
                  <strong>{r.sessionName}</strong>
                  <span className="result-duration">{r.duration}</span>
                </div>
                <pre>{r.output || r.error || '(无输出)'}</pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
