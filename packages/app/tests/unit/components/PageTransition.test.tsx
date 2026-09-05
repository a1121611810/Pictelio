// @vitest-environment happy-dom
/**
 * PageTransition 页面容器单测（#364 A）。
 *
 * oracle 溯源：
 * - 返回进场初始态（translate3d(-4%, 0, 0) + opacity 0）与终态（identity + opacity 1）
 *   来自 WinUI 返回视差方向（新页自左小幅滑入）与服务模块 ENTER_OFFSET 常量；
 * - transition 使用真实模块导出 BACK_EXIT_TRANSITION（= Fluent 2 standard 曲线
 *   cubic-bezier(0.33,0,0.67,1) + --durationSlow，见 src/styles/tokens.css），
 *   非自洽 mock；
 * - data-page-root 属性是 backTransitionService 快照定位契约，必须始终存在。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "solid-js/web";
import { BACK_EXIT_TRANSITION, ENTER_OFFSET } from "@/services/backTransitionService";

const mockSvc = vi.hoisted(() => ({
  prefersReducedMotion: vi.fn<() => boolean>(() => false),
  consumePendingBackEnter: vi.fn<() => boolean>(() => false),
}));

vi.mock("@/services/backTransitionService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/backTransitionService")>();
  return { ...actual, ...mockSvc };
});

import PageTransition from "@/components/PageTransition";

// rAF 手动泵：控制组件「双 rAF 后开始过渡」的时序
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

describe("PageTransition 页面容器", () => {
  let dispose: (() => void) | null = null;
  let container: HTMLElement;

  const mount = () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    dispose = render(
      () => (
        <PageTransition>
          <span class="child">内容</span>
        </PageTransition>
      ),
      container,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute("data-page-root")).toBe(""); // 快照定位契约（始终存在）
    return el;
  };

  beforeEach(() => {
    mockSvc.prefersReducedMotion.mockReturnValue(false);
    mockSvc.consumePendingBackEnter.mockReturnValue(false);
    rafQueue = [];
    rafSpy.mockClear();
    vi.stubGlobal("requestAnimationFrame", rafSpy);
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("默认（前进方向/无标记）：直显，不安排进场动画", () => {
    const el = mount();

    expect(el.style.opacity).toBe("1");
    expect(el.style.transform).toBe("");
    expect(el.querySelector(".child")?.textContent).toBe("内容");
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it("返回进场：初始态同帧生效，双 rAF 后过渡至 identity（token 断言）", () => {
    mockSvc.consumePendingBackEnter.mockReturnValue(true);

    const el = mount();

    // 初始态在首帧绘制前确定（先渲染后加载）
    expect(el.style.transform).toBe(`translate3d(${ENTER_OFFSET}, 0, 0)`);
    expect(el.style.opacity).toBe("0");
    expect(el.style.willChange).toBe("transform, opacity");

    pump(2);

    expect(el.style.transition).toBe(BACK_EXIT_TRANSITION);
    expect(el.style.transform).toBe("translate3d(0, 0, 0)");
    expect(el.style.opacity).toBe("1");
  });

  it("进场动画 transitionend 后清理 transition/will-change", () => {
    mockSvc.consumePendingBackEnter.mockReturnValue(true);

    const el = mount();
    pump(2);
    el.dispatchEvent(new Event("transitionend"));

    expect(el.style.transition).toBe("");
    expect(el.style.willChange).toBe("");
  });

  it("reduced-motion：即便有返回标记也不播放进场动画", () => {
    mockSvc.prefersReducedMotion.mockReturnValue(true);
    mockSvc.consumePendingBackEnter.mockReturnValue(true);

    const el = mount();

    expect(el.style.transform).toBe("");
    expect(el.style.opacity).toBe("1");
    expect(rafSpy).not.toHaveBeenCalled();
  });
});
