// Package store 负责会话配置的持久化与凭据的安全存储。
// 凭据优先使用系统钥匙串；无钥匙串服务时降级为 AES-256-GCM 加密文件。
package store

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/zalando/go-keyring"
)

// AuthType 认证方式
type AuthType string

const (
	AuthPassword AuthType = "password"
	AuthKey      AuthType = "key"
)

// Session 会话配置（不含敏感凭据）
type Session struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Group      string   `json:"group,omitempty"`
	Host       string   `json:"host"`
	Port       int      `json:"port"`
	Username   string   `json:"username"`
	AuthType   AuthType `json:"authType"`
	KeyPath    string   `json:"keyPath,omitempty"`
	Encoding   string   `json:"encoding,omitempty"`
	Color      string   `json:"color,omitempty"`
	Favorite   bool     `json:"favorite,omitempty"`
	CreatedAt  string   `json:"createdAt,omitempty"`
}

// Credential 敏感凭据（单独加密存储，不写入会话 JSON）
type Credential struct {
	Password   string `json:"password,omitempty"`
	Passphrase string `json:"passphrase,omitempty"`
}

const (
	serviceName   = "hiShell"
	credPrefix    = "cred:"
	sessionsFile  = "sessions.json"
	fallbackFile  = "keyring.enc"
	keyringEnvVar = "HISHELL_NO_KEYRING"
)

// SessionStore 会话存储
type SessionStore struct {
	mu       sync.RWMutex
	dir      string
	sessions []Session
	useFallback bool
	fallbackKey []byte
}

// NewSessionStore 创建会话存储，自动探测钥匙串可用性
func NewSessionStore() (*SessionStore, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return nil, fmt.Errorf("获取配置目录失败: %w", err)
	}
	dir = filepath.Join(dir, "hiShell")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("创建配置目录失败: %w", err)
	}

	s := &SessionStore{dir: dir, sessions: []Session{}}
	s.detectKeyring()

	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

// detectKeyring 探测系统钥匙串是否可用
func (s *SessionStore) detectKeyring() {
	if os.Getenv(keyringEnvVar) == "1" {
		s.useFallback = true
		s.initFallbackKey()
		return
	}
	// 写一个测试条目探测（Windows 凭据管理器 / macOS Keychain / Linux Secret Service）
	probeKey := "__hishell_probe__"
	if err := keyring.Set(serviceName, probeKey, "ok"); err != nil {
		s.useFallback = true
		s.initFallbackKey()
		return
	}
	_ = keyring.Delete(serviceName, probeKey)
	s.useFallback = false
}

// initFallbackKey 生成或加载本地加密密钥
func (s *SessionStore) initFallbackKey() {
	keyPath := filepath.Join(s.dir, ".masterkey")
	if data, err := os.ReadFile(keyPath); err == nil && len(data) == 32 {
		s.fallbackKey = data
		return
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err == nil {
		_ = os.WriteFile(keyPath, key, 0600)
		s.fallbackKey = key
	}
}

// List 返回所有会话
func (s *SessionStore) List() []Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]Session, len(s.sessions))
	copy(result, s.sessions)
	return result
}

// Get 按 ID 查找会话
func (s *SessionStore) Get(id string) (Session, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, sess := range s.sessions {
		if sess.ID == id {
			return sess, true
		}
	}
	return Session{}, false
}

// Save 新增或更新会话（凭据单独处理）
func (s *SessionStore) Save(sess Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	found := false
	for i, existing := range s.sessions {
		if existing.ID == sess.ID {
			s.sessions[i] = sess
			found = true
			break
		}
	}
	if !found {
		s.sessions = append(s.sessions, sess)
	}
	return s.persistLocked()
}

// Delete 删除会话及其凭据
func (s *SessionStore) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	filtered := s.sessions[:0]
	for _, sess := range s.sessions {
		if sess.ID != id {
			filtered = append(filtered, sess)
		}
	}
	s.sessions = filtered
	_ = s.deleteCredential(id)
	return s.persistLocked()
}

// GetCredential 读取会话凭据
func (s *SessionStore) GetCredential(id string) (Credential, error) {
	if s.useFallback {
		return s.getCredentialFallback(id)
	}
	data, err := keyring.Get(serviceName, credPrefix+id)
	if err != nil {
		return Credential{}, fmt.Errorf("读取凭据失败: %w", err)
	}
	var cred Credential
	if err := json.Unmarshal([]byte(data), &cred); err != nil {
		return Credential{}, fmt.Errorf("解析凭据失败: %w", err)
	}
	return cred, nil
}

// SetCredential 保存会话凭据
func (s *SessionStore) SetCredential(id string, cred Credential) error {
	if s.useFallback {
		return s.setCredentialFallback(id, cred)
	}
	data, err := json.Marshal(cred)
	if err != nil {
		return err
	}
	return keyring.Set(serviceName, credPrefix+id, string(data))
}

// DeleteCredential 删除会话凭据
func (s *SessionStore) DeleteCredential(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.deleteCredential(id)
}

func (s *SessionStore) deleteCredential(id string) error {
	if s.useFallback {
		return s.deleteCredentialFallback(id)
	}
	return keyring.Delete(serviceName, credPrefix+id)
}

// IsUsingFallback 是否使用降级加密（供前端提示）
func (s *SessionStore) IsUsingFallback() bool {
	return s.useFallback
}

// --- 内部持久化 ---

func (s *SessionStore) load() error {
	path := filepath.Join(s.dir, sessionsFile)
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("读取会话文件失败: %w", err)
	}
	if err := json.Unmarshal(data, &s.sessions); err != nil {
		return fmt.Errorf("解析会话文件失败: %w", err)
	}
	return nil
}

func (s *SessionStore) persistLocked() error {
	path := filepath.Join(s.dir, sessionsFile)
	data, err := json.MarshalIndent(s.sessions, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("写入会话文件失败: %w", err)
	}
	return nil
}

// --- AES-256-GCM 降级实现 ---

func (s *SessionStore) credentialPath(id string) string {
	return filepath.Join(s.dir, fmt.Sprintf("cred_%s.enc", id))
}

func (s *SessionStore) getCredentialFallback(id string) (Credential, error) {
	data, err := os.ReadFile(s.credentialPath(id))
	if err != nil {
		return Credential{}, fmt.Errorf("读取加密凭据失败: %w", err)
	}
	plain, err := decryptGCM(s.fallbackKey, data)
	if err != nil {
		return Credential{}, err
	}
	var cred Credential
	if err := json.Unmarshal(plain, &cred); err != nil {
		return Credential{}, err
	}
	return cred, nil
}

func (s *SessionStore) setCredentialFallback(id string, cred Credential) error {
	plain, err := json.Marshal(cred)
	if err != nil {
		return err
	}
	encrypted, err := encryptGCM(s.fallbackKey, plain)
	if err != nil {
		return err
	}
	return os.WriteFile(s.credentialPath(id), encrypted, 0600)
}

func (s *SessionStore) deleteCredentialFallback(id string) error {
	err := os.Remove(s.credentialPath(id))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func encryptGCM(key, plain []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	ciphertext := gcm.Seal(nonce, nonce, plain, nil)
	return []byte(base64.StdEncoding.EncodeToString(ciphertext)), nil
}

func decryptGCM(key, data []byte) ([]byte, error) {
	decoded, err := base64.StdEncoding.DecodeString(string(data))
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(decoded) < gcm.NonceSize() {
		return nil, fmt.Errorf("加密数据格式错误")
	}
	nonce, ciphertext := decoded[:gcm.NonceSize()], decoded[gcm.NonceSize():]
	return gcm.Open(nil, nonce, ciphertext, nil)
}
