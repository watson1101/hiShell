import { useState } from 'react'
import { useAppStore } from '../hooks/store'
import { api } from '../hooks/api'
import type { Session } from '../types'

interface Props {
  onEdit: (s?: Session) => void
  onBatch: () => void
  collapsed: boolean
  onToggleCollapse: () => void
}

const statusColor: Record<string, string> = {
  idle: '#6b7280',
  connecting: '#e0af68',
  connected: '#9ece6a',
  disconnected: '#6b7280',
  error: '#f7768e',
}

export default function SessionSidebar({ onEdit, onBatch, collapsed, onToggleCollapse }: Props) {
  const { sessions, statuses, activeSessionId, setActiveSession, setStatus, removeSession, loadSessions } = useAppStore()
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  // 收起态：只显示一条窄栏和一个展开按钮，点击可恢复
  if (collapsed) {
    return (
      <aside className="sidebar sidebar-collapsed">
        <button className="sidebar-expand-btn" title="展开会话列表" onClick={onToggleCollapse}>»</button>
        <div className="sidebar-collapsed-label">会话</div>
      </aside>
    )
  }

  const filtered = sessions.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.host.toLowerCase().includes(search.toLowerCase())
  )

  // 按分组聚合
  const groups = new Map<string, Session[]>()
  filtered.forEach((s) => {
    const key = s.group || '默认分组'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(s)
  })

  function handleConnect(s: Session) {
    // 设为当前活动会话，三区（终端/文件/监控）切换连接到它。
    // 真正的连接由 TerminalView 在挂载后发起，确保事件监听先注册完成。
    setStatus(s.id, 'connecting')
    setActiveSession(s.id)
  }

  async function handleDisconnect(s: Session) {
    try {
      await api.disconnect(s.id)
      setStatus(s.id, 'disconnected')
    } catch (e: any) {
      window.alert(`断开失败: ${e.message || e}`)
    }
  }

  async function handleDelete(id: string) {
    await removeSession(id)
    await loadSessions()
    setConfirmDelete(null)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">hiShell <span className="version-local">SSH</span></div>
        <div className="sidebar-header-actions">
          <button className="icon-btn" title="收起会话列表" onClick={onToggleCollapse}>«</button>
          <button className="icon-btn" title="新增会话" onClick={() => onEdit()}>＋</button>
        </div>
      </div>

      <div className="search-box">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索会话 / 主机..."
        />
      </div>

      <div className="session-list">
        {groups.size === 0 && (
          <div className="empty-hint">
            {sessions.length === 0 ? '暂无会话，点右上角 ＋ 新建' : '无匹配会话'}
          </div>
        )}
        {Array.from(groups.entries()).map(([groupName, items]) => (
          <div key={groupName} className="session-group">
            <div className="group-name">▼ {groupName} ({items.length})</div>
            {items.map((s) => {
              const status = statuses[s.id] || 'idle'
              return (
                <div key={s.id} className={`session-item ${status} ${activeSessionId === s.id ? 'active' : ''}`}>
                  <div className="session-main" onDoubleClick={() => handleConnect(s)} onClick={() => setActiveSession(s.id)}>
                    <span className="status-dot" style={{ background: statusColor[status] }} />
                    <div className="session-info">
                      <div className="session-name">
                        {s.favorite && <span className="fav">★</span>}
                        {s.name}
                      </div>
                      <div className="session-host">{s.username}@{s.host}:{s.port}</div>
                    </div>
                  </div>
                  <div className="session-actions">
                    {status === 'connected' ? (
                      <>
                        <button title="切换到此会话" onClick={() => setActiveSession(s.id)}>切换</button>
                        <button title="断开" onClick={() => handleDisconnect(s)}>断</button>
                      </>
                    ) : (
                      <button title="连接" onClick={() => handleConnect(s)}>连</button>
                    )}
                    <button title="编辑" onClick={() => onEdit(s)}>✎</button>
                    <button title="删除" onClick={() => setConfirmDelete(s.id)}>×</button>
                  </div>
                  {confirmDelete === s.id && (
                    <div className="confirm-delete">
                      <span>确认删除？</span>
                      <button onClick={() => handleDelete(s.id)}>确认</button>
                      <button onClick={() => setConfirmDelete(null)}>取消</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <button className="batch-btn" onClick={onBatch}>⚡ 批量命令</button>
      </div>
    </aside>
  )
}
