#!/usr/bin/env node
// r114c/G9:历史接线的正文前置判据必须容忍缺 content 的 tool_result。
//
// 回归背景:workflowRunOf 的前置判据对"序列化后的正文"直接调 .includes(),而 tool_result
// 缺 content 键时该值是 undefined(JSON.stringify(undefined) 返回 undefined)→ TypeError,
// 这条路径外层没有 try/catch → 整个会话的历史读取 500,一条坏块让会话打不开。
//
// 白盒:直接 import session-reader 跑完整读取路径(不起服务、不占端口)。HOME 指向临时
// 沙箱后再动态 import —— PROJECTS_DIR 在模块加载时由 homedir() 定,先 import 就会指向真家目录。
//
// Run: node tests/unit/check-r114c-reader-guard.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'r114c-home-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

const HASH = '-tmp-r114c-proj';
const PROJ = join(HOME, '.claude', 'projects', HASH);
mkdirSync(PROJ, { recursive: true });

const CWD = join(HOME, 'proj');
const TDIR = `/Users/x/.claude/projects/${HASH}/aaaa-bbbb/subagents/workflows/wf_631a4c46-1d3`;
const LAUNCH = `Workflow launched in background. Task ID: w1zi6gd0p\nTranscript dir: ${TDIR}`;

// 一条 user 提问 + 一条 assistant tool_use + 一条 user tool_result 的最小会话。
const writeSession = (sid, toolName, block) => {
  const rows = [
    { type: 'user', uuid: 'u1', sessionId: sid, cwd: CWD, timestamp: '2026-09-07T00:00:00.000Z', message: { role: 'user', content: '跑一下' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', sessionId: sid, cwd: CWD, timestamp: '2026-09-07T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: block.tool_use_id, name: toolName, input: { script: 'x' } }] } },
    { type: 'user', uuid: 'u2', parentUuid: 'a1', sessionId: sid, cwd: CWD, timestamp: '2026-09-07T00:00:02.000Z', message: { role: 'user', content: [block] } },
  ];
  writeFileSync(join(PROJ, `${sid}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
};

const SID_NOCONTENT = '11111111-aaaa-1111-aaaa-111111111111';  // tool_result 没有 content 键
const SID_TEXT = '22222222-aaaa-2222-aaaa-222222222222';       // 正文兜底(字符串正文)
const SID_ARRAY = '33333333-aaaa-3333-aaaa-333333333333';      // 正文是块数组(非字符串)

writeSession(SID_NOCONTENT, 'Bash', { tool_use_id: 'toolu_nc01', type: 'tool_result', is_error: false });
writeSession(SID_TEXT, 'Workflow', { tool_use_id: 'toolu_tx01', type: 'tool_result', content: LAUNCH, is_error: false });
writeSession(SID_ARRAY, 'Workflow', { tool_use_id: 'toolu_ar01', type: 'tool_result', content: [{ type: 'text', text: LAUNCH }], is_error: false });

const { getSessionMessages } = await import('../../server/services/session-reader.js');
const firstToolCall = async (sid) => ((await getSessionMessages(sid, HASH)).messages || []).flatMap((m) => m.toolCalls || [])[0];

let PASS = 0;
let FAILS = 0;
async function check(name, fn) {
  try { await fn(); PASS++; console.log(`  ✓ ${name}`); }
  catch (e) { FAILS++; console.log(`  ✗ ${name}\n      ${String(e?.message || e).split('\n').slice(0, 4).join('\n      ')}`); }
}

console.log('\nG9 历史接线对缺 content 的 tool_result 的容忍');

await check('G9-1 缺 content 的 tool_result:整段历史读取不抛(改前 TypeError → 会话 500)', async () => {
  const { messages } = await getSessionMessages(SID_NOCONTENT, HASH);
  assert.ok(Array.isArray(messages) && messages.length > 0, '会话必须能读出消息');
});

await check('G9-2 缺 content 的结果不加 workflowRun,其余字段照给', async () => {
  const tc = await firstToolCall(SID_NOCONTENT);
  assert.equal(tc.result.toolUseId, 'toolu_nc01');
  assert.equal(tc.result.isError, false);
  assert.equal('workflowRun' in tc.result, false, '缺正文的结果不许被当成工作流');
});

await check('G9-3 控制组:字符串正文的工作流仍走兜底,workflowRun 照出', async () => {
  const tc = await firstToolCall(SID_TEXT);
  assert.equal(tc.result.workflowRun?.runId, 'wf_631a4c46-1d3', '归一不得把正文兜底整条关掉');
  assert.equal(tc.result.workflowRun.taskId, 'w1zi6gd0p');
});

await check('G9-4 控制组:块数组正文(非字符串)序列化后仍能兜底', async () => {
  const tc = await firstToolCall(SID_ARRAY);
  assert.equal(tc.result.workflowRun?.runId, 'wf_631a4c46-1d3');
});

try { rmSync(HOME, { recursive: true, force: true }); } catch {}

console.log(`\n通过 ${PASS} / 失败 ${FAILS}`);
process.exit(FAILS === 0 ? 0 : 1);
