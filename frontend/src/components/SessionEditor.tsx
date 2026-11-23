import { useState, useEffect } from 'react'
import type { Session, TestResult } from '../types'
import { api } from '../hooks/api'
import { useAppStore } from '../hooks/store'

interface Props {
  session?: Session
  onClose: () => void
}

export default function SessionEditor({ session, onClose }: Props) {
  const addSession = useAppStore((s) => s.addSession)
  const [form, setForm] = useState<Session>(session || {
    id: '',
    name: '',
    group: '',
    host: '',
    port: 22,
    username: 'root',
    authType: 'password',
    keyPath: '',
    encoding: 'utf-8',
    favorite: false,
  })
  const [password, setPassword] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [remember, setRemember] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  useEffect(() => {
    if (session) {
      api.hasCredential(session.id).then((has) => {
        if (has) setPassword('********') // 占位，保存时若未修改则跳过
      }).catch(() => {})
    }
  }, [session])

  // 仅 ESC 键关闭弹窗；点击遮罩层/外部不再关闭
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  function update(field: keyof Session, value: any) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSave() {
    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) {
      setError('请填写名称、主机和用户名')
      return
    }
    setSaving(true)
    setError('')
    try {
      const toSave = { ...form, id: form.id || `sess_${Date.now()}` }
      await addSession(toSave)
      const credChanged = password && password !== '********'
      const passChanged = passphrase && passphrase !== '********'
      if (remember && (credChanged || passChanged)) {
        await api.saveCredential(toSave.id, credChanged ? password : '', passChanged ? passphrase : '')
      }
      onClose()
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  async function chooseKey() {
    const path = await api.openKeyPathDialog()
    if (path) update('keyPath', path)
  }

  async function handleTest() {
    if (!form.host.trim() || !form.username.trim()) {
      setTestResult({ success: false, message: '请先填写主机和用户名', duration: 0, serverVersion: '' })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      // 把当前表单的凭据直接传给后端验证（不保存）
      const effectivePass = form.authType === 'password' ? password : ''
      const effectivePassphrase = form.authType === 'key' ? passphrase : ''
      const result = await api.testConnection(form, effectivePass, effectivePassphrase)
      setTestResult(result)
    } catch (e: any) {
      setTestResult({ success: false, message: e.message || String(e), duration: 0, serverVersion: '' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>{session ? '编辑会话' : '新建会话'}</h3>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="form-row">
            <label>会话名称 *</label>
            <input value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="我的服务器" autoFocus />
          </div>
          <div className="form-row">
            <label>分组</label>
            <input value={form.group} onChange={(e) => update('group', e.target.value)} placeholder="生产环境 / 测试环境" />
          </div>
          <div className="form-row two-col">
            <div>
              <label>主机 *</label>
              <input value={form.host} onChange={(e) => update('host', e.target.value)} placeholder="192.168.1.100" />
            </div>
            <div>
              <label>端口</label>
              <input type="number" value={form.port} onChange={(e) => update('port', Number(e.target.value))} />
            </div>
          </div>
          <div className="form-row">
            <label>用户名 *</label>
            <input value={form.username} onChange={(e) => update('username', e.target.value)} placeholder="root" />
          </div>

          <div className="form-row">
            <label>认证方式</label>
            <div className="radio-group">
              <label className="radio-label">
                <input type="radio" checked={form.authType === 'password'} onChange={() => update('authType', 'password')} />
                密码
              </label>
              <label className="radio-label">
                <input type="radio" checked={form.authType === 'key'} onChange={() => update('authType', 'key')} />
                私钥
              </label>
            </div>
          </div>

          {form.authType === 'password' ? (
            <div className="form-row">
              <label>密码</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="留空表示不保存" />
            </div>
          ) : (
            <>
              <div className="form-row">
                <label>私钥路径</label>
                <div className="input-with-btn">
                  <input value={form.keyPath} onChange={(e) => update('keyPath', e.target.value)} placeholder="C:\Users\me\.ssh\id_rsa" />
                  <button onClick={chooseKey}>浏览</button>
                </div>
              </div>
              <div className="form-row">
                <label>私钥密码 (passphrase)</label>
                <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="无密码则留空" />
              </div>
            </>
          )}

          <div className="form-row two-col">
            <div>
              <label>终端编码</label>
              <select value={form.encoding} onChange={(e) => update('encoding', e.target.value)}>
                <option value="utf-8">UTF-8</option>
                <option value="gbk">GBK（中文 Windows）</option>
              </select>
            </div>
            <div>
              <label>标签颜色</label>
              <input type="color" value={form.color || '#7aa2f7'} onChange={(e) => update('color', e.target.value)} style={{ width: '100%', height: 36 }} />
            </div>
          </div>

          <label className="checkbox-label">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            记住凭据到系统钥匙串（Windows 凭据管理器 / macOS Keychain）
          </label>

          {testResult && (
            <div className={`test-result ${testResult.success ? 'ok' : 'fail'}`}>
              <div className="test-result-message">
                <span className="test-result-icon">{testResult.success ? '✓' : '✗'}</span>
                {testResult.message}
              </div>
              {testResult.success && testResult.serverVersion && (
                <div className="test-result-detail">服务端: {testResult.serverVersion}</div>
              )}
            </div>
          )}

          {error && <div className="form-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn test" onClick={handleTest} disabled={testing}>
            {testing ? '测试中...' : '测试连接'}
          </button>
          <div className="footer-spacer" />
          <button className="btn secondary" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
