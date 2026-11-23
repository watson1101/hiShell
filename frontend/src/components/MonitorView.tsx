import { useEffect, useRef, useState } from 'react'
import type { MonitorSnapshot } from '../types'
import { api, events } from '../hooks/api'

interface Props {
  sessionId: string
  active: boolean
  title?: string
}

interface NetSample { rx: number; tx: number }

export default function MonitorView({ sessionId, active, title }: Props) {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null)
  const [error, setError] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const historyRef = useRef<NetSample[]>([])

  useEffect(() => {
    if (!active) return
    let offData: (() => void) | null = null
    let offError: (() => void) | null = null

    async function start() {
      try {
        offData = events.on('monitor:data', (snap: MonitorSnapshot) => {
          if (snap?.sessionId !== sessionId) return
          setSnapshot(snap)
          setError('')
          historyRef.current.push({ rx: snap.network.rxRate, tx: snap.network.txRate })
          if (historyRef.current.length > 60) historyRef.current.shift()
          drawChart()
        })
        offError = events.on('monitor:error', (payload: { sessionId: string; message: string }) => {
          if (payload?.sessionId === sessionId) setError(payload.message)
        })
        await api.startMonitor(sessionId)
      } catch (e: any) {
        setError(`启动监控失败: ${e.message || e}`)
      }
    }
    start()

    return () => {
      offData?.()
      offError?.()
      api.stopMonitor(sessionId).catch(() => {})
    }
  }, [sessionId, active])

  function drawChart() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    // 网格线（对应截图虚线）
    ctx.strokeStyle = '#2a2e3d'
    ctx.setLineDash([2, 3])
    ctx.lineWidth = 1
    for (let i = 1; i < 5; i++) {
      const y = (h / 5) * i
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }

    const samples = historyRef.current
    if (samples.length < 2) return

    const maxRate = Math.max(1024, ...samples.flatMap((s) => [s.rx, s.tx])) * 1.2
    const stepX = w / 60

    // 下行曲线（绿色，对应截图绿色柱）
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(158, 206, 106, 0.5)'
    ctx.strokeStyle = '#9ece6a'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    samples.forEach((s, i) => {
      const x = i * stepX
      const y = h - (s.rx / maxRate) * h
      if (i === 0) ctx.moveTo(x, h)
      ctx.lineTo(x, y)
    })
    ctx.lineTo((samples.length - 1) * stepX, h)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    samples.forEach((s, i) => {
      const x = i * stepX
      const y = h - (s.rx / maxRate) * h
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()

    // 上行曲线（橙红，对应截图橙红柱）
    ctx.fillStyle = 'rgba(247, 118, 142, 0.4)'
    ctx.strokeStyle = '#f7768e'
    ctx.beginPath()
    samples.forEach((s, i) => {
      const x = i * stepX
      const y = h - (s.tx / maxRate) * h
      if (i === 0) ctx.moveTo(x, h)
      ctx.lineTo(x, y)
    })
    ctx.lineTo((samples.length - 1) * stepX, h)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    samples.forEach((s, i) => {
      const x = i * stepX
      const y = h - (s.tx / maxRate) * h
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }

  const s = snapshot

  return (
    <div className="monitor-view">
      {title && <div className="monitor-host-title">{title}</div>}
      {error && <div className="monitor-error">{error}</div>}
      {!s && !error && <div className="monitor-waiting">{active ? '正在采集系统信息...' : '等待连接服务器...'}</div>}

      {s && (
        <>
          <div className="monitor-section">
            <div className="monitor-title">系统信息 <span className="sys-badge">{s.os}</span></div>
            <div className="info-row"><span>运行</span><span>{s.uptime || '—'}</span></div>
            <div className="info-row"><span>负载</span><span>{s.loadAvg || '—'}</span></div>
          </div>

          <div className="monitor-section">
            <div className="metric-row">
              <span className="metric-label">CPU</span>
              <div className="metric-bar"><div className="metric-fill cpu" style={{ width: `${Math.min(s.cpuUsage, 100)}%` }} /></div>
              <span className="metric-value">{s.cpuUsage.toFixed(1)}%</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">内存</span>
              <div className="metric-bar"><div className="metric-fill mem" style={{ width: `${Math.min(s.memUsage, 100)}%` }} /></div>
              <span className="metric-value">{s.memUsage.toFixed(0)}%</span>
              <span className="metric-sub">{s.memUsed}/{s.memTotal}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">交换</span>
              <div className="metric-bar"><div className="metric-fill swap" style={{ width: `${Math.min(s.swapUsage, 100)}%` }} /></div>
              <span className="metric-value">{s.swapUsage.toFixed(0)}%</span>
              <span className="metric-sub">{s.swapUsed}/{s.swapTotal}</span>
            </div>
          </div>

          <div className="monitor-section">
            <div className="monitor-subtitle">进程 (Top)</div>
            <table className="monitor-table">
              <thead><tr><th>内存</th><th>CPU</th><th>命令</th></tr></thead>
              <tbody>
                {s.processes.map((p, i) => (
                  <tr key={i}>
                    <td>{p.memory}</td>
                    <td>{p.cpu}</td>
                    <td title={p.command}>{p.command}</td>
                  </tr>
                ))}
                {s.processes.length === 0 && <tr><td colSpan={3}>无进程数据</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="monitor-section">
            <div className="monitor-subtitle network-title">
              <span>↑ 上行 {s.network.txHuman}</span>
              <span>↓ 下行 {s.network.rxHuman}</span>
              <span className="net-iface">{s.network.interface || '—'} ▼</span>
            </div>
            <canvas ref={canvasRef} width={320} height={120} className="net-canvas" />
            <div className="net-rates">
              <span>↑ {(s.network.txRate / 1024).toFixed(1)} KB/s</span>
              <span>↓ {(s.network.rxRate / 1024).toFixed(1)} KB/s</span>
            </div>
          </div>

          <div className="monitor-section">
            <div className="monitor-subtitle">磁盘挂载点</div>
            <table className="monitor-table disks-table">
              <thead><tr><th>路径</th><th>可用/大小</th></tr></thead>
              <tbody>
                {s.disks.map((d, i) => (
                  <tr key={i}>
                    <td title={d.path}>{d.path}</td>
                    <td>
                      <div className="disk-cell">
                        <div className="disk-bar"><div className="disk-fill" style={{ width: `${Math.min(d.used, 100)}%` }} /></div>
                        <span>{d.avail}/{d.size}</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {s.disks.length === 0 && <tr><td colSpan={2}>无磁盘数据</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
