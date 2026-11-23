import { useState, useEffect, useCallback, useRef } from 'react'
import type { FileEntry, TransferProgress } from '../types'
import { api, events } from '../hooks/api'
import DirTree from './DirTree'

interface Props {
  sessionId: string
  active: boolean
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export default function SftpView({ sessionId, active }: Props) {
  const [path, setPath] = useState('~')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [transfers, setTransfers] = useState<TransferProgress[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dirInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const list = await api.sftpList(sessionId, path)
      setEntries(list)
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [sessionId, path])

  useEffect(() => { if (active) refresh() }, [active, refresh])

  useEffect(() => {
    const off = events.on('sftp:progress', (p: TransferProgress) => {
      setTransfers((prev) => {
        const idx = prev.findIndex((t) => t.id === p.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = p
          return next
        }
        return [p, ...prev].slice(0, 20)
      })
    })
    return off
  }, [])

  function navigate(dir: FileEntry) {
    setPath(dir.path)
    setSelected(new Set())
  }

  function goUp() {
    if (path === '/' || path === '~') return
    const parts = path.split('/').filter(Boolean)
    parts.pop()
    setPath('/' + parts.join('/'))
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      // 通过 Wails 文件对话框拿到的是本地完整路径；拖拽需要临时处理
      const localPath = (file as any).path || ''
      if (!localPath) {
        setError('拖拽上传需要浏览器文件路径支持，请使用「上传文件」按钮选择')
        continue
      }
      try {
        const remotePath = path === '~' ? `~/${file.name}` : `${path}/${file.name}`
        await api.sftpUpload(sessionId, localPath, remotePath)
        await refresh()
      } catch (e: any) {
        setError(`上传 ${file.name} 失败: ${e.message || e}`)
      }
    }
  }

  async function handleUploadClick() {
    const localPath = await api.openFileDialog()
    if (!localPath) return
    const name = localPath.split(/[\\/]/).pop() || 'file'
    const remotePath = path === '~' ? `~/${name}` : `${path}/${name}`
    try {
      await api.sftpUpload(sessionId, localPath, remotePath)
      await refresh()
    } catch (e: any) {
      setError(`上传失败: ${e.message || e}`)
    }
  }

  async function handleUploadDirClick() {
    const localDir = await api.openDirectoryDialog()
    if (!localDir) return
    const name = localDir.split(/[\\/]/).pop() || 'dir'
    const remoteDir = path === '~' ? `~/${name}` : `${path}/${name}`
    try {
      await api.sftpUploadDirectory(sessionId, localDir, remoteDir)
      await refresh()
    } catch (e: any) {
      setError(`上传目录失败: ${e.message || e}`)
    }
  }

  async function handleDownload(entry: FileEntry) {
    try {
      if (entry.isDir) {
        const localDir = await api.saveDirectoryDialog()
        if (!localDir) return
        await api.sftpDownloadDirectory(sessionId, entry.path, localDir)
      } else {
        const localPath = await api.saveFileDialog(entry.name)
        if (!localPath) return
        await api.sftpDownload(sessionId, entry.path, localPath)
      }
    } catch (e: any) {
      setError(`下载失败: ${e.message || e}`)
    }
  }

  async function handleMkdir() {
    const name = window.prompt('新目录名称：')
    if (!name) return
    try {
      const remotePath = path === '~' ? `~/${name}` : `${path}/${name}`
      await api.sftpMkdir(sessionId, remotePath)
      await refresh()
    } catch (e: any) {
      setError(`创建目录失败: ${e.message || e}`)
    }
  }

  async function handleDelete() {
    if (selected.size === 0) return
    if (!window.confirm(`确认删除选中的 ${selected.size} 项？`)) return
    try {
      for (const p of selected) {
        const entry = entries.find((e) => e.path === p)
        await api.sftpRemove(sessionId, p, entry?.isDir || false)
      }
      setSelected(new Set())
      await refresh()
    } catch (e: any) {
      setError(`删除失败: ${e.message || e}`)
    }
  }

  function toggleSelect(entry: FileEntry) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(entry.path)) next.delete(entry.path)
      else next.add(entry.path)
      return next
    })
  }

  const activeTransfers = transfers.filter((t) => t.status === 'running')

  return (
    <div className="sftp-view">
      <div className="sftp-toolbar">
        <button onClick={goUp} title="上级目录">↑ 上级</button>
        <button onClick={refresh} title="刷新">↻ 刷新</button>
        <button onClick={handleUploadClick} title="上传文件">⬆ 上传文件</button>
        <button onClick={handleUploadDirClick} title="上传目录">⬆ 上传目录</button>
        <button onClick={handleMkdir} title="新建目录">＋ 新目录</button>
        <button onClick={handleDelete} disabled={selected.size === 0} title="删除">✕ 删除</button>
        <input className="path-input" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && refresh()} />
      </div>

      {error && <div className="sftp-error">{error}</div>}

      <div className="sftp-body">
        {/* 左侧：目录树导航 */}
        <aside className="sftp-tree-pane">
          <DirTree
            sessionId={sessionId}
            currentPath={path}
            onNavigate={(p) => { setPath(p); setSelected(new Set()) }}
          />
        </aside>

        {/* 右侧：拖拽区 + 文件列表 */}
        <div className="sftp-content">
          <div
            className={`sftp-dropzone ${dragOver ? 'drag-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files) }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={(e) => uploadFiles(e.target.files)} />
            <input ref={dirInputRef} type="file" style={{ display: 'none' }} />
            将文件拖拽到此处上传（目录请使用「上传目录」按钮）
          </div>

          <div className="sftp-table-wrap">
            <table className="sftp-table">
              <thead>
                <tr>
                  <th style={{ width: 30 }}></th>
                  <th>名称</th>
                  <th style={{ width: 100 }}>大小</th>
                  <th style={{ width: 160 }}>修改时间</th>
                  <th style={{ width: 80 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={5} className="sftp-empty">加载中...</td></tr>}
                {!loading && entries.length === 0 && <tr><td colSpan={5} className="sftp-empty">空目录</td></tr>}
                {entries.map((e) => (
                  <tr key={e.path} onDoubleClick={() => e.isDir && navigate(e)}>
                    <td>
                      <input type="checkbox" checked={selected.has(e.path)} onChange={() => toggleSelect(e)} />
                    </td>
                    <td>
                      <span className="file-icon">{e.isDir ? '📁' : '📄'}</span>
                      <span className="file-name" title={e.path}>{e.name}</span>
                    </td>
                    <td>{e.isDir ? '—' : formatSize(e.size)}</td>
                    <td>{e.modTime ? new Date(e.modTime).toLocaleString() : '—'}</td>
                    <td>
                      {!e.isDir && <button className="mini-btn" onClick={() => handleDownload(e)} title="下载">↓</button>}
                      {e.isDir && <button className="mini-btn" onClick={() => navigate(e)} title="进入">→</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {activeTransfers.length > 0 && (
        <div className="transfer-panel">
          <div className="transfer-title">传输中 ({activeTransfers.length})</div>
          {activeTransfers.map((t) => (
            <div key={t.id} className="transfer-item">
              <div className="transfer-name">{t.direction === 'upload' ? '⬆' : '⬇'} {t.file}</div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${t.percent}%` }} />
              </div>
              <div className="transfer-detail">{t.percent}% · {formatSize(t.bytes)} / {formatSize(t.total)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
