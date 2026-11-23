// Wails 绑定封装：开发期提供 stub，生产环境由 wails 生成的绑定覆盖。
// wails dev 会自动生成 frontend/wailsjs/go/main/App.js

import type {
  Session, FileEntry, TransferProgress, BatchResult, TestResult,
} from '../types'

// @ts-ignore - 由 wails 生成
import * as AppBinding from '../../wailsjs/go/main/App'
// @ts-ignore - 由 wails 生成
import { EventsOn } from '../../wailsjs/runtime/runtime'

// Wails 生成的 Go model 把枚举字段标为 string，这里做类型断言桥接到前端严格类型
const as = <T>(v: unknown): T => v as T

export const api = {
  listSessions: (): Promise<Session[]> =>
    AppBinding.ListSessions().then((r: unknown) => as<Session[]>(r)),
  saveSession: (s: Session): Promise<void> => AppBinding.SaveSession(s),
  deleteSession: (id: string): Promise<void> => AppBinding.DeleteSession(id),
  saveCredential: (id: string, password: string, passphrase: string): Promise<void> =>
    AppBinding.SaveCredential(id, password, passphrase),
  hasCredential: (id: string): Promise<boolean> => AppBinding.HasCredential(id),
  isUsingFallback: (): Promise<boolean> => AppBinding.IsUsingFallback(),

  testConnection: (s: Session, password: string, passphrase: string): Promise<TestResult> =>
    AppBinding.TestConnection(s, password, passphrase).then((r: unknown) => as<TestResult>(r)),

  connect: (id: string): Promise<void> => AppBinding.Connect(id),
  connectWithCredential: (id: string, password: string, passphrase: string, remember: boolean): Promise<void> =>
    AppBinding.ConnectWithCredential(id, password, passphrase, remember),
  disconnect: (id: string): Promise<void> => AppBinding.Disconnect(id),
  isConnected: (id: string): Promise<boolean> => AppBinding.IsConnected(id),
  connectedSessions: (): Promise<string[]> => AppBinding.ConnectedSessions(),
  writeTerminal: (id: string, data: string): Promise<void> => AppBinding.WriteTerminal(id, data),
  resizeTerminal: (id: string, cols: number, rows: number): Promise<void> =>
    AppBinding.ResizeTerminal(id, cols, rows),
  exec: (id: string, command: string): Promise<string> => AppBinding.Exec(id, command),

  sftpList: (sessionId: string, path: string): Promise<FileEntry[]> => AppBinding.SftpList(sessionId, path),
  sftpMkdir: (sessionId: string, path: string): Promise<void> => AppBinding.SftpMkdir(sessionId, path),
  sftpRemove: (sessionId: string, path: string, isDir: boolean): Promise<void> =>
    AppBinding.SftpRemove(sessionId, path, isDir),
  sftpRename: (sessionId: string, oldPath: string, newPath: string): Promise<void> =>
    AppBinding.SftpRename(sessionId, oldPath, newPath),
  sftpUpload: (sessionId: string, localPath: string, remotePath: string): Promise<string> =>
    AppBinding.SftpUpload(sessionId, localPath, remotePath),
  sftpDownload: (sessionId: string, remotePath: string, localPath: string): Promise<string> =>
    AppBinding.SftpDownload(sessionId, remotePath, localPath),
  sftpUploadDirectory: (sessionId: string, localDir: string, remoteDir: string): Promise<void> =>
    AppBinding.SftpUploadDirectory(sessionId, localDir, remoteDir),
  sftpDownloadDirectory: (sessionId: string, remoteDir: string, localDir: string): Promise<void> =>
    AppBinding.SftpDownloadDirectory(sessionId, remoteDir, localDir),
  sftpTransfers: (): Promise<TransferProgress[]> =>
    AppBinding.SftpTransfers().then((r: unknown) => as<TransferProgress[]>(r)),

  startMonitor: (sessionId: string): Promise<void> => AppBinding.StartMonitor(sessionId),
  stopMonitor: (sessionId: string): Promise<void> => AppBinding.StopMonitor(sessionId),

  batchExec: (ids: string[], command: string, timeout: number): Promise<BatchResult[]> =>
    AppBinding.BatchExec(ids, command, timeout).then((r: unknown) => as<BatchResult[]>(r)),

  openFileDialog: (): Promise<string> => AppBinding.OpenFileDialog(),
  openDirectoryDialog: (): Promise<string> => AppBinding.OpenDirectoryDialog(),
  saveFileDialog: (name: string): Promise<string> => AppBinding.SaveFileDialog(name),
  saveDirectoryDialog: (): Promise<string> => AppBinding.SaveDirectoryDialog(),
  openKeyPathDialog: (): Promise<string> => AppBinding.OpenKeyPathDialog(),
  homeDir: (): Promise<string> => AppBinding.HomeDir(),
  version: (): Promise<string> => AppBinding.Version(),
}

export const events = {
  on(event: string, callback: (data: any) => void): () => void {
    const handler = (...payload: any[]) => callback(payload?.[0])
    return EventsOn(event, handler)
  },
}
