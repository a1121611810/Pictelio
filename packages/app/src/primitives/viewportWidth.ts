import { createSignal, type Accessor } from "solid-js";

// ── 视口宽度源 ──
//
// 独立模块：把「浏览器视口宽度」从 readerSettingsStore 中抽出，使 store
// 不再在模块加载时自建 window 监听（消除导入即 IO 的副作用）。
// - 浏览器环境：模块加载时初始化 + resize 实时重算（旋转/分屏/折叠）
// - 非浏览器环境（node 单测）：初始为 0，用 setViewportWidth 显式注入

const [width, setWidth] = createSignal(0);

if (typeof window !== "undefined") {
  setWidth(window.innerWidth);
  window.addEventListener("resize", () => setWidth(window.innerWidth));
}

/** 视口宽度（px）accessor。 */
export const viewportWidth: Accessor<number> = width;

/** 显式设置视口宽度：非浏览器环境 / 测试注入 / 手动覆盖。 */
export function setViewportWidth(vw: number): void {
  setWidth(vw);
}
