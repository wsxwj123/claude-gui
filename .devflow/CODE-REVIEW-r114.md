# CODE-REVIEW r114 —— 代码质量抽查(dev-flow 05 Step5-2,内置 code-review 技能,high 档)

审查范围:feature/r114-workflow-ui(基线 master 17f1b400,26 commit)。技能流程:10 角度候选约 36 条 → 去重 26 → 逐条验证 22 CONFIRMED / 4 PLAUSIBLE / 0 REFUTED → 补漏 5 → 按严重度截 15 条。下面每条附主会话核实结论与处置。

| # | 位置 | 问题(人话) | 主会话核实 | 处置 |
|---|---|---|---|---|
| 1 | WorkflowCard.jsx:219 | 点开内层助手时只写 text/thinking/toolCalls,而对话视图只渲染 blocks → 助手对话永远空白 | 成立(SubagentView 读 blocks) | **本轮修**(F1) |
| 2 | App.jsx:809 | 刷新页面/重开后正在跑的工作流没有 store 条目,后续进度全丢,卡片停在"状态未知" | 成立(条目只由 task_started 建) | **下一轮**:需要服务端在进度事件里带 tool_use_id 或客户端从存活任务表补建条目(契约级改动) |
| 3 | App.jsx:810 | 非权威终态(settledBy gone/level)把进度冻结且卡片显示绿色"已完成" | 部分成立:level 路径不会触发(CLI 存活任务表含 local_workflow,spike 实证);"点停止但任务已不在表里"的 gone 路径成立 | **本轮修显示**(F9:gone/level 显示"状态未知",随后由快照补真实终态);B1-9 丢弃规则不动 |
| 4 | WorkflowCard.jsx:132 | 快照请求失败后本次挂载永不重试(askedRef 不复位) | 成立 | **本轮修**(F2) |
| 5 | WorkflowCard.jsx:192 | 内层助手水合"一生一次",状态/转写永久冻结 | 成立 | **本轮修**(F3) |
| 6 | workflowView.js:191 | 快照缓存只按 runId 键,续跑覆写同名快照后拿到旧数据 | 成立(需同页内续跑) | **下一轮**(缓存键加 taskId,需契约 C2.6 调整) |
| 7 | WorkflowCard.jsx:179 | 停止请求网络失败时误提示"回合已结束" | 成立 | **本轮修**(F4:只在 noOwner 时弹) |
| 8 | WorkflowCard.jsx:237 | 阶段默认展开只在首次见到时算一次 → 后续阶段开跑时不展开 | 成立(全部阶段在首份表里预告) | **本轮修**(F5:只许折→展,不许展→折,用户操作优先) |
| 9 | WorkflowCard.jsx:72 | 耗时用整体 running 门,缓存命中等无 durationMs 的终态行在运行期显示增长耗时 | 成立(真实快照有 cached 行无 durationMs) | **本轮修**(F6:按行自身显示态) |
| 10 | AgentMonitorPanel.jsx:858 | 覆盖集从未过滤/未截断的全量算,卡片被挤出桶或窗格收起后整个工作流在面板消失 | 成立 | **本轮修**(F7) |
| 11 | chat.js:1727 | 进度心跳不续命,30 分钟无任务变化 → 空闲回收关流 → 长工作流被杀、卡片永远转圈 | 成立(task_progress 不刷新 createdAt;仅 task_updated/level 刷新) | **本轮修**(S1) |
| 12 | AgentMonitorPanel.jsx:369 | 面板改渲紧凑卡后丢了描述/后台会话徽标/跳回会话控件/总耗时 | 成立 | **下一轮**(面板紧凑卡补信息) |
| 13 | check-r114-locks.mjs:48 | 三条"逐字节不动"锁以 HEAD 为基线,干净树下自比 | 成立(主会话已按 17f1b400 人工核实) | **下一轮**(改用 merge-base 基线,需测试代理) |
| 14 | session-reader.js:30 | tool_result 缺 content 时前置判据抛 TypeError,整个会话历史 500 | PLAUSIBLE(本机 96859 个块零缺 content) | **本轮修**(S2:一行守卫) |
| 15 | WorkflowCard.jsx:81 | 面板里助手行看着可点却无反应;键盘 Enter/Space 打不开 | 成立 | **本轮修**(F8) |

被截掉的低优先级项(记录,不本轮):resultTruncated 无人读;正文兜底路径含空格截断;workflow-progress-bg 无会话过滤群发;TurnBubble 内联箭头使 memo 失效;fmtTokens 无 M 档;fallbackAgents 序 5 无人传;out.phases 无消费者;助手 error 字段不渲染;「收起过程」对仅含 Workflow 的回合无效;**tests/fixtures/r114 两个夹具含本机家目录路径与原始提示词**(公开仓个人信息面,下一轮脱敏须同步改锁定测试)。
