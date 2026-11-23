# hiShell 功能清单与开发记录

> 跨平台 SSH 客户端 · Wails v2 + Go + React + TypeScript + xterm.js
> 目标平台：Windows / macOS / Linux
> 定位：个人开发者自用，完整交互式 PTY 终端

## 一、需求来源

- 核心体验参考：Xshell、MobaXterm、FinalShell
- 远程目标：Linux / macOS 服务器
- 认证方式：用户名密码、私钥
- 额外功能：目录文件浏览 + 拖拽上传下载、多服务器批量命令、FinalShell 风格系统监控侧栏
- 补充确认：rz/sz（ZMODEM）传输、凭据系统钥匙串加密存储

## 二、技术选型决策

| 项目 | 选择 | 理由 |
|------|------|------|
| 桌面框架 | Wails v2 | 系统 WebView，不用 Electron；包体小、内存低；Go 已就绪，免装 Rust/MSVC |
| 后端 | Go 1.20+ | `golang.org/x/crypto/ssh` 是 SSH 事实标准库，PTY/SFTP 全支持 |
| 前端 | React + TypeScript + Vite | 生态成熟，组件化便于复杂 UI |
| 终端仿真 | xterm.js | VS Code 同款，支持 256 色、Unicode、鼠标事件 |
| SFTP | github.com/pkg/sftp | 与 x/crypto/ssh 无缝集成 |
| 凭据存储 | go-keyring + 本地 AES 降级 | 优先系统钥匙串，无钥匙串环境降级为加密文件 |

### 备选方案记录

- **Tauri + Rust**：性能/包体与 Wails 接近，但本机 Rust/MSVC 未安装，环境准备重，SSH 生态不如 Go 成熟 → 已放弃
- **Electron**：内存占用高（空应用 150MB+），不符合「硬件配置低」要求 → 已放弃

## 三、功能状态总览

图例：✅ 已实现（代码完成并编译通过） · ⬜ 待实现 · ❌ 不可行/放弃

### 3.1 连接管理 + 终端（MVP 核心）✅

| 功能 | 状态 | 说明 |
|------|------|------|
| 会话配置（名称/主机/端口/用户/分组） | ✅ | 本地 JSON 持久化到用户配置目录 |
| 密码认证 | ✅ | 凭据存系统钥匙串 |
| 私钥认证（含 passphrase） | ✅ | 支持 OpenSSH/PEM 格式，文件对话框选择 |
| 完整交互式 PTY 终端 | ✅ | xterm.js + SSH shell session，xterm-256color |
| 三区常驻布局（FinalShell 风格） | ✅ | 左侧监控栏 + 右上终端 + 右下文件管理，同时显示，双击会话切换连接目标 |
| 终端/文件区域高度可调 | ✅ | 两者之间分界线可上下拖动（15%~85%），比例保存到 localStorage；双击恢复 50/50，方向键微调；终端随尺寸自动 refit |
| 终端自适应 resize | ✅ | ResizeObserver 同步窗口尺寸到远端 PTY |
| 断线检测与状态提示 | ✅ | 状态圆点（灰/黄/绿/红）+ 退出事件提示 |
| 连接超时/认证失败提示 | ✅ | 15 秒超时，明确错误信息 |
| 终端编码切换（UTF-8/GBK） | ✅ | 会话级配置，GBK 解码回退处理 |
| 会话标签颜色 | ✅ | 自定义标签圆点颜色 |
| 测试连接按钮 | ✅ | 新建/编辑会话界面可先验证连通性，仅握手认证不启动 shell，显示耗时与服务端版本 |
| known_hosts 主机密钥校验 | ⬜ | 当前为首次连接自动信任（InsecureIgnoreHostKey） |

### 3.2 会话管理 ✅

| 功能 | 状态 | 说明 |
|------|------|------|
| 会话树（分组聚合、收藏标记） | ✅ | 按 group 字段分组，★ 收藏标记 |
| 会话搜索 | ✅ | 按名称/主机实时过滤 |
| 会话增删改 | ✅ | 含删除二次确认 |
| 会话导入/导出 | ⬜ | 用户后续决定何时开发 |

### 3.3 SFTP 文件管理 ✅

| 功能 | 状态 | 说明 |
|------|------|------|
| 远程目录浏览 | ✅ | 列目录、上级、路径跳转、双击进入 |
| 左侧目录树导航 | ✅ | FinalShell 风格：/ 根目录懒加载展开，点击目录切换，自动展开到当前路径并高亮 |
| 拖拽上传文件 | ✅ | 拖入远程面板（依赖浏览器文件路径支持）|
| 上传文件/目录（对话框） | ✅ | 系统文件/目录对话框，可靠路径获取 |
| 下载文件/目录 | ✅ | 文件/目录对话框选择本地保存位置 |
| 新建/删除/重命名目录 | ✅ | 新建/删除已实现；重命名后端已实现，前端 UI 待补 |
| 传输进度显示 | ✅ | 事件推送实时进度条 |
| 目录递归上传下载 | ✅ | Walk 递归实现 |
| 断点续传 | ⬜ | 后续增强 |

### 3.4 服务器监控侧栏（FinalShell 风格）✅

| 功能 | 状态 | 说明 |
|------|------|------|
| 运行时间 / 负载（load average） | ✅ | 定时采集（2 秒） |
| CPU / 内存 / 交换使用率 | ✅ | 进度条展示 |
| 进程列表（内存/CPU/命令） | ✅ | ps -eo rss,pcpu,comm 解析，内存显示真实占用（如 96M）、CPU 显示百分比，取前 8；已修复原先列错位导致的「内存显示成 PID 百分比」问题 |
| 网络实时曲线（上下行） | ✅ | canvas 绘制，红涨绿跌配色 |
| 磁盘挂载点表格（路径/可用/大小） | ✅ | df 解析，带使用率条 |
| Linux 命令适配 | ✅ | top/free/df/proc/net/dev |
| macOS 命令适配 | ✅ | sysctl/vm_stat/df/netstat |

### 3.5 多服务器批量命令 ✅

| 功能 | 状态 | 说明 |
|------|------|------|
| 勾选多个已连接会话 | ✅ | 全选/清空，仅显示已连接 |
| 一键并发下发命令 | ✅ | Go goroutine 并发 exec，可设超时 |
| 分服务器展示输出与状态 | ✅ | 每台一栏，成功/失败色标 + 耗时 |
| 快捷命令预设 | ✅ | 系统信息/资源/磁盘/内存Top/端口 |

### 3.6 文件传输（ZMODEM）

| 功能 | 状态 | 说明 |
|------|------|------|
| rz 上传（本地 → 服务器） | ❌ MVP 暂不可行 | 见下方可行性评估 |
| sz 下载（服务器 → 本地） | ❌ MVP 暂不可行 | 见下方可行性评估 |
| SFTP 拖拽替代方案 | ✅ | 作为 rz/sz 的主要替代，体验更好 |

> **可行性评估（2026-11-20）**：rz/sz 基于 ZMODEM 协议，需要拦截终端字节流中的协议握手序列
> （如 `rz` 等待时服务端发来的 `**B0000...`），并接管后续二进制传输。在 xterm.js 浏览器终端中，
> 这些控制字符会混入正常终端输出，需要实现完整的 ZMODEM 状态机 + 二进制流旁路，
> 且要与 SSH PTY 流精确同步。该工作量接近独立子项目，且稳定性风险高。
> **决策**：第一版不实现，以 SFTP 拖拽上传/下载作为功能等价替代。
> 若后续确需 rz/sz，建议方案：在 Go 后端为每个连接注入 ZMODEM 协处理器，
> 检测到触发序列后暂停 PTY 输出转发，切换到二进制模式——可作为 v0.3 独立里程碑评估。

### 3.7 其他常见功能（用户决定后续再定）

| 功能 | 状态 | 说明 |
|------|------|------|
| 端口转发/隧道 | ⬜ | 本地/远程转发 |
| 会话重命名（SFTP 重命名 UI） | ⬜ | 后端已就绪，前端补 UI |
| 分屏视图 | ⬜ | 同窗口多终端并排 |
| 快捷键自定义 | ⬜ | 复制/粘贴/新建标签等 |
| 宏/脚本录制 | ⬜ | 命令序列回放 |
| 串口连接 | ⬜ | MobaXterm 特性 |
| RDP/VNC 集成 | ⬜ | 远程桌面类功能 |

## 四、开发环境记录

- 系统自带 Go 1.20.4（过旧，不认识 toolchain 指令，无法编译 Wails v2.10）
- 通过 `go install golang.org/toolchain@v0.0.1-go1.23.4.windows-amd64` 从 goproxy.cn 拉取 Go 1.23.4 工具链到模块缓存
  - 路径：`C:\Users\hongw\go\pkg\mod\golang.org\toolchain@v0.0.1-go1.23.4.windows-amd64\bin\go.exe`
  - 构建时用该 go.exe 加入 PATH，并设 `GOTOOLCHAIN=local`
- WebView2 Runtime 158 已就绪（Wails Windows 端依赖）
- pnpm 12 需通过 `pnpm approve-builds --all` 批准 esbuild 构建脚本，配置写入 pnpm-workspace.yaml
- 前端：Node 22 + pnpm，构建产物 dist/（471KB / gzip 131KB），TypeScript 类型检查通过

## 五、运行与打包命令

在 `C:\workspace\github\hiShell` 目录：

```bash
# 设置 Go 1.23 工具链环境（每次新终端需执行）
export PATH="/c/Users/hongw/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.23.4.windows-amd64/bin:/c/Users/hongw/go/bin:$PATH"
export GOTOOLCHAIN=local
export GOPROXY=https://goproxy.cn,direct

# 开发模式（热更新）
wails dev

# 生产打包（Windows）
wails build -platform windows/amd64

# 交叉编译 macOS / Linux（需在对应平台或配置交叉编译工具链）
wails build -platform darwin/amd64
wails build -platform linux/amd64
```

产物位置：`build/bin/hiShell.exe`

## 六、常见坑

1. **Go 版本**：系统 Go 1.20 太旧，必须用缓存的 1.23.4 工具链，否则报 `invalid go version` / `unknown directive: toolchain`
2. **pnpm esbuild**：首次需 `pnpm approve-builds --all`，否则 wails build 在安装前端依赖阶段退出
3. **凭据存储**：系统钥匙串不可用时（如某些 Linux 无 Secret Service），自动降级为 AES-256-GCM 加密文件（密钥存 `.masterkey`）
4. **主机密钥**：当前首次连接自动信任，安全性较低；生产使用建议加 known_hosts 校验
5. **拖拽上传**：依赖浏览器暴露的 `File.path`，某些 WebView 环境可能拿不到，此时请用「上传文件」对话框
6. **macOS 监控**：`top -l 2` 需采集两次才有 CPU 数据，首次快照 CPU 可能为 0

## 七、开发日志

- 2026-11-20：确认需求与技术选型；创建工作目录与任务清单；搭建 Wails+Go+React 骨架；
  完成 Go 后端六大模块（SSH/存储/SFTP/监控/批量/桥接）与前端全部组件；
  解决 Go 版本过旧问题（用模块代理拉取 Go 1.23 工具链）；前后端编译与类型检查通过；
  评估 rz/sz 可行性并决策用 SFTP 替代；完成首次桌面应用打包验证。
- 2026-11-20（续）：新增「测试连接」按钮；弹窗改为仅 ESC/关闭按钮关闭（点外部不关）。
- 2026-11-20（续）：修复「连上后三区空白」——根因是 CSS flex 高度塌陷（app-shell 为 column 但 sidebar 用 calc(100%-24px) 横向写法，把 main-area 挤成 0 高度），非终端组件问题；经实机截图验证修复。
- 2026-11-20（续）：按 FinalShell 截图重构为三区常驻布局（左侧监控栏 + 右上终端 + 右下文件），引入 activeSessionId 驱动，三视图加 key 保证切换会话重连；修复 SFTP 起始路径 `~` 未展开导致的 No such file（Go 侧 expandTilde）。
- 2026-11-20（追加）：新建/编辑会话界面新增「测试连接」按钮，仅做 SSH 握手认证、不启动 shell，
  支持已保存凭据占位符回退，展示连接耗时与服务端 SSH 版本；重新生成绑定、类型检查与打包通过。
- 2026-11-20（追加）：三项体验优化——①最左侧会话栏支持收起/展开（header « 收起，窄栏 » 展开）；
  ②修复进程监控内存列显示成 PID 百分比的 bug（根因：parseTopLinux 跳过表头后才找 %MEM/%CPU 列索引，
  数据行中不存在这些标记，回退取 fields[0]/[1]/[2] 即 PID/USER/PR；改用 ps -eo rss,pcpu,comm 固定列，
  内存按 humanKB 显示真实占用、单元测试验证）；③「正在连接…」从终端文字改为覆盖层，连上即消失，不再残留。
- 2026-11-20（追加）：SFTP 文件管理区按 FinalShell 增加左侧目录树导航（frontend/src/components/DirTree.tsx）：
  从 / 根目录懒加载子目录，点击切换路径，自动展开并高亮当前路径；SftpView 布局改为 左树 + 右(拖拽区/文件表)；
  类型检查与打包通过。
