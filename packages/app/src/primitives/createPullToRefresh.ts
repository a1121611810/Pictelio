import { createSignal } from "solid-js";

/**
 * 下拉刷新手势原语（深模块：小接口 + 状态机实现，ADR-0076）。
 *
 * 状态机：idle → pulling → refresh-ready → refreshing → idle
 * - touchstart 仅在「列表在顶部」且「未在刷新」时启动追踪
 * - touchmove 计算阻尼后下拉距离，超过阈值进入 refresh-ready（并 preventDefault 阻止原生 overscroll）
 * - touchend 在 refresh-ready 时进入 refreshing 并触发 onRefresh；onRefresh 完成后自动回弹 idle
 * - 未达阈值松手 → 回弹 idle（不触发刷新）
 *
 * 与滚动分页共存：仅顶部启动（isAtTop）、刷新中忽略重复下拉（isRefreshing）。
 * 阈值沿用旧版 VirtualFeed 的 60px（可配置）。
 *
 * 事件处理器接收 TouchEventLike（只读结构子集），既兼容原生 TouchEvent 也便于单测构造假事件。
 */

export type PullPhase = "idle" | "pulling" | "refresh-ready" | "refreshing";

/** 触摸事件只读结构（原生 TouchEvent 的结构子集，可赋值兼容——TouchList 是 ArrayLike） */
export interface TouchEventLike {
  touches: ArrayLike<{ clientY: number }>;
  preventDefault: () => void;
}

export interface PullToRefresh {
  /** 当前下拉距离（px，阻尼后）——供 PullIndicator 渲染 */
  pullDistance: () => number;
  /** 当前相位——供 PullIndicator zone 渲染 */
  pullPhase: () => PullPhase;
  /** 绑定到列表容器的 touch 事件处理器 */
  touchHandlers: {
    onTouchStart: (e: TouchEventLike) => void;
    onTouchMove: (e: TouchEventLike) => void;
    onTouchEnd: () => void;
  };
}

export interface PullToRefreshOptions {
  /** 触发刷新动作（store.refresh，refetch 第一页） */
  onRefresh: () => void | Promise<void>;
  /** 触发阈值 px（默认 60，沿用旧版 VirtualFeed refreshThreshold） */
  threshold?: number;
  /** 下拉阻尼系数 0~1（默认 0.4：下拉 150px 到 60px 阈值） */
  damping?: number;
  /** 是否位于列表顶部（默认 window.scrollY <= 0；容器滚动时传容器 scrollTop） */
  isAtTop?: () => boolean;
  /** 是否正在刷新（store.refreshing；true 时忽略新的下拉启动） */
  isRefreshing?: () => boolean;
}

export function createPullToRefresh(options: PullToRefreshOptions): PullToRefresh {
  const threshold = options.threshold ?? 60;
  const damping = options.damping ?? 0.4;
  const isAtTop = options.isAtTop ?? (() => typeof window === "undefined" || window.scrollY <= 0);
  const isRefreshing = options.isRefreshing ?? (() => false);

  const [pullDistance, setPullDistance] = createSignal(0);
  const [pullPhase, setPullPhase] = createSignal<PullPhase>("idle");

  let tracking = false;
  let startY = 0;

  function onTouchStart(e: TouchEventLike) {
    if (isRefreshing() || !isAtTop()) return;
    tracking = true;
    startY = e.touches[0]?.clientY ?? 0;
  }

  function onTouchMove(e: TouchEventLike) {
    if (!tracking || isRefreshing()) return;
    const dy = (e.touches[0]?.clientY ?? startY) - startY;
    if (dy <= 0) {
      // 向上滑动：取消下拉
      setPullDistance(0);
      setPullPhase("idle");
      return;
    }
    const dist = Math.min(dy * damping, threshold * 1.5);
    setPullDistance(dist);
    setPullPhase(dist >= threshold ? "refresh-ready" : "pulling");
    // 下拉中阻止原生 overscroll/橡皮筋
    e.preventDefault();
  }

  function onTouchEnd() {
    if (!tracking) return;
    tracking = false;
    if (pullPhase() === "refresh-ready" && !isRefreshing()) {
      setPullPhase("refreshing");
      setPullDistance(threshold);
      const settle = () => {
        setPullDistance(0);
        setPullPhase("idle");
      };
      void Promise.resolve(options.onRefresh()).then(settle, settle);
    } else {
      setPullDistance(0);
      setPullPhase("idle");
    }
  }

  return {
    pullDistance,
    pullPhase,
    touchHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
  };
}
