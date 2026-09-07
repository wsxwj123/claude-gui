# r115 证据:genui 图示文字被裁 = 界面缩放污染了 mermaid 的折行判据

用户 2026-09-07 报:genui 渲染的流程图「第二行的『中性粒与…』显示不全」,会话 `89373ffb`。

## 复现(真实 app,不是隔离环境)

沙箱 HOME(`scratchpad/r114-real/home`)里造一个会话,原样写入该会话里那段 `cgui-ui` 围栏;
worktree 的 `server/index.js` 起在 6705;WebKit(与桌面 app 同内核)1280×1000 打开,读
`[data-genui-mermaid]` 里每个节点的框宽与标签内文字宽度。脚本:`scratchpad/r115-mermaid/genui-app-repro.mjs`。

改前:**12 个节点里 8 个的文字被裁**(`scrollWidth > clientWidth`)。

```
✗被裁 A-0   框宽 300  文字 scroll=256 client=200  ws=nowrap  「VNP20009 静脉注射 定植肿瘤乏氧核」
✗被裁 B-1   框宽 300  文字 scroll=348 client=200  ws=nowrap  「招募 CD11b 阳性髓系细胞 中性粒与巨噬大量涌入」
· 正常 C-3   框宽 245  文字 scroll=154 client=154  ws=nowrap  「吞噬与 NETs 清除细菌」
✗被裁 F-9 / G-11 / I-17 / J-19 / K-21 / L-23  同 B-1 形态
被裁节点数: 8 / 12
```

## 排除的两条错误假设(都做了实验)

1. **字体不一致**:标签实际生效字体是 mermaid 自己的 `trebuchet ms, verdana, arial, sans-serif`,
   不受 genui 容器的 `Newsreader, Georgia, serif` 影响;把容器字体强行换成 body 那套,
   被裁数仍是 8/12(`scratchpad/r115-mermaid/font-proof.txt`)。
2. **WebKit 不支持 `white-space: break-spaces`**:同一段源码在干净空白页里(Chromium 与 WebKit
   都试过)正常折行成 2 行,不被裁(`verify-fix.mjs`)。

## 真正的根因

mermaid 11 `addHtmlSpan`(`client/node_modules/mermaid/dist/**`)决定标签折不折行的写法:

```js
// div 先套 white-space: nowrap; max-width: <width>px
let bbox = div.node().getBoundingClientRect();
if (bbox.width === width) {                  // ← 精确相等
  div.style('display', 'table');
  div.style('white-space', 'break-spaces');  // 只有这里才允许折行
  div.style('width', width + 'px');
}
```

而 CC-GUI 的界面缩放写在根元素上(`client/src/stores/sessionStore.js`:`document.documentElement.style.zoom = String(n)`),
`getBoundingClientRect()` 返回的是**缩放后**的值。实测(`eq-proof.txt`):

| 环境 | 根元素 zoom | 量到的宽 | `=== 200` |
|---|---|---|---|
| 真实 app 页面 | 1.2 | **240**(offsetWidth 仍是 200) | **false** |
| 干净空白页 | 1 | 200 | true |

于是缩放不是 100% 时,这个相等判断永远不成立 → 长标签停在 `white-space:nowrap` + `max-width:200px`
→ 超出 200px 的部分被节点框裁掉。短标签(自然宽度 < 200px)不受影响,所以只有一部分节点出问题。

这也解释了用户的直觉「字体调大就显示不全」:界面缩放正是通过 `zoom` 实现的。

## 修法与验证

`client/src/genui/host/host-zoom.ts`(新):`neutralizeHostZoom(el)` 把元素自身的 `zoom` 设为根元素缩放的倒数,
使其内部的 `getBoundingClientRect()` 回到未缩放的 CSS px;`createOffscreenHost()` 直接给出这样的离屏容器。

落点选在 `genui/host/`:`upstream/` 下的文件不许直接 import `utils/`(项目分层约定,`check-genui-host-primitives.mjs` 第 4 条机械拦截),宿主件必须经 `host/` 转手 —— 读宿主页面的缩放正是 host 适配层的职责。全仓两个 mermaid 渲染入口共用这一份实现,不重复。

两个 mermaid 渲染入口都接上(全仓只有这两处):
- `client/src/genui/upstream/mermaid-core.ts` 的 `renderInto`:挂进文档**之前**抵消。
- `client/src/components/ArtifactPreview.jsx` 的 `MermaidView`:改成 `mermaid.render(id, code, host)` 传离屏容器,用完 `remove()`。

改后同一复现:

```
· 正常 A-0   框宽 260  文字 scroll=200 client=200  行数=2  ws=break-spaces
· 正常 B-1   框宽 260  文字 scroll=200 client=200  行数=2  ws=break-spaces
· 正常 G-11  框宽 260  文字 scroll=200 client=200  行数=4  ws=break-spaces
被裁节点数: 0 / 12
```

回归锁:`tests/unit/check-r115-ui-zoom.mjs`(11 条,node 直跑;纯逻辑用假 DOM 测,两个接线点用源码锁 —— 真实折行行为要浏览器,node 测不到)。

## 顺带发现,本轮未改

这张图的标签里有 `Lip@V` —— 这是作者纳米载体的正式名称(脂质体载 V),**内容完全正当**。
问题出在 mermaid 11 把标签里裸写的 `@` 当成保留语法(边 id),导致**整张图第一次解析就失败**,
靠 `repairMermaidSource` 的重试才画出来;而该修复会把标签里的 `<br/>` 换成空格,
**作者写的换行点被丢掉**,折行位置改由 200px 自动断行决定。

正确的修法在我们这一侧:给标签加引号(`A["Lip@V ..."]`)后 `@` 不再被当语法、`<br/>` 也能保留,
按作者意图断行(实测见 `verify-fix.mjs` 的乙组)。**绝不是让作者改名或去掉 `@`** —— 载体名称是数据,
渲染器该适应数据。这属于"能更好"而非"显示不全",且要动 `repairMermaidSource` 的既有行为,留作下一轮。
