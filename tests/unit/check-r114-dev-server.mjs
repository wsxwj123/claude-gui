#!/usr/bin/env node
// r114 开发侧白盒自测:只测验收测试够不着的那一段 —— 消息泵/deliverLine 共用的
// projectWorkflowProgressMessage 的【门】。
//
// 为什么单独测:验收的 A3 段是用 projectWorkflowProgress 复刻投影口径写的,复刻不了
// "哪些消息该被改写"这一步。门写错(比如错认成 task_started、或把纯心跳补成空表)时
// 验收全绿、真机上进度表每 10s 闪一次空白。
//
// Run: node tests/unit/check-r114-dev-server.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectWorkflowProgressMessage } from '../../server/routes/chat.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EV = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/r114/spike-wf-progress-2.json'), 'utf8'));

// 1. 带表的 task_progress:整表投影,其余字段一字不动,原对象不被改写。
{
  const out = projectWorkflowProgressMessage(EV);
  assert.ok(out && out !== EV, '必须返回新对象(原消息不许就地改写)');
  assert.equal(out.workflow_progress.length, 4);
  assert.equal('promptPreview' in out.workflow_progress[2], false, '提示词原文必须被砍掉');
  assert.equal('promptPreview' in EV.workflow_progress[2], true, '入参不得被就地改写');
  const { workflow_progress: _a, ...restOut } = out;
  const { workflow_progress: _b, ...restIn } = EV;
  assert.deepEqual(restOut, restIn, 'task_id/tool_use_id/description/summary/usage 必须原样');
}

// 2. 纯心跳(不带表)→ null:调用方据此原样透传,且【不广播】。
//    实证 6 条 task_progress 里 4 条不带表;补成 [] 会把前端已有的进度整表清空。
assert.equal(projectWorkflowProgressMessage(
  { type: 'system', subtype: 'task_progress', task_id: 't1', description: 'x' }), null);
assert.equal(projectWorkflowProgressMessage(
  { type: 'system', subtype: 'task_progress', workflow_progress: null }), null);
assert.equal(projectWorkflowProgressMessage(
  { type: 'system', subtype: 'task_progress', workflow_progress: '[]' }), null);

// 3. 门:只认 system/task_progress。别的消息带了同名字段也不改写(改写 = 下游按
//    task_progress 的形状解一条不是 task_progress 的消息)。
for (const m of [
  { type: 'system', subtype: 'task_started', workflow_progress: [{ type: 'workflow_phase', index: 1, title: 'A' }] },
  { type: 'assistant', subtype: 'task_progress', workflow_progress: [{ type: 'workflow_phase', index: 1, title: 'A' }] },
  { type: 'system', workflow_progress: [{ type: 'workflow_phase', index: 1, title: 'A' }] },
  null, undefined, 'x', 42,
]) {
  assert.equal(projectWorkflowProgressMessage(m), null, `不该被改写:${JSON.stringify(m)}`);
}

// 4. 空表是合法的"当前没有条目":照常改写(不塌成 null),否则首条空表事件会被当心跳丢掉。
{
  const out = projectWorkflowProgressMessage({ type: 'system', subtype: 'task_progress', workflow_progress: [] });
  assert.deepEqual(out.workflow_progress, []);
}

console.log('check-r114-dev-server: all assertions passed');
