/**
 * 返回方向页面过渡服务（#364 A：真实交互体检——系统返回 2 帧硬切零过渡）。
 *
 * 机制「动画吸收冻结」（#360：返回时 home 全量 remount 造成 ~200ms 主线程冻结）：
 *  1. 返回触发的同一帧内对当前页根元素（`[data-page-root]`，由 PageTransition 标注）
 *     施加预位移 transform——下一 vsync 即见旧页移动，视觉响应 ≤1 帧；
 *  2. 下一 rAF 深拷贝当前页 DOM 为 fixed 覆盖层，随即执行真正的返回导航——
 *     home remount 的主线程冻结发生在覆盖层之下，屏幕停留在「旧页已位移」帧；
 *  3. 冻结结束后（双 rAF 确保初始帧已提交）覆盖层按 Fluent 曲线滑出淡出，
 *     露出新页（新页进场动画由 PageTransition 的返回标记驱动）。
 *
 * Fluent 规范：时长 `var(--durationSlow)`、曲线 `var(--curveEasyEase)`
 * （= cubic-bezier(0.33, 0, 0.67, 1)，Fluent standard）；位移用百分比（随视口宽度）。
 * `prefers-reduced-motion` 下直接导航（无快照、无动画），与改造前行为一致；
 * 全局 CSS（base.css）亦将 transition 降级为 0.01ms 兜底。
 */

/** back 进场标记的有效消费窗口：路由切换同步挂载新页，超出即视为陈旧标记 */
const BACK_ENTER_WINDOW_MS = 500;
/** 覆盖层清理兜底时长（transitionend 迟迟不触发时，如主线程长任务吞掉事件） */
export const EXIT_FALLBACK_MS = 700;
/** 返回按下瞬间的预位移（视口宽百分比）：一次可见的小幅移动，宣告过渡已开始 */
const PRE_MOVE_OFFSET = "6%";
/** 退出终点：完全滑出屏幕并淡出 */
const EXIT_OFFSET = "100%";
/** 覆盖层层级：高于全屏查看器/浮层（z-50），短暂存活，pointer-events 关闭不挡交互 */
const EXIT_Z_INDEX = "60";
/** 新页进场起点（自左侧，WinUI 返回视差方向），由 PageTransition 消费 */
export const ENTER_OFFSET = "-4%";

/** 过渡使用的 Fluent motion tokens（集中声明，单测断言出处：Fluent 2 standard 曲线 + slow 时长） */
export const BACK_EXIT_TRANSITION =
  "transform var(--durationSlow) var(--curveEasyEase), opacity var(--durationSlow) var(--curveEasyEase)";

/** 是否处于返回过渡进行中（防重入：第二次返回直接导航，不叠加覆盖层） */
let active = false;
/** 待消费的返回进场标记（时间戳），由 PageTransition 挂载时消费 */
let pendingBackEnterAt: number | null = null;

/** prefers-reduced-motion 检测（环境缺 window/matchMedia 时视为未开启） */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/**
 * PageTransition 挂载时同步消费：最近一次返回导航之后，新页是否应播放进场动画。
 * 仅在标记窗口期内有效，消费即清除（含过期清除）。
 */
export function consumePendingBackEnter(): boolean {
  if (pendingBackEnterAt === null) return false;
  const valid = Date.now() - pendingBackEnterAt <= BACK_ENTER_WINDOW_MS;
  pendingBackEnterAt = null;
  return valid;
}

function markBackEnter(): void {
  pendingBackEnterAt = Date.now();
}

/** 移除克隆子树中的 id / data-page-root，避免覆盖层与活页产生重复标识 */
function stripIdentifiers(clone: HTMLElement): void {
  if (clone.id) clone.removeAttribute("id");
  clone.removeAttribute("data-page-root");
  clone.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
  clone.querySelectorAll("[data-page-root]").forEach((n) => n.removeAttribute("data-page-root"));
}

/** 克隆 canvas 内容（ugoira 播放器等）：污染 canvas 会抛错，降级为空白并告警 */
function copyCanvases(source: HTMLElement, clone: HTMLElement): void {
  const src = source.querySelectorAll("canvas");
  const dst = clone.querySelectorAll("canvas");
  dst.forEach((c, i) => {
    try {
      c.getContext("2d")?.drawImage(src[i], 0, 0);
    } catch (e) {
      console.warn("[backTransition] 快照 canvas 内容复制失败（以空白呈现）", e);
    }
  });
}

/**
 * 执行带返回过渡的导航。
 * @param navigateBack 实际的返回导航（App 注入类型安全 API，页面经 goBack 走 history.back）
 */
export function runBackTransition(navigateBack: () => void): void {
  // 降级 1：reduced-motion —— 无动画直切（与改造前行为一致）
  if (prefersReducedMotion()) {
    navigateBack();
    return;
  }
  // 降级 2：过渡进行中重复返回 —— 直接导航，不叠加覆盖层
  if (active) {
    navigateBack();
    return;
  }
  const root = document.querySelector<HTMLElement>("[data-page-root]");
  // 降级 3：找不到页面根（未用 PageTransition 的路由）—— 告警后直切，绝不阻塞返回
  if (!root) {
    console.warn("[backTransition] 未找到 [data-page-root]，返回过渡降级为直切");
    navigateBack();
    return;
  }

  active = true;
  markBackEnter();

  // ① 同帧预位移：无 transition，下一 vsync 即见旧页移动（视觉响应 ≤1 帧）
  root.style.willChange = "transform";
  root.style.transform = `translate3d(${PRE_MOVE_OFFSET}, 0, 0)`;
  // 防御：若导航实际未发生（如 history 栈空导航静默无效），恢复活页样式
  const restoreTimer = setTimeout(() => {
    if (root.isConnected) {
      root.style.willChange = "";
      root.style.transform = "";
    }
  }, EXIT_FALLBACK_MS);

  let overlay: HTMLElement | null = null;

  // ② 下一帧：快照 + 覆盖层 + 真正导航（remount 冻结被覆盖层吸收）
  requestAnimationFrame(() => {
    try {
      const rect = root.getBoundingClientRect(); // 含预位移，覆盖层与冻结帧无缝衔接
      const clone = root.cloneNode(true) as HTMLElement;
      clone.style.transform = ""; // 位移由覆盖层自身位置承载，避免二次偏移
      clone.style.willChange = "";
      stripIdentifiers(clone);
      copyCanvases(root, clone);

      overlay = document.createElement("div");
      overlay.setAttribute("aria-hidden", "true");
      const s = overlay.style;
      s.position = "fixed";
      s.top = `${rect.top}px`;
      s.left = `${rect.left}px`;
      s.width = `${rect.width}px`;
      s.height = `${rect.height}px`;
      s.margin = "0";
      s.zIndex = EXIT_Z_INDEX;
      s.pointerEvents = "none";
      s.overflow = "hidden";
      s.background = "var(--colorNeutralBackground1)";
      s.willChange = "transform, opacity";
      s.transform = "translate3d(0, 0, 0)";
      s.opacity = "1";
      overlay.appendChild(clone);
      document.body.appendChild(overlay);
    } catch (e) {
      console.warn("[backTransition] 页面快照失败，返回过渡降级为直切", e);
      clearTimeout(restoreTimer);
      active = false;
      navigateBack(); // 返回必须无条件达成
      return;
    }

    const el = overlay as HTMLElement;

    // ③ 立即切路由：home 全量 remount 冻结期间屏幕停留在「旧页已位移」帧
    navigateBack();

    // ④ 双 rAF 确保初始帧提交后开始退出动画（滑出 + 淡出，Fluent standard 曲线）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transition = BACK_EXIT_TRANSITION;
        el.style.transform = `translate3d(${EXIT_OFFSET}, 0, 0)`;
        el.style.opacity = "0";
      });
    });

    // ⑤ 清理（transitionend 与兜底计时器幂等竞争；过滤后代冒泡事件，防提前终止退出动画）
    let done = false;
    const onEnd = (e: TransitionEvent) => {
      if (e.target !== el) return;
      cleanup();
    };
    const cleanup = () => {
      if (done) return;
      done = true;
      el.removeEventListener("transitionend", onEnd);
      el.remove();
      clearTimeout(fallbackTimer);
      active = false;
    };
    const fallbackTimer = setTimeout(cleanup, EXIT_FALLBACK_MS);
    el.addEventListener("transitionend", onEnd);
  });
}

/** 页面内返回统一入口：所有 in-app 返回按钮与系统返回共用同一过渡路径（#364） */
export function goBack(): void {
  runBackTransition(() => window.history.back());
}

/** 测试辅助：重置模块单例状态（active 标记 / 进场标记） */
export function resetBackTransitionState(): void {
  active = false;
  pendingBackEnterAt = null;
}
