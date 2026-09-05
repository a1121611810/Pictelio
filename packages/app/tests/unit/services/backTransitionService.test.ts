// @vitest-environment happy-dom
/**
 * backTransitionService 单测（#364 A：返回方向页面过渡 /「动画吸收冻结」）。
 *
 * oracle 溯源：
 * - Fluent 令牌：BACK_EXIT_TRANSITION 断言值来自 src/styles/tokens.css 的
 *   `--durationSlow`（300ms）与 `--curveEasyEase`（cubic-bezier(0.33, 0, 0.67, 1)，
 *   Fluent 2 standard 曲线），与 issue #364 的曲线/时长硬约束一致；
 * - 时序契约（同步预位移 → rAF 快照+导航 → 双 rAF 退出动画 → 幂等清理）来自
 *   服务文档注释（#360 定性的 home remount 冻结必须被覆盖层吸收）；
 * - 降级路径（reduced-motion / 缺页面根 / 快照失败 / 重入）期望「返回必须无条件达成」
 *   且按测试硬约束 3 输出 console.warn（缺根与快照失败两处）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runBackTransition,
  goBack,
  consumePendingBackEnter,
  prefersReducedMotion,
  resetBackTransitionState,
  EXIT_FALLBACK_MS,
  BACK_EXIT_TRANSITION,
} from "@/services/backTransitionService";

// ── rAF 手动泵：确定性控制「下一帧」时序 ──
let rafQueue: FrameRequestCallback[] = [];
const rafSpy = vi.fn((cb: FrameRequestCallback) => {
  rafQueue.push(cb);
  return rafQueue.length;
});
const pump = (n: number) => {
  for (let i = 0; i < n; i++) {
    const batch = rafQueue;
    rafQueue = [];
    batch.forEach((cb) => cb(0));
  }
};

function mountPageRoot(): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-page-root", "");
  document.body.appendChild(root);
  return root;
}

function overlays(): HTMLElement[] {
  return [...document.body.children].filter(
    (el) => el !== pageRoot && el.getAttribute("aria-hidden") === "true",
  );
}

let pageRoot: HTMLElement = null as unknown as HTMLElement;

describe("backTransitionService", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    resetBackTransitionState();
    rafQueue = [];
    rafSpy.mockClear();
    vi.stubGlobal("requestAnimationFrame", rafSpy);
    // 仅 fake 定时器与 Date：默认配置会连 requestAnimationFrame 一起 fake，
    // 导致服务的 rAF 进入 vitest 帧队列而绕过本测试的 rAF 泵
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    pageRoot = mountPageRoot();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("prefersReducedMotion", () => {
    it("reflects matchMedia matches", () => {
      expect(prefersReducedMotion()).toBe(false);
      vi.spyOn(window, "matchMedia").mockImplementation(
        () => ({ matches: true }) as MediaQueryList,
      );
      expect(prefersReducedMotion()).toBe(true);
    });
  });

  describe("runBackTransition 降级路径（返回必须无条件达成）", () => {
    it("reduced-motion：直接导航，不安排任何动画与快照", () => {
      vi.spyOn(window, "matchMedia").mockImplementation(
        () => ({ matches: true }) as MediaQueryList,
      );
      const navigateBack = vi.fn();

      runBackTransition(navigateBack);

      expect(navigateBack).toHaveBeenCalledTimes(1);
      expect(rafSpy).not.toHaveBeenCalled();
      expect(overlays()).toHaveLength(0);
      // 降级路径不置位进场标记：新页不应播放进场动画
      expect(consumePendingBackEnter()).toBe(false);
    });

    it("缺少 [data-page-root]：warn 后直接导航", () => {
      pageRoot.removeAttribute("data-page-root");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const navigateBack = vi.fn();

      runBackTransition(navigateBack);

      expect(warn).toHaveBeenCalledWith(expect.stringContaining("[backTransition]"));
      expect(warn.mock.calls[0][0]).toContain("data-page-root");
      expect(navigateBack).toHaveBeenCalledTimes(1);
      expect(consumePendingBackEnter()).toBe(false);
    });

    it("快照失败（cloneNode 抛错）：warn 后仍导航且只导航一次", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(pageRoot, "cloneNode").mockImplementation(() => {
        throw new Error("boom");
      });
      const navigateBack = vi.fn();

      runBackTransition(navigateBack);
      pump(1); // 触发快照帧

      expect(warn).toHaveBeenCalledWith(expect.stringContaining("快照失败"), expect.any(Error));
      expect(navigateBack).toHaveBeenCalledTimes(1);
      expect(overlays()).toHaveLength(0);
      // active 已复位：下一次返回可再次走过渡
      const navigateBack2 = vi.fn();
      runBackTransition(navigateBack2);
      expect(navigateBack2).not.toHaveBeenCalled(); // 等待 rAF，未直接导航 = active 已复位
    });
  });

  describe("runBackTransition 主路径（动画吸收冻结时序）", () => {
    const RECT = { top: -120, left: 24.6, width: 412, height: 3000 };

    function setupRect() {
      vi.spyOn(pageRoot, "getBoundingClientRect").mockReturnValue({
        ...RECT,
        x: RECT.left,
        y: RECT.top,
        right: RECT.left + RECT.width,
        bottom: RECT.top + RECT.height,
        toJSON: () => RECT,
      } as DOMRect);
    }

    it("同步阶段：先预位移，导航尚未发生", () => {
      const navigateBack = vi.fn();

      runBackTransition(navigateBack);

      expect(pageRoot.style.transform).toBe("translate3d(6%, 0, 0)");
      expect(pageRoot.style.willChange).toBe("transform");
      expect(navigateBack).not.toHaveBeenCalled();
      expect(rafSpy).toHaveBeenCalledTimes(1);
    });

    it("第 1 帧：快照覆盖层与冻结帧无缝衔接，随后立即导航恰好一次", () => {
      setupRect();
      const navigateBack = vi.fn();

      runBackTransition(navigateBack);
      pump(1);

      expect(navigateBack).toHaveBeenCalledTimes(1);
      const list = overlays();
      expect(list).toHaveLength(1);
      const overlay = list[0];
      // 覆盖层定位取自含预位移的 rect（无缝衔接），并关闭交互
      expect(overlay.style.position).toBe("fixed");
      expect(overlay.style.top).toBe("-120px");
      expect(overlay.style.left).toBe("24.6px");
      expect(overlay.style.width).toBe("412px");
      expect(overlay.style.height).toBe("3000px");
      expect(overlay.style.pointerEvents).toBe("none");
      // 克隆自页面根，且已剥离标识（防重复 id / data-page-root）
      expect(overlay.firstElementChild).not.toBeNull();
      expect(overlay.querySelector("[data-page-root]")).toBeNull();
      // 克隆自身的预位移已清除（位移由覆盖层位置承载，避免二次偏移）
      expect((overlay.firstElementChild as HTMLElement).style.transform).toBe("");
    });

    it("第 3 帧：覆盖层按 Fluent standard 曲线滑出淡出（token 断言）", () => {
      setupRect();
      runBackTransition(vi.fn());

      pump(1); // 快照 + 导航
      pump(2); // 双 rAF 后进入退出动画

      const overlay = overlays()[0];
      expect(overlay.style.transition).toBe(BACK_EXIT_TRANSITION);
      expect(BACK_EXIT_TRANSITION).toContain("var(--durationSlow)");
      expect(BACK_EXIT_TRANSITION).toContain("var(--curveEasyEase)");
      expect(overlay.style.transform).toBe("translate3d(100%, 0, 0)");
      expect(overlay.style.opacity).toBe("0");
    });

    it("transitionend 触发幂等清理：覆盖层移除且 active 复位", () => {
      setupRect();
      runBackTransition(vi.fn());
      pump(1);
      const overlay = overlays()[0];

      overlay.dispatchEvent(new Event("transitionend"));
      // 双发也只清理一次（幂等）
      overlay.dispatchEvent(new Event("transitionend"));

      expect(document.body.contains(overlay)).toBe(false);
      const navigateBack2 = vi.fn();
      runBackTransition(navigateBack2);
      expect(navigateBack2).not.toHaveBeenCalled(); // 未直接导航 = active 已复位
    });

    it("transitionend 缺失时由兜底计时器清理", () => {
      setupRect();
      runBackTransition(vi.fn());
      pump(1);
      const overlay = overlays()[0];
      expect(overlay).toBeDefined();

      vi.advanceTimersByTime(EXIT_FALLBACK_MS);

      expect(document.body.contains(overlay)).toBe(false);
    });

    it("导航静默无效（history 栈空）时恢复活页样式", () => {
      setupRect();
      runBackTransition(() => {}); // navigateBack 为 no-op，活页仍在文档中
      expect(pageRoot.style.transform).not.toBe("");

      vi.advanceTimersByTime(EXIT_FALLBACK_MS);

      expect(pageRoot.isConnected).toBe(true);
      expect(pageRoot.style.transform).toBe("");
      expect(pageRoot.style.willChange).toBe("");
    });

    it("过渡进行中重复返回：直接导航，不叠加覆盖层", () => {
      setupRect();
      runBackTransition(vi.fn());
      pump(1);
      expect(overlays()).toHaveLength(1);

      const navigateBack2 = vi.fn();
      runBackTransition(navigateBack2);

      expect(navigateBack2).toHaveBeenCalledTimes(1);
      expect(overlays()).toHaveLength(1);
    });

    it("克隆子树中的 id 与 canvas 子节点不破坏快照", () => {
      setupRect();
      const inner = document.createElement("div");
      inner.id = "some-id";
      const canvas = document.createElement("canvas");
      inner.appendChild(canvas);
      pageRoot.appendChild(inner);

      runBackTransition(vi.fn());
      pump(1);

      const overlay = overlays()[0];
      expect(overlay.querySelector("[id]")).toBeNull();
      expect(overlay.querySelector("canvas")).not.toBeNull();
    });

    it("canvas 内容复制失败（污染画布 drawImage 抛错）：warn 后快照与导航照常", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const drawImage = vi.fn(() => {
        throw new Error("tainted canvas");
      });
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
        drawImage,
      } as unknown as CanvasRenderingContext2D);
      pageRoot.appendChild(document.createElement("canvas"));
      setupRect();
      const navigateBack = vi.fn();

      runBackTransition(navigateBack);
      pump(1);

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("canvas 内容复制失败"),
        expect.any(Error),
      );
      // 返回必须无条件达成，且快照（空白 canvas 降级）仍然生效
      expect(navigateBack).toHaveBeenCalledTimes(1);
      expect(overlays()).toHaveLength(1);
      expect(overlays()[0].querySelector("canvas")).not.toBeNull();
    });
  });

  describe("goBack（页面内返回统一入口）", () => {
    it("经 runBackTransition 执行 window.history.back()", () => {
      const historyBack = vi.spyOn(window.history, "back").mockImplementation(() => {});

      goBack();
      pump(1);

      expect(historyBack).toHaveBeenCalledTimes(1);
    });
  });

  describe("consumePendingBackEnter（进场标记）", () => {
    it("初始无标记", () => {
      expect(consumePendingBackEnter()).toBe(false);
    });

    it("主路径置位后可消费一次（消费即清除）", () => {
      runBackTransition(vi.fn());
      expect(consumePendingBackEnter()).toBe(true);
      expect(consumePendingBackEnter()).toBe(false);
    });

    it("超过窗口期后标记过期", () => {
      runBackTransition(vi.fn());
      vi.advanceTimersByTime(501);
      expect(consumePendingBackEnter()).toBe(false);
    });
  });
});
