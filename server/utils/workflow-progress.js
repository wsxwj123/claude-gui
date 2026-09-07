// r114:Workflow(工作流)进度表与磁盘快照的纯函数层。全部无副作用、无 fs 调用,
// 平台相关的东西(home / join)一律参数注入 —— mac 上跑 path.win32 就能覆盖 Windows 分支。
//
// 两个数据源,同一种投影后的形状:
//   实时 = 父流 system/task_progress 的 workflow_progress[](CLI 自己算好的全量阶段+助手表);
//   历史 = <sid>/workflows/<runId>.json 快照里的 workflowProgress(终态权威)。
// 投影 = 键白名单。既是省流量(73 助手档一条 45–125KB、每 ~10s 一份),也是别把
// promptPreview(写给助手的整段提示词原文)往前端和日志里搬。
import { homedir } from 'os';
import { join as pathJoin } from 'path';

// runId 闸门:连 `.` `/` `\` 都不允许 —— 快照文件名由它拼出来,放宽一格就是路径穿透。
// 失败方向 = 拒绝(读不到快照 → 界面降级),不会穿透。
export const WF_RUN_ID = /^wf_[A-Za-z0-9-]{4,64}$/;
// projectHash / sid 闸门:排除纯点名(`.` `..`)防上跳。routes/agents.js 的
// /workflow-agents 复用同一个对象(那边 re-export),不许各写一份正则(会漂)。
export const WF_SAFE_ID = /^(?!\.+$)[A-Za-z0-9._-]+$/;
// 快照读取上限。1000 助手(官方上限)的快照实测量级 ≈800KB,32MB 是"这文件不对劲"的判据,
// 不是正常容量线;超限直接 413,绝不先读进内存再判(单进程后端,读 33MB = 全局卡顿)。
export const WF_MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;

// 进度条目的键白名单。缺失的键一律不补默认值(补了前端会把"未知"当成有值)。
const PHASE_KEYS = ['type', 'index', 'title'];
const AGENT_KEYS = ['type', 'index', 'label', 'phaseIndex', 'phaseTitle', 'agentId', 'agentType',
  'model', 'state', 'error', 'skipped', 'blocked', 'cached', 'attempt', 'lastAttemptReason',
  'queuedAt', 'startedAt', 'durationMs', 'tokens', 'toolCalls', 'lastToolName', 'lastToolSummary',
  'resultPreview'];
// Map 而非字面量对象:entries 来自模型/CLI 产出的数据,`type:'constructor'` 这类键
// 在普通对象上会命中原型链拿到非数组的东西,随后 for..of 直接抛,把整条消息流搞断。
const KEYS_BY_TYPE = new Map([['workflow_phase', PHASE_KEYS], ['workflow_agent', AGENT_KEYS]]);

/**
 * 进度表整表投影。
 * @param {unknown} entries 原始 workflow_progress
 * @returns {Array|null} 非数组入参一律 null(调用方据此"不改写消息");数组 → 新数组。
 *   null 与 [] 是两件事:缺表 ≠ 空表,后者会把前端已有的进度整表清空。
 *   顺序原样保留(排序/分组是前端的事),不去重、不截断(截断 = 1000 助手的工作流少显示助手)。
 */
export function projectWorkflowProgress(entries) {
  if (!Array.isArray(entries)) return null;
  const out = [];
  for (const e of entries) {
    const keys = e && typeof e === 'object' ? KEYS_BY_TYPE.get(e.type) : null;
    if (!keys) continue;                 // 脏条目(null/字符串/未知 type)整条丢弃,不抛
    const o = {};
    for (const k of keys) {
      const v = e[k];
      if (v !== undefined) o[k] = v;     // undefined 的键整个不出现,不写 key:undefined
    }
    out.push(o);
  }
  return out;
}

/**
 * 快照路径拼装 + 三参闸门。任一参数不过校验 → null,**不拼路径**
 * (拼出来再判 = 把穿透路径交给了调用方)。
 * @returns {{path:string, root:string, segments:string[]}|null}
 *   segments = 需要逐段 lstat 查符号链接的四条路径(少一段,那一段换成软链就穿透了)。
 */
export function workflowSnapshotPath(projectHash, sid, runId, { home = homedir(), join = pathJoin } = {}) {
  if (typeof projectHash !== 'string' || !WF_SAFE_ID.test(projectHash)) return null;
  if (typeof sid !== 'string' || !WF_SAFE_ID.test(sid)) return null;
  if (typeof runId !== 'string' || !WF_RUN_ID.test(runId)) return null;
  const projects = join(home, '.claude', 'projects');
  const root = join(projects, projectHash, sid, 'workflows');
  const path = join(root, runId + '.json');
  if (!path.startsWith(root)) return null;   // join 归一化后仍越界 = 不该发生,发生了就拒
  return {
    path,
    root,
    segments: [join(projects, projectHash), join(projects, projectHash, sid), root, path],
  };
}

// 值为 null/undefined 的可选键整个不出现;0 / '' / false 是有效值,照常写入。
function put(out, key, value) {
  if (value !== undefined && value !== null) out[key] = value;
}

/**
 * 磁盘快照投影(历史回看的数据来源)。
 * @param {unknown} raw 快照 JSON.parse 后的对象
 * @returns {object|null} 非对象(含数组)→ null。
 *   `script`(脚本源码,内嵌写给助手的 prompt)/`logs`/`scriptPath`/`defaultModel`/`args`
 *   **绝不透传**:体积大、含本机绝对路径,且实时侧本来就看不到同类数据。
 */
export function projectWorkflowSnapshot(raw, { maxResultChars = 20000, maxErrorChars = 2000 } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  put(out, 'runId', raw.runId);
  put(out, 'taskId', raw.taskId);
  put(out, 'workflowName', raw.workflowName);
  put(out, 'status', raw.status);          // completed|failed|killed;未知值原样透传
  put(out, 'summary', raw.summary);
  if (raw.error !== undefined && raw.error !== null) {
    // error 是异常堆栈(实证多行、含 /$bunfs/root/…),截断即可,不加单独的 truncated 标志。
    const err = typeof raw.error === 'string' ? raw.error : String(raw.error);
    out.error = err.length > maxErrorChars ? err.slice(0, maxErrorChars) + '…' : err;
  }
  put(out, 'startTime', raw.startTime);
  put(out, 'durationMs', raw.durationMs);
  put(out, 'agentCount', raw.agentCount);
  put(out, 'totalTokens', raw.totalTokens);
  put(out, 'totalToolCalls', raw.totalToolCalls);
  // phases 只用于"M 个阶段"的计数与标题;分组一律走 progress 里的 workflow_phase 条目
  // (实证快照的 phases 没有 index)。slice 一份,别把响应对象与入参别在一起。
  out.phases = Array.isArray(raw.phases) ? raw.phases.slice() : [];
  out.progress = projectWorkflowProgress(raw.workflowProgress) ?? [];
  let result = null;
  if (raw.result !== undefined && raw.result !== null) {
    result = typeof raw.result === 'string' ? raw.result : JSON.stringify(raw.result);
    if (result === undefined) result = null;   // 不可序列化(函数等)当没有
  }
  out.resultTruncated = typeof result === 'string' && result.length > maxResultChars;
  out.result = out.resultTruncated ? result.slice(0, maxResultChars) : result;
  out.source = 'snapshot';
  return out;
}

/**
 * 从 toolUseResult.transcriptDir 反推 {projectHash, sid, runId}。
 * 形如 `…/.claude/projects/<hash>/<sid>/subagents/workflows/<runId>`(Windows 同形反斜杠)。
 * 取**最后一个** `projects` 段(路径里可能出现两次),形状不符一律 null,**不抛**
 * (抛了会把整条历史消息读挂)。
 */
export function parseWorkflowTranscriptDir(dir) {
  if (typeof dir !== 'string' || !dir) return null;
  const parts = dir.replace(/[/\\]+$/, '').split(/[/\\]+/);
  const p = parts.lastIndexOf('projects');
  if (p < 0 || parts.length !== p + 6) return null;
  const [projectHash, sid, subagents, workflows, runId] = parts.slice(p + 1);
  if (subagents !== 'subagents' || workflows !== 'workflows') return null;
  if (!WF_SAFE_ID.test(projectHash) || !WF_SAFE_ID.test(sid) || !WF_RUN_ID.test(runId)) return null;
  return { projectHash, sid, runId };
}

/**
 * 老会话兜底:从 Workflow 的 tool_result 正文里捞 taskId / runId / transcriptDir。
 * 唯一消费者是 session-reader(结构化 toolUseResult 缺失/不全时);**前端不实现副本**
 * —— 两份正则靠人肉维护必漂,而前端从正文拿不到 hash/sid,快照请求照样发不出去。
 * 三项都没匹配到 → null(不返回全 null 的对象)。
 */
export function parseWorkflowLaunchText(text) {
  if (typeof text !== 'string' || !text) return null;
  const taskId = /Task ID:\s*([A-Za-z0-9_-]{1,64})/.exec(text)?.[1] ?? null;
  const transcriptDir = /Transcript dir:\s*(\S+)/.exec(text)?.[1] ?? null;
  // 同时认 / 与 \;右界断言挡住"超长 runId 被截成合法前缀"绕过 WF_RUN_ID 闸门。
  const runId = /[/\\]workflows[/\\](wf_[A-Za-z0-9-]{4,64})(?=$|[\s"])/m.exec(text)?.[1] ?? null;
  if (taskId === null && transcriptDir === null && runId === null) return null;
  return { taskId, runId, transcriptDir };
}
