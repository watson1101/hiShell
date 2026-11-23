// hiShell 前端调用 Go 后端的类型定义

export interface TestResult {
  success: boolean
  message: string
  duration: number
  serverVersion: string
}

export interface Session {
  id: string
  name: string
  group?: string
  host: string
  port: number
  username: string
  authType: 'password' | 'key'
  keyPath?: string
  encoding?: string
  color?: string
  favorite?: boolean
  createdAt?: string
}

export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  mode: string
  modTime: string
}

export interface TransferProgress {
  id: string
  direction: 'upload' | 'download'
  file: string
  bytes: number
  total: number
  percent: number
  status: 'running' | 'done' | 'error'
  message?: string
}

export interface ProcessInfo {
  memory: string
  cpu: string
  command: string
}

export interface NetworkInfo {
  interface: string
  rxBytes: number
  txBytes: number
  rxRate: number
  txRate: number
  rxHuman: string
  txHuman: string
}

export interface DiskMount {
  path: string
  avail: string
  size: string
  used: number
}

export interface MonitorSnapshot {
  sessionId: string
  os: string
  uptime: string
  loadAvg: string
  cpuUsage: number
  memUsage: number
  memUsed: string
  memTotal: string
  swapUsage: number
  swapUsed: string
  swapTotal: string
  processes: ProcessInfo[]
  network: NetworkInfo
  disks: DiskMount[]
  timestamp: number
}

export interface BatchResult {
  sessionId: string
  sessionName: string
  success: boolean
  output: string
  error?: string
  duration: string
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
