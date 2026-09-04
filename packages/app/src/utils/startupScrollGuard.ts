/**
 * 启动窗口滚动守卫（带用户意图判别）。
 *
 * 为什么需要：Chromium 浏览器级滚动恢复（磁盘浏览数据）在启动早期会把 scrollY
 * 恢复为上次会话位置（真机实测 t≈3.5s 0→1306），且不经 window.scrollTo、
 * 不受 history.scrollRestoration="manual" 控制。守卫在启动窗口内监听 scroll，
 * 出现恢复特征滚动（scrollY>0）立即回顶并自卸载，保证冷启动从顶部开始。
 *
 * 为什么判别用户意图：旧实现（无判别的 scroll 监听）会把用户在启动窗口内的
 * 主动滚动也误判为恢复滚动并打回顶部。判别依据：Chromium 磁盘级恢复不产生
 * 任何输入事件，而用户滚动一定先有 touchstart / pointerdown / wheel 交互事件
 * （均为 passive 监听，不阻塞滚动）；一旦见到任一交互事件即标记 userInteracted，
 * 此后永不回顶。
 */

/** 守卫配置 */
export interface StartupScrollGuardOptions {
  /** 是否仍需执行回顶（调用方传 persistScrollRestoration() 的取反） */
  isTopRequired: () => boolean;
  /** 回顶实现（由调用方注入，便于测试与复用） */
  scrollToTop: () => void;
  /** 守卫存活窗口（ms），到点全部自卸载；默认 5000 */
  windowMs?: number;
}

/** 守卫默认存活窗口（ms）：覆盖真机实测的恢复时机（t≈3.5s）并留有余量 */
const DEFAULT_WINDOW_MS = 5000;

/**
 * 安装启动滚动守卫，返回 cleanup（移除全部监听与定时器，幂等）。
 */
export function installStartupScrollGuard(options: StartupScrollGuardOptions): () => void {
  const { isTopRequired, scrollToTop, windowMs = DEFAULT_WINDOW_MS } = options;

  let userInteracted = false;
  let disposed = false;

  // 用户交互标记：磁盘级恢复不触发这些事件，用户滚动一定先有交互
  const markInteracted = (): void => {
    userInteracted = true;
  };

  const onScroll = (): void => {
    if (disposed) return;
    if (window.scrollY > 0 && !userInteracted && isTopRequired()) {
      // 先自卸载再回顶：防止 scrollToTop 引发的 scroll 事件重入
      cleanup();
      scrollToTop();
    }
  };

  // passive 监听：不阻塞滚动；removeEventListener 无需重复 options（仅 capture 参与匹配，注册时为默认 false）
  window.addEventListener("touchstart", markInteracted, { passive: true });
  window.addEventListener("pointerdown", markInteracted, { passive: true });
  window.addEventListener("wheel", markInteracted, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  const timer = setTimeout(cleanup, windowMs);

  /** 移除全部监听与定时器（幂等） */
  function cleanup(): void {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    window.removeEventListener("touchstart", markInteracted);
    window.removeEventListener("pointerdown", markInteracted);
    window.removeEventListener("wheel", markInteracted);
    window.removeEventListener("scroll", onScroll);
  }

  return cleanup;
}
