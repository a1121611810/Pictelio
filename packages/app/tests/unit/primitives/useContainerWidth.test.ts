import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot, flush } from "solid-js";

// Polyfill ResizeObserver for happy-dom（happy-dom 不自带）。
const roObserve = vi.fn();
const roDisconnect = vi.fn();
let lastCallback: ResizeObserverCallback | undefined;
class MockResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    lastCallback = cb;
  }
  observe = roObserve;
  unobserve = vi.fn();
  disconnect = roDisconnect;
  takeRecords = vi.fn(() => []);
}
vi.stubGlobal("ResizeObserver", MockResizeObserver);

// happy-dom 默认 getComputedStyle 返回 paddingLeft/Right = ""，
// parseFloat("") = NaN → 守卫拒绝写 → width 永远 0。
// 用 stubGlobal 覆盖整个函数（spyOn 在 prototype method 上不可靠）。
// vi.stubGlobal 在 vitest config clearMocks 下跨测试持久，beforeEach 重新 stub 即可。
vi.stubGlobal(
  "getComputedStyle",
  () => ({ paddingLeft: "0px", paddingRight: "0px" }) as unknown as CSSStyleDeclaration,
);

import { useContainerWidth } from "@/primitives/useContainerWidth";

/**
 * 适配 Solid 2.0：createRoot body 内 setSignal 触发 REACTIVE_WRITE_IN_OWNED_SCOPE，
 * ref callback 也在 owned scope 内。规范模式（参考 createFeedVirtualizer.test.ts 的
 * runWithRoot）：createRoot 同步执行完 body → flush() 触发 onSettled 微任务 → 拿到
 * hook result → dispose。在 dispose 链上验证 cleanup（onSettled 返回值）→ onSettled
 * callback 已经跑过 → cleanup 必调。
 */
function setupHook() {
  let result: ReturnType<typeof useContainerWidth> | undefined;
  let disposeFn: (() => void) | undefined;
  createRoot((dispose) => {
    disposeFn = dispose;
    result = useContainerWidth();
    // body 内立即 dispose 不安全（onSettled 还没机会跑）；延后到 body 外
  });
  flush(); // 触发 onSettled 回调执行
  if (!result || !disposeFn) throw new Error("setupHook failed");
  return { hook: result, dispose: disposeFn };
}

describe("useContainerWidth", () => {
  beforeEach(() => {
    roObserve.mockClear();
    roDisconnect.mockClear();
    lastCallback = undefined;
    // 重置 getComputedStyle stub
    vi.stubGlobal(
      "getComputedStyle",
      () => ({ paddingLeft: "0px", paddingRight: "0px" }) as unknown as CSSStyleDeclaration,
    );
  });

  it("初始 width = 0（ref 未挂前）", () => {
    let result: ReturnType<typeof useContainerWidth> | undefined;
    createRoot((dispose) => {
      result = useContainerWidth();
      dispose(); // 立即 dispose——owner 已建立，signal 不需写
    });
    flush();
    expect(result!.width()).toBe(0);
  });

  it("ref(el) 反映 clientWidth - paddingLeft - paddingRight", () => {
    const { hook, dispose } = setupHook();
    const el = document.createElement("div");
    // happy-dom 默认 paddingLeft/Right = "0px"，parseFloat → 0
    Object.defineProperty(el, "clientWidth", { value: 300, configurable: true });
    hook.ref(el);
    flush(); // Solid 2.0：createRoot body 内 setSignal 延迟到 flush 提交
    expect(hook.width()).toBe(300);
    expect(roObserve).toHaveBeenCalledWith(el);
    dispose();
  });

  it("ResizeObserver 回调更新 width（contentRect.width 口径）", () => {
    const { hook, dispose } = setupHook();
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { value: 200, configurable: true });
    hook.ref(el);
    flush();
    expect(hook.width()).toBe(200);

    // lastCallback 是 ref 内部 new 时挂的回调，直接调用即可
    const cb = lastCallback!;
    lastCallback = undefined; // 防 mock 内部再次覆盖
    cb(
      [
        {
          contentRect: {
            width: 480,
            height: 100,
            top: 0,
            left: 0,
            bottom: 100,
            right: 480,
            x: 0,
            y: 0,
          },
        } as unknown as ResizeObserverEntry,
      ],
      new MockResizeObserver(() => {}),
    );
    flush();
    expect(hook.width()).toBe(480);
    dispose();
  });

  it("setW 守卫：NaN/负值/非有限不写入", () => {
    const { hook, dispose } = setupHook();
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { value: 100, configurable: true });
    hook.ref(el);
    flush();
    expect(hook.width()).toBe(100);

    const cb = lastCallback!;
    lastCallback = undefined;
    cb(
      [
        { contentRect: { width: NaN } } as unknown as ResizeObserverEntry,
        { contentRect: { width: -1 } } as unknown as ResizeObserverEntry,
        { contentRect: { width: Infinity } } as unknown as ResizeObserverEntry,
      ],
      new MockResizeObserver(() => {}),
    );
    flush();
    expect(hook.width()).toBe(100); // 未被非法值覆盖

    cb(
      [{ contentRect: { width: 250 } } as unknown as ResizeObserverEntry],
      new MockResizeObserver(() => {}),
    );
    flush();
    expect(hook.width()).toBe(250);
    dispose();
  });

  it("卸载时 ResizeObserver.disconnect() 必被调用（修复 NO_OWNER_CLEANUP 泄漏）", () => {
    const { hook, dispose } = setupHook();
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { value: 100, configurable: true });
    hook.ref(el);
    flush();
    expect(roObserve).toHaveBeenCalledTimes(1);
    expect(roDisconnect).not.toHaveBeenCalled();

    dispose();
    expect(roDisconnect).toHaveBeenCalledTimes(1);
  });

  it("未挂 ref 时卸载不调用 disconnect（no-op 路径）", () => {
    const { dispose } = setupHook();
    expect(roObserve).not.toHaveBeenCalled();
    // ro 仍为 undefined，cleanup 链上 ro?.disconnect() 是 no-op——显式断言不抛错
    expect(() => dispose()).not.toThrow();
    expect(roDisconnect).not.toHaveBeenCalled();
  });

  it("padding 影响初始 width 测量", () => {
    const { hook, dispose } = setupHook();
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { value: 320, configurable: true });
    // 覆盖默认 getComputedStyle stub，给定 padding 16+24=40
    vi.stubGlobal(
      "getComputedStyle",
      () =>
        ({
          paddingLeft: "16px",
          paddingRight: "24px",
        }) as unknown as CSSStyleDeclaration,
    );
    hook.ref(el);
    flush();
    expect(hook.width()).toBe(320 - 16 - 24);
    dispose();
  });
});
