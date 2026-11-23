// Package batch 实现多服务器并发命令下发。
package batch

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/hongw/hishell/internal/sshx"
)

// Result 单台服务器的执行结果
type Result struct {
	SessionID string `json:"sessionId"`
	SessionName string `json:"sessionName"`
	Success   bool   `json:"success"`
	Output    string `json:"output"`
	Error     string `json:"error,omitempty"`
	Duration  string `json:"duration"`
}

// Service 批量命令服务
type Service struct {
	sshManager *sshx.Manager
}

func NewService(manager *sshx.Manager) *Service {
	return &Service{sshManager: manager}
}

// Exec 向多个会话并发下发同一条命令
func (s *Service) Exec(sessionIDs []string, names map[string]string, command string, timeoutSec int) []Result {
	if strings.TrimSpace(command) == "" {
		return nil
	}
	if timeoutSec <= 0 {
		timeoutSec = 30
	}

	results := make([]Result, len(sessionIDs))
	var wg sync.WaitGroup

	for i, id := range sessionIDs {
		wg.Add(1)
		go func(idx int, sessionID string) {
			defer wg.Done()
			start := time.Now()
			result := Result{SessionID: sessionID, SessionName: names[sessionID]}

			stdout, stderr, err := s.sshManager.Exec(sessionID, command)
			output := string(stdout)
			if len(stderr) > 0 {
				if output != "" {
					output += "\n"
				}
				output += "[stderr] " + string(stderr)
			}
			if err != nil {
				result.Success = false
				result.Error = err.Error()
				if output != "" {
					result.Output = output
				}
			} else {
				result.Success = true
				result.Output = output
			}
			result.Duration = fmt.Sprintf("%dms", time.Since(start).Milliseconds())
			results[idx] = result
		}(i, id)
	}

	wg.Wait()
	return results
}
