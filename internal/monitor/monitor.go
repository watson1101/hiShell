// Package monitor 通过 SSH exec 采集服务器系统指标，数据结构对齐 FinalShell 侧栏。
package monitor

import (
	"bufio"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/hongw/hishell/internal/sshx"
)

// EmitFunc 事件推送函数
type EmitFunc func(event string, data ...interface{})

// Snapshot 一次采集的完整快照
type Snapshot struct {
	SessionID  string       `json:"sessionId"`
	OS         string       `json:"os"`         // linux / darwin
	Uptime     string       `json:"uptime"`     // 运行时间描述
	LoadAvg    string       `json:"loadAvg"`    // 负载 1/5/15 分钟
	CPUUsage   float64      `json:"cpuUsage"`   // 百分比
	MemUsage   float64      `json:"memUsage"`   // 百分比
	MemUsed    string       `json:"memUsed"`    // 如 2.2G
	MemTotal   string       `json:"memTotal"`   // 如 11.5G
	SwapUsage  float64      `json:"swapUsage"`
	SwapUsed   string       `json:"swapUsed"`
	SwapTotal  string       `json:"swapTotal"`
	Processes  []Process    `json:"processes"`
	Network    NetworkInfo  `json:"network"`
	Disks      []DiskMount  `json:"disks"`
	Timestamp  int64        `json:"timestamp"`
}

// Process 进程条目
type Process struct {
	Memory string `json:"memory"`
	CPU    string `json:"cpu"`
	Command string `json:"command"`
}

// NetworkInfo 网络信息（含实时流量采样）
type NetworkInfo struct {
	Interface string        `json:"interface"`
	RxBytes   int64         `json:"rxBytes"`
	TxBytes   int64         `json:"txBytes"`
	RxRate    float64       `json:"rxRate"` // bytes/s
	TxRate    float64       `json:"txRate"`
	RxHuman   string        `json:"rxHuman"`
	TxHuman   string        `json:"txHuman"`
}

// DiskMount 磁盘挂载点
type DiskMount struct {
	Path  string `json:"path"`
	Avail string `json:"avail"`
	Size  string `json:"size"`
	Used  float64 `json:"used"` // 使用百分比
}

// Service 监控服务
type Service struct {
	sshManager *sshx.Manager
	emit       EmitFunc
	mu         sync.Mutex
	tickers    map[string]*time.Ticker
	stops      map[string]chan struct{}
	prevNet    map[string]netSample
	interval   time.Duration
}

type netSample struct {
	info NetworkInfo
	at   time.Time
}

// NewService 创建监控服务
func NewService(manager *sshx.Manager, emit EmitFunc) *Service {
	return &Service{
		sshManager: manager,
		emit:       emit,
		tickers:    make(map[string]*time.Ticker),
		stops:      make(map[string]chan struct{}),
		prevNet:    make(map[string]netSample),
		interval:   2 * time.Second,
	}
}

// Start 开始采集指定会话的监控数据
func (s *Service) Start(sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.stops[sessionID]; exists {
		return nil // 已在采集
	}
	stop := make(chan struct{})
	s.stops[sessionID] = stop

	// 立即采集一次
	go s.collectAndEmit(sessionID)

	ticker := time.NewTicker(s.interval)
	s.tickers[sessionID] = ticker
	go func() {
		for {
			select {
			case <-ticker.C:
				s.collectAndEmit(sessionID)
			case <-stop:
				ticker.Stop()
				return
			}
		}
	}()
	return nil
}

// Stop 停止采集
func (s *Service) Stop(sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if stop, exists := s.stops[sessionID]; exists {
		close(stop)
		delete(s.stops, sessionID)
	}
	if ticker, exists := s.tickers[sessionID]; exists {
		ticker.Stop()
		delete(s.tickers, sessionID)
	}
	delete(s.prevNet, sessionID)
}

// StopAll 停止所有采集
func (s *Service) StopAll() {
	s.mu.Lock()
	ids := make([]string, 0, len(s.stops))
	for id := range s.stops {
		ids = append(ids, id)
	}
	s.mu.Unlock()
	for _, id := range ids {
		s.Stop(id)
	}
}

func (s *Service) collectAndEmit(sessionID string) {
	snapshot, err := s.Collect(sessionID)
	if err != nil {
		s.emit("monitor:error", map[string]interface{}{"sessionId": sessionID, "message": err.Error()})
		return
	}
	s.emit("monitor:data", snapshot)
}

// Collect 执行一次采集
func (s *Service) Collect(sessionID string) (Snapshot, error) {
	snap := Snapshot{SessionID: sessionID, Timestamp: time.Now().Unix(), Processes: []Process{}, Disks: []DiskMount{}}

	// 探测操作系统
	out, _, err := s.sshManager.Exec(sessionID, "uname -s")
	if err != nil {
		return snap, fmt.Errorf("探测系统失败: %w", err)
	}
	osName := strings.TrimSpace(string(out))
	if osName == "Darwin" {
		snap.OS = "darwin"
		return s.collectDarwin(sessionID, snap)
	}
	snap.OS = "linux"
	return s.collectLinux(sessionID, snap)
}

// --- Linux 采集 ---

func (s *Service) collectLinux(sessionID string, snap Snapshot) (Snapshot, error) {
	// uptime: 运行时间 + 负载
	if out, _, err := s.sshManager.Exec(sessionID, "uptime"); err == nil {
		parseUptime(string(out), &snap)
	}

	// CPU 使用率：从 /proc/stat 采样两次
	cpu1, _, err1 := s.sshManager.Exec(sessionID, "grep '^cpu ' /proc/stat")
	if err1 == nil {
		time.Sleep(300 * time.Millisecond)
		cpu2, _, err2 := s.sshManager.Exec(sessionID, "grep '^cpu ' /proc/stat")
		if err2 == nil {
			snap.CPUUsage = calcCPUUsage(string(cpu1), string(cpu2))
		}
	}

	// 内存/交换：free -b
	if out, _, err := s.sshManager.Exec(sessionID, "free -b 2>/dev/null || free"); err == nil {
		parseFreeLinux(string(out), &snap)
	}

	// 进程：按实际物理内存(RSS)排序取前 8，内存显示真实占用、CPU 显示百分比。
	// 使用 ps 的固定列输出，避免 top 输出格式随版本/终端宽度变化导致列错位。
	psCmd := "ps -eo rss,pcpu,comm --sort=-rss 2>/dev/null | head -n 9 || ps -eo rss,pcpu,comm | head -n 9"
	if out, _, err := s.sshManager.Exec(sessionID, psCmd); err == nil {
		snap.Processes = parseProcessPS(string(out))
	}

	// 磁盘挂载：df -h（排除临时文件系统）
	if out, _, err := s.sshManager.Exec(sessionID, "df -h -x tmpfs -x devtmpfs 2>/dev/null || df -h"); err == nil {
		snap.Disks = parseDF(string(out))
	}

	// 网络：/proc/net/dev
	if out, _, err := s.sshManager.Exec(sessionID, "cat /proc/net/dev"); err == nil {
		snap.Network = s.parseNetDevLinux(sessionID, string(out))
	}

	return snap, nil
}

// --- macOS 采集 ---

func (s *Service) collectDarwin(sessionID string, snap Snapshot) (Snapshot, error) {
	if out, _, err := s.sshManager.Exec(sessionID, "uptime"); err == nil {
		parseUptime(string(out), &snap)
	}

	// CPU: sysctl
	if out, _, err := s.sshManager.Exec(sessionID, "sysctl -n vm.loadavg"); err == nil {
		snap.LoadAvg = strings.Trim(strings.TrimSpace(string(out)), "{}")
	}
	if out, _, err := s.sshManager.Exec(sessionID, "top -l 2 -n 0 | grep 'CPU usage' | tail -1"); err == nil {
		snap.CPUUsage = parseDarwinCPU(string(out))
	}

	// 内存: vm_stat + sysctl
	if out, _, err := s.sshManager.Exec(sessionID, "sysctl -n hw.memsize"); err == nil {
		if total, e := strconv.ParseInt(strings.TrimSpace(string(out)), 10, 64); e == nil {
			snap.MemTotal = humanBytes(total)
		}
	}
	if out, _, err := s.sshManager.Exec(sessionID, "vm_stat"); err == nil {
		parseDarwinMem(string(out), &snap)
	}

	// 进程：macOS 的 ps 用 -m 按内存排序，列格式同为 rss,pcpu,comm
	if out, _, err := s.sshManager.Exec(sessionID, "ps -eo rss,pcpu,comm -m | head -n 9"); err == nil {
		snap.Processes = parseProcessPS(string(out))
	}

	// 磁盘
	if out, _, err := s.sshManager.Exec(sessionID, "df -h"); err == nil {
		snap.Disks = parseDF(string(out))
	}

	// 网络
	if out, _, err := s.sshManager.Exec(sessionID, "netstat -ib | grep -E '^en' | head -1"); err == nil {
		snap.Network = parseNetstatDarwin(string(out))
	}

	return snap, nil
}

// --- 解析函数 ---

func parseUptime(output string, snap *Snapshot) {
	// 15:32:07 up 2 days,  3:14,  2 users,  load average: 0.10, 0.13, 0.09
	line := strings.TrimSpace(output)
	if idx := strings.Index(line, "up "); idx >= 0 {
		rest := line[idx+3:]
		if comma := strings.Index(rest, ","); comma >= 0 {
			snap.Uptime = strings.TrimSpace(rest[:comma])
		}
	}
	if idx := strings.Index(line, "load average:"); idx >= 0 {
		snap.LoadAvg = strings.TrimSpace(line[idx+len("load average:"):])
	}
}

func calcCPUUsage(s1, s2 string) float64 {
	fields1 := strings.Fields(s1)
	fields2 := strings.Fields(s2)
	if len(fields1) < 9 || len(fields2) < 9 {
		return 0
	}
	// fields: cpu user nice system idle iowait irq softirq steal guest guest_nice
	parse := func(f []string) (total, idle int64) {
		for i := 1; i < len(f) && i <= 8; i++ {
			v, _ := strconv.ParseInt(f[i], 10, 64)
			total += v
			if i == 4 || i == 5 { // idle, iowait
				idle += v
			}
		}
		return
	}
	t1, i1 := parse(fields1)
	t2, i2 := parse(fields2)
	totalDiff := t2 - t1
	idleDiff := i2 - i1
	if totalDiff <= 0 {
		return 0
	}
	return float64(totalDiff-idleDiff) / float64(totalDiff) * 100
}

func parseFreeLinux(output string, snap *Snapshot) {
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 3 {
			continue
		}
		switch strings.ToLower(fields[0]) {
		case "mem:":
			total, _ := strconv.ParseInt(fields[1], 10, 64)
			used, _ := strconv.ParseInt(fields[2], 10, 64)
			snap.MemTotal = humanBytes(total)
			snap.MemUsed = humanBytes(used)
			if total > 0 {
				snap.MemUsage = float64(used) / float64(total) * 100
			}
		case "swap:":
			total, _ := strconv.ParseInt(fields[1], 10, 64)
			used, _ := strconv.ParseInt(fields[2], 10, 64)
			snap.SwapTotal = humanBytes(total)
			snap.SwapUsed = humanBytes(used)
			if total > 0 {
				snap.SwapUsage = float64(used) / float64(total) * 100
			}
		}
	}
}

// parseProcessPS 解析 "RSS(KB) %CPU COMMAND" 格式的进程列表。
// 内存列展示实际常驻内存占用（如 980M），CPU 列展示使用百分比，避免把 PID 当成内存百分比。
func parseProcessPS(output string) []Process {
	var processes []Process
	for i, line := range strings.Split(output, "\n") {
		if i == 0 || strings.TrimSpace(line) == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		rssKB, err := strconv.ParseInt(fields[0], 10, 64)
		if err != nil {
			continue
		}
		processes = append(processes, Process{
			Memory: humanKB(rssKB),
			CPU:    fields[1] + "%",
			Command: strings.Join(fields[2:], " "),
		})
		if len(processes) >= 8 {
			break
		}
	}
	return processes
}

// humanKB 把 KB 转为人类可读的内存大小（如 980M / 9.8G）
func humanKB(kb int64) string {
	if kb < 1024 {
		return fmt.Sprintf("%dK", kb)
	}
	mb := float64(kb) / 1024
	if mb < 1024 {
		return fmt.Sprintf("%.0fM", mb)
	}
	return fmt.Sprintf("%.1fG", mb/1024)
}

func parseDF(output string) []DiskMount {
	var disks []DiskMount
	scanner := bufio.NewScanner(strings.NewReader(output))
	first := true
	for scanner.Scan() {
		if first {
			first = false
			continue
		}
		fields := strings.Fields(scanner.Text())
		if len(fields) < 5 {
			continue
		}
		size := fields[1]
		avail := fields[3]
		usePct := strings.TrimSuffix(fields[4], "%")
		used, _ := strconv.ParseFloat(usePct, 64)
		disks = append(disks, DiskMount{
			Path:  fields[len(fields)-1],
			Size:  size,
			Avail: avail,
			Used:  used,
		})
	}
	return disks
}

var netDevLineRe = regexp.MustCompile(`^\s*(\w+):\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)\s+`)

func (s *Service) parseNetDevLinux(sessionID, output string) NetworkInfo {
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		match := netDevLineRe.FindStringSubmatch(scanner.Text())
		if match == nil || match[1] == "lo" {
			continue
		}
		rx, _ := strconv.ParseInt(match[2], 10, 64)
		tx, _ := strconv.ParseInt(match[3], 10, 64)

		info := NetworkInfo{Interface: match[1], RxBytes: rx, TxBytes: tx, RxHuman: humanBytes(rx), TxHuman: humanBytes(tx)}

		s.mu.Lock()
		prev := s.prevNet[sessionID]
		now := time.Now()
		s.prevNet[sessionID] = netSample{info: info, at: now}
		s.mu.Unlock()
		if prev.info.Interface == info.Interface && rx >= prev.info.RxBytes && tx >= prev.info.TxBytes {
			elapsed := now.Sub(prev.at).Seconds()
			if elapsed > 0 && elapsed < 60 {
				info.RxRate = float64(rx-prev.info.RxBytes) / elapsed
				info.TxRate = float64(tx-prev.info.TxBytes) / elapsed
			}
		}
		return info
	}
	return NetworkInfo{}
}

func parseNetstatDarwin(output string) NetworkInfo {
	fields := strings.Fields(output)
	if len(fields) < 10 {
		return NetworkInfo{}
	}
	rx, _ := strconv.ParseInt(fields[6], 10, 64)
	tx, _ := strconv.ParseInt(fields[9], 10, 64)
	return NetworkInfo{
		Interface: fields[0],
		RxBytes:   rx, TxBytes: tx,
		RxHuman: humanBytes(rx), TxHuman: humanBytes(tx),
	}
}

func parseDarwinCPU(output string) float64 {
	// CPU usage: 1.2% user, 2.3% sys, 96.5% idle
	re := regexp.MustCompile(`([\d.]+)%\s*idle`)
	match := re.FindStringSubmatch(output)
	if len(match) > 1 {
		idle, _ := strconv.ParseFloat(match[1], 64)
		return 100 - idle
	}
	return 0
}

func parseDarwinMem(output string, snap *Snapshot) {
	scanner := bufio.NewScanner(strings.NewReader(output))
	pageSize := int64(16384)
	var freePages, inactivePages, activePages int64
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "Pages free:") {
			freePages, _ = strconv.ParseInt(strings.Fields(line)[2], 10, 64)
		} else if strings.HasPrefix(line, "Pages inactive:") {
			inactivePages, _ = strconv.ParseInt(strings.Fields(line)[2], 10, 64)
		} else if strings.HasPrefix(line, "Pages active:") {
			activePages, _ = strconv.ParseInt(strings.Fields(line)[2], 10, 64)
		}
	}
	total, _ := parseBytes(snap.MemTotal)
	if total > 0 {
		free := (freePages + inactivePages) * pageSize
		used := total - free
		snap.MemUsed = humanBytes(used)
		snap.MemUsage = float64(used) / float64(total) * 100
	}
	_ = activePages
}

func parseBytes(human string) (int64, error) {
	human = strings.TrimSpace(human)
	re := regexp.MustCompile(`(?i)^([\d.]+)\s*([KMGTP]?)B?$`)
	match := re.FindStringSubmatch(human)
	if len(match) < 2 {
		return 0, fmt.Errorf("无法解析: %s", human)
	}
	value, err := strconv.ParseFloat(match[1], 64)
	if err != nil {
		return 0, err
	}
	multipliers := map[string]float64{"": 1, "K": 1024, "M": 1024 * 1024, "G": 1024 * 1024 * 1024, "T": 1024 * 1024 * 1024 * 1024}
	mul := multipliers[strings.ToUpper(match[2])]
	return int64(value * mul), nil
}

func humanBytes(bytes int64) string {
	if bytes < 0 {
		return "0B"
	}
	units := []string{"B", "K", "M", "G", "T"}
	value := float64(bytes)
	i := 0
	for value >= 1024 && i < len(units)-1 {
		value /= 1024
		i++
	}
	if i == 0 {
		return fmt.Sprintf("%d%s", bytes, units[i])
	}
	return fmt.Sprintf("%.1f%s", value, units[i])
}
