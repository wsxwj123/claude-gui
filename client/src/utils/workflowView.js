// 工作流视图的纯逻辑(无 JSX/React,node 直跑可测)。WorkflowCard 与监控面板共用。
//
// 数据只有两个来源:实时的 task_progress.workflow_progress(服务端已按白名单投影过)
// 与磁盘上的 <runId>.json 快照(同一投影)。两者形状相同,所以下面所有函数对两条路
// 一视同仁 —— 差别只在 selectWorkflowSource 决定这一刻该看哪一份。

const UNPHASED_KEY = 'unphased';
const UNPHASED_TITLE = '未分阶段';

// 排序键:缺 index 的条目排在有 index 的之后,彼此保持原顺序(V8 的 sort 是稳定的)。
function byIndex(a, b) {
  const ai = Number.isFinite(a?.index) ? a.index : null;
  const bi = Number.isFinite(b?.index) ? b.index : null;
  if (ai === null && bi === null) return 0;
  if (ai === null) return 1;
  if (bi === null) return -1;
  return ai - bi;
}

// 阶段分组:[{key, index, title, agents[]}]。
// 阶段条目(workflow_phase)先建组 —— 它在开跑前就被全量预告,所以"已预告但还没派助手"
// 的空组要保留(界面显示"0 个助手"),那正是用户判断"还剩几个阶段"的依据。
// 助手的 phaseIndex 与 phase.index 同为 1 基(实证),不做基数换算。
export function groupWorkflowPhases(entries) {
  if (!Array.isArray(entries)) return [];
  const byKey = new Map();
  const groupFor = (index, title) => {
    const key = 'p' + index;
    let g = byKey.get(key);
    if (!g) { g = { key, index, title, agents: [] }; byKey.set(key, g); }
    else if (!g.title && title) g.title = title;
    return g;
  };
  for (const e of entries) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    if (e.type === 'workflow_phase') {
      if (!Number.isFinite(e.index)) continue;
      groupFor(e.index, e.title || '阶段 ' + e.index);
      continue;
    }
    if (e.type !== 'workflow_agent') continue;   // 未知 type 忽略,不猜
    if (!Number.isFinite(e.phaseIndex)) {
      let g = byKey.get(UNPHASED_KEY);
      if (!g) { g = { key: UNPHASED_KEY, index: null, title: UNPHASED_TITLE, agents: [] }; byKey.set(UNPHASED_KEY, g); }
      g.agents.push(e);
      continue;
    }
    // phaseIndex 有值但没有对应的 phase 条目 → 现开一组,标题回落"阶段 N"(不留空白)。
    groupFor(e.phaseIndex, e.phaseTitle || '阶段 ' + e.phaseIndex).agents.push(e);
  }
  const groups = [...byKey.values()];
  // 入参数组不得被就地排序(调用方可能还拿着同一份表)——这里排的是新建的 groups 数组
  // 与各组自己的 agents 数组。
  groups.sort((a, b) => {
    if (a.index === null) return 1;             // 未分阶段恒排最后
    if (b.index === null) return -1;
    return a.index - b.index;
  });
  for (const g of groups) g.agents.sort(byIndex);
  return groups;
}

// run 级显示状态:把 activeAgents[].status(6 值)收敛成界面用的 5 态。
// 没有 status 的条目 = 刚建出来还没跑起来,算在跑(不谎称结束)。
export function runDisplayStatus(agent) {
  if (!agent) return 'unknown';
  const s = agent.status;
  if (s === 'done') return 'done';
  if (s === 'error') return 'error';
  if (s === 'stopped') return 'stopped';
  if (s === 'working' || s === 'starting' || s === undefined || s === '') return 'running';
  return 'unknown';
}

// 助手级显示状态,三段按序,先命中先返回:
//   A 段 agent 自身终态 > run 状态(工作流被停,已跑完的助手仍是"完成");
//   B 段 run 终态 > agent 非终态(定格在停止那一刻的表里 state 还是 progress);
//   C 段 才看 agent 自己的 state。
export function agentDisplayState(entry, runStatus) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const state = e.state;
  if (state === 'done') return e.cached === true ? 'cached' : 'done';
  if (state === 'error') {
    if (e.skipped === true) return 'skipped';
    if (e.blocked === true) return 'blocked';
    return 'error';
  }
  if (runStatus === 'stopped') return 'stopped';
  if (runStatus === 'done' || runStatus === 'error') return 'unknown';
  if (state === 'progress') return 'running';
  // start 且已有 startedAt = 已开跑;只有 queuedAt = 还在排队(实证可达)。
  if (state === 'start') return e.startedAt ? 'running' : 'queued';
  return 'unknown';
}

// 六序降级:自上而下第一条命中即用。
//
// 序 1/1b 优先于快照是硬红线:同一个脚本续跑(resumeFromRunId)会整体覆写同名快照,
// "有快照就用快照"会让第二轮跑到一半读到第一轮的 completed —— 界面谎称已完成。
// 1b 的启动窗解决另一半:头 10 秒进度表还是空的,此时也绝不许去看快照;但窗口必须有
// 上限,否则永远不发进度表的老 CLI 会永久卡在"正在启动…",连裸列表都降不下去。
export function selectWorkflowSource(input) {
  const {
    live = null, snapshot = null, cardTaskId = null, fallbackAgents = null,
    now = Date.now(), startupGraceMs = 15000,
  } = input && typeof input === 'object' ? input : {};
  const liveRows = live && Array.isArray(live.progress) ? live.progress.length : 0;
  const snapRows = snapshot && Array.isArray(snapshot.progress) ? snapshot.progress.length : 0;

  if (live && live.status === 'running') {
    if (liveRows) return { source: 'live', superseded: false, note: null };
    const startedAt = Number.isFinite(live.startedAt) ? live.startedAt : now;
    if (now - startedAt < startupGraceMs) return { source: 'live', superseded: false, note: '正在启动…' };
  }
  if (liveRows) {
    if (snapRows && snapshot.taskId && live.taskId && snapshot.taskId === live.taskId) {
      return { source: 'snapshot', superseded: false, note: null };
    }
    const superseded = Boolean(snapshot && snapshot.taskId && live.taskId && snapshot.taskId !== live.taskId);
    return {
      source: 'live',
      superseded,
      note: superseded ? '该运行记录已被后续续跑覆盖,下面是本次运行的最后进度' : null,
    };
  }
  if (snapRows) {
    const superseded = Boolean(cardTaskId && snapshot.taskId && cardTaskId !== snapshot.taskId);
    return {
      source: 'snapshot',
      superseded,
      note: superseded ? '磁盘上的运行记录属于后续的续跑,与这条消息不是同一次运行' : null,
    };
  }
  if (Array.isArray(fallbackAgents) && fallbackAgents.length) {
    return { source: 'disk', superseded: false, note: '此运行未留下阶段/标签信息' };
  }
  return { source: 'none', superseded: false, note: '此运行未提供进度信息' };
}

// 快照请求所需的三元组。三项由服务端随 tool_result 下发(transcriptDir 在服务端解析,
// 绝对路径不进前端);前端不自己拼 projectHash、不解析工具正文 —— 分屏下按当前 tab 取
// hash 会拿到别的窗格的,而正文里能捞到的只有 runId,拼不出请求。
export function resolveRunRef(input) {
  const { toolCall = null, agent = null } = input && typeof input === 'object' ? input : {};
  const wr = toolCall?.result?.workflowRun || null;
  const complete = wr && wr.runId && wr.projectHash && wr.sid;
  return {
    ref: complete ? { runId: wr.runId, projectHash: wr.projectHash, sid: wr.sid } : null,
    taskId: wr?.taskId ?? agent?.taskId ?? null,
  };
}

// 每阶段可渲染行数:总行数封顶 200,阶段多时均摊,但每阶段至少 5 行
// (50 阶段时总数会溢到 250,是刻意留的下限)。超出的折进"显示全部 (n)"。
export function phaseRowQuota(phaseCount, max = 200) {
  return Math.max(5, Math.floor(max / Math.max(1, phaseCount)));
}

const snapshotCache = new Map();   // runId → Promise<object|null>

function defaultFetcher(ref) {
  const q = `projectHash=${encodeURIComponent(ref.projectHash)}&sid=${encodeURIComponent(ref.sid)}&runId=${encodeURIComponent(ref.runId)}`;
  return fetch(`/api/workflow-run?${q}`).then((r) => (r.ok ? r.json() : null));
}

// 快照取一次,按 runId 全局去重。分屏两个窗格 + 监控面板可能同时渲染同一张终态卡片,
// 各自 useRef 去重会把同一份(最大 800KB)快照拉三遍,且组件卸载即丢、切回来重拉。
// 模块级缓存跨卸载存活;失败不写缓存(下次挂载可重试),但本函数自己不重试。
export function getWorkflowSnapshot(ref, { fetcher = defaultFetcher } = {}) {
  const runId = ref?.runId;
  if (!runId || !ref.projectHash || !ref.sid) return Promise.resolve(null);
  const hit = snapshotCache.get(runId);
  if (hit) return hit;
  const p = Promise.resolve()
    .then(() => fetcher(ref))
    .catch(() => null)                       // 网络错/非 200/JSON 坏 → null,永不 reject
    .then((snap) => {
      if (!snap || typeof snap !== 'object') { snapshotCache.delete(runId); return null; }
      return snap;
    });
  snapshotCache.set(runId, p);
  return p;
}
