/** 当前打开的 overlay 类型。 */
export type OverlayType =
  | "viewer"
  | "settingsDrawer"
  | "blocklistSheet"
  | "seriesSheet"
  | "readerSettingsSheet"
  | "commentSheet"
  | "reportSheet"
  | "pagePicker"
  | "novelExportSheet";

interface OverlayEntry {
  type: OverlayType;
  close: () => void;
}

/**
 * Overlay 栈：越靠后的元素越靠近栈顶。
 *
 * SolidJS 2.0 迁移语义修正（set-后-读审计高危点 #4）：1.x 版本此栈用 createSignal
 * 承载，2.0 的微任务批处理使「push 后同 tick 内 pop/读栈顶」拿到旧栈，LIFO 语义错位。
 * 该栈没有任何响应式订阅者（signal 从未导出），是纯命令式状态机（硬件返回键 /
 * 弹层开关 effect 驱动），故改为普通数组承载，读写天然同步可见，等价 1.x 行为；
 * 附带消除调用方在 effect 体内 push 的 owned-scope 写入限制。
 */
const overlayStack: OverlayEntry[] = [];

/** 将指定类型的 overlay 关闭函数压入栈顶。 */
export function pushOverlay(type: OverlayType, close: () => void): void {
  overlayStack.push({ type, close });
}

/** 弹出并关闭当前栈顶 overlay，返回被弹出的条目；栈空时返回 undefined。 */
function popTop(): OverlayEntry | undefined {
  const top = overlayStack[overlayStack.length - 1];
  if (!top) {
    return undefined;
  }
  top.close();
  overlayStack.pop();
  return top;
}

/**
 * 关闭栈顶指定类型的 overlay。
 * 仅当栈顶 overlay 类型匹配时才关闭，保证 LIFO 顺序。
 */
export function popOverlay(type: OverlayType): boolean {
  const top = overlayStack[overlayStack.length - 1];
  if (!top || top.type !== type) {
    return false;
  }
  popTop();
  return true;
}

/** 关闭栈顶 overlay 并返回是否成功。 */
export function closeTopOverlay(): boolean {
  return popTop() !== undefined;
}

/**
 * 清空整个 overlay 栈，不调用任何 close 回调。
 * 用于路由切换等场景：组件即将卸载，由路由本身负责清理 UI。
 */
export function clearOverlays(): void {
  overlayStack.length = 0;
}
