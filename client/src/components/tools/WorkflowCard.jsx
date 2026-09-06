import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Layers, Loader2, Square } from '../Icon.jsx';
import { useStore } from '../../stores/sessionStore.js';
import { resolveOwnedAgent } from '../../utils/agentOwner.js';
import { confirmDialog } from '../../utils/confirmDialog.jsx';
import { ElapsedTime } from '../LoadingBits.jsx';
import {
  agentDisplayState, getWorkflowSnapshot, groupWorkflowPhases,
  phaseRowQuota, resolveRunRef, runDisplayStatus, selectWorkflowSource,
} from '../../utils/workflowView.js';

// 工作流卡片:聊天内联与监控面板共用的唯一渲染组件。
//
// 数据来自两条路(实时进度表 / 磁盘快照),由 selectWorkflowSource 一次判定该看哪份;
// 本组件只负责把选中的那份画出来,不做任何来源推断,也不解析工具正文。
//
// 内层助手【没有停止按钮】:CLI 的停止指令只认"任务"这一级,工作流内部的助手没有
// 任务编号可指,拿 agentId 去调只会静默落空并显示误导性的"任务表中已不存在"。

// 助手/运行状态共用一个徽章:cached / skipped / blocked / stopped / unknown 走同一套
// 中性样式,只换文案 —— 前两者在真实运行里极罕见,不值得各写一套配色。
const STATE_META = {
  queued:  { label: '排队',   cls: 'text-ink-faint bg-canvas-warm border-canvas-deep' },
  running: { label: '在跑',   cls: 'text-blue-700 bg-blue-50 border-blue-200' },
  done:    { label: '完成',   cls: 'text-green-700 bg-green-50 border-green-200' },
  error:   { label: '失败',   cls: 'text-red-700 bg-red-50 border-red-200' },
  cached:  { label: '完成(缓存命中)', cls: 'text-ink-muted bg-canvas-warm border-canvas-deep' },
  skipped: { label: '已跳过', cls: 'text-ink-muted bg-canvas-warm border-canvas-deep' },
  blocked: { label: '已拦截', cls: 'text-ink-muted bg-canvas-warm border-canvas-deep' },
  stopped: { label: '已停止', cls: 'text-ink-muted bg-canvas-warm border-canvas-deep' },
  unknown: { label: '未知',   cls: 'text-ink-faint bg-canvas-warm border-canvas-deep' },
};
const RUN_LABEL = { running: '运行中', done: '已完成', error: '失败', stopped: '已停止', unknown: '状态未知' };
const ACTIVE_STATES = new Set(['running', 'queued']);
const HYDRATE_STATUS = {
  done: 'done', cached: 'done',
  error: 'error', blocked: 'error', skipped: 'error',
  stopped: 'stopped', running: 'working', queued: 'working', unknown: 'stopped',
};

function Badge({ state, label }) {
  const m = STATE_META[state] || STATE_META.unknown;
  return (
    <span className={`shrink-0 px-1.5 py-px rounded border text-[10px] font-body leading-4 ${m.cls}`}>
      {label || m.label}
    </span>
  );
}

// 模型与外部工具产出的文本一律先过硬上限再交给 React 渲染(CSS 截断只挡视觉,
// 一条 40KB 的 label 照样进 DOM)。
function clip(v, max = 200) {
  const s = v == null ? '' : String(v);
  return s.length > max ? s.slice(0, max) + '…' : s;
}
function fmtTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
// 助手耗时:终态取 CLI 算好的 durationMs,在跑的按 startedAt 现算。
// 不挂每秒定时器 —— 一次工作流最多渲 200 行,每秒重渲整卡不值当;进度表本身每 10s
// 到一次,届时自然刷新。
function agentDuration(entry) {
  if (Number.isFinite(entry?.durationMs)) return fmtDuration(entry.durationMs);
  if (Number.isFinite(entry?.startedAt)) return fmtDuration(Date.now() - entry.startedAt);
  return null;
}

function AgentRow({ entry, index, state, onOpen, compact }) {
  const label = clip(entry?.label) || `助手 ${index + 1}`;
  const tokens = fmtTokens(entry?.tokens);
  const dur = agentDuration(entry);
  const lastTool = clip(entry?.lastToolSummary || entry?.lastToolName, 200);
  const openable = !!entry?.agentId && typeof onOpen === 'function';
  return (
    <div
      role={openable ? 'button' : undefined}
      tabIndex={openable ? 0 : undefined}
      onClick={openable ? onOpen : undefined}
      title={openable ? `${label}\n点击查看该助手的完整对话` : label}
      className={`flex items-center gap-2 px-2 py-1 rounded-md text-[11px] font-body transition-colors ${
        openable ? 'cursor-pointer hover:bg-canvas-warm' : ''
      }`}
    >
      <span className="shrink-0 w-3 flex items-center justify-center">
        {state === 'running'
          ? <Loader2 size={10} className="text-blue-600 animate-spin" />
          : <span className={`w-1.5 h-1.5 rounded-full ${
              state === 'done' || state === 'cached' ? 'bg-success'
                : state === 'error' ? 'bg-error'
                  : state === 'queued' ? 'bg-ink-ghost' : 'bg-ink-faint'
            }`} />}
      </span>
      <span className="flex-1 min-w-0 truncate text-ink">{label}</span>
      {lastTool && !compact && (
        <span className="min-w-0 max-w-[9rem] truncate font-mono text-[10px] text-ink-faint" title={lastTool}>
          {lastTool}
        </span>
      )}
      {dur && <span className="shrink-0 font-mono text-[10px] text-ink-faint tabular-nums">{dur}</span>}
      {tokens && <span className="shrink-0 font-mono text-[10px] text-ink-faint tabular-nums">{tokens}</span>}
      <Badge state={state} />
    </div>
  );
}

function WorkflowCardImpl({ toolUseId, ownerSessionId = null, toolCall = null, fallbackAgents = null, compact = false, onOpenAgent = null }) {
  // 归属校验:activeAgents 按 tool_use.id 全局唯一,分支(fork)会话复制出的卡片撞源
  // 会话的 id —— 不校验就会渲染源会话正在跑的工作流,停止键也停到源会话头上。
  const agent = resolveOwnedAgent(useStore((s) => s.activeAgents[toolUseId]), ownerSessionId);
  const [snapshot, setSnapshot] = useState(null);
  const askedRef = useRef(false);
  const foldDefaults = useRef(new Map());
  const [override, setOverride] = useState(() => new Map());
  const [showAll, setShowAll] = useState(() => new Set());
  const [resultFull, setResultFull] = useState(false);

  const runStatus = runDisplayStatus(agent);
  const { ref, taskId } = resolveRunRef({ toolCall, agent });

  // 快照只在【非运行中】取一次:live 还在跑时读快照 = 读到上一轮续跑覆写的记录,
  // 界面会谎称"已完成"。失败静默(不弹窗、不重试),降级链自会退到 live 定格。
  useEffect(() => {
    if (askedRef.current || !ref || runStatus === 'running') return;
    askedRef.current = true;
    let alive = true;
    getWorkflowSnapshot(ref).then((s) => { if (alive && s) setSnapshot(s); });
    return () => { alive = false; };
  }, [ref?.runId, ref?.projectHash, ref?.sid, runStatus]);

  const pick = selectWorkflowSource({
    live: agent ? { progress: agent.wfProgress || null, status: runStatus, taskId: agent.taskId || null, startedAt: agent.startedAt ?? null } : null,
    snapshot,
    cardTaskId: taskId,
    fallbackAgents,
  });
  const rows = pick.source === 'snapshot' ? (snapshot?.progress || []) : (agent?.wfProgress || []);
  const groups = useMemo(() => groupWorkflowPhases(pick.source === 'disk' || pick.source === 'none' ? null : rows), [rows, pick.source]);
  const quota = phaseRowQuota(groups.length);
  const totals = useMemo(() => {
    let agents = 0; let tokens = 0; let toolCalls = 0;
    for (const g of groups) {
      for (const a of g.agents) {
        agents += 1;
        if (Number.isFinite(a.tokens)) tokens += a.tokens;
        if (Number.isFinite(a.toolCalls)) toolCalls += a.toolCalls;
      }
    }
    return { agents, tokens, toolCalls };
  }, [groups]);

  const name = clip(agent?.name || snapshot?.workflowName || toolCall?.input?.name || 'workflow', 80);
  const meta = [
    groups.length > 0 ? `${groups.length} 阶段` : null,
    totals.agents > 0 ? `${totals.agents} 助手` : null,
    fmtTokens(totals.tokens) ? `${fmtTokens(totals.tokens)} tokens` : null,
    totals.toolCalls > 0 ? `${totals.toolCalls} 次工具` : null,
  ].filter(Boolean).join(' · ');
  const canStop = runStatus === 'running' && !!agent;

  const stopWorkflow = async (e) => {
    e?.stopPropagation?.();
    const ok = await confirmDialog('停止整个工作流?正在运行的助手会被中止,已完成的结果保留。', { danger: true });
    if (!ok) return;
    const r = await useStore.getState().stopSingleTask(ownerSessionId || agent?.sessionId || null, toolUseId);
    if (r?.stopped) return;   // 权威终态随后到达,无需额外提示
    confirmDialog(r?.procAlive
      ? '工作流已不在运行任务表中(可能已结束或进程已回收)'
      : '本回合的对话进程已结束,无法再从这里停止工作流。', { confirmText: '知道了' });
  };

  // 点开单个助手看完整对话:复用既有子代理视图链路(store 键 'agent-<agentId>' +
  // 会话消息端点已支持回退扫 subagents/workflows)。projectHash 只来自服务端下发的
  // 运行引用,拿不到就不发请求(只展示进度表里已有的字段)。
  const openAgent = (entry) => {
    if (!entry?.agentId || typeof onOpenAgent !== 'function') return;
    const key = 'agent-' + entry.agentId;
    const st = useStore.getState();
    if (!st.activeAgents[key]) {
      st.upsertAgent(key, {
        // hydrated:这条是为了看转写现补的,不进监控桶、不被 level 剪枝。
        hydrated: true,
        wfInner: true,
        name: clip(entry.label, 80) || entry.agentId,
        agentType: entry.agentType || null,
        model: entry.model || null,
        description: clip(entry.lastToolSummary) || '',
        status: HYDRATE_STATUS[agentDisplayState(entry, runStatus)] || 'stopped',
        startedAt: Number.isFinite(entry.startedAt) ? entry.startedAt : Date.now(),
        sessionId: ownerSessionId || null,
      });
      const hash = ref?.projectHash;
      if (hash) {
        fetch(`/api/sessions/${encodeURIComponent(key)}/messages?projectHash=${encodeURIComponent(hash)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            const msgs = Array.isArray(d) ? d : (d?.messages || []);
            const text = []; const thinking = []; const toolCalls = [];
            for (const m of msgs) {
              if (m.type !== 'turn') continue;
              if (Array.isArray(m.thinking)) thinking.push(...m.thinking);
              if (Array.isArray(m.text)) text.push(...m.text);
              if (Array.isArray(m.toolCalls)) toolCalls.push(...m.toolCalls);
            }
            if (text.length || thinking.length || toolCalls.length) {
              useStore.getState().upsertAgent(key, { text, thinking, toolCalls });
            }
          })
          .catch(() => {});
      }
    }
    onOpenAgent(key);
  };

  // 展开态 = 用户设定 ?? 首次见到该阶段时算出的默认值(算完冻住)。每 10s 一份新进度
  // 表既不能把用户折起来的阶段重新弹开,也不该在阶段跑完那一刻自己收起。
  const anyActive = groups.some((g) => g.agents.some((a) => ACTIVE_STATES.has(agentDisplayState(a, runStatus))));
  // 全终态时展开最后【一个派过助手的】阶段:阶段是开跑前就全量预告的,收尾时的最后
  // 一组常常是没派出助手的空阶段,展开它等于把真正有结果的那组藏起来。
  const withAgents = groups.filter((g) => g.agents.length);
  const lastKey = (withAgents.length ? withAgents[withAgents.length - 1] : groups[groups.length - 1])?.key ?? null;
  const isOpen = (g) => {
    if (override.has(g.key)) return override.get(g.key);
    if (!foldDefaults.current.has(g.key)) {
      const active = g.agents.some((a) => ACTIVE_STATES.has(agentDisplayState(a, runStatus)));
      foldDefaults.current.set(g.key, active || (!anyActive && g.key === lastKey));
    }
    return foldDefaults.current.get(g.key);
  };
  const toggle = (key, open) => setOverride((p) => { const n = new Map(p); n.set(key, !open); return n; });

  const pad = compact ? 'px-2.5' : 'px-3';
  const resultText = pick.source === 'snapshot' && snapshot?.result != null ? String(snapshot.result) : '';
  const errorText = pick.source === 'snapshot' && snapshot?.error ? String(snapshot.error) : '';
  const cap = resultFull ? 20000 : 4000;

  return (
    <div data-cgui="workflow-card" className="border border-canvas-deep rounded-lg overflow-hidden bg-canvas animate-fade-up">
      {/* 头:工作流名 · 整体状态 · 规模 · 停止整个工作流 */}
      <div className={`${pad} py-2 flex items-start gap-2.5 bg-canvas-warm/60 border-b border-canvas-deep`}>
        <span className="shrink-0 mt-px w-5 h-5 rounded-md bg-accent-subtle flex items-center justify-center text-ink-muted">
          <Layers size={12} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[12px] text-ink font-body truncate" title={name}>{name}</span>
            <Badge state={runStatus} label={RUN_LABEL[runStatus]} />
            {runStatus === 'running' && Number.isFinite(agent?.startedAt) && <ElapsedTime startedAt={agent.startedAt} />}
          </div>
          {meta && <div className="mt-0.5 truncate text-[10px] text-ink-faint font-body" title={meta}>{meta}</div>}
        </div>
        {canStop && (
          <button
            onClick={stopWorkflow}
            className="shrink-0 px-1.5 py-px rounded border border-canvas-deep bg-canvas text-[10px] text-ink-muted hover:text-error hover:border-error/40 hover:bg-error/10 transition-colors font-body flex items-center gap-1"
            title="停止整个工作流"
          >
            <Square size={9} className="fill-current" />{!compact && '停止整个工作流'}
          </button>
        )}
      </div>

      {/* 降级横幅:续跑覆盖 / 未留下阶段信息 / 未提供进度信息。启动窗内单独走骨架。 */}
      {pick.note && pick.note !== '正在启动…' && (
        <div className={`${pad} py-1.5 text-[10px] font-body border-b border-canvas-deep ${
          pick.superseded ? 'bg-amber-50 text-amber-700' : 'bg-canvas-warm text-ink-muted'
        }`}>
          {pick.note}
        </div>
      )}

      {pick.note === '正在启动…' && (
        <div className={`${pad} py-2 flex items-center gap-2 text-[11px] text-ink-muted font-body`}>
          <Loader2 size={11} className="animate-spin text-ink-faint" />正在启动…
        </div>
      )}

      {/* 体:阶段分组 → 助手行。每阶段行数按配额裁,超出折进「显示全部」。 */}
      {groups.length > 0 && (
        <div className="divide-y divide-canvas-deep">
          {groups.map((g) => {
            const open = isOpen(g);
            const full = showAll.has(g.key);
            const shown = full ? g.agents : g.agents.slice(0, quota);
            const doneCount = g.agents.filter((a) => ['done', 'cached'].includes(agentDisplayState(a, runStatus))).length;
            return (
              <div key={g.key}>
                <button
                  onClick={() => toggle(g.key, open)}
                  className={`w-full ${pad} py-1.5 flex items-center gap-2 hover:bg-canvas-warm transition-colors text-left`}
                >
                  {open ? <ChevronDown size={11} className="shrink-0 text-ink-faint" /> : <ChevronRight size={11} className="shrink-0 text-ink-faint" />}
                  <span className="shrink-0 w-4 text-center font-mono text-[10px] text-ink-faint tabular-nums">
                    {g.index == null ? '·' : g.index}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-[11px] text-ink font-body" title={g.title}>{clip(g.title, 80)}</span>
                  <span className="shrink-0 font-mono text-[10px] text-ink-faint tabular-nums">
                    {doneCount}/{g.agents.length}
                  </span>
                </button>
                {open && g.agents.length > 0 && (
                  <div className={`${compact ? 'px-1.5' : 'px-2'} pb-1.5 space-y-px`}>
                    {shown.map((a, i) => (
                      <AgentRow
                        key={a.agentId ?? ('i' + i)}
                        entry={a}
                        index={i}
                        state={agentDisplayState(a, runStatus)}
                        compact={compact}
                        onOpen={() => openAgent(a)}
                      />
                    ))}
                    {!full && g.agents.length > quota && (
                      <button
                        onClick={() => setShowAll((p) => new Set(p).add(g.key))}
                        className="w-full px-2 py-1 text-left text-[10px] text-ink-faint hover:text-ink-muted font-body"
                      >
                        显示全部 ({g.agents.length})
                      </button>
                    )}
                  </div>
                )}
                {open && g.agents.length === 0 && (
                  <div className={`${pad} pb-1.5 text-[10px] text-ink-faint font-body`}>该阶段尚未派出助手</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 降级序 5:磁盘裸列表(只有 agentId / 类型 / 三态,没有阶段与标签)。 */}
      {pick.source === 'disk' && (
        <div className={`${compact ? 'px-1.5' : 'px-2'} py-1.5 space-y-px`}>
          {(fallbackAgents || []).map((a, i) => (
            <div key={a?.id ?? ('i' + i)} className="flex items-center gap-2 px-2 py-1 text-[11px] font-body">
              <span className="flex-1 min-w-0 truncate font-mono text-ink-muted">
                {clip(a?.agentType, 80) || 'agent'} <span className="text-ink-faint">#{String(a?.id ?? '').slice(-4)}</span>
              </span>
              <Badge state={a?.status === 'running' ? 'running' : (a?.status === 'done' ? 'done' : 'unknown')}
                label={a?.status === 'idle' ? '空闲' : undefined} />
            </div>
          ))}
        </div>
      )}

      {/* 结果与报错:一律纯文本,不走 markdown —— 这段内容全部由助手与外部工具产出。 */}
      {(resultText || errorText) && (
        <div className={`${pad} py-2 border-t border-canvas-deep space-y-2`}>
          {errorText && (
            <pre className="text-[11px] font-mono whitespace-pre-wrap p-2 rounded bg-red-50 text-red-700 max-h-48 overflow-y-auto">
              {errorText.slice(0, cap)}
            </pre>
          )}
          {resultText && (
            <details>
              <summary className="cursor-pointer text-[10px] text-ink-faint uppercase tracking-wider font-body">运行结果</summary>
              <pre className="text-[11px] font-mono whitespace-pre-wrap mt-2 p-2 rounded bg-canvas-warm text-ink-muted max-h-64 overflow-y-auto">
                {resultText.slice(0, cap)}
              </pre>
            </details>
          )}
          {!resultFull && (resultText.length > cap || errorText.length > cap) && (
            <button onClick={() => setResultFull(true)} className="text-[10px] text-ink-faint hover:text-ink-muted font-body">
              展开更多
            </button>
          )}
        </div>
      )}

      {/* 内层助手行没有停止按钮,原因写在这里,免得用户以为按钮丢了。 */}
      {totals.agents > 0 && (
        <div className={`${pad} py-1.5 border-t border-canvas-deep text-[10px] text-ink-faint font-body`}>
          工作流内的单个助手无法单独停止;可停止整个工作流。
        </div>
      )}
    </div>
  );
}

// 每 10s 一份全量进度表 + 长会话里可能同时挂着几十张卡片:不 memo 会把整条会话重渲。
export const WorkflowCard = React.memo(WorkflowCardImpl);
