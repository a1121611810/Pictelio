import { describe, it, expect, vi, type Mock } from "vitest";
import type { BackGestureContext } from "@/services/backGestureService";

async function loadService() {
  vi.resetModules();
  const mod = await import("@/services/backGestureService");
  return mod;
}

function mockCapacitorApp() {
  const addListener = vi.fn().mockResolvedValue({ remove: vi.fn() });
  const exitApp = vi.fn();
  vi.doMock("@capacitor/app", () => ({
    App: { addListener, exitApp },
  }));
  return { addListener, exitApp };
}

function getHandler(addListener: Mock) {
  expect(addListener).toHaveBeenCalledWith("backButton", expect.any(Function));
  return addListener.mock.calls[0][1] as () => void;
}

function createContext(pathname: string): BackGestureContext {
  return {
    getPathname: vi.fn().mockReturnValue(pathname),
    navigateBack: vi.fn(),
    dispatchExitHint: vi.fn(),
  };
}

describe("backGestureService", () => {
  describe("pushOverlay / closeTopOverlay", () => {
    it("invokes the most recently pushed close function", async () => {
      const { pushOverlay, closeTopOverlay } = await loadService();
      const closeA = vi.fn();
      const closeB = vi.fn();

      pushOverlay("viewer", closeA);
      pushOverlay("readerSettingsSheet", closeB);
      const result = closeTopOverlay();

      expect(result).toBe(true);
      expect(closeB).toHaveBeenCalledTimes(1);
      expect(closeA).not.toHaveBeenCalled();
    });

    it("returns false when the stack is empty", async () => {
      const { closeTopOverlay } = await loadService();
      expect(closeTopOverlay()).toBe(false);
    });

    it("closes overlays in LIFO order", async () => {
      const { pushOverlay, closeTopOverlay } = await loadService();
      const order: string[] = [];

      pushOverlay("viewer", () => order.push("viewer"));
      pushOverlay("readerSettingsSheet", () => order.push("readerSettingsSheet"));
      pushOverlay("seriesSheet", () => order.push("seriesSheet"));

      closeTopOverlay();
      closeTopOverlay();
      closeTopOverlay();

      expect(order).toEqual(["seriesSheet", "readerSettingsSheet", "viewer"]);
    });
  });

  describe("clearOverlays", () => {
    it("empties the stack without invoking close callbacks", async () => {
      const { pushOverlay, clearOverlays, closeTopOverlay } = await loadService();
      const closeA = vi.fn();
      const closeB = vi.fn();

      pushOverlay("viewer", closeA);
      pushOverlay("readerSettingsSheet", closeB);
      clearOverlays();

      expect(closeA).not.toHaveBeenCalled();
      expect(closeB).not.toHaveBeenCalled();
      expect(closeTopOverlay()).toBe(false);
    });

    it("leaves closeTopOverlay returning false when the stack is empty", async () => {
      const { clearOverlays, closeTopOverlay } = await loadService();
      clearOverlays();
      expect(closeTopOverlay()).toBe(false);
    });
  });

  describe("popOverlay", () => {
    it("closes the top overlay when its type matches and returns true", async () => {
      const { pushOverlay, popOverlay } = await loadService();
      const closeViewer = vi.fn();
      const closeSettings = vi.fn();

      pushOverlay("viewer", closeViewer);
      pushOverlay("readerSettingsSheet", closeSettings);

      const result = popOverlay("readerSettingsSheet");

      expect(result).toBe(true);
      expect(closeSettings).toHaveBeenCalledTimes(1);
      expect(closeViewer).not.toHaveBeenCalled();
    });

    it("returns false when the top overlay type does not match", async () => {
      const { pushOverlay, popOverlay } = await loadService();
      pushOverlay("viewer", vi.fn());
      expect(popOverlay("readerSettingsSheet")).toBe(false);
    });

    it("returns false when the stack is empty", async () => {
      const { popOverlay } = await loadService();
      expect(popOverlay("viewer")).toBe(false);
    });
  });

  describe("registerBackGesture", () => {
    it("navigates back when no overlay is open and path is not root", async () => {
      const { addListener, exitApp } = mockCapacitorApp();
      const ctx = createContext("/illust/123");
      const { registerBackGesture } = await loadService();

      const remove = await registerBackGesture(ctx);
      const handler = getHandler(addListener);
      handler();
      remove();

      expect(ctx.navigateBack).toHaveBeenCalledTimes(1);
      expect(ctx.dispatchExitHint).not.toHaveBeenCalled();
      expect(exitApp).not.toHaveBeenCalled();
    });

    it("closes the top overlay instead of navigating back", async () => {
      const { addListener, exitApp } = mockCapacitorApp();
      const ctx = createContext("/illust/123");
      const { pushOverlay, registerBackGesture } = await loadService();
      const closeViewer = vi.fn();
      pushOverlay("viewer", closeViewer);

      const remove = await registerBackGesture(ctx);
      const handler = getHandler(addListener);
      handler();
      remove();

      expect(closeViewer).toHaveBeenCalledTimes(1);
      expect(ctx.navigateBack).not.toHaveBeenCalled();
      expect(exitApp).not.toHaveBeenCalled();
    });

    it("shouldExitOnBack 激活期间 → 一次返回即退出应用（门槛过渡面，#253）", async () => {
      const { addListener, exitApp } = mockCapacitorApp();
      const ctx = createContext("/home");
      ctx.shouldExitOnBack = vi.fn().mockReturnValue(true);
      const { registerBackGesture } = await loadService();
      const remove = await registerBackGesture(ctx);
      const handler = getHandler(addListener);

      handler();

      expect(exitApp).toHaveBeenCalledTimes(1);
      expect(ctx.navigateBack).not.toHaveBeenCalled();
      expect(ctx.dispatchExitHint).not.toHaveBeenCalled();
      remove();
    });

    it("shouldExitOnBack 未激活 → 不影响原有流程（关闭 overlay 优先）", async () => {
      const { addListener, exitApp } = mockCapacitorApp();
      const ctx = createContext("/home");
      ctx.shouldExitOnBack = vi.fn().mockReturnValue(false);
      const { registerBackGesture } = await loadService();
      const remove = await registerBackGesture(ctx);
      const handler = getHandler(addListener);

      handler();
      expect(exitApp).not.toHaveBeenCalled();
      expect(ctx.dispatchExitHint).toHaveBeenCalledTimes(1);
      remove();
    });

    it("dispatches exitHint on first back at root path and exits app on second back within 2 seconds", async () => {
      const { addListener, exitApp } = mockCapacitorApp();
      const ctx = createContext("/home");

      const { registerBackGesture } = await loadService();
      const remove = await registerBackGesture(ctx);
      const handler = getHandler(addListener);

      handler();
      expect(ctx.dispatchExitHint).toHaveBeenCalledTimes(1);
      expect(exitApp).not.toHaveBeenCalled();

      handler();
      expect(exitApp).toHaveBeenCalledTimes(1);
      expect(ctx.navigateBack).not.toHaveBeenCalled();

      remove();
    });
  });
});
