// @vitest-environment happy-dom
/**
 * EngineFallbackBanner — 引擎降级提示条（ADR-0164 决策 6 / spec §7.2、E11）。
 *
 * 覆盖：降级快照（effective=webview ∧ preferred=lynx）且未 optout → 渲染原因文案 +
 * 两个动作按钮；「知道了」仅本次关闭；「不再提示」写 optout 键 + 关闭；
 * optout 已置 / 非降级快照 / 快照畸形或缺失 → 不渲染。
 *
 * mock 模式参照 tests/unit/utils/clientSwitchEngineState.test.ts：@capacitor/preferences
 * 按键分发（真实 clientSwitch 解析逻辑 + 真实 zh 字典渲染文案）。
 *
 * oracle 溯源：快照行格式 = Java EngineRoute.snapshotLine() 逐字拼接（spec §3）；
 * 文案 = zh 字典 engineFallback.reason.* / engineFallback.banner.*；
 * optout 键字面量 = Java EnginePrefs.KEY_FALLBACK_OPTOUT（spec §3 键契约表）；
 * 畸形快照 warn（spec E11 禁静默）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";

const mocks = vi.hoisted(() => ({
  preferencesGet: vi.fn(),
  preferencesSet: vi.fn(),
  exitApp: vi.fn(),
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: mocks.preferencesGet, set: mocks.preferencesSet },
}));
vi.mock("@capacitor/app", () => ({
  App: { exitApp: mocks.exitApp },
}));
vi.mock("@/native/ClientInfo", () => ({
  ClientInfo: { restart: vi.fn(), getClientKinds: vi.fn() },
}));

import EngineFallbackBanner from "@/components/EngineFallbackBanner";

/** 按键分发的 Preferences.get mock 状态（每用例重设） */
let stateValue: string | null = null;
let optoutValue: string | null = null;

function seed(nextState: string | null, nextOptout: string | null = null) {
  stateValue = nextState;
  optoutValue = nextOptout;
}

/** 微任务 + 宏任务双排空：挂载期 Promise.all（快照 + optout）完成后断言 */
const flushAsync = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.preferencesGet.mockImplementation(({ key }: { key: string }) => {
    if (key === "pictelio_engine_state") return Promise.resolve({ value: stateValue });
    if (key === "pictelio_engine_fallback_optout") return Promise.resolve({ value: optoutValue });
    return Promise.resolve({ value: null });
  });
  mocks.preferencesSet.mockResolvedValue(undefined);
  seed(null, null);
});

describe("EngineFallbackBanner 显示条件（快照 + optout）", () => {
  it("降级快照（preferred=lynx effective=webview）且未 optout → 渲染原因文案 + 两个按钮", async () => {
    seed("preferred=lynx effective=webview reason=lynx_unavailable");
    render(() => <EngineFallbackBanner />);

    expect(await screen.findByText("Lynx 引擎在本机不可用，已改用 WebView")).toBeDefined();
    // DOM 契约：按钮按 aria-label 断言（语义名，非位置）
    expect(screen.getByRole("button", { name: "知道了" })).toBeDefined();
    expect(screen.getByRole("button", { name: "不再提示" })).toBeDefined();
    // a11y：容器 role=status + aria-live=polite
    const status = document.querySelector('[role="status"][aria-live="polite"]');
    expect(status).not.toBeNull();
  });

  it("点击「知道了」→ 仅本次关闭（不写 optout 键）", async () => {
    seed("preferred=lynx effective=webview reason=lynx_unavailable");
    render(() => <EngineFallbackBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "知道了" }));

    await vi.waitFor(() => {
      expect(screen.queryByRole("button", { name: "知道了" })).toBeNull();
    });
    expect(mocks.preferencesSet).not.toHaveBeenCalled();
  });

  it("点击「不再提示」→ 写 optout = 'true' + 关闭", async () => {
    seed("preferred=lynx effective=webview reason=lynx_unavailable");
    render(() => <EngineFallbackBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "不再提示" }));

    await vi.waitFor(() => {
      expect(mocks.preferencesSet).toHaveBeenCalledWith({
        key: "pictelio_engine_fallback_optout",
        value: "true",
      });
    });
    await vi.waitFor(() => {
      expect(screen.queryByRole("button", { name: "不再提示" })).toBeNull();
    });
  });

  it("optout 已置（'true'）→ 不渲染", async () => {
    seed("preferred=lynx effective=webview reason=lynx_unavailable", "true");
    render(() => <EngineFallbackBanner />);
    await flushAsync();

    expect(screen.queryByText("Lynx 引擎在本机不可用，已改用 WebView")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("非降级快照（effective = preferred）→ 不渲染", async () => {
    seed("preferred=lynx effective=lynx reason=preferred");
    render(() => <EngineFallbackBanner />);
    await flushAsync();

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("快照缺失（null）→ 不渲染", async () => {
    seed(null);
    render(() => <EngineFallbackBanner />);
    await flushAsync();

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("快照畸形 → 不渲染 + console.warn（spec E11 禁静默）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    seed("garbage");
    render(() => <EngineFallbackBanner />);
    await flushAsync();

    expect(screen.queryByRole("status")).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[clientSwitch]"), "garbage");
    warn.mockRestore();
  });
});
