# hiShell

跨平台的 SSH 客户端，体验参考 Xshell / MobaXterm / FinalShell。基于 **Wails v2 + Go + React + TypeScript**，使用系统原生 WebView，不打包浏览器内核，安装包小、内存占用低。

> 当前版本：`v0.1.0-alpha` · 定位：个人开发者自用的完整交互式 SSH 工具

---

## 功能特性

### 连接与终端
- 用户名 / 密码、私钥（含 passphrase）两种认证方式
- 完整交互式 PTY 终端（xterm.js，支持 256 色、UTF-8 / GBK 切换）
- 新建 / 编辑会话时可「测试连接」，只做 TCP + SSH 握手认证，不启动 shell
- 连接状态可视化：空闲 / 连接中 / 已连接 / 错误
- 终端尺寸自适应，ResizeObserver 同步远端 PTY

### 文件管理（SFTP）
- FinalShell 风格左侧目录树（懒加载、自动展开并高亮当前路径）
- 拖拽上传、系统对话框上传文件 / 目录、递归上传下载
- 新建 / 删除目录，传输进度实时显示
- 起始路径 `~` 自动展开为家目录

### 服务器监控
- FinalShell 风格常驻侧栏：系统信息、负载、CPU / 内存 / 交换、网络实时曲线、磁盘挂载点
- 进程 Top（按 RSS 排序，显示真实内存占用与 CPU 百分比）
- 每 2 秒通过 SSH 重新采集并推送，Linux / macOS 命令分支已适配

> 说明：进程 CPU 列采用 `ps -eo pcpu`，即进程**自启动以来的平均值**；常驻进程 RSS 内存也基本稳定，因此这两列短时间内变化不明显，属于指标口径特性，并非数据未刷新。

### 其他
- 多服务器批量命令：并发下发、分服务器展示输出与耗时、快捷命令预设
- 会话分组、收藏、搜索、增删改，配置本地 JSON 持久化
- 凭据优先存系统钥匙串，不可用时降级为 AES-256-GCM 加密文件
- 最左侧会话栏可收起 / 展开；终端与文件管理之间的分界线可上下拖动，比例持久化，双击恢复默认

---

## 技术栈

| 层次 | 技术 |
|------|------|
| 桌面框架 | Wails v2.10.2（系统 WebView：Windows WebView2 / macOS WebKit / Linux WebKitGTK） |
| 后端 | Go 1.23、`golang.org/x/crypto/ssh`、`github.com/pkg/sftp` |
| 前端 | React 18 + TypeScript + Vite 6 |
| 终端 | xterm.js 5 + FitAddon + WebLinksAddon |
| 状态管理 | Zustand |
| 凭据存储 | go-keyring + 本地 AES 降级 |

---

## 项目结构

```
hiShell/
├── main.go                 # Wails 入口，嵌入 frontend/dist
├── app.go                  # 暴露给前端的 Wails 方法（连接/SFTP/监控/批量）
├── wails.json              # Wails 构建配置
├── internal/
│   ├── sshx/               # SSH 连接管理、PTY、测试连接、Exec
│   ├── sftp/               # SFTP 列目录 / 上传 / 下载 / 递归目录
│   ├── monitor/            # 系统指标采集（Linux / macOS 分支）
│   ├── batch/              # 多服务器并发命令
│   └── store/              # 会话 JSON 存储、凭据加密与钥匙串
├── frontend/
│   ├── src/
│   │   ├── App.tsx         # 三区常驻布局 + 可拖动分界线
│   │   ├── components/     # 终端 / SFTP / 目录树 / 监控 / 批量 / 会话编辑
│   │   ├── hooks/          # Wails API 封装、全局 store、事件订阅
│   │   └── types/          # 前后端共享类型
│   └── wailsjs/            # Wails 自动生成的绑定（无需手动修改）
├── build/                  # 图标与平台打包资源（bin/ 为构建输出，已忽略）
└── FEATURES.md             # 完整功能清单、开发记录与环境坑
```

---

## 环境要求

| 依赖 | 版本要求 | 备注 |
|------|----------|------|
| Go | ≥ 1.23 | Wails v2.10 不认识旧版 toolchain 指令 |
| Node.js | ≥ 20 | 本机使用 Node 22 |
| pnpm | 已安装 | 需允许 esbuild 构建脚本（见下方） |
| Wails CLI | v2.10.2 | `go install github.com/wailsapp/wails/v2/cmd/wails@v2.10.2` |
| WebView2 Runtime | Windows 需预装 | Win11 一般自带 |

---

## 快速开始

### 1. 克隆与准备

```bash
git clone <your-repo-url> hiShell
cd hiShell
```

前端依赖安装（已通过 `pnpm-workspace.yaml` 的 `allowBuilds.esbuild: true` 放行构建脚本；若换环境仍被拦截，执行 `pnpm approve-builds --all`）：

```bash
cd frontend && pnpm install && cd ..
```

### 2. 生产构建

```bash
wails build -platform windows/amd64
```

产物：`build/bin/hiShell.exe`

### 3. 开发模式（热更新）

```bash
wails dev
```

### 4. 本机（Windows）Go 工具链特别说明

系统自带的 Go 1.20.4 过旧，需改用缓存中的 Go 1.23.4 工具链；每次新开终端先执行：

```bash
export PATH="/c/Users/hongw/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.23.4.windows-amd64/bin:/c/Users/hongw/go/bin:$PATH"
export GOTOOLCHAIN=local
export GOPROXY=https://goproxy.cn,direct
```

---

## 使用说明

1. 点击左侧 `＋` 新建会话，填写名称、主机、端口、用户名，选择密码或私钥认证。
2. 可先点「测试连接」验证连通性，再双击会话连接。
3. 连接成功后自动呈现三区：**左侧监控 / 右上终端 / 右下文件管理**。
4. 拖拽分界线可调整终端与文件区域高度；双击分界线恢复 50/50。
5. 文件管理左侧为远程目录树，右侧可拖拽上传，选中文件后可下载。
6. 左下角「⚡ 批量命令」可向多台已连接服务器同时下发指令。

---

## 数据存储与安全

- 会话配置：`os.UserConfigDir()/hiShell/sessions.json`
  - Windows：`%AppData%\hiShell\`
  - macOS：`~/Library/Application Support/hiShell/`
  - Linux：`~/.config/hiShell/`
- 凭据：优先系统钥匙串；不可用时降级为 `cred_<id>.enc`（AES-256-GCM），主密钥 `.masterkey`
- 目录权限 `0700`、文件权限 `0600`

> **安全提示**：当前主机密钥校验为「首次连接自动信任」（`InsecureIgnoreHostKey`），尚未实现 `known_hosts`，存在中间人攻击风险。生产或公网环境使用前建议补充主机密钥校验。

---

## 已知限制

- rz / sz（ZMODEM）未实现：xterm.js 中需拦截 PTY 字节流并实现完整 ZMODEM 状态机，工作量大且稳定性风险高，已用 SFTP 拖拽替代。
- `known_hosts` 主机密钥校验待实现。
- SFTP 重命名：后端已支持，前端 UI 待补。
- 断点续传、会话导入导出、端口转发等高级特性暂未实现。
- 会话栏与监控栏宽度目前固定，仅终端 / 文件区域高度可调。

### 跨平台构建说明

源码本身跨平台，但 **Wails v2 依赖 CGO 与平台原生 WebView，不能在当前 Windows 机器一次编出三平台包**：

- **Windows**：已验证，直接 `wails build -platform windows/amd64`。
- **Linux**：需在 Linux 环境（如 WSL 安装 `libgtk-3-dev`、`libwebkit2gtk-4.1-dev` + Go 1.23 + Node）中执行 `wails build -platform linux/amd64`；运行机器需安装 WebKitGTK。
- **macOS**：Wails v2 官方不支持从 Windows / Linux 交叉编译，需 Mac 或 CI macOS runner（Xcode CLT）执行 `wails build -platform darwin/arm64`（或 `darwin/universal`），产物为 `.app`，对外分发需签名与公证。

---

## 相关文档

- `FEATURES.md`：完整功能清单、开发日志、环境踩坑记录与构建命令

## 许可证

MIT（见 `wails.json` 中的 license 配置）
