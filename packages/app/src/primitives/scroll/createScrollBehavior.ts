import type { Accessor } from "solid-js";
import { createScrollPosition } from "@solid-primitives/scroll";

// ─── Types ───

export interface ScrollBehaviorConfig {
  /** 方向判定最小位移（默认 4px） */
  directionThreshold?: number;
  /** 是否累计位移（默认 false），设为 true 时方向判定累计到超过 threshold 才触发 */
  accumulate?: boolean;
  /** 跳变忽略阈值 px（默认 200），超过此值的瞬间跳变不触发方向变化 */
  jumpThreshold?: number;
  /** 空闲重现延迟 ms（默认 250ms） */
  idleDelay?: number;
  /** 顶部保护区 px（默认 48px，即 header 高度） */
  topGuard?: number;
  /** 是否启用向下滚动隐藏（默认 true） */
  hideOnScrollDown?: boolean;
}

export interface ScrollBehaviorResult {
  /** 是否可见（由方向 + 保护区 + 空闲控制） */
  visible: Accessor<boolean>;
  /** 动态阈值检测函数，返回是否已超过 threshold px */
  scrolledPast: (threshold: number) => Accessor<boolean>;
  /** 暂停滚动方向判定（程序性滚动期间使用） */
  suppress: (durationMs?: number) => void;
  /** 当前滚动方向 */
  direction: Accessor<"up" | "down" | null>;
  /** 重置方向判定的基准位置 */
  reset: () => void;
}

// ─── Implementation ───

export function createScrollBehavior(config?: ScrollBehaviorConfig): ScrollBehaviorResult {
  const dirThreshold = config?.directionThreshold ?? 4;
  const accumulate = config?.accumulate ?? false;
  const jumpThreshold = config?.jumpThreshold ?? 200;
  const idleDelay = config?.idleDelay ?? 250;
  const topGuard = config?.topGuard ?? 48;
  const hideOnScrollDown = config?.hideOnScrollDown ?? true;

  // ── 滚动位置 ──
  const scroll = createScrollPosition();

  // ── 滚动方向 ──
  const [direction, setDirection] = createSignal<"up" | "down" | null>(null);
  let lastScrollY = 0;
  // 累计位移（accumulate 模式使用）
  let accumulatedDelta = 0;
  let suppressed = false;
  let suppressTimer: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    const currentY = scroll.y;
    const delta = currentY - lastScrollY;
    const absDelta = Math.abs(delta);

    // 跳变检测：如果单次位移超过 jumpThreshold，忽略（不重置基准）
    if (absDelta > jumpThreshold) {
      lastScrollY = currentY;
      return;
    }

    if (!suppressed) {
      if (accumulate) {
        accumulatedDelta += delta;
        if (accumulatedDelta >= dirThreshold && delta > 0) {
          setDirection("down");
          accumulatedDelta = 0;
        } else if (accumulatedDelta <= -dirThreshold && delta < 0) {
          setDirection("up");
          accumulatedDelta = 0;
        }
      } else {
        if (absDelta >= dirThreshold) {
          if (delta > 0 && currentY > topGuard) {
            setDirection("down");
          } else if (delta < 0) {
            setDirection("up");
          }
        }
      }
    }

    lastScrollY = currentY;
  });

  onCleanup(() => {
    if (suppressTimer) clearTimeout(suppressTimer);
  });

  // ── 滚动驱动显隐 ──
  const [visible, setVisible] = createSignal(true);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    const d = direction();

    if (!hideOnScrollDown) {
      setVisible(true);
      return;
    }

    // 在顶部保护区内始终可见
    if (scroll.y < topGuard) {
      setVisible(true);
      return;
    }

    if (d === "down") {
      setVisible(false);
      // 清除空闲定时器
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = undefined;
    } else if (d === "up") {
      setVisible(true);
    } else {
      // null = 无滚动操作，空闲重现
      setVisible(true);
    }
  });

  // 空闲重现
  createEffect(() => {
    void scroll.y; // 跟踪滚动

    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      setDirection(null);
      setVisible(true);
    }, idleDelay);
  });

  onCleanup(() => {
    if (idleTimer) clearTimeout(idleTimer);
  });

  // ── 阈值检测 ──
  function scrolledPast(threshold: number): Accessor<boolean> {
    const [past, setPast] = createSignal(false);

    createEffect(() => {
      setPast(scroll.y > threshold);
    });

    return past;
  }

  // ── suppress ──
  function suppress(durationMs?: number) {
    suppressed = true;
    if (suppressTimer) clearTimeout(suppressTimer);
    suppressTimer = setTimeout(() => {
      suppressed = false;
    }, durationMs ?? 200);
  }

  return {
    visible,
    scrolledPast,
    suppress,
    direction,
    reset: () => {
      lastScrollY = scroll.y;
      setDirection(null);
    },
  };
}
