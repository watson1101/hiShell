// Package sftpx 封装基于现有 SSH 连接的 SFTP 文件操作。
package sftpx

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/hongw/hishell/internal/sshx"
	"github.com/pkg/sftp"
)

// EmitFunc 事件推送函数
type EmitFunc func(event string, data ...interface{})

// FileEntry 文件/目录条目
type FileEntry struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	IsDir    bool   `json:"isDir"`
	Size     int64  `json:"size"`
	Mode     string `json:"mode"`
	ModTime  string `json:"modTime"`
}

// TransferProgress 传输进度
type TransferProgress struct {
	ID       string `json:"id"`
	Direction string `json:"direction"` // upload / download
	File     string `json:"file"`
	Bytes    int64  `json:"bytes"`
	Total    int64  `json:"total"`
	Percent  int    `json:"percent"`
	Status   string `json:"status"` // running / done / error
	Message  string `json:"message,omitempty"`
}

// Service SFTP 服务
type Service struct {
	sshManager *sshx.Manager
	emit       EmitFunc
	mu         sync.Mutex
	transfers  map[string]*TransferProgress
}

// NewService 创建 SFTP 服务
func NewService(manager *sshx.Manager, emit EmitFunc) *Service {
	return &Service{sshManager: manager, emit: emit, transfers: make(map[string]*TransferProgress)}
}

// expandTilde 将 ~ 开头的路径展开为 SFTP 会话的真实家目录路径
func expandTilde(client *sftp.Client, p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") {
		home, err := client.RealPath(".")
		if err == nil {
			if p == "~" {
				return home
			}
			return strings.TrimSuffix(home, "/") + "/" + strings.TrimPrefix(p, "~/")
		}
	}
	return p
}

func (s *Service) client(id string) (*sftp.Client, error) {
	sshClient, err := s.sshManager.GetClient(id)
	if err != nil {
		return nil, err
	}
	client, err := sftp.NewClient(sshClient)
	if err != nil {
		return nil, fmt.Errorf("创建 SFTP 客户端失败: %w", err)
	}
	return client, nil
}

// List 列出远程目录
func (s *Service) List(sessionID, remotePath string) ([]FileEntry, error) {
	client, err := s.client(sessionID)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	remotePath = expandTilde(client, remotePath)
	if remotePath == "" {
		remotePath, err = client.Getwd()
		if err != nil {
			return nil, err
		}
	}

	entries, err := client.ReadDir(remotePath)
	if err != nil {
		return nil, fmt.Errorf("读取目录 %s 失败: %w", remotePath, err)
	}

	result := make([]FileEntry, 0, len(entries))
	for _, e := range entries {
		result = append(result, FileEntry{
			Name:    e.Name(),
			Path:    filepath.ToSlash(filepath.Join(remotePath, e.Name())),
			IsDir:   e.IsDir(),
			Size:    e.Size(),
			Mode:    e.Mode().String(),
			ModTime: e.ModTime().Format(time.RFC3339),
		})
	}

	// 目录在前，按名称排序
	sort.Slice(result, func(i, j int) bool {
		if result[i].IsDir != result[j].IsDir {
			return result[i].IsDir
		}
		return result[i].Name < result[j].Name
	})
	return result, nil
}

// Mkdir 创建远程目录
func (s *Service) Mkdir(sessionID, remotePath string) error {
	client, err := s.client(sessionID)
	if err != nil {
		return err
	}
	defer client.Close()
	remotePath = expandTilde(client, remotePath)
	return client.MkdirAll(remotePath)
}

// Remove 删除远程文件或目录（目录递归删除）
func (s *Service) Remove(sessionID, remotePath string, isDir bool) error {
	client, err := s.client(sessionID)
	if err != nil {
		return err
	}
	defer client.Close()
	remotePath = expandTilde(client, remotePath)
	if isDir {
		return client.RemoveAll(remotePath)
	}
	return client.Remove(remotePath)
}

// Rename 重命名/移动
func (s *Service) Rename(sessionID, oldPath, newPath string) error {
	client, err := s.client(sessionID)
	if err != nil {
		return err
	}
	defer client.Close()
	oldPath = expandTilde(client, oldPath)
	newPath = expandTilde(client, newPath)
	return client.Rename(oldPath, newPath)
}

// Upload 上传本地文件到远程路径
func (s *Service) Upload(sessionID, localPath, remotePath string) (string, error) {
	transferID := fmt.Sprintf("up_%d", time.Now().UnixNano())
	localFile, err := os.Open(localPath)
	if err != nil {
		return "", fmt.Errorf("打开本地文件失败: %w", err)
	}
	defer localFile.Close()

	stat, err := localFile.Stat()
	if err != nil {
		return "", err
	}

	client, err := s.client(sessionID)
	if err != nil {
		return "", err
	}
	defer client.Close()
	remotePath = expandTilde(client, remotePath)

	remoteFile, err := client.Create(remotePath)
	if err != nil {
		return "", fmt.Errorf("创建远程文件失败: %w", err)
	}
	defer remoteFile.Close()

	progress := &TransferProgress{
		ID: transferID, Direction: "upload", File: filepath.Base(localPath),
		Total: stat.Size(), Status: "running",
	}
	s.setProgress(progress)

	_, err = io.Copy(remoteFile, &progressReader{
		reader: localFile,
		total:  stat.Size(),
		onProgress: func(bytes int64) {
			p := s.getProgress(transferID)
			if p == nil {
				return
			}
			p.Bytes = bytes
			p.Percent = int(bytes * 100 / p.Total)
			s.setProgress(p)
			s.emit("sftp:progress", p)
		},
	})
	if err != nil {
		progress.Status = "error"
		progress.Message = err.Error()
		s.setProgress(progress)
		s.emit("sftp:progress", progress)
		return transferID, err
	}
	progress.Status = "done"
	progress.Percent = 100
	progress.Bytes = progress.Total
	s.setProgress(progress)
	s.emit("sftp:progress", progress)
	return transferID, nil
}

// Download 下载远程文件到本地路径
func (s *Service) Download(sessionID, remotePath, localPath string) (string, error) {
	transferID := fmt.Sprintf("down_%d", time.Now().UnixNano())

	client, err := s.client(sessionID)
	if err != nil {
		return "", err
	}
	defer client.Close()
	remotePath = expandTilde(client, remotePath)

	remoteFile, err := client.Open(remotePath)
	if err != nil {
		return "", fmt.Errorf("打开远程文件失败: %w", err)
	}
	defer remoteFile.Close()

	stat, err := remoteFile.Stat()
	if err != nil {
		return "", err
	}

	localFile, err := os.Create(localPath)
	if err != nil {
		return "", fmt.Errorf("创建本地文件失败: %w", err)
	}
	defer localFile.Close()

	progress := &TransferProgress{
		ID: transferID, Direction: "download", File: filepath.Base(remotePath),
		Total: stat.Size(), Status: "running",
	}
	s.setProgress(progress)

	_, err = io.Copy(localFile, &progressReader{
		reader: remoteFile,
		total:  stat.Size(),
		onProgress: func(bytes int64) {
			p := s.getProgress(transferID)
			if p == nil {
				return
			}
			p.Bytes = bytes
			p.Percent = int(bytes * 100 / p.Total)
			s.setProgress(p)
			s.emit("sftp:progress", p)
		},
	})
	if err != nil {
		progress.Status = "error"
		progress.Message = err.Error()
		s.setProgress(progress)
		s.emit("sftp:progress", progress)
		return transferID, err
	}
	progress.Status = "done"
	progress.Percent = 100
	progress.Bytes = progress.Total
	s.setProgress(progress)
	s.emit("sftp:progress", progress)
	return transferID, nil
}

// UploadDirectory 递归上传本地目录
func (s *Service) UploadDirectory(sessionID, localDir, remoteDir string) error {
	client, err := s.client(sessionID)
	if err != nil {
		return err
	}
	defer client.Close()
	remoteDir = expandTilde(client, remoteDir)

	return filepath.Walk(localDir, func(localPath string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(localDir, localPath)
		if err != nil {
			return err
		}
		remotePath := remoteDir
		if rel != "." {
			remotePath = remoteDir + "/" + filepath.ToSlash(rel)
		}
		if info.IsDir() {
			return client.MkdirAll(remotePath)
		}
		src, err := os.Open(localPath)
		if err != nil {
			return err
		}
		defer src.Close()
		dst, err := client.Create(remotePath)
		if err != nil {
			return err
		}
		defer dst.Close()
		_, err = io.Copy(dst, src)
		return err
	})
}

// DownloadDirectory 递归下载远程目录
func (s *Service) DownloadDirectory(sessionID, remoteDir, localDir string) error {
	client, err := s.client(sessionID)
	if err != nil {
		return err
	}
	defer client.Close()
	remoteDir = expandTilde(client, remoteDir)

	var walk func(remote, local string) error
	walk = func(remote, local string) error {
		entries, err := client.ReadDir(remote)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(local, 0755); err != nil {
			return err
		}
		for _, e := range entries {
			rp := remote + "/" + e.Name()
			lp := filepath.Join(local, e.Name())
			if e.IsDir() {
				if err := walk(rp, lp); err != nil {
					return err
				}
			} else {
				src, err := client.Open(rp)
				if err != nil {
					return err
				}
				dst, err := os.Create(lp)
				if err != nil {
					src.Close()
					return err
				}
				_, err = io.Copy(dst, src)
				src.Close()
				dst.Close()
				if err != nil {
					return err
				}
			}
		}
		return nil
	}
	return walk(remoteDir, localDir)
}

func (s *Service) setProgress(p *TransferProgress) {
	s.mu.Lock()
	s.transfers[p.ID] = p
	s.mu.Unlock()
}

func (s *Service) getProgress(id string) *TransferProgress {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.transfers[id]
}

// ListTransfers 返回传输任务列表（供前端刷新）
func (s *Service) ListTransfers() []TransferProgress {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make([]TransferProgress, 0, len(s.transfers))
	for _, p := range s.transfers {
		result = append(result, *p)
	}
	return result
}

type progressReader struct {
	reader     io.Reader
	total      int64
	read       int64
	onProgress func(int64)
}

func (r *progressReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	r.read += int64(n)
	if r.onProgress != nil {
		r.onProgress(r.read)
	}
	return n, err
}
