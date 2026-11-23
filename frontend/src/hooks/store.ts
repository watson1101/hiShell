import { create } from 'zustand'
import type { Session, ConnectionStatus } from '../types'
import { api } from './api'

interface Tab {
  sessionId: string
  title: string
  status: ConnectionStatus
  view: 'terminal' | 'sftp' | 'monitor'
}

interface AppState {
  sessions: Session[]
  tabs: Tab[]
  activeTab: string | null
  activeSessionId: string | null
  statuses: Record<string, ConnectionStatus>
  loading: boolean
  error: string

  loadSessions: () => Promise<void>
  addSession: (s: Session) => Promise<void>
  removeSession: (id: string) => Promise<void>
  openTab: (sessionId: string, view?: Tab['view']) => void
  closeTab: (sessionId: string, view: Tab['view']) => void
  setActiveTab: (key: string) => void
  setActiveSession: (id: string) => void
  setStatus: (sessionId: string, status: ConnectionStatus, message?: string) => void
  setError: (msg: string) => void
}

export const tabKey = (sessionId: string, view: string) => `${sessionId}:${view}`

export const useAppStore = create<AppState>((set, get) => ({
  sessions: [],
  tabs: [],
  activeTab: null,
  activeSessionId: null,
  statuses: {},
  loading: false,
  error: '',

  loadSessions: async () => {
    set({ loading: true })
    try {
      const sessions = await api.listSessions()
      set({ sessions, loading: false })
    } catch (e: any) {
      set({ error: e.message || '加载会话失败', loading: false })
    }
  },

  addSession: async (s) => {
    await api.saveSession(s)
    await get().loadSessions()
  },

  removeSession: async (id) => {
    await api.deleteSession(id)
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      tabs: state.tabs.filter((t) => t.sessionId !== id),
    }))
  },

  openTab: (sessionId, view = 'terminal') => {
    const session = get().sessions.find((s) => s.id === sessionId)
    if (!session) return
    const key = tabKey(sessionId, view)
    set((state) => {
      const exists = state.tabs.some((t) => tabKey(t.sessionId, t.view) === key)
      const tabs = exists ? state.tabs : [...state.tabs, {
        sessionId,
        title: `${session.name} · ${view === 'terminal' ? '终端' : view === 'sftp' ? '文件' : '监控'}`,
        status: state.statuses[sessionId] || 'idle',
        view,
      }]
      return { tabs, activeTab: key }
    })
  },

  closeTab: (sessionId, view) => {
    const key = tabKey(sessionId, view)
    set((state) => {
      const tabs = state.tabs.filter((t) => tabKey(t.sessionId, t.view) !== key)
      return {
        tabs,
        activeTab: state.activeTab === key ? (tabs[0] ? tabKey(tabs[0].sessionId, tabs[0].view) : null) : state.activeTab,
      }
    })
  },

  setActiveTab: (key) => set({ activeTab: key }),

  setActiveSession: (id) => set({ activeSessionId: id }),

  setStatus: (sessionId, status) => {
    set((state) => ({
      statuses: { ...state.statuses, [sessionId]: status },
      tabs: state.tabs.map((t) => t.sessionId === sessionId ? { ...t, status } : t),
    }))
  },

  setError: (msg) => set({ error: msg }),
}))
