#!/usr/bin/env node
// r114 v5 补充验收测试:§C2.2b 两个新纯函数(snapshotRunStatus / effectiveRunStatus)
// + §C3 第 13/14 条(历史回看的整体状态徽章、助手行状态、耗时显示规则)。
//
// 本文件是【黑盒验收测试】:只依据 .devflow/INTERFACE-r114.md 的「修订 v5」条款写,
// 没看实现代码、没看 PLAN/RESEARCH。夹具是 tests/fixtures/r114/ 的真实 CLI 运行样本。
//
// 它要证明的用户可见事实(真机 M9 暴露的缺口):
//   打开一个"当时被停止"的旧会话 → 整体徽章是「已停止」、助手不转圈、耗时不按当前时间现算。
//
// 设计要点:
//  * 动态 import + 逐条 try/catch:两个新函数还不存在时每条各自红,而不是整文件在 import 处炸。
//  * 每条测试只测一件事,互不依赖,可任意顺序跑。
//  * §C3 13/14 是组件渲染行为,JSX 进不了 node → 按契约点名的文件做源码锁(读文本判定)。
//
// Run: node tests/unit/check-r114b-client.mjs
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

// ── 夹具:真实"被停止"的工作流快照 ─────────────────────────────────────────
// 前端拿到的是投影后的条目(§A1.4:snapshot.progress = projectWorkflowProgress(raw.workflowProgress)),
// 这里按 §A1.2 的白名单在测试侧自己投影一份,免得依赖服务端实现。
const PHASE_KEYS = ['type', 'index', 'title'];
const AGENT_KEYS = ['type', 'index', 'label', 'phaseIndex', 'phaseTitle', 'agentId', 'agentType', 'model',
  'state', 'error', 'skipped', 'blocked', 'cached', 'attempt', 'lastAttemptReason', 'queuedAt', 'startedAt',
  'durationMs', 'tokens', 'toolCalls', 'lastToolName', 'lastToolSummary', 'resultPreview'];
function projectLikeContract(entries) {
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const keys = e.type === 'workflow_phase' ? PHASE_KEYS : e.type === 'workflow_agent' ? AGENT_KEYS : null;
    if (!keys) continue;
    const o = {};
    for (const k of keys) if (e[k] !== undefined) o[k] = e[k];
    out.push(o);
  }
  return out;
}

const RAW_KILLED = fixture('snapshot-killed.json');
const PROGRESS = projectLikeContract(RAW_KILLED.workflowProgress);
const AGENT_ROWS = PROGRESS.filter((e) => e.type === 'workflow_agent');
// 历史会话里前端手上的快照对象(§A1.4 的返回形状,只留本测试用得到的键)
const snapWith = (status) => ({
  status, progress: PROGRESS, phases: RAW_KILLED.phases,
  result: RAW_KILLED.result, resultTruncated: false, source: 'snapshot',
});

// ══════════════════════════════════════════════════════════════════════════
// 一、snapshotRunStatus —— 磁盘上的运行状态 → 界面上的整体状态(§C2.2b)
// ══════════════════════════════════════════════════════════════════════════
console.log('\n一、snapshotRunStatus:磁盘状态词 → 界面状态词(§C2.2b)');

await red('V5-1 completed → done', async () => {
  assert.equal(need(V, 'snapshotRunStatus')('completed'), 'done');
});

await red('V5-2 failed → error', async () => {
  assert.equal(need(V, 'snapshotRunStatus')('failed'), 'error');
});

await red('V5-3 killed → stopped(真机 M9 的那份快照就是这个状态)', async () => {
  assert.equal(need(V, 'snapshotRunStatus')('killed'), 'stopped');
});

await red('V5-4 大小写必须严格:KILLED / Completed / FAILED 一律 unknown', async () => {
  const f = need(V, 'snapshotRunStatus');
  for (const v of ['KILLED', 'Killed', 'Completed', 'COMPLETED', 'FAILED', 'Failed']) {
    assert.equal(f(v), 'unknown', `${v} 不在取值域里,不许猜成终态`);
  }
});

await red('V5-5 非字符串 → unknown(null/数字/布尔/对象/数组/函数)', async () => {
  const f = need(V, 'snapshotRunStatus');
  for (const v of [null, 42, 0, true, false, {}, { status: 'killed' }, ['killed'], () => 'killed']) {
    assert.equal(f(v), 'unknown', `${JSON.stringify(v) ?? String(v)} 必须 → unknown`);
  }
});

await red('V5-6 缺参 / undefined → unknown', async () => {
  const f = need(V, 'snapshotRunStatus');
  assert.equal(f(), 'unknown', '一个参数都不传');
  assert.equal(f(undefined), 'unknown', '显式 undefined');
});

await red('V5-7 空串与带空格的值 → unknown(不做 trim,取值域是穷举)', async () => {
  const f = need(V, 'snapshotRunStatus');
  assert.equal(f(''), 'unknown');
  assert.equal(f('   '), 'unknown');
  assert.equal(f(' killed '), 'unknown');
  assert.equal(f('killed\n'), 'unknown');
});

await red('V5-8 反向:running / pending / paused 不得被映射成任何终态', async () => {
  const f = need(V, 'snapshotRunStatus');
  for (const v of ['running', 'pending', 'paused']) {
    const got = f(v);
    assert.equal(got, 'unknown', `${v} → ${got};非终态被当终态 = 历史卡片谎报"已完成/已停止"`);
  }
});

await red('V5-9 反向:输出词表自身(done/error/stopped/unknown)不是磁盘词表 → unknown', async () => {
  const f = need(V, 'snapshotRunStatus');
  for (const v of ['done', 'error', 'stopped', 'unknown', 'working', 'starting']) {
    assert.equal(f(v), 'unknown', `${v} 是界面词/live 词,不是快照 status 词`);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 二、effectiveRunStatus —— 没有 live 条目时才用快照补状态(§C2.2b)
// ══════════════════════════════════════════════════════════════════════════
console.log('\n二、effectiveRunStatus:live 优先,快照只在历史会话补位(§C2.2b)');

await red("V5-10 ('unknown','snapshot',{status:'killed'}) → stopped", async () => {
  assert.equal(need(V, 'effectiveRunStatus')('unknown', 'snapshot', { status: 'killed' }), 'stopped');
});

await red("V5-11 ('unknown','snapshot',{status:'completed'}) → done", async () => {
  assert.equal(need(V, 'effectiveRunStatus')('unknown', 'snapshot', { status: 'completed' }), 'done');
});

await red("V5-12 ('unknown','snapshot',{status:'failed'}) → error", async () => {
  assert.equal(need(V, 'effectiveRunStatus')('unknown', 'snapshot', { status: 'failed' }), 'error');
});

await red("V5-13 ('unknown','snapshot',{status:'paused'}) → unknown", async () => {
  assert.equal(need(V, 'effectiveRunStatus')('unknown', 'snapshot', { status: 'paused' }), 'unknown');
});

await red("V5-14 ('unknown','snapshot',null) → unknown(快照没拿到)", async () => {
  assert.equal(need(V, 'effectiveRunStatus')('unknown', 'snapshot', null), 'unknown');
});

await red("V5-15 ('unknown','snapshot',{}) → unknown(快照里没有 status 键)", async () => {
  const f = need(V, 'effectiveRunStatus');
  assert.equal(f('unknown', 'snapshot', {}), 'unknown');
  assert.equal(f('unknown', 'snapshot', undefined), 'unknown', '第三参数缺失也不许抛');
});

await red("V5-16 ('done','snapshot',{status:'killed'}) → done(live 终态优先)", async () => {
  assert.equal(need(V, 'effectiveRunStatus')('done', 'snapshot', { status: 'killed' }), 'done');
});

await red("V5-17 ('unknown','live',{status:'killed'}) → unknown(source 不是 snapshot 就不看快照)", async () => {
  assert.equal(need(V, 'effectiveRunStatus')('unknown', 'live', { status: 'killed' }), 'unknown');
});

await red("V5-18 ('running','live',null) → running", async () => {
  assert.equal(need(V, 'effectiveRunStatus')('running', 'live', null), 'running');
});

await red("V5-19 ('stopped','disk',{status:'completed'}) → stopped", async () => {
  assert.equal(need(V, 'effectiveRunStatus')('stopped', 'disk', { status: 'completed' }), 'stopped');
});

await red('V5-20 反向:source 为 live/disk/none 时,killed 快照一个都不许生效', async () => {
  const f = need(V, 'effectiveRunStatus');
  for (const src of ['live', 'disk', 'none']) {
    const got = f('unknown', src, { status: 'killed' });
    assert.equal(got, 'unknown', `source=${src} 时返回 ${got};只有 'snapshot' 这一档才准看快照`);
  }
});

await red('V5-21 反向:source 缺失 / 空串 / 未知值时也不许看快照', async () => {
  const f = need(V, 'effectiveRunStatus');
  for (const src of [undefined, null, '', 'SNAPSHOT', 'snapshots', 0]) {
    const got = f('unknown', src, { status: 'killed' });
    assert.equal(got, 'unknown', `source=${JSON.stringify(src)} 时返回 ${got}`);
  }
});

await red('V5-22 live 已有结论时(running/done/error/stopped)快照一律不得覆盖', async () => {
  const f = need(V, 'effectiveRunStatus');
  assert.equal(f('running', 'snapshot', { status: 'completed' }), 'running', '还在跑就不许被快照写成已完成');
  assert.equal(f('stopped', 'snapshot', { status: 'completed' }), 'stopped');
  assert.equal(f('done', 'snapshot', { status: 'failed' }), 'done');
  assert.equal(f('error', 'snapshot', { status: 'completed' }), 'error');
});

await red('V5-23 快照本身不是对象(字符串/数字/数组)→ unknown,且不抛', async () => {
  const f = need(V, 'effectiveRunStatus');
  for (const s of ['killed', 42, ['killed'], true]) {
    assert.equal(f('unknown', 'snapshot', s), 'unknown', `snapshot=${JSON.stringify(s)}`);
  }
  assert.equal(f('unknown', 'snapshot', { status: 42 }), 'unknown', 'status 不是字符串');
  assert.equal(f('unknown', 'snapshot', { status: null }), 'unknown', 'status 是 null');
});

// ══════════════════════════════════════════════════════════════════════════
// 三、行为链:打开旧会话(没有 live 条目)时,整张卡片显示成什么(§C2.2b 行为后果)
// ══════════════════════════════════════════════════════════════════════════
console.log('\n三、行为链:历史会话回看(真实"被停止"的快照 → 整体状态 → 每个助手)');

await green('V5-24 夹具自检:这份真实快照是 killed,两个助手当时都停在"进行中"', async () => {
  assert.equal(RAW_KILLED.status, 'killed', '夹具变了就不是 M9 那个场景了');
  assert.equal(AGENT_ROWS.length, 2, '两个助手条目');
  assert.deepEqual(AGENT_ROWS.map((e) => e.state), ['progress', 'progress'],
    '两个助手都停在 progress —— 这正是历史卡片会转圈的原料');
  assert.deepEqual(AGENT_ROWS.map((e) => e.label), ['sleep:1', 'sleep:2']);
  assert.equal(AGENT_ROWS.every((e) => e.durationMs === undefined), true,
    '条目没有 durationMs —— 耗时只能来自 startedAt,这正是 §C3-14 要管的情况');
});

await red('V5-25 被停止的旧工作流:整体 = stopped,两个助手都显示"已停止",没有一个转圈', async () => {
  const eff = need(V, 'effectiveRunStatus');
  const ads = need(V, 'agentDisplayState');
  const runStatus = eff('unknown', 'snapshot', snapWith('killed'));
  assert.equal(runStatus, 'stopped', '整体徽章必须是「已停止」而不是「状态未知」');
  const shown = AGENT_ROWS.map((e) => ads(e, runStatus));
  assert.deepEqual(shown, ['stopped', 'stopped'], `实际 ${JSON.stringify(shown)}`);
  assert.equal(shown.includes('running'), false, '历史卡片里出现"在跑" = 假转圈(M9 的原报障)');
  assert.equal(shown.includes('queued'), false, '历史卡片里出现"排队中"同样是假状态');
});

await red('V5-26 没有 live 条目时 runDisplayStatus(undefined) 与 effectiveRunStatus 串起来仍是 stopped', async () => {
  const rds = need(V, 'runDisplayStatus');
  const eff = need(V, 'effectiveRunStatus');
  assert.equal(rds(undefined), 'unknown', '历史会话没有 live 条目 → live 状态是 unknown');
  assert.equal(eff(rds(undefined), 'snapshot', snapWith('killed')), 'stopped',
    '这就是卡片顶部徽章该走的整条链路');
});

await red('V5-27 completed 快照:整体 = done,没跑完的助手显示"未知"(不谎称完成)', async () => {
  const eff = need(V, 'effectiveRunStatus');
  const ads = need(V, 'agentDisplayState');
  const runStatus = eff('unknown', 'snapshot', snapWith('completed'));
  assert.equal(runStatus, 'done');
  const shown = AGENT_ROWS.map((e) => ads(e, runStatus));
  assert.deepEqual(shown, ['unknown', 'unknown'], `实际 ${JSON.stringify(shown)}`);
});

await red('V5-28 failed 快照:整体 = error,没跑完的助手显示"未知"', async () => {
  const eff = need(V, 'effectiveRunStatus');
  const ads = need(V, 'agentDisplayState');
  const runStatus = eff('unknown', 'snapshot', snapWith('failed'));
  assert.equal(runStatus, 'error');
  const shown = AGENT_ROWS.map((e) => ads(e, runStatus));
  assert.deepEqual(shown, ['unknown', 'unknown'], `实际 ${JSON.stringify(shown)}`);
});

await red('V5-29 停止不抹掉已完成的助手:killed 快照里 state=done 的那个仍显示"已完成"', async () => {
  const eff = need(V, 'effectiveRunStatus');
  const ads = need(V, 'agentDisplayState');
  const runStatus = eff('unknown', 'snapshot', snapWith('killed'));
  const rows = [{ ...AGENT_ROWS[0], state: 'done' }, AGENT_ROWS[1]];
  assert.deepEqual(rows.map((e) => ads(e, runStatus)), ['done', 'stopped'],
    '助手自己的终态优先于整体状态(§B2 A 段),否则用户看不到"停止前已经跑完的结果"');
});

await red('V5-30 快照状态不认识时:整体 unknown;进行中的助手按 §B2 段 C 仍是 running(契约既有语义)', async () => {
  const eff = need(V, 'effectiveRunStatus');
  const ads = need(V, 'agentDisplayState');
  const runStatus = eff('unknown', 'snapshot', snapWith('cancelled'));
  assert.equal(runStatus, 'unknown', '未知状态原样透传成 unknown,不猜');
  assert.deepEqual(AGENT_ROWS.map((e) => ads(e, runStatus)), ['running', 'running'],
    '这是契约 §B2 的既有结果(残留缺口:未知状态的历史快照仍会转圈),此处只钉住它不被悄悄改掉');
});

// ══════════════════════════════════════════════════════════════════════════
// 四、源码锁:§C3 第 13/14 条(组件渲染,JSX 进不了 node,只能读文本判定)
// ══════════════════════════════════════════════════════════════════════════
console.log('\n四、卡片源码锁:整体状态从哪来、耗时什么时候显示(§C3 13/14)');

const CARD_REL = 'client/src/components/tools/WorkflowCard.jsx';
const CARD = read(CARD_REL);

// 取 fnName(...) 每次调用的实参原文(括号配平;不解析字符串里的括号,够用)
function callArgs(src, fnName) {
  const out = [];
  const needle = fnName + '(';
  let i = src.indexOf(needle);
  while (i !== -1) {
    let depth = 0;
    let j = i + needle.length - 1;
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) break;
    out.push(src.slice(i + needle.length, j));
    i = src.indexOf(needle, j);
  }
  return out;
}
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const c of text) {
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts.map((s) => s.trim()).filter((s) => s !== '');
}

await red(`V5-31 ${CARD_REL} 必须真的调用 effectiveRunStatus(`, async () => {
  assert.notEqual(CARD, '', `读不到 ${CARD_REL}`);
  assert.match(CARD, /effectiveRunStatus\s*\(/,
    '卡片里没有 effectiveRunStatus 调用 = 顶部徽章仍然只看 live 状态,历史会话照样显示「状态未知」');
});

await red('V5-32 助手行传给 agentDisplayState 的第二参数必须是有效整体状态,不能是裸 runDisplayStatus(...)', async () => {
  assert.notEqual(CARD, '', `读不到 ${CARD_REL}`);
  const calls = callArgs(CARD, 'agentDisplayState');
  assert.ok(calls.length > 0, '卡片里一次 agentDisplayState 调用都没有 —— 助手行的状态是怎么来的?');
  const bad = [];
  for (const raw of calls) {
    const args = splitTopLevel(raw);
    if (args.length < 2) { bad.push(`${raw}(只有 ${args.length} 个实参)`); continue; }
    const second = args[1];
    if (/effectiveRunStatus\s*\(/.test(second)) continue;          // 直接现算,合格
    if (/runDisplayStatus\s*\(/.test(second)) { bad.push(second); continue; } // 裸 live 状态,正是 M9 的病根
    const idm = second.match(/^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*$/);
    if (!idm) { bad.push(second); continue; }
    const last = second.split(/[.?]+/).filter(Boolean).pop();
    // 允许 const x = effectiveRunStatus(...) / const x = useMemo(() => { … effectiveRunStatus(…) }, []) 等写法:
    // 只要该名字的赋值点 300 字符内出现 effectiveRunStatus( 就算合格。
    const assigned = new RegExp(`\\b${last}\\s*[:=][^=][^]{0,300}?effectiveRunStatus\\s*\\(`);
    if (!assigned.test(CARD)) bad.push(`${second}(没找到它由 effectiveRunStatus 赋值的地方)`);
  }
  assert.deepEqual(bad, [], `这些第二参数不是有效整体状态:${JSON.stringify(bad)}`);
});

await red('V5-33 耗时不许无条件按当前时间现算(历史卡片会显示成几百分钟还一直涨)', async () => {
  assert.notEqual(CARD, '', `读不到 ${CARD_REL}`);
  // 覆盖两种写法:Date.now() - x.startedAt 与 now - x.startedAt(now = Date.now())
  const re = /(?:Date\.now\(\)|\bnow\b)\s*-\s*[^;\n)]{0,60}?startedAt/g;
  const hits = [];
  const ungated = [];
  let m;
  while ((m = re.exec(CARD)) !== null) {
    hits.push(m[0]);
    const before = CARD.slice(Math.max(0, m.index - 400), m.index);
    // "只在有效整体状态为 running 时才现算" 的门:=== 'running' / 'running' && / isRunning
    const gated = /===\s*['"`]running['"`]|['"`]running['"`]\s*(?:&&|\?|===)|\bisRunning\b|\brunning\b\s*&&/.test(before);
    if (!gated) ungated.push(m[0]);
  }
  assert.deepEqual(ungated, [],
    `扫到 ${hits.length} 处按当前时间现算耗时,其中 ${ungated.length} 处前 400 字符内看不到"整体状态为 running"的门:${JSON.stringify(ungated)}`);
});

await green('V5-34 条目自带 durationMs 时要能直接显示(§C3-14 第一种情况)', async () => {
  assert.notEqual(CARD, '', `读不到 ${CARD_REL}`);
  assert.match(CARD, /durationMs/,
    '卡片完全不引用 durationMs = 终态助手的耗时无处可取,只能违规现算');
});

// ══════════════════════════════════════════════════════════════════════════
// 五、回归:已有导出的行为不因新增而变(§C2.2 / §B2 / §C2.3 的既有数值例子)
// ══════════════════════════════════════════════════════════════════════════
console.log('\n五、回归:既有三个导出的行为一字不变');

await green('V5-35 runDisplayStatus:没有条目 → unknown;working → running', async () => {
  const f = need(V, 'runDisplayStatus');
  assert.equal(f(null), 'unknown');
  assert.equal(f(undefined), 'unknown');
  assert.equal(f({ status: 'working' }), 'running');
});

await green('V5-36 runDisplayStatus:done → done;没见过的状态 → unknown', async () => {
  const f = need(V, 'runDisplayStatus');
  assert.equal(f({ status: 'done' }), 'done');
  assert.equal(f({ status: 'needs_input' }), 'unknown');
});

await green('V5-37 agentDisplayState:整体已停止但助手已完成 → done;助手还在跑 → stopped', async () => {
  const f = need(V, 'agentDisplayState');
  assert.equal(f({ state: 'done' }, 'stopped'), 'done');
  assert.equal(f({ state: 'progress' }, 'stopped'), 'stopped');
});

await green('V5-38 agentDisplayState:整体已完成但助手只排到队 → unknown(不得是 queued)', async () => {
  const f = need(V, 'agentDisplayState');
  assert.equal(f({ state: 'start' }, 'done'), 'unknown');
  assert.equal(f({}, 'unknown'), 'unknown');
});

await green('V5-39 selectWorkflowSource:live 定格 + 同一次运行的快照 → 用快照', async () => {
  const f = need(V, 'selectWorkflowSource');
  const r = f({ live: { progress: [{ type: 'workflow_agent' }], status: 'done', taskId: 't1' },
    snapshot: { taskId: 't1', progress: [{ type: 'workflow_agent' }] } });
  assert.equal(r.source, 'snapshot');
  assert.equal(r.superseded, false);
});

await green('V5-40 selectWorkflowSource:什么都没有 → none + 固定文案', async () => {
  const f = need(V, 'selectWorkflowSource');
  assert.deepEqual(f({}), { source: 'none', superseded: false, note: '此运行未提供进度信息' });
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n—— check-r114b-client: ${PASS} 绿 / ${FAILS} 红(共 ${PASS + FAILS} 条)——`);
console.log(`   [修前应红] ${tally.RED.pass + tally.RED.fail} 条(现在绿 ${tally.RED.pass} / 红 ${tally.RED.fail})`);
console.log(`   [修前应绿] ${tally.GREEN.pass + tally.GREEN.fail} 条(现在绿 ${tally.GREEN.pass} / 红 ${tally.GREEN.fail})`);
if (FAILS) {
  console.log('红的条目:');
  for (const n of failed) console.log(`  ✗ ${n}`);
}
process.exit(FAILS ? 1 : 0);
