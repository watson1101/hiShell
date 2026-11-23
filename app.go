package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/hongw/hishell/internal/batch"
	"github.com/hongw/hishell/internal/monitor"
	sftpx "github.com/hongw/hishell/internal/sftp"
	"github.com/hongw/hishell/internal/sshx"
	"github.com/hongw/hishell/internal/store"
)

// App 主应用，暴露给前端的方法
type App struct {
	ctx     context.Context
	store   *store.SessionStore
	ssh     *sshx.Manager
	sftp    *sftpx.Service
	monitor *monitor.Service
	batch   *batch.Service
}

func NewApp(sessionStore *store.SessionStore) *App {
	return &App{store: sessionStore}
}

func (a *App) SetSSHManager(m *sshx.Manager) {
	a.ssh = m
	a.sftp = sftpx.NewService(m, a.Emit)
	a.monitor = monitor.NewService(m, a.Emit)
	a.batch = batch.NewService(m)
}

// Emit 事件推送（供各模块回调）
func (a *App) Emit(event string, data ...interface{}) {
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, event, data...)
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) shutdown(ctx context.Context) {
	a.monitor.StopAll()
	for _, id := range a.ssh.ConnectedIDs() {
		_ = a.ssh.Disconnect(id)
	}
}

// --- 会话管理 ---

// ListSessions 返回所有会话
func (a *App) ListSessions() []store.Session {
	return a.store.List()
}

// SaveSession 保存会话（不含凭据）
func (a *App) SaveSession(sess store.Session) error {
	if sess.ID == "" {
		sess.ID = fmt.Sprintf("sess_%d", time.Now().UnixNano())
	}
	if sess.Port == 0 {
		sess.Port = 22
	}
	if sess.Encoding == "" {
		sess.Encoding = "utf-8"
	}
	return a.store.Save(sess)
}

// DeleteSession 删除会话
func (a *App) DeleteSession(id string) error {
	a.monitor.Stop(id)
	_ = a.ssh.Disconnect(id)
	return a.store.Delete(id)
}

// SaveCredential 保存会话凭据
func (a *App) SaveCredential(id, password, passphrase string) error {
	return a.store.SetCredential(id, store.Credential{Password: password, Passphrase: passphrase})
}

// HasCredential 判断凭据是否已保存
func (a *App) HasCredential(id string) bool {
	_, err := a.store.GetCredential(id)
	return err == nil
}

// IsUsingFallback 凭据是否使用降级加密
func (a *App) IsUsingFallback() bool {
	return a.store.IsUsingFallback()
}

// TestConnection 测试会话连通性（表单数据直接传入，不保存）。
// 密码认证用 password；密钥认证用 passphrase 解锁私钥。
// 编辑已有会话时，若表单密码是占位符 ********，则回退读取已保存的凭据。
func (a *App) TestConnection(sess store.Session, password, passphrase string) sshx.TestResult {
	cred := store.Credential{Password: password, Passphrase: passphrase}
	if sess.ID != "" {
		if _, exists := a.store.Get(sess.ID); exists {
			if saved, err := a.store.GetCredential(sess.ID); err == nil {
				if password == "" || password == "********" {
					cred.Password = saved.Password
				}
				if passphrase == "" || passphrase == "********" {
					cred.Passphrase = saved.Passphrase
				}
			}
		}
	}
	return a.ssh.TestConnection(sess, cred, 10*time.Second)
}

// --- SSH 连接与终端 ---

// Connect 连接会话（从存储读取凭据）
func (a *App) Connect(id string) error {
	sess, exists := a.store.Get(id)
	if !exists {
		return fmt.Errorf("会话不存在: %s", id)
	}
	cred, err := a.store.GetCredential(id)
	if err != nil {
		// 凭据不存在时返回特定错误，前端弹出输入密码框
		return fmt.Errorf("NEED_CREDENTIAL: %v", err)
	}
	return a.ssh.Connect(sess, cred)
}

// ConnectWithCredential 带临时凭据连接（密码输入框使用）
func (a *App) ConnectWithCredential(id, password, passphrase string, remember bool) error {
	sess, exists := a.store.Get(id)
	if !exists {
		return fmt.Errorf("会话不存在: %s", id)
	}
	cred := store.Credential{Password: password, Passphrase: passphrase}
	if remember {
		if err := a.store.SetCredential(id, cred); err != nil {
			return fmt.Errorf("保存凭据失败: %w", err)
		}
	}
	return a.ssh.Connect(sess, cred)
}

// Disconnect 断开连接
func (a *App) Disconnect(id string) error {
	a.monitor.Stop(id)
	return a.ssh.Disconnect(id)
}

// IsConnected 查询连接状态
func (a *App) IsConnected(id string) bool {
	return a.ssh.IsConnected(id)
}

// ConnectedSessions 返回已连接会话 ID
func (a *App) ConnectedSessions() []string {
	return a.ssh.ConnectedIDs()
}

// WriteTerminal 前端键盘输入写入远端 PTY（data 为 base64 编码）
func (a *App) WriteTerminal(id string, data string) error {
	decoded, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return fmt.Errorf("终端数据解码失败: %w", err)
	}
	return a.ssh.Write(id, decoded)
}

// ResizeTerminal 调整远端 PTY 大小
func (a *App) ResizeTerminal(id string, cols, rows int) error {
	return a.ssh.Resize(id, cols, rows)
}

// Exec 在非交互通道执行命令（供前端单次命令使用）
func (a *App) Exec(sessionID, command string) (string, error) {
	stdout, stderr, err := a.ssh.Exec(sessionID, command)
	output := string(stdout)
	if len(stderr) > 0 {
		output += string(stderr)
	}
	if err != nil {
		return output, err
	}
	return output, nil
}

// --- SFTP ---

// SftpList 列出远程目录
func (a *App) SftpList(sessionID, remotePath string) ([]sftpx.FileEntry, error) {
	return a.sftp.List(sessionID, remotePath)
}

// SftpMkdir 创建远程目录
func (a *App) SftpMkdir(sessionID, remotePath string) error {
	return a.sftp.Mkdir(sessionID, remotePath)
}

// SftpRemove 删除远程文件或目录
func (a *App) SftpRemove(sessionID, remotePath string, isDir bool) error {
	return a.sftp.Remove(sessionID, remotePath, isDir)
}

// SftpRename 重命名
func (a *App) SftpRename(sessionID, oldPath, newPath string) error {
	return a.sftp.Rename(sessionID, oldPath, newPath)
}

// SftpUpload 上传文件（localPath 由前端通过系统文件对话框获取）
func (a *App) SftpUpload(sessionID, localPath, remotePath string) (string, error) {
	return a.sftp.Upload(sessionID, localPath, remotePath)
}

// SftpDownload 下载文件到本地路径
func (a *App) SftpDownload(sessionID, remotePath, localPath string) (string, error) {
	return a.sftp.Download(sessionID, remotePath, localPath)
}

// SftpUploadDirectory 上传目录
func (a *App) SftpUploadDirectory(sessionID, localDir, remoteDir string) error {
	return a.sftp.UploadDirectory(sessionID, localDir, remoteDir)
}

// SftpDownloadDirectory 下载目录
func (a *App) SftpDownloadDirectory(sessionID, remoteDir, localDir string) error {
	return a.sftp.DownloadDirectory(sessionID, remoteDir, localDir)
}

// SftpTransfers 返回传输任务列表
func (a *App) SftpTransfers() []sftpx.TransferProgress {
	return a.sftp.ListTransfers()
}

// --- 监控 ---

// StartMonitor 开始采集服务器监控数据
func (a *App) StartMonitor(sessionID string) error {
	return a.monitor.Start(sessionID)
}

// StopMonitor 停止采集
func (a *App) StopMonitor(sessionID string) {
	a.monitor.Stop(sessionID)
}

// --- 批量命令 ---

// BatchExec 向多个会话并发下发命令
func (a *App) BatchExec(sessionIDs []string, command string, timeoutSec int) []batch.Result {
	names := make(map[string]string)
	for _, id := range sessionIDs {
		if sess, ok := a.store.Get(id); ok {
			names[id] = sess.Name
		} else {
			names[id] = id
		}
	}
	return a.batch.Exec(sessionIDs, names, command, timeoutSec)
}

// --- 系统对话框 ---

// OpenFileDialog 打开文件选择对话框（上传用）
func (a *App) OpenFileDialog() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "选择要上传的文件"})
	return path, err
}

// OpenDirectoryDialog 打开目录选择对话框（上传目录用）
func (a *App) OpenDirectoryDialog() (string, error) {
	path, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "选择要上传的目录"})
	return path, err
}

// SaveFileDialog 打开文件保存对话框（下载用）
func (a *App) SaveFileDialog(defaultName string) (string, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "选择保存位置",
		DefaultFilename: defaultName,
	})
	return path, err
}

// SaveDirectoryDialog 打开目录保存对话框（下载目录用）
func (a *App) SaveDirectoryDialog() (string, error) {
	path, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "选择保存目录"})
	return path, err
}

// --- 工具 ---

// OpenKeyPathDialog 选择私钥文件
func (a *App) OpenKeyPathDialog() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "选择私钥文件"})
	return path, err
}

// HomeDir 返回用户主目录
func (a *App) HomeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return home
}

// JoinPath 拼接路径（供前端调用，避免跨平台路径问题）
func (a *App) JoinPath(base, name string) string {
	return filepath.Join(base, name)
}

// Version 返回版本号
func (a *App) Version() string {
	return "v0.1.0-alpha"
}
