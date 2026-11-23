import { useState, useEffect, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import { api } from '../hooks/api'

interface Props {
  sessionId: string
  currentPath: string
  onNavigate: (path: string) => void
}

interface TreeNode {
  name: string
  children: string[]
  loaded: boolean
  loading: boolean
}

// 目录树节点：key 为绝对路径
const ROOT = '/'

export default function DirTree({ sessionId, currentPath, onNavigate }: Props) {
  const [nodes, setNodes] = useState<Record<string, TreeNode>>({
    [ROOT]: { name: '/', children: [], loaded: false, loading: false },
  })
  const [expanded, setExpanded] = useState<Set<string>>(new Set([ROOT]))
  const [activePath, setActivePath] = useState(currentPath)

  // 用 ref 同步跟踪，避免 loadChildren 闭包读到过期 state
  const nodesRef = useRef(nodes)
  useEffect(() => { nodesRef.current = nodes }, [nodes])
  const loadingRef = useRef<Set<string>>(new Set())

  // 解析 ~ 为真实家目录：从 sftpList('~') 返回条目的绝对路径推断
  useEffect(() => {
    if (currentPath === '~') {
      let cancelled = false
      api.sftpList(sessionId, '~').then((list) => {
        if (cancelled) return
        if (list.length > 0 && list[0].path) {
          const p = list[0].path
          const idx = p.lastIndexOf('/')
          setActivePath(idx > 0 ? p.slice(0, idx) : ROOT)
        } else {
          setActivePath(ROOT)
        }
      }).catch(() => { if (!cancelled) setActivePath(ROOT) })
      return () => { cancelled = true }
    }
    setActivePath(currentPath)
  }, [currentPath, sessionId])

  // 懒加载某个目录的直接子目录（仅取目录项）
  const loadChildren = useCallback(async (dirPath: string) => {
    if (loadingRef.current.has(dirPath)) return
    if (nodesRef.current[dirPath]?.loaded) return
    loadingRef.current.add(dirPath)
    setNodes((prev) => ({
      ...prev,
      [dirPath]: { ...(prev[dirPath] || { name: dirPath, children: [], loaded: false }), loading: true },
    }))
    try {
      const list = await api.sftpList(sessionId, dirPath)
      const dirs = list.filter((e) => e.isDir).sort((a, b) => a.name.localeCompare(b.name))
      setNodes((prev) => {
        const next = { ...prev }
        next[dirPath] = {
          ...(next[dirPath] || { name: dirPath, loaded: false, loading: false }),
          children: dirs.map((d) => d.path),
          loaded: true,
          loading: false,
        }
        dirs.forEach((d) => {
          if (!next[d.path]) next[d.path] = { name: d.name, children: [], loaded: false, loading: false }
        })
        return next
      })
    } catch {
      // 无权限/读取失败：当作空目录，避免树卡在 loading
      setNodes((prev) => ({
        ...prev,
        [dirPath]: { ...(prev[dirPath] || { name: dirPath, children: [] }), loaded: true, loading: false },
      }))
    } finally {
      loadingRef.current.delete(dirPath)
    }
  }, [sessionId])

  // 当前路径变化时，逐级加载并展开其所有祖先节点
  useEffect(() => {
    if (!activePath || activePath === '~' || activePath === ROOT) return
    const chain: string[] = []
    let p = activePath
    while (p && p !== ROOT) {
      chain.unshift(p)
      const i = p.lastIndexOf('/')
      p = i <= 0 ? ROOT : p.slice(0, i)
    }
    chain.unshift(ROOT)
    let cancelled = false
    ;(async () => {
      for (const dir of chain) {
        if (cancelled) return
        setExpanded((prev) => new Set(prev).add(dir))
        await loadChildren(dir)
      }
    })()
    return () => { cancelled = true }
  }, [activePath, loadChildren])

  function toggleExpand(path: string) {
    const willExpand = !expanded.has(path)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (willExpand) next.add(path)
      else next.delete(path)
      return next
    })
    if (willExpand) loadChildren(path)
  }

  function renderNode(path: string, depth: number): ReactNode {
    const node = nodes[path]
    if (!node) return null
    const isExpanded = expanded.has(path)
    const isActive = path === activePath
    return (
      <div key={path}>
        <div
          className={`tree-node ${isActive ? 'active' : ''}`}
          style={{ paddingLeft: depth * 14 + 6 }}
          title={path}
          onClick={() => { onNavigate(path); if (!isExpanded) toggleExpand(path) }}
        >
          <span
            className="tree-arrow"
            onClick={(e) => { e.stopPropagation(); toggleExpand(path) }}
          >
            {node.loading ? '…' : isExpanded ? '▼' : '▶'}
          </span>
          <span className="tree-icon">{isExpanded ? '📂' : '📁'}</span>
          <span className="tree-name">{node.name}</span>
        </div>
        {isExpanded && node.children.map((cp) => renderNode(cp, depth + 1))}
        {isExpanded && node.loaded && node.children.length === 0 && (
          <div className="tree-empty" style={{ paddingLeft: depth * 14 + 28 }}>空目录</div>
        )}
      </div>
    )
  }

  return (
    <div className="dir-tree">
      <div className="dir-tree-title">目录导航</div>
      <div className="dir-tree-body">{renderNode(ROOT, 0)}</div>
    </div>
  )
}
