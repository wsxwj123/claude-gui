#!/usr/bin/env node
// r114 前端验收测试:workflowView.js 七个导出 + §B 两张交叉表 + 降级选择 + 性能。
//
// 本文件是【黑盒验收测试】:只依据 .devflow/INTERFACE-r114.md(§B、§C、§G)写,
// 没看实现、没看 PLAN/RESEARCH/代码地图。夹具是 .devflow/fixtures-r114/ 的真实 CLI 样本。
//
// 设计要点:
//  * 动态 import + 逐条 try/catch:模块还不存在时每条各自红,而不是整文件炸。
//  * 纯函数真跑真断言;JSX 进不了 node,组件契约(§C3)的可锁部分在 check-r114-locks.mjs。
//  * B1(run 级交叉表)没有对应导出,落点在 App.jsx 分支里 —— 本文件按源码锚点逐行卡,
//    真值语义还得靠真机(见 TEST-PLAN 的「必须真机验证」)。
//  * 每条测试只测一件事,互不依赖(getWorkflowSnapshot 的模块级缓存用各自唯一 runId 隔离)。
//
// Run: node tests/unit/check-r114-client.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let PASS = 0;
let FAILS = 0;
const failed = [];
const tally = { RED: { pass: 0, fail: 0 }, GREEN: { pass: 0, fail: 0 } };
const TAG = { RED: '[修前应红]', GREEN: '[修前应绿]' };
async function check(tag, name, fn) {
  const label = `${TAG[tag]} ${name}`;
  try {
    await fn();
    PASS++; tally[tag].pass++;
    console.log(`  ✓ ${label}`);
  } catch (e) {
    FAILS++; tally[tag].fail++;
    failed.push(label);
    const msg = String((e && e.message) || e).split('\n').slice(0, 4).join('\n      ');
    console.log(`  ✗ ${label}\n      ${msg}`);
  }
}
const red = (name, fn) => check('RED', name, fn);
const green = (name, fn) => check('GREEN', name, fn);

async function load(rel) {
  try { return await import(pathToFileURL(join(ROOT, rel)).href); }
  catch (e) { return { __err: e }; }
}
function need(mod, name) {
  if (!mod || mod.__err) throw new Error(`模块 client/src/utils/workflowView.js 未能导入:${(mod && mod.__err && mod.__err.message) || '未知'}`);
  const f = mod[name];
  if (typeof f !== 'function') throw new Error(`缺少导出 ${name}(当前 typeof=${typeof f})`);
  return f;
}
const read = (rel) => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; } };
const fixture = (name) => JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/r114', name), 'utf8'));

const V = await load('client/src/utils/workflowView.js');

// 契约里 agent 条目的白名单形状(投影后进前端的就是这个)
const agent = (o) => ({ type: 'workflow_agent', ...o });
const phase = (index, title) => ({ type: 'workflow_phase', index, title });

// ══════════════════════════════════════════════════════════════════════════
// C2.1  groupWorkflowPhases —— 阶段分组(用户看到的"第几阶段 / 谁在跑")
// ══════════════════════════════════════════════════════════════════════════
console.log('\nC2.1 阶段分组(§C2.1)');

await red('C2.1-1 非数组 → []', async () => {
  const f = need(V, 'groupWorkflowPhases');
  for (const v of [null, undefined, 'x', 42, { a: 1 }]) {
    assert.deepEqual(f(v), [], `${JSON.stringify(v)} 必须 → [](空视图,不崩)`);
  }
});

await red('C2.1-2 夹具 progress-2:一个阶段 2 个助手 + 一个空阶段', async () => {
  const f = need(V, 'groupWorkflowPhases');
  const g = f(fixture('spike-wf-progress-2.json').workflow_progress);
  assert.equal(g.length, 2, 'Sleep + Report 两组');
  assert.deepEqual(g.map((x) => [x.key, x.title, x.agents.length]),
    [['p1', 'Sleep', 2], ['p2', 'Report', 0]], '空组必须保留(阶段已预告、助手还没派)');
});

await red('C2.1-3 组按 phase.index 升序,不按出现顺序', async () => {
  const f = need(V, 'groupWorkflowPhases');
  const g = f([phase(5, '补跑'), phase(1, '摸底'), phase(2, '综合')]);
  assert.deepEqual(g.map((x) => x.index), [1, 2, 5]);
});

await red('C2.1-4 有 phaseIndex 但没有对应 phase 条目 → 现开一组,用 phaseTitle', async () => {
  const f = need(V, 'groupWorkflowPhases');
  const g = f([phase(1, '摸底'), agent({ index: 1, label: 'D', phaseIndex: 5, phaseTitle: '补跑' })]);
  assert.deepEqual(g.map((x) => [x.key, x.index, x.title]), [['p1', 1, '摸底'], ['p5', 5, '补跑']]);
});

await red('C2.1-5 现开的组缺 phaseTitle → 标题回落「阶段 N」', async () => {
  const f = need(V, 'groupWorkflowPhases');
  const g = f([agent({ index: 1, label: 'D', phaseIndex: 3 })]);
  assert.equal(g[0].title, '阶段 3', '猜不出名字就写清楚是第几阶段,不留空白');
});

await red('C2.1-6 phaseIndex 缺失 → 进「未分阶段」组,index 为 null', async () => {
  const f = need(V, 'groupWorkflowPhases');
  const g = f([agent({ index: 1, label: 'C' })]);
  assert.deepEqual([g[0].key, g[0].index, g[0].title], ['unphased', null, '未分阶段']);
});

await red('C2.1-7 「未分阶段」恒排最后', async () => {
  const f = need(V, 'groupWorkflowPhases');
  const g = f([agent({ index: 1, label: 'C' }), phase(5, '补跑'), phase(1, '摸底')]);
  assert.deepEqual(g.map((x) => x.key), ['p1', 'p5', 'unphased']);
});

await red('C2.1-8 没有无阶段助手时,「未分阶段」组不出现', async () => {
  const f = need(V, 'groupWorkflowPhases');
  const g = f([phase(1, '摸底'), agent({ index: 1, label: 'A', phaseIndex: 1 })]);
  assert.deepEqual(g.map((x) => x.key), ['p1'], '空的未分阶段组不该占一行');
});

await red('C2.1-9 组内助手按 index 升序', async () => {
  const f = need(V, 'groupWorkflowPhases');
  const g = f([phase(1, 'P'), agent({ index: 3, label: 'C', phaseIndex: 1 }), agent({ index: 1, label: 'A', phaseIndex: 1 })]);
  assert.deepEqual(g[0].agents.map((a) => a.label), ['A', 'C']);
});

await red('C2.1-10 缺 index 的助手排最后且保持原顺序(稳定)', async () => {
  const f = need(V, 'groupWorkflowPhases');
  const g = f([phase(1, 'P'),
    agent({ label: 'X', phaseIndex: 1 }), agent({ index: 2, label: 'B', phaseIndex: 1 }),
    agent({ label: 'Y', phaseIndex: 1 }), agent({ index: 1, label: 'A', phaseIndex: 1 })]);
  assert.deepEqual(g[0].agents.map((a) => a.label), ['A', 'B', 'X', 'Y'], '无 index 的两条保持 X 在 Y 前');
});

await red('C2.1-11 契约给的混排数值例子:组序 p1/p2/p5/unphased', async () => {
  const f = need(V, 'groupWorkflowPhases');
  const g = f([
    phase(1, '摸底'), phase(2, '综合'),
    agent({ index: 1, label: 'A', phaseIndex: 1 }),
    agent({ index: 3, label: 'C' }),
    agent({ index: 2, label: 'B', phaseIndex: 1 }),
    agent({ index: 4, label: 'D', phaseIndex: 5, phaseTitle: '补跑' }),
  ]);
  assert.deepEqual(g.map((x) => [x.key, x.title, x.agents.map((a) => a.label)]),
    [['p1', '摸底', ['A', 'B']], ['p2', '综合', []], ['p5', '补跑', ['D']], ['unphased', '未分阶段', ['C']]]);
});

await red('C2.1-12 未知 type 条目被忽略(不成组、不进任何组)', async () => {
  const f = need(V, 'groupWorkflowPhases');
  const g = f([{ type: 'workflow_log', message: 'x' }, phase(1, 'P')]);
  assert.deepEqual(g.map((x) => x.key), ['p1']);
  assert.equal(g[0].agents.length, 0);
});

await red('C2.1-13 脏条目(null / 字符串 / 数组)不抛异常', async () => {
  const f = need(V, 'groupWorkflowPhases');
  const g = f([null, 'x', 42, [], phase(1, 'P')]);
  assert.equal(Array.isArray(g), true, '脏数据必须被跳过,不能让整张卡片崩掉');
});

await red('C2.1-14 幂等:同一份表分组两次结果相同(SSE+WS 双路到达)', async () => {
  const f = need(V, 'groupWorkflowPhases');
  const src = fixture('spike-wf-progress-2.json').workflow_progress;
  assert.deepEqual(f(src), f(src));
});

await red('C2.1-15 重复条目不去重(同 agentId 出现两次 → 两行)', async () => {
  const f = need(V, 'groupWorkflowPhases');
  const g = f([phase(1, 'P'), agent({ index: 1, label: 'A', phaseIndex: 1, agentId: 'x' }), agent({ index: 1, label: 'A', phaseIndex: 1, agentId: 'x' })]);
  assert.equal(g[0].agents.length, 2, '去重是 CLI 的事;前端擅自去重会藏掉重试的那次');
});

await red('C2.1-16 不改写入参数组(原数组顺序不变)', async () => {
  const f = need(V, 'groupWorkflowPhases');
  const src = [agent({ index: 3, label: 'C', phaseIndex: 1 }), agent({ index: 1, label: 'A', phaseIndex: 1 })];
  f(src);
  assert.deepEqual(src.map((a) => a.label), ['C', 'A'], '排序必须在副本上做,不得就地 sort 入参');
});

// ══════════════════════════════════════════════════════════════════════════
// C2.2  runDisplayStatus —— run 级显示状态(5 态)
// ══════════════════════════════════════════════════════════════════════════
console.log('\nC2.2 run 显示状态(§C2.2)');

for (const [input, want, why] of [
  [null, 'unknown', 'falsy 条目'],
  [undefined, 'unknown', 'falsy 条目'],
  [{ status: 'done' }, 'done', ''],
  [{ status: 'error' }, 'error', ''],
  [{ status: 'stopped' }, 'stopped', ''],
  [{ status: 'working' }, 'running', ''],
  [{ status: 'starting' }, 'running', ''],
  [{ status: undefined }, 'running', '刚建条目还没状态 = 在跑'],
  [{ status: '' }, 'running', ''],
  [{ status: 'needs_input' }, 'unknown', '其它已知值也走 unknown'],
  [{ status: '乱码' }, 'unknown', ''],
]) {
  await red(`C2.2 runDisplayStatus(${JSON.stringify(input)}) → '${want}'${why ? ' —— ' + why : ''}`, async () => {
    const f = need(V, 'runDisplayStatus');
    assert.equal(f(input), want);
  });
}

// ══════════════════════════════════════════════════════════════════════════
// B2  agentDisplayState(entry, runStatus) —— 三段按序,先命中先返回
//   用户视角:这张表决定"工作流被停了,但那个已经跑完的助手还显示不显示绿勾"。
// ══════════════════════════════════════════════════════════════════════════
console.log('\nB2 助手显示状态交叉表(§B2)');

for (const [entry, runStatus, want, why] of [
  // 段 A:agent 终态 > run 状态
  [{ state: 'done', cached: true }, 'running', 'cached', 'A 段:命中缓存'],
  [{ state: 'done' }, 'running', 'done', 'A 段'],
  [{ state: 'error', skipped: true }, 'running', 'skipped', 'A 段'],
  [{ state: 'error', blocked: true }, 'running', 'blocked', 'A 段'],
  [{ state: 'error' }, 'running', 'error', 'A 段'],
  // 段 B:run 终态 > agent 非终态
  [{ state: 'progress' }, 'stopped', 'stopped', 'B 段:工作流被停,在跑的助手跟着停'],
  [{ state: 'start', startedAt: 1 }, 'stopped', 'stopped', 'B 段'],
  [{ state: 'progress' }, 'done', 'unknown', 'B 段:不谎称还在跑'],
  [{ state: 'progress' }, 'error', 'unknown', 'B 段'],
  // 段 C:agent 自身状态
  [{ state: 'progress' }, 'running', 'running', 'C 段'],
  [{ state: 'start', startedAt: 1788654540445 }, 'running', 'running', 'C 段:有 startedAt = 已开跑'],
  [{ state: 'start' }, 'running', 'queued', 'C 段:只有 queuedAt = 排队中(实证可达)'],
  [{ state: 'start', queuedAt: 1788654540444 }, 'running', 'queued', 'C 段'],
  [{}, 'running', 'unknown', 'C 段兜底:缺 state'],
  [{ state: '未来新状态' }, 'running', 'unknown', 'C 段兜底:未知值不猜'],
  [null, 'running', 'unknown', 'C 段兜底:entry 非对象'],
  ['x', 'running', 'unknown', 'C 段兜底:entry 非对象'],
  [{ state: 'progress' }, 'unknown', 'running', 'run 状态 unknown 时按 agent 自身算'],
]) {
  await red(`B2 agentDisplayState(${JSON.stringify(entry)}, '${runStatus}') → '${want}' —— ${why}`, async () => {
    const f = need(V, 'agentDisplayState');
    assert.equal(f(entry, runStatus), want);
  });
}

// 契约点名的 6 条并发/乱序组合(与上表重叠,但这 6 条是"裁定权"的核心,单列)
for (const [entry, runStatus, want, why] of [
  [{ state: 'done' }, 'stopped', 'done', '① 停了工作流,已完成的助手仍是完成(A 赢)'],
  [{ state: 'progress' }, 'stopped', 'stopped', '② 停了工作流,在跑的助手显示已停止(B 赢)'],
  [{ state: 'start' }, 'done', 'unknown', '③ 工作流已完成 + 助手只排过队 → unknown,不得是 queued'],
  [{ state: 'error', skipped: true }, 'running', 'skipped', '④ 跳过优先于报错'],
  [{ state: 'done', cached: true }, 'running', 'cached', '⑤ 缓存命中优先于完成'],
  [{}, 'unknown', 'unknown', '⑥ 什么都没有 → unknown'],
]) {
  await red(`B2-并发 ${why}`, async () => {
    const f = need(V, 'agentDisplayState');
    assert.equal(f(entry, runStatus), want);
  });
}

await red('B2-取值域 agentDisplayState 只返回 9 个已知值', async () => {
  const f = need(V, 'agentDisplayState');
  const OK = new Set(['queued', 'running', 'done', 'cached', 'error', 'skipped', 'blocked', 'stopped', 'unknown']);
  for (const st of ['start', 'progress', 'done', 'error', undefined, 'x'])
    for (const rs of ['running', 'done', 'error', 'stopped', 'unknown', undefined])
      assert.equal(OK.has(f({ state: st }, rs)), true, `state=${st} run=${rs} 返回了域外值 ${f({ state: st }, rs)}`);
});

// ══════════════════════════════════════════════════════════════════════════
// C2.3  selectWorkflowSource —— 六序降级(§C2.3;同时覆盖 B1-10 ~ B1-13)
//   用户视角:同一个脚本续跑过一次,磁盘上的快照属于"后一次";这套序保证消息下方
//   显示的永远是"这条消息那次运行",而不是悄悄换成新的一次。
// ══════════════════════════════════════════════════════════════════════════
console.log('\nC2.3 降级选择六序(§C2.3 / B1-10~13)');

const NOW = 1_800_000_000_000;
const x = { type: 'workflow_agent', index: 1, label: 'x' };
const y = { type: 'workflow_agent', index: 1, label: 'y' };

await red('C2.3-序1 live 在跑且有表 → live(B1-10:live 在跑 > 快照)', async () => {
  const f = need(V, 'selectWorkflowSource');
  const r = f({ live: { progress: [x], status: 'running', taskId: 't1', startedAt: NOW - 1000 }, snapshot: { taskId: 't0', progress: [y] }, now: NOW });
  assert.deepEqual(r, { source: 'live', superseded: false, note: null });
});

await red('C2.3-序1b 表还空但刚起(<15s)→ live + 「正在启动…」,绝不看快照', async () => {
  const f = need(V, 'selectWorkflowSource');
  const r = f({ live: { progress: [], status: 'running', taskId: 't1', startedAt: NOW - 3000 }, snapshot: { taskId: 't0', progress: [y] }, now: NOW });
  assert.deepEqual(r, { source: 'live', superseded: false, note: '正在启动…' }, '启动窗内看快照 = 上一次运行的进度冒充这一次');
});

await red('C2.3-序1b 边界 startedAt 缺失 → 按 now 算,仍在启动窗内', async () => {
  const f = need(V, 'selectWorkflowSource');
  const r = f({ live: { progress: [], status: 'running', taskId: 't1', startedAt: null }, now: NOW });
  assert.equal(r.note, '正在启动…');
});

await red('C2.3-序1b 边界 刚好 15s → 不再算启动中(判据是严格小于)', async () => {
  const f = need(V, 'selectWorkflowSource');
  const r = f({ live: { progress: [], status: 'running', taskId: 't1', startedAt: NOW - 15000 }, now: NOW });
  assert.notEqual(r.note, '正在启动…', '15000ms 不小于 15000ms,应已降级');
});

await red('C2.3-序1b 超窗且有裸列表 → disk,不永久卡「正在启动…」', async () => {
  const f = need(V, 'selectWorkflowSource');
  const r = f({ live: { progress: [], status: 'running', startedAt: NOW - 60000 }, fallbackAgents: [{ id: 'a1' }], now: NOW });
  assert.deepEqual(r, { source: 'disk', superseded: false, note: '此运行未留下阶段/标签信息' }, '老 CLI 不发进度表,60s 后必须降级到磁盘裸列表');
});

await red('C2.3-序2 live 终态 + 同 taskId 的快照 → snapshot(B1-11:快照带 result)', async () => {
  const f = need(V, 'selectWorkflowSource');
  const r = f({ live: { progress: [x], status: 'done', taskId: 't1' }, snapshot: { taskId: 't1', progress: [y] }, now: NOW });
  assert.deepEqual(r, { source: 'snapshot', superseded: false, note: null });
});

await red('C2.3-序3 live 终态 + 异 taskId 快照 → live + superseded(B1-12)', async () => {
  const f = need(V, 'selectWorkflowSource');
  const r = f({ live: { progress: [x], status: 'done', taskId: 't1' }, snapshot: { taskId: 't2', progress: [y] }, now: NOW });
  assert.equal(r.source, 'live');
  assert.equal(r.superseded, true);
  assert.equal(r.note, '该运行记录已被后续续跑覆盖,下面是本次运行的最后进度');
});

await red('C2.3-序3 live 终态 + 无快照 → live,不标 superseded', async () => {
  const f = need(V, 'selectWorkflowSource');
  const r = f({ live: { progress: [x], status: 'stopped', taskId: 't1' }, snapshot: null, now: NOW });
  assert.deepEqual(r, { source: 'live', superseded: false, note: null });
});

await red('C2.3-序3 快照缺 taskId → 不标 superseded(判不出来就别吓唬用户)', async () => {
  const f = need(V, 'selectWorkflowSource');
  const r = f({ live: { progress: [x], status: 'error', taskId: 't1' }, snapshot: { progress: [y] }, now: NOW });
  assert.equal(r.superseded, false);
});

await red('C2.3-序4 无 live 只有快照 → snapshot(B1-13 历史会话)', async () => {
  const f = need(V, 'selectWorkflowSource');
  const r = f({ live: null, snapshot: { taskId: 't2', progress: [y] }, cardTaskId: 't2', now: NOW });
  assert.deepEqual(r, { source: 'snapshot', superseded: false, note: null });
});

await red('C2.3-序4 历史卡片 taskId 与快照不同 → superseded + 提示这不是同一次运行', async () => {
  const f = need(V, 'selectWorkflowSource');
  const r = f({ live: null, snapshot: { taskId: 't2', progress: [y] }, cardTaskId: 't1', now: NOW });
  assert.equal(r.source, 'snapshot');
  assert.equal(r.superseded, true);
  assert.equal(r.note, '磁盘上的运行记录属于后续的续跑,与这条消息不是同一次运行');
});

await red('C2.3-序5 只有磁盘裸列表 → disk + 「未留下阶段/标签信息」', async () => {
  const f = need(V, 'selectWorkflowSource');
  const r = f({ live: null, snapshot: null, fallbackAgents: [{ id: 'a1' }], now: NOW });
  assert.deepEqual(r, { source: 'disk', superseded: false, note: '此运行未留下阶段/标签信息' });
});

await red('C2.3-序6 全空 → none + 「此运行未提供进度信息」', async () => {
  const f = need(V, 'selectWorkflowSource');
  assert.deepEqual(f({ live: null, snapshot: null, fallbackAgents: [], now: NOW }),
    { source: 'none', superseded: false, note: '此运行未提供进度信息' });
});

await red('C2.3-健壮 入参为 undefined / {} → none,不抛', async () => {
  const f = need(V, 'selectWorkflowSource');
  assert.equal(f(undefined).source, 'none');
  assert.equal(f({}).source, 'none');
});

await red('C2.3-健壮 live.progress 为 null(投影拒绝过)→ 不当成有表', async () => {
  const f = need(V, 'selectWorkflowSource');
  const r = f({ live: { progress: null, status: 'done', taskId: 't1' }, snapshot: { taskId: 't1', progress: [y] }, now: NOW });
  assert.equal(r.source, 'snapshot', 'live 没表时应落到快照,而不是报 live 空表');
});

await red('C2.3-取值域 source 只返回 live/snapshot/disk/none', async () => {
  const f = need(V, 'selectWorkflowSource');
  const OK = new Set(['live', 'snapshot', 'disk', 'none']);
  for (const st of ['running', 'done', 'error', 'stopped', 'unknown'])
    for (const prog of [[], [x], null])
      assert.equal(OK.has(f({ live: { progress: prog, status: st, taskId: 't1', startedAt: NOW - 99999 }, now: NOW }).source), true);
});

// ══════════════════════════════════════════════════════════════════════════
// C2.4  resolveRunRef —— 恒返回对象,前端不自己拼 hash、不解析正文
// ══════════════════════════════════════════════════════════════════════════
console.log('\nC2.4 运行引用解析(§C2.4)');

await red('C2.4-1 workflowRun 三项齐全 → ref 三元组 + taskId', async () => {
  const f = need(V, 'resolveRunRef');
  const r = f({ toolCall: { result: { workflowRun: { runId: 'wf_x-abcd', projectHash: '-h', sid: 's', taskId: 't' } } } });
  assert.deepEqual(r, { ref: { runId: 'wf_x-abcd', projectHash: '-h', sid: 's' }, taskId: 't' });
});

for (const [desc, wr] of [
  ['缺 projectHash', { runId: 'wf_x-abcd', sid: 's', taskId: 't' }],
  ['缺 sid', { runId: 'wf_x-abcd', projectHash: '-h', taskId: 't' }],
  ['缺 runId', { projectHash: '-h', sid: 's', taskId: 't' }],
  ['projectHash 为 null', { runId: 'wf_x-abcd', projectHash: null, sid: 's', taskId: 't' }],
]) {
  await red(`C2.4-2 ${desc} → ref 为 null(taskId 照给)`, async () => {
    const f = need(V, 'resolveRunRef');
    const r = f({ toolCall: { result: { workflowRun: wr } } });
    assert.equal(r.ref, null, '三项不齐就别发请求(拼出来的路径必然 400/404)');
    assert.equal(r.taskId, 't');
  });
}

await red('C2.4-3 无 toolCall,只有 live 条目 → {ref:null, taskId:来自 agent}', async () => {
  const f = need(V, 'resolveRunRef');
  assert.deepEqual(f({ toolCall: null, agent: { taskId: 'w1zi' } }), { ref: null, taskId: 'w1zi' });
});

await red('C2.4-4 taskId 优先取 workflowRun,其次 agent', async () => {
  const f = need(V, 'resolveRunRef');
  const r = f({ toolCall: { result: { workflowRun: { taskId: 'from-run' } } }, agent: { taskId: 'from-agent' } });
  assert.equal(r.taskId, 'from-run');
});

await red('C2.4-5 什么都没有 → {ref:null, taskId:null},恒返回对象绝不返回 null', async () => {
  const f = need(V, 'resolveRunRef');
  assert.deepEqual(f({}), { ref: null, taskId: null });
  assert.deepEqual(f({ toolCall: null, agent: null }), { ref: null, taskId: null });
});

await red('C2.4-6 入参为 undefined 也不抛', async () => {
  const f = need(V, 'resolveRunRef');
  const r = f(undefined);
  assert.equal(r && typeof r === 'object', true, '恒返回对象:调用点直接解构,返回 null 就是白屏');
});

await red('C2.4-7 不碰 toolCall.result.content(不做正文解析)', async () => {
  const f = need(V, 'resolveRunRef');
  const launch = fixture('spike-wf-toolresult.json').block.content;
  const r = f({ toolCall: { result: { content: launch } } });
  assert.equal(r.ref, null, '正文里虽然有 Run ID,前端也不许自己解析(§E2-13)');
});

// ══════════════════════════════════════════════════════════════════════════
// C2.5  phaseRowQuota —— 每阶段渲染行数配额
// ══════════════════════════════════════════════════════════════════════════
console.log('\nC2.5 阶段行数配额(§C2.5)');

for (const [count, want] of [[1, 200], [20, 10], [50, 5], [0, 200], [1000, 5], [-3, 200]]) {
  await red(`C2.5 phaseRowQuota(${count}) → ${want}`, async () => {
    const f = need(V, 'phaseRowQuota');
    assert.equal(f(count), want);
  });
}

await red('C2.5 自定义 max 生效:phaseRowQuota(10, 100) → 10', async () => {
  const f = need(V, 'phaseRowQuota');
  assert.equal(f(10, 100), 10);
});

// ══════════════════════════════════════════════════════════════════════════
// C2.6  getWorkflowSnapshot —— runId 级全局去重缓存(唯一非纯导出)
// ══════════════════════════════════════════════════════════════════════════
console.log('\nC2.6 快照缓存与去重(§C2.6)');

const refOf = (n) => ({ runId: `wf_cache${n}-0001`, projectHash: '-h', sid: 's' });

await red('C2.6-1 并发两次调用(分屏两窗格)→ fetcher 只被调 1 次', async () => {
  const f = need(V, 'getWorkflowSnapshot');
  let calls = 0;
  const fetcher = () => { calls += 1; return new Promise((r) => setTimeout(() => r({ runId: 'a', status: 'completed' }), 30)); };
  const ref = refOf('a');
  const [r1, r2] = await Promise.all([f(ref, { fetcher }), f(ref, { fetcher })]);
  assert.equal(calls, 1, '两个窗格同时展开同一个工作流不得打两次请求');
  assert.deepEqual(r1, r2);
});

await red('C2.6-2 已解析后再调 → fetcher 0 次(缓存命中)', async () => {
  const f = need(V, 'getWorkflowSnapshot');
  let calls = 0;
  const fetcher = async () => { calls += 1; return { status: 'completed' }; };
  const ref = refOf('b');
  await f(ref, { fetcher });
  const before = calls;
  const again = await f(ref, { fetcher });
  assert.equal(calls, before, '第二次必须走缓存');
  assert.deepEqual(again, { status: 'completed' }, '缓存命中也要拿到同一份快照');
});

await red('C2.6-3 缓存按 runId 分键:另一个 runId 会重新取', async () => {
  const f = need(V, 'getWorkflowSnapshot');
  let calls = 0;
  const fetcher = async (ref) => { calls += 1; return { runId: ref.runId }; };
  await f(refOf('c1'), { fetcher });
  const r = await f(refOf('c2'), { fetcher });
  assert.equal(calls, 2);
  assert.equal(r.runId, 'wf_cachec2-0001');
});

await red('C2.6-4 失败(fetcher 返回 null)不写缓存:下次还能再取', async () => {
  const f = need(V, 'getWorkflowSnapshot');
  let calls = 0;
  const fetcher = async () => { calls += 1; return calls === 1 ? null : { status: 'completed' }; };
  const ref = refOf('d');
  const first = await f(ref, { fetcher });
  assert.equal(first, null, '404/422 时返回 null');
  const second = await f(ref, { fetcher });
  assert.equal(calls, 2, '失败必须从缓存里删掉,否则这个工作流永远显示不出结果');
  assert.deepEqual(second, { status: 'completed' });
});

await red('C2.6-5 fetcher 抛异常也不毒化缓存(下次仍会重试)', async () => {
  const f = need(V, 'getWorkflowSnapshot');
  let calls = 0;
  const fetcher = async () => { calls += 1; if (calls === 1) throw new Error('network down'); return { status: 'failed' }; };
  const ref = refOf('e');
  try { await f(ref, { fetcher }); } catch { /* 抛不抛都行,契约只要求不缓存失败 */ }
  const second = await f(ref, { fetcher });
  assert.equal(calls, 2);
  assert.deepEqual(second, { status: 'failed' });
});

await red('C2.6-6 ref 不完整 → 不调 fetcher,直接 null', async () => {
  const f = need(V, 'getWorkflowSnapshot');
  let calls = 0;
  const fetcher = async () => { calls += 1; return {}; };
  const r = await f(null, { fetcher });
  assert.equal(calls, 0, 'ref 为 null 时打请求 = 必然 400');
  assert.equal(r, null);
});

// ══════════════════════════════════════════════════════════════════════════
// 性能:1000 助手 / 20 阶段 —— 整链路 parse → 投影 → 分组 单次 < 200ms
// ══════════════════════════════════════════════════════════════════════════
console.log('\n性能:1000 助手整链路(§C2.1 修订 v2)');

await red('PERF 1000 助手 / 20 阶段:JSON.parse → 投影 → 分组 < 200ms', async () => {
  const group = need(V, 'groupWorkflowPhases');
  const wp = await load('server/utils/workflow-progress.js');
  const project = need(wp, 'projectWorkflowProgress');
  const base = fixture('spike-wf-progress-2.json').workflow_progress[2];
  const entries = [];
  for (let p = 1; p <= 20; p++) entries.push({ type: 'workflow_phase', index: p, title: '阶段' + p });
  for (let i = 1; i <= 1000; i++) {
    entries.push({ ...base, index: i, label: 'agent:' + i, agentId: 'a' + String(i).padStart(16, '0'), phaseIndex: (i % 20) + 1, phaseTitle: '阶段' + ((i % 20) + 1) });
  }
  const text = JSON.stringify(entries);
  const t0 = process.hrtime.bigint();
  const groups = group(project(JSON.parse(text)));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(groups.reduce((n, g) => n + g.agents.length, 0), 1000, '1000 个助手一个都不能少');
  assert.ok(ms < 200, `整链路 ${ms.toFixed(1)}ms,超过 200ms —— 每 10s 一份进度会卡主线程`);
});

// ══════════════════════════════════════════════════════════════════════════
// B1  run 级交叉表:落点在 App.jsx 的 task_progress 分支,只能按源码锚点卡
//     (真值语义见 TEST-PLAN「必须真机验证」)
// ══════════════════════════════════════════════════════════════════════════
console.log('\nB1 run 级交叉表的接线锚点(§B1)');

const APP = read('client/src/App.jsx');
const tpSeg = (() => {
  const i = APP.indexOf("subtype === 'task_progress'");
  return i > 0 ? APP.slice(i, i + 1400) : '';
})();

await red('B1-2 带表时整表替换:分支里必须有 Array.isArray(event.workflow_progress) 守卫', async () => {
  assert.ok(tpSeg.length > 0, 'App.jsx 必须仍有 task_progress 分支');
  assert.match(tpSeg, /Array\.isArray\(event\.workflow_progress\)/, '没有守卫 = 缺表的事件也会写进 store');
});

await red('B1-2 带表时必须同时记 wfProgressAt(「更新于 Xs 前」的唯一来源)', async () => {
  assert.match(tpSeg, /wfProgressAt/);
});

await green('B1-3 不带表的 task_progress 不得把表兜底成 []', async () => {
  assert.equal(/workflow_progress[^]{0,80}(\?\?|\|\|)\s*\[\]/.test(tpSeg), false,
    '`?? []` / `|| []` 会把已有进度表清空 —— 6 条事件里 4 条不带表,清空就是满屏闪烁');
});

await red('B1-9 权威终态到达后的 task_progress 必须整条丢弃', async () => {
  assert.match(tpSeg, /done|error|stopped/, 'task_progress 分支里必须能看到终态判据');
  assert.match(tpSeg, /optimisticStop/, '终态丢弃守卫必须带 optimisticStop 例外(B1-9b),否则乐观停止后最后几个助手永远"未知"');
});

await green('B1-8 level 全量集不剪 workflow 条目(pruneByLiveSet 真跑)', async () => {
  const lp = await load('client/src/utils/levelPrune.js');
  const prune = need(lp, 'pruneByLiveSet');
  const ts = 1_000_000_000;
  const old = ts - (lp.LEVEL_PRUNE_MIN_AGE_MS ?? 60000) - 1;
  const ids = prune({ toolu_wf: { sessionId: 'S', taskManaged: true, status: 'working', startedAt: old, workflow: true } },
    { sessionId: 'S', taskIds: [], toolUseIds: [], settled: [], ts });
  assert.deepEqual(ids, [], 'workflow 条目永远豁免剪枝(跨回合在后台跑,不在 CLI 的 tasks 表里)');
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n—— check-r114-client: ${PASS} 绿 / ${FAILS} 红(共 ${PASS + FAILS} 条)——`);
console.log(`   [修前应红] ${tally.RED.pass + tally.RED.fail} 条(现在绿 ${tally.RED.pass} / 红 ${tally.RED.fail})`);
console.log(`   [修前应绿] ${tally.GREEN.pass + tally.GREEN.fail} 条(现在绿 ${tally.GREEN.pass} / 红 ${tally.GREEN.fail})`);
if (FAILS) {
  console.log('红的条目:');
  for (const n of failed) console.log(`  ✗ ${n}`);
}
process.exit(FAILS ? 1 : 0);
