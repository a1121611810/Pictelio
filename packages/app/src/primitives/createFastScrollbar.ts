import { createSignal } from "solid-js";

/**
 * 快速滚动条原语（FastScroller，ADR-0077）——深模块：小接口 + 几何/拖拽算法。
 *
 * 仿 Android `FastScroller.java`：
 * - thumb 高 = 视口² / 内容高（clamp 最小 24px）
 * - thumb 偏移 = scrollTop/(内容−视口) × (轨道−thumb)
 * - 拖拽：thumb 位移比例线性映射 → onScrollTo（慢拖慢滚/快拖快滚天然成立）
 * - onScrollTo 经 rAF 合帧：一帧内多次 pointermove 只落位一次；pointerup 立即 flush 最新目标
 * - 内容 ≤ 视口时不可见；拖拽中 active（供 UI 加宽变亮）
 *
 * 纯计算：不依赖 DOM pointer capture（由组件层处理），事件收 clientY 结构子集，
 * 便于单测构造假事件。scroll 位置由组件在 scroll 事件里驱动。
 */

interface PointerLike {
  clientY: number;
  preventDefault: () => void;
}

interface FastScrollbar {
  /** thumb 高度 px（视口²/内容，clamp 24 ~ 轨道高） */
  thumbHeight: () => number;
  /** thumb 顶部偏移 px */
  thumbOffset: () => number;
  /** 是否可见（内容 > 视口） */
  visible: () => boolean;
  /** 是否拖拽中（控制加宽变亮） */
  active: () => boolean;
  handlers: {
    onPointerDown: (e: PointerLike) => void;
    onPointerMove: (e: PointerLike) => void;
    onPointerUp: () => void;
  };
}

interface FastScrollbarOptions {
  /** 当前滚动位置 px */
  getScrollTop: () => number;
  /** 视口高度 px */
  getViewportHeight: () => number;
  /** 内容总高 px（虚拟化 totalSize + 容器顶部偏移） */
  getContentHeight: () => number;
  /** 滚动到指定位置（window.scrollTo 等，外部负责 clamp 边界） */
  onScrollTo: (top: number) => void;
  /** 轨道高度 px（默认视口高） */
  getTrackHeight?: () => number;
}

/** thumb 最小高度（可抓取） */
const MIN_THUMB_HEIGHT = 24;

export function createFastScrollbar(options: FastScrollbarOptions): FastScrollbar {
  const [active, setActive] = createSignal(false);

  const viewport = () => Math.max(0, options.getViewportHeight());
  const content = () => Math.max(0, options.getContentHeight());
  const track = () => Math.max(0, (options.getTrackHeight ?? options.getViewportHeight)());

  const visible = () => content() > viewport() + 1;
  const maxScroll = () => Math.max(0, content() - viewport());

  const thumbHeight = () => {
    if (!visible()) return 0;
    const t = track();
    const raw = (viewport() * viewport()) / content();
    return Math.min(t, Math.max(MIN_THUMB_HEIGHT, raw));
  };

  const thumbOffset = () => {
    if (!visible() || maxScroll() <= 0) return 0;
    const t = track();
    const ratio = Math.min(1, Math.max(0, options.getScrollTop() / maxScroll()));
    return ratio * (t - thumbHeight());
  };

  // ── 拖拽状态（位移比例线性映射）──
  let dragging = false;
  let startClientY = 0;
  let startScrollTop = 0;
  /** 未落位的最新目标 top：pointermove 合帧用，一帧内多次 move 只 scrollTo 一次 */
  let pendingTop: number | null = null;
  let moveRafId = 0;
  /** thumb 在轨道内的可移动空间（track − thumb） */
  const thumbTravel = () => Math.max(1, track() - thumbHeight());

  /** 立即取消未决 rAF 并落位最新目标（抬手时保证终态即时到位） */
  function flushPendingScroll() {
    if (moveRafId !== 0) {
      cancelAnimationFrame(moveRafId);
      moveRafId = 0;
    }
    if (pendingTop !== null) {
      const top = pendingTop;
      pendingTop = null;
      options.onScrollTo(top);
    }
  }

  function onPointerDown(e: PointerLike) {
    if (!visible()) return;
    e.preventDefault();
    dragging = true;
    startClientY = e.clientY;
    startScrollTop = options.getScrollTop();
    setActive(true);
  }

  function onPointerMove(e: PointerLike) {
    if (!dragging) return;
    // 阻止默认行为必须在事件回调内同步执行，不能延迟到 rAF
    e.preventDefault();
    const deltaThumb = e.clientY - startClientY;
    const ratio = deltaThumb / thumbTravel();
    // 拖拽中 pointermove 一帧内可触发多次，逐次 scrollTo 会让主线程连续重排；
    // 只记录最新目标位置并合并到 rAF，一帧至多一次 onScrollTo。
    pendingTop = startScrollTop + ratio * maxScroll();
    if (moveRafId === 0) {
      moveRafId = requestAnimationFrame(() => {
        moveRafId = 0;
        if (pendingTop !== null) {
          const top = pendingTop;
          pendingTop = null;
          options.onScrollTo(top);
        }
      });
    }
  }

  function onPointerUp() {
    if (!dragging) return;
    // 抬手立即落位最新目标，避免最后一次 pointermove 被合帧吞掉停在中间位置
    flushPendingScroll();
    dragging = false;
    setActive(false);
  }

  return {
    thumbHeight,
    thumbOffset,
    visible,
    active,
    handlers: { onPointerDown, onPointerMove, onPointerUp },
  };
}
