import type { VirtualItem, Virtualizer } from "@tanstack/solid-virtual";
import type { ScrollRestoreState } from "./createScrollRestore";

// ─── 类型 ───

export interface VirtualScrollRestoreOptions {
  /** 惰性获取 Virtualizer 实例（解开「构造需要 initialOffset、恢复需要 instance」的循环依赖）。 */
  getVirtualizer: () => Virtualizer<Window, HTMLElement>;
  /** 读取已保存状态（无则 undefined）。存储位置（store key / callback props）由调用方决定。 */
  getState: () => ScrollRestoreState | undefined;
  /** 卸载时保存状态。 */
  saveState: (state: ScrollRestoreState) => void;
  /** ResizeObserver 兜底重试窗口（毫秒），默认 500。 */
  fallbackTimeoutMs?: number;
}

export interface VirtualScrollRestoreAPI {
  /** → Virtualizer 构造参数 initialOffset。 */
  readonly initialOffset: number | undefined;
  /** → Virtualizer 构造参数 initialMeasurementsCache。 */
  readonly initialMeasurementsCache: VirtualItem[];
  /**
   * 三层显式恢复：同步 scrollTo → ResizeObserver 监听文档生长重试 → 超时放弃。
   * 调用方在自身 onMount 末尾（_didMount/_willUpdate 之后）调用一次。
   * 恢复必须显式执行，禁止依赖 Virtualizer initialOffset（WebView 实测不触发窗口滚动，见 ADR 0010）。
   */
  restoreScroll: () => void;
}

const DEFAULT_FALLBACK_TIMEOUT_MS = 500;

export function createVirtualScrollRestore(
  options: VirtualScrollRestoreOptions,
): VirtualScrollRestoreAPI {
  // initialOffset / initialMeasurementsCache 需随 Virtualizer 构造一并给出，创建时读取一次；
  // restoreScroll 则在调用时惰性重读（等价于旧实现中 onMount 内读 memo 的语义）。
  const initialState = options.getState();

  // ── 卸载时保存（primitive 自行注册 cleanup，调用方零接线） ──
  onCleanup(() => {
    const snapshot = options.getVirtualizer().takeSnapshot();
    const offset = window.scrollY;
    if (snapshot.length === 0 && offset <= 0) {
      return;
    }
    options.saveState({ snapshot, offset, version: 1 });
  });

  return {
    initialOffset: initialState?.offset,
    initialMeasurementsCache: initialState?.snapshot ?? [],

    restoreScroll: () => {
      const savedOffset = options.getState()?.offset;
      if (savedOffset == null || savedOffset <= 0) {
        return;
      }

      // ① 主路径：同步 scrollTo，强制浏览器立即布局
      window.scrollTo({ top: savedOffset });

      // ② 兜底：若 scrollHeight 不足导致 scrollY 被 clamp，
      //    通过 ResizeObserver 监听 document 生长后重试
      if (window.scrollY < savedOffset) {
        let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
        const ro = new ResizeObserver(() => {
          window.scrollTo({ top: savedOffset });
          if (window.scrollY >= savedOffset) {
            ro.disconnect();
            clearTimeout(fallbackTimer);
          }
        });
        ro.observe(document.documentElement);
        fallbackTimer = setTimeout(
          () => ro.disconnect(),
          options.fallbackTimeoutMs ?? DEFAULT_FALLBACK_TIMEOUT_MS,
        );
        onCleanup(() => {
          ro.disconnect();
          clearTimeout(fallbackTimer);
        });
      }
    },
  };
}
