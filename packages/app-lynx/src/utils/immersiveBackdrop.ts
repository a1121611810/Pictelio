// ─── 沉浸态影院底（#896）───
//
// 缺陷：方形作品（1:1）在竖屏上按原比例渲染只有 `100vw` 高（`detailImageHeightVw`），
// 必然短于视口 ⇒ 沉浸态下图片下方露出页面底色。真机实测取色：
// `02-detail.png` 在 y=1500 是图片橙 (252,178,125)，`03-immersive.png` 同位置是
// (248,250,255) —— 页面底色。读作「布局坏了」，不是「沉浸」。
//
// **关键认知：方图在竖屏上不可能既铺满又不变形。** 拉伸会破坏比例（不可接受），
// 裁切会切掉用户的画（更不可接受）。故唯一正解是让露出的区域成为**影院黑边** ——
// 所有图库/相册的既有做法：画面居中，四周留黑，黑边不抢戏。
//
// 为什么不放进 `imageLayout.ts`：那是「按作品比例算高度」的纯几何函数，
// 不该知道「当前是否沉浸」这个 UI 状态。两者分离，各改各的。
//
// ⚠️ 刻意**不**用 MD3 令牌：MD3 的 `surface*` 全是浅色系，正是本缺陷的元凶；
// 影院黑边不属于 MD3 语义体系，用字面 `bg-black`（Tailwind 内置，黑 = 全不透明）。
// 故本文件**不产生**任何 `var(--md-*)` 引用。

/** 非沉浸态页面底色（与 IllustDetail.vue 根元素既有类名一致，不得改动） */
const PAGE_SURFACE = 'bg-surface'

/** 沉浸态影院底：纯黑，落在画之后、不与画争注意力 */
const CINEMA_BACKDROP = 'bg-black'

/**
 * 按沉浸态返回页面根的底色类名。
 * @param immersive 当前是否处于沉浸态（chrome 已全部隐藏）
 */
export function immersiveBackdropClass(immersive: boolean): string {
  return immersive ? CINEMA_BACKDROP : PAGE_SURFACE
}
