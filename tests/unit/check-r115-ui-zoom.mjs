// r115:界面缩放(<html> style.zoom)污染 mermaid 折行判据 —— 回归锁。
//
// 背景(真机实测,worktree r115,WebKit 1280x1000,界面缩放 1.2):
//   一张 12 节点的 genui 流程图里 8 个节点的文字被裁掉。mermaid 给标签先套
//   `white-space:nowrap; max-width:200px`,量一次 getBoundingClientRect(),
//   **只有 rect.width === 200 时**才改判成 break-spaces 让文字折行(mermaid 11
//   dist 的 addHtmlSpan)。zoom=1.2 时 rect 宽是 240,等式永不成立 → 长标签停在
//   不折行、超出 200px 的部分被节点框裁掉。修法:离屏测量容器就地把 zoom 抵消回 1。
//   修前 8/12 被裁,修后 0/12(证据 .devflow/GENUI-ZOOM-EVIDENCE-r115.md)。
//
// 这里锁两层:①host-zoom.ts 的纯逻辑(node 里注入假 DOM 直接跑);②两个 mermaid 渲染
// 入口确实用上了它(源码锁 —— 真实折行行为要浏览器,node 测不到)。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; } };

let pass = 0; let fail = 0;
const check = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n      ${e.message}`); }
};

// ── 假 DOM:只提供 host-zoom.ts 用到的两个全局 ──────────────────────────────
function withFakeDom(zoomValue, fn) {
  const prevDoc = globalThis.document;
  const prevGCS = globalThis.getComputedStyle;
  globalThis.document = { documentElement: {}, body: null, createElement: () => ({ style: {} }) };
  globalThis.getComputedStyle = (el) => (el === globalThis.document.documentElement ? { zoom: zoomValue } : { zoom: '1' });
  try { return fn(); }
  finally {
    if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc;
    if (prevGCS === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = prevGCS;
  }
}

const mod = await import(pathToFileURL(join(ROOT, 'client/src/genui/host/host-zoom.ts')).href);

console.log('\nA 纯逻辑(client/src/genui/host/host-zoom.ts)');

await check('A1 无 DOM 环境(node 直跑)hostUiZoom() 返回 1,不抛', () => {
  assert.equal(mod.hostUiZoom(), 1);
});

await check('A2 zoom=1.2 时读出 1.2', () => {
  withFakeDom('1.2', () => assert.equal(mod.hostUiZoom(), 1.2));
});

await check('A3 zoom 是非法值 / 空 / 0 时一律回落 1(绝不返回 0 导致除零)', () => {
  for (const v of ['', 'normal', '0', 'abc', undefined, null, 'NaN']) {
    withFakeDom(v, () => assert.equal(mod.hostUiZoom(), 1, `zoom=${JSON.stringify(v)} 应回落 1`));
  }
});

await check('A4 zoom=1.2 时 neutralizeHostZoom 把元素 zoom 设成倒数', () => {
  withFakeDom('1.2', () => {
    const el = { style: {} };
    const z = mod.neutralizeHostZoom(el);
    assert.equal(z, 1.2);
    assert.equal(el.style.zoom, String(1 / 1.2), '必须写倒数,量出来才是未缩放的 CSS px');
  });
});

await check('A5 zoom=1 时不写任何内联样式(不留无谓痕迹)', () => {
  withFakeDom('1', () => {
    const el = { style: {} };
    assert.equal(mod.neutralizeHostZoom(el), 1);
    assert.equal('zoom' in el.style, false, 'zoom 本来就是 1,不该写 style.zoom');
  });
});

await check('A6 传 null/undefined 不抛(调用点不必先判空)', () => {
  withFakeDom('1.5', () => {
    assert.equal(mod.neutralizeHostZoom(null), 1.5);
    assert.equal(mod.neutralizeHostZoom(undefined), 1.5);
  });
});

// ── 源码锁:两个 mermaid 渲染入口都要用上它 ──────────────────────────────
console.log('\nB 两个 mermaid 渲染入口的接线(源码锁)');

const CORE = read('client/src/genui/upstream/mermaid-core.ts');
const ART = read('client/src/components/ArtifactPreview.jsx');

await check('B1 genui 的 mermaid-core 导入并调用 neutralizeHostZoom', () => {
  assert.notEqual(CORE, '', 'mermaid-core.ts 读不到');
  assert.match(CORE, /import\s*\{[^}]*neutralizeHostZoom[^}]*\}\s*from\s*['"][^'"]*host-zoom\.ts['"]/);
  assert.match(CORE, /neutralizeHostZoom\s*\(\s*container\s*\)/);
});

await check('B2 抵消必须发生在把容器挂进文档之前(挂上去之后再改 zoom 已经量过一次了)', () => {
  const iNeutral = CORE.indexOf('neutralizeHostZoom(container)');
  const iAppend = CORE.indexOf('document.body?.appendChild(container)');
  assert.ok(iNeutral > 0 && iAppend > 0, '两个调用点都要在');
  assert.ok(iNeutral < iAppend, `neutralizeHostZoom 应在 appendChild 之前(现在 ${iNeutral} vs ${iAppend})`);
});

await check('B3 ArtifactPreview 的 mermaid.render 传了离屏容器(不再让 mermaid 自己在 body 上建)', () => {
  assert.notEqual(ART, '', 'ArtifactPreview.jsx 读不到');
  assert.match(ART, /import\s*\{[^}]*createOffscreenHost[^}]*\}\s*from\s*['"][^'"]*host-zoom\.ts['"]/);
  assert.match(ART, /mermaid\.render\(\s*id\s*,\s*code\s*,\s*host\s*\)/,
    'render 必须带第三个参数(容器),否则 mermaid 在 body 上建元素,量到的是被缩放过的宽度');
});

await check('B4 ArtifactPreview 用完必须移除离屏容器(否则每渲一张图漏一个节点)', () => {
  assert.match(ART, /createOffscreenHost\(\)[\s\S]{0,200}?host\.remove\(\)/);
});

await check('B5 host-zoom.ts 只读根元素的 zoom,不去改它(改了会连累整页布局)', () => {
  const SRC = read('client/src/genui/host/host-zoom.ts');
  assert.notEqual(SRC, '', 'host-zoom.ts 读不到');
  // 判的是代码不是注释:文档注释里要引用 sessionStore 那行赋值来交代缩放的来源。
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.equal(/documentElement\.style\.zoom\s*=/.test(code), false, '不得写根元素的 zoom');
});

console.log(`\n—— check-r115-ui-zoom: ${pass} 绿 / ${fail} 红(共 ${pass + fail} 条)——`);
process.exit(fail ? 1 : 0);
