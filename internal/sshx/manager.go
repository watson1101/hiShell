// Package sshx 封装 SSH 连接、PTY 终端、远程命令执行。
package sshx

import (
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"os"
	"sync"
	"time"

	"github.com/hongw/hishell/internal/store"
	"golang.org/x/crypto/ssh"
)

// EmitFunc 事件推送函数（由 Wails runtime 注入）
type EmitFunc func(event string, data ...interface{})

// Connection 单个 SSH 连接
type Connection struct {
	ID       string
	client   *ssh.Client
	session  *ssh.Session
	stdin    io.WriteCloser
	stdout   io.Reader
	stderr   io.Reader
	mu       sync.Mutex
	closed   bool
	closeCh  chan struct{}
	emit     EmitFunc
	encoding string
}

// Manager 连接管理器
type Manager struct {
	mu    sync.RWMutex
	conns map[string]*Connection
	emit  EmitFunc
}

// NewManager 创建连接管理器
func NewManager(emit EmitFunc) *Manager {
	return &Manager{conns: make(map[string]*Connection), emit: emit}
}

// Connect 建立 SSH 连接并启动交互式 shell
func (m *Manager) Connect(sess store.Session, cred store.Credential) error {
	if sess.Port == 0 {
		sess.Port = 22
	}

	authMethods, err := buildAuthMethods(sess, cred)
	if err != nil {
		return err
	}

	config := &ssh.ClientConfig{
		User:            sess.Username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // 个人工具：首次连接自动信任，后续可加 known_hosts 校验
		Timeout:         15 * time.Second,
		ClientVersion:   "SSH-2.0-hiShell_1.0",
	}

	addr := net.JoinHostPort(sess.Host, fmt.Sprintf("%d", sess.Port))
	m.emit("ssh:status", map[string]interface{}{"sessionId": sess.ID, "status": "connecting"})

	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		m.emit("ssh:status", map[string]interface{}{"sessionId": sess.ID, "status": "error", "message": err.Error()})
		return fmt.Errorf("连接 %s 失败: %w", addr, err)
	}

	session, err := client.NewSession()
	if err != nil {
		client.Close()
		m.emit("ssh:status", map[string]interface{}{"sessionId": sess.ID, "status": "error", "message": err.Error()})
		return fmt.Errorf("创建会话失败: %w", err)
	}

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := session.RequestPty("xterm-256color", 24, 80, modes); err != nil {
		session.Close()
		client.Close()
		return fmt.Errorf("请求 PTY 失败: %w", err)
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		client.Close()
		return err
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		session.Close()
		client.Close()
		return err
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		session.Close()
		client.Close()
		return err
	}

	conn := &Connection{
		ID:       sess.ID,
		client:   client,
		session:  session,
		stdin:    stdin,
		stdout:   stdout,
		stderr:   stderr,
		closeCh:  make(chan struct{}),
		emit:     m.emit,
		encoding: sess.Encoding,
	}

	// 若已有同 ID 连接，先断开
	m.mu.Lock()
	if old, exists := m.conns[sess.ID]; exists {
		_ = old.Close()
	}
	m.conns[sess.ID] = conn
	m.mu.Unlock()

	// 启动 shell
	if err := session.Shell(); err != nil {
		m.remove(conn)
		return fmt.Errorf("启动 shell 失败: %w", err)
	}

	m.emit("ssh:status", map[string]interface{}{"sessionId": sess.ID, "status": "connected"})

	// 异步读取输出
	go conn.readLoop(conn.stdout, "ssh:terminal-data")
	go conn.readLoop(conn.stderr, "ssh:terminal-data")

	// 等待 shell 退出
	go func() {
		err := session.Wait()
		code := 0
		reason := ""
		if err != nil {
			if exitErr, ok := err.(*ssh.ExitError); ok {
				code = exitErr.ExitStatus()
			}
			reason = err.Error()
		}
		m.remove(conn)
		m.emit("ssh:terminal-exit", map[string]interface{}{"sessionId": conn.ID, "code": code, "reason": reason})
		m.emit("ssh:status", map[string]interface{}{"sessionId": conn.ID, "status": "disconnected", "message": reason})
	}()

	return nil
}

// readLoop 持续读取远端输出并通过事件推送
func (c *Connection) readLoop(reader io.Reader, event string) {
	buf := make([]byte, 32768)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			encoded := base64.StdEncoding.EncodeToString(buf[:n])
			c.emit(event, map[string]interface{}{"sessionId": c.ID, "data": encoded})
		}
		if err != nil {
			if err != io.EOF {
				c.emit("ssh:terminal-data", map[string]interface{}{
					"sessionId": c.ID,
					"data":      base64.StdEncoding.EncodeToString([]byte(fmt.Sprintf("\r\n[连接中断: %v]\r\n", err))),
				})
			}
			return
		}
	}
}

// Write 向远端 PTY 写入数据（前端键盘输入）
func (m *Manager) Write(id string, data []byte) error {
	conn, err := m.get(id)
	if err != nil {
		return err
	}
	conn.mu.Lock()
	defer conn.mu.Unlock()
	if conn.closed {
		return fmt.Errorf("连接已关闭")
	}
	_, err = conn.stdin.Write(data)
	return err
}

// Resize 调整远端 PTY 窗口大小
func (m *Manager) Resize(id string, cols, rows int) error {
	conn, err := m.get(id)
	if err != nil {
		return err
	}
	if cols <= 0 || rows <= 0 {
		return nil
	}
	return conn.session.WindowChange(rows, cols)
}

// Disconnect 主动断开连接
func (m *Manager) Disconnect(id string) error {
	conn, err := m.get(id)
	if err != nil {
		return err
	}
	err = conn.Close()
	m.remove(conn)
	m.emit("ssh:status", map[string]interface{}{"sessionId": id, "status": "disconnected"})
	return err
}

// Close 关闭单个连接
func (c *Connection) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil
	}
	c.closed = true
	close(c.closeCh)
	var errs []error
	if c.session != nil {
		if err := c.session.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	if c.client != nil {
		if err := c.client.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	if len(errs) > 0 {
		return errs[0]
	}
	return nil
}

// GetClient 获取底层 ssh.Client（供 SFTP / 监控 / 批量命令复用）
func (m *Manager) GetClient(id string) (*ssh.Client, error) {
	conn, err := m.get(id)
	if err != nil {
		return nil, err
	}
	return conn.client, nil
}

// IsConnected 判断连接是否活跃
func (m *Manager) IsConnected(id string) bool {
	_, err := m.get(id)
	return err == nil
}

// ConnectedIDs 返回所有活跃连接 ID
func (m *Manager) ConnectedIDs() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	ids := make([]string, 0, len(m.conns))
	for id := range m.conns {
		ids = append(ids, id)
	}
	return ids
}

// Exec 在指定连接上执行一条非交互命令并收集输出（用于监控/批量）
func (m *Manager) Exec(id, command string) ([]byte, []byte, error) {
	client, err := m.GetClient(id)
	if err != nil {
		return nil, nil, err
	}
	session, err := client.NewSession()
	if err != nil {
		return nil, nil, err
	}
	defer session.Close()

	var stdout, stderr []byte
	session.Stdout = &byteWriter{data: &stdout}
	session.Stderr = &byteWriter{data: &stderr}
	err = session.Run(command)
	return stdout, stderr, err
}

type byteWriter struct {
	data *[]byte
	mu   sync.Mutex
}

func (w *byteWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	*w.data = append(*w.data, p...)
	return len(p), nil
}

func (m *Manager) get(id string) (*Connection, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	conn, exists := m.conns[id]
	if !exists {
		return nil, fmt.Errorf("会话 %s 未连接", id)
	}
	return conn, nil
}

func (m *Manager) remove(conn *Connection) {
	m.mu.Lock()
	if current, exists := m.conns[conn.ID]; exists && current == conn {
		delete(m.conns, conn.ID)
	}
	m.mu.Unlock()
	_ = conn.Close()
}

// TestResult 测试连接结果
type TestResult struct {
	Success  bool   `json:"success"`
	Message  string `json:"message"`
	Duration int64  `json:"duration"` // 毫秒
	ServerVersion string `json:"serverVersion"` // 服务端 SSH 版本横幅
}

// TestConnection 仅验证网络可达性与 SSH 认证，不启动 shell/PTY，验证后立即断开。
// 用于「新建/编辑会话」界面的测试按钮——此时会话尚未保存，凭据从表单临时传入。
func (m *Manager) TestConnection(sess store.Session, cred store.Credential, timeout time.Duration) TestResult {
	start := time.Now()
	result := TestResult{}

	if sess.Host == "" {
		result.Message = "主机地址为空"
		return result
	}
	if sess.Port == 0 {
		sess.Port = 22
	}
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	authMethods, err := buildAuthMethods(sess, cred)
	if err != nil {
		result.Message = err.Error()
		return result
	}

	config := &ssh.ClientConfig{
		User:            sess.Username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         timeout,
		ClientVersion:   "SSH-2.0-hiShell_1.0",
	}

	addr := net.JoinHostPort(sess.Host, fmt.Sprintf("%d", sess.Port))
	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		result.Message = fmt.Sprintf("连接 %s 失败: %v", addr, err)
		return result
	}
	defer client.Close()

	result.Success = true
	result.ServerVersion = string(client.ServerVersion())
	result.Duration = time.Since(start).Milliseconds()
	result.Message = fmt.Sprintf("连接成功（认证通过，耗时 %dms）", result.Duration)
	return result
}

// buildAuthMethods 根据认证类型构造 ssh.AuthMethod
func buildAuthMethods(sess store.Session, cred store.Credential) ([]ssh.AuthMethod, error) {
	var methods []ssh.AuthMethod

	switch sess.AuthType {
	case store.AuthKey:
		if sess.KeyPath == "" {
			return nil, fmt.Errorf("密钥路径为空")
		}
		keyBytes, err := os.ReadFile(expandHome(sess.KeyPath))
		if err != nil {
			return nil, fmt.Errorf("读取私钥失败: %w", err)
		}
		var signer ssh.Signer
		if cred.Passphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(keyBytes, []byte(cred.Passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey(keyBytes)
		}
		if err != nil {
			return nil, fmt.Errorf("解析私钥失败（可能是格式错误或需要 passphrase）: %w", err)
		}
		methods = append(methods, ssh.PublicKeys(signer))
	case store.AuthPassword:
		if cred.Password == "" {
			return nil, fmt.Errorf("密码为空")
		}
		methods = append(methods, ssh.Password(cred.Password))
	default:
		return nil, fmt.Errorf("不支持的认证方式: %s", sess.AuthType)
	}
	return methods, nil
}

// expandHome 展开 ~ 为用户主目录
func expandHome(path string) string {
	if len(path) > 1 && path[0] == '~' && (path[1] == '/' || path[1] == '\\') {
		home, err := os.UserHomeDir()
		if err == nil {
			return home + path[1:]
		}
	}
	return path
}
