# 平台兼容性审查 — 0.2.377(v0.2.376..HEAD,r114 + r115 合并后,平台:Windows / macOS 两者)

范围:17 个非测试文件(已排除 `tests/`、`.devflow/`、`CHANGELOG.md`)。前端 11 个、服务端 4 个、`package.json` / `package-lock.json`。
基线:`.devflow/WINDOWS-REVIEW-0.2.376.md` 的"已核对无问题"不重复报。
扫描:`scan.mjs --base v0.2.376 --platform all` → **无命中**(命中为零仍逐类人工核对,见 ③)。

## ① 裁决:可发(致命 0 / 必修 0 / 建议 2)

本轮没有触及任何"经 cmd.exe 起进程"的拼接、没有新增 spawn/execFile 调用点、没有改安装器与签名链路。新增的服务端代码只读文件,路径拼接与解析两侧分隔符都覆盖且有测试注入 Windows 分支;新增的前端代码不含裸 `vw/vh`、不用 `window.confirm/alert`、横向行都带换行与最小宽度。唯一需要 Windows 真机确认的是"界面缩放抵消"在 WebView2 上的行为(mac WKWebView 已实测通过)。

## ② 问题清单

### 建议-1 [Both] 界面缩放抵消只在 WebKit 上实测过,WebView2 未取证(D-4)
- 位置:`client/src/genui/host/host-zoom.ts:26`(`getComputedStyle(document.documentElement).zoom`)
- 什么输入出什么错:若某引擎的计算样式不返回 `zoom`,`parseFloat` 得 NaN → 回落 1 → 不做抵消 → 行为与改前一致(图仍可能被裁),**不会新增崩溃或错乱**。若某引擎的 `zoom` 语义不是"沿子树相乘",则子元素写倒数不能抵消,同样退回改前行为。
- 判据依据:checkpoints.md D-4「dev 预览复现不了的行为不许拿 Chromium 行为推根因」——反过来同样成立:mac 上验的不能直接类推到 WebView2。
- 需要谁改:无需改代码;按 ④ 的 Windows 真机项取证。失败也只是"没修好",不是回归。

### 建议-2 [Both] 历史工作流的正文兜底解析对含空格的路径会截断(W-B10 / G-8)
- 位置:`server/utils/workflow-progress.js:129` 一带的正文解析(`Transcript dir:` 后按非空白截取)
- 什么输入出什么错:项目路径含空格(Windows 上 `C:\Users\某某\My Documents\...` 常见)时,只对**没有结构化字段的老会话**走这条兜底,截断后解析不出三元组 → 该卡片降级为"此运行未提供进度信息",不崩不报错。新会话走结构化字段,不受影响。
- 判据依据:checkpoints.md 的"带空格路径"条。
- 需要谁改:下一轮改 `parseWorkflowLaunchText` 的截取判据(改成按行尾或已知后缀锚定),验收:路径含空格的老会话正文也能解析出 runId/taskId。

## ③ 已核对无问题

**A 进程与命令行**
- 本轮 diff 中 `spawn` / `execFile` / `pty.spawn` / `cmd.exe` 相关行数为 **0**(`git diff v0.2.376..HEAD -- server/ client/` 过滤后无输出),既有调用点一行未动。
- 引号往返回归:`crt-roundtrip.mjs server/utils/win-cmd.js` → **15/15**(未改该模块,作回归跑)。
- r113 的 `--bg` 长度/换行守卫、`winCmdSpawnSpec` 全部未触及。

**B 路径与文件系统**
- `server/utils/workflow-progress.js`:`home` 与 `join` 全部参数注入(文件头第 2 行明写),测试用 `path.win32.join` 覆盖 Windows 分支;目录切分 `split(/[/\\]+/)`、尾部清理 `replace(/[/\\]+$/,'')`、runId 正则 `[/\\]workflows[/\\]` —— 两种分隔符都认。
- 运行号白名单拒绝 `..`、`/`、`\`、大写、超长(验收测试 A1.1-3 逐个断言)。
- 新端点 `GET /api/workflow-run`:四段路径逐段 `lstat` 查符号链接,且**符号链接门早于 ENOENT**(悬空软链 lstat 不报错但 readFile 会跟随);错误响应只含 `error` 一个键,不回显 home 路径与项目哈希。
- 未新增 `/tmp` 硬编码、未新增按 `/` 切文件名、未新增 `HOME` 读点。

**C 原生模块与运行时**
- SDK 升级 0.3.191 → 0.3.261:锁文件里 **8 个平台包齐全**,含 `win32-x64` 与 `win32-arm64`(均 `optional: true`,os/cpu 字段正确)—— Windows CI 的 `npm ci` 能拿到自己的 CLI 二进制,不会因为我在 mac 上安装而只锁了 darwin 包。
- SDK `engines: node >= 18.0.0`,低于应用地板(`check-r57-node-floor` 绿)。
- `scripts/postinstall.cjs` 本轮未改动。
- 未新增原生模块、未新增顶层 import 的可选依赖。

**D 渲染引擎**
- 本轮新增前端代码中 `100vw` / `100vh` / `window.confirm` / `window.alert` / `navigator.platform` 命中数为 **0**。
- 工作流卡片与手机版新建会话页的横向行:`flex-wrap` / `min-w-0` / `truncate` / `shrink-0` 齐备(卡片文件内 17 处,App.jsx 247 处)。手机版实测 320/360/375/390/430 五档零溢出零重叠;卡片紧凑态在 280px 窄栏核对过。
- 弹窗一律走项目自己的 `confirmDialog`(Tauri 禁用原生 confirm/alert 的既有红线)。
- 图示文字被裁的根因**不是**拿 Chromium 行为推的:在 WebKit(与桌面 app 同内核)与干净空白页做了差分实验,并直接量到 `rect.width` 240 vs 200 的等式不成立(证据 `.devflow/GENUI-ZOOM-EVIDENCE-r115.md`)。

**E 分发 / 签名 / 安装 / 网络**
- 未改安装器、签名、更新链路、`bundle.targets`、CI 工作流。
- 未新增网络请求;新端点是本机只读。

**G 预警**
- 未新增子进程输出解析(不涉 cp936);未新增 `.bat/.ps1`;未新增拼进正则/WQL/`sh -c` 的用户输入。
- 新增的用户 JSON 读点(工作流快照)有大小上限(32MB → 413)、解析失败归 422、0 字节归 422,失败均有明确错误码。BOM 情形:`JSON.parse` 遇 BOM 会抛 → 走 422 分支,不崩(与既有 JSON 读点同口径)。

## ④ 必须真机验证

**Windows**
1. 装 0.2.377 后打开一个含工作流的历史会话。看:卡片显示阶段与助手、状态为终态。**过**:不出现"状态未知"且无转圈。
2. 设置里把界面缩放调到 120%,让模型画一张 genui 流程图(节点标签写长句)。看:节点文字是否折行显示完整。**过**:无文字被节点框裁掉。若被裁,说明 WebView2 的 `zoom` 语义与 WebKit 不同(建议-1),记录后按新证据改。
3. 项目路径放在含空格的目录下(如 `C:\Users\x\My Docs\proj`),跑一次工作流再回看。**过**:卡片能显示阶段与助手(走结构化字段,不依赖正文兜底)。
4. 主对话按停止:后台还在跑的子代理与工作流不被连带杀掉。**过**:15 秒后它们仍在运行。

**macOS**
1. 本机重建版启动后 `/api/health` 报 0.2.377,签名 `codesign --verify --deep --strict` 通过。
2. 界面缩放 120% 下画 genui 流程图,文字不被裁(已在 WebKit 沙箱实测 0/12,装机后复核一次)。

## ⑤ 新增排查点

无。本轮未踩到新的平台坑;建议-1 属既有 D-4 的应用,建议-2 属既有"带空格路径"条,均不需要新 ID。
