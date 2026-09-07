/**
 * 宿主界面缩放的读取与抵消(PLAN §2.0.1-2:upstream/ 只能经 host/ 拿宿主件)。
 *
 * CC-GUI 的界面缩放写在根元素上(`sessionStore` 的 `document.documentElement.style.zoom = n`)。
 * `zoom` 会放大 `getBoundingClientRect()` 的返回值:一个真实宽 200px 的元素在 zoom=1.2 下
 * 量出来是 240(`offsetWidth` 仍是 200)。
 *
 * 这对"拿 rect 宽度和一个未缩放常量做精确比较"的第三方布局代码是致命的。已知受害者是
 * mermaid:它给流程图标签先套 `white-space:nowrap; max-width:<W>px`,量一次,
 * **只有 `rect.width === W` 时**才改判成 `white-space:break-spaces` 允许折行
 * (mermaid 11 dist 的 addHtmlSpan)。缩放不是 100% 时这个等式永远不成立,长标签就停在
 * 不折行状态、超出 max-width 的部分被节点框裁掉 —— 用户实测一张 12 节点的流程图里
 * 8 个节点的文字被切(证据见 .devflow/GENUI-ZOOM-EVIDENCE-r115.md)。
 *
 * 解法:凡是"离屏量尺寸"的容器,都在自己这一层把缩放抵消回 1,量到的就是未缩放的 CSS px。
 * 产出的图形几何自洽,挂回页面后随整页一起缩放,观感不受影响。
 *
 * 只读根元素的 zoom,绝不写它 —— 写了会连累整页布局。
 *
 * @module genui/host/host-zoom
 */

/** 宿主当前的界面缩放倍数。取不到、非数、非正数一律回落 1(绝不返回 0,调用方要拿它做除数)。 */
export function hostUiZoom(): number {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return 1
  try {
    const z = parseFloat(getComputedStyle(document.documentElement).zoom as unknown as string)
    return Number.isFinite(z) && z > 0 ? z : 1
  } catch {
    return 1
  }
}

/**
 * 在元素自身这一层抵消宿主缩放,使其内部的 getBoundingClientRect() 回到未缩放的 CSS px。
 * 缩放本来就是 1 时不写任何内联样式(不留无谓痕迹)。传 null/undefined 不抛。
 * @returns 实际抵消掉的倍数(1 表示没动)
 */
export function neutralizeHostZoom(el: HTMLElement | null | undefined): number {
  const z = hostUiZoom()
  if (el && z !== 1) el.style.zoom = String(1 / z)
  return z
}

/**
 * 建一个离屏测量容器:定位到视口外、无外边距、并抵消宿主缩放。调用方负责 `remove()`。
 */
export function createOffscreenHost(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.position = 'fixed'
  el.style.left = '-100000px'
  el.style.top = '0'
  el.style.margin = '0'
  neutralizeHostZoom(el)
  document.body?.appendChild(el)
  return el
}
