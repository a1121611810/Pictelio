
/** 当前打开的 overlay 类型。 */
export type OverlayType =
  | "viewer"
  | "settingsDrawer"
  | "blocklistSheet"
  | "seriesSheet"
  | "readerSettingsSheet"
  | "commentSheet"
  | "reportSheet";

interface OverlayEntry {
  type: OverlayType;
  close: () => void;
}

/** Overlay 栈：越靠后的元素越靠近栈顶。 */
const [overlayStack, setOverlayStack] = createSignal<OverlayEntry[]>([]);

/** 将指定类型的 overlay 关闭函数压入栈顶。 */
export function pushOverlay(type: OverlayType, close: () => void): void {
  setOverlayStack((prev) => [...prev, { type, close }]);
}

/** 弹出并关闭当前栈顶 overlay，返回被弹出的条目；栈空时返回 undefined。 */
function popTop(): OverlayEntry | undefined {
  const top = overlayStack()[overlayStack().length - 1];
  if (!top) {
    return undefined;
  }
  top.close();
  setOverlayStack((prev) => prev.slice(0, -1));
  return top;
}

/**
 * 关闭栈顶指定类型的 overlay。
 * 仅当栈顶 overlay 类型匹配时才关闭，保证 LIFO 顺序。
 */
export function popOverlay(type: OverlayType): boolean {
  const top = overlayStack()[overlayStack().length - 1];
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
  setOverlayStack([]);
}
