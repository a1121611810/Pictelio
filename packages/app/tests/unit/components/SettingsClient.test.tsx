// @vitest-environment happy-dom
/**
 * SettingsClient — 设置页「客户端」卡（T2 入口行 + ADR-0164 自动回退开关行/生效双态行）。
 *
 * 覆盖：full 能力（双引擎）时渲染入口行；点击行导航到 /client-switch 说明页
 *（不再打开确认弹窗）；webview-only 能力（ADR-0062）时不渲染入口；
 * 「自动回退 WebView」开关行乐观切换并写偏好；生效双态行仅降级快照时渲染。
 *
 * mock 模式参照 tests/unit/utils/clientSwitch.test.ts：@/utils/clientSwitch 走
 * importOriginal 部分 mock（见下方 mock 块内注释）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";

const mocks = vi.hoisted(() => ({
  readClientKind: vi.fn(),
  supportsClientSwitch: vi.fn(),
  readAutoFallbackSwitch: vi.fn(),
  writeAutoFallbackSwitch: vi.fn(),
  readEngineState: vi.fn(),
  getClientKinds: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/utils/clientSwitch", async (importOriginal) => {
  // 部分 mock：读写/解析逻辑走真实实现（IO 由 @capacitor/preferences mock 承担），
  // reasonKey 真实映射 + 真实 zh 字典渲染文案。
  const actual = await importOriginal<typeof import("@/utils/clientSwitch")>();
  return {
    ...actual,
    readClientKind: mocks.readClientKind,
    supportsClientSwitch: mocks.supportsClientSwitch,
    readAutoFallbackSwitch: mocks.readAutoFallbackSwitch,
    writeAutoFallbackSwitch: mocks.writeAutoFallbackSwitch,
    readEngineState: mocks.readEngineState,
  };
});
vi.mock("@/native/ClientInfo", () => ({
  ClientInfo: { getClientKinds: mocks.getClientKinds },
}));
vi.mock("@solidjs/router", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  } as typeof actual;
});

import SettingsClient from "@/components/settings/SettingsClient";

describe("SettingsClient 切换渲染引擎入口行", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.readClientKind.mockResolvedValue("webview");
    mocks.getClientKinds.mockResolvedValue({ kinds: ["webview", "lynx"] });
    mocks.supportsClientSwitch.mockReturnValue(true);
    mocks.readAutoFallbackSwitch.mockResolvedValue(true);
    mocks.readEngineState.mockResolvedValue(null);
  });

  it("full 能力（webview+lynx）时渲染入口行，展示当前引擎文案", async () => {
    mocks.supportsClientSwitch.mockImplementation(
      (kinds) => kinds === null || (kinds.includes("webview") && kinds.includes("lynx")),
    );
    render(() => <SettingsClient />);

    expect(await screen.findByText("切换渲染引擎")).toBeDefined();
    expect(await screen.findByText(/当前：WebView/)).toBeDefined();
  });

  it("点击入口行 → 导航到 /client-switch（不再弹确认对话框）", async () => {
    mocks.supportsClientSwitch.mockImplementation(
      (kinds) => kinds === null || (kinds.includes("webview") && kinds.includes("lynx")),
    );
    render(() => <SettingsClient />);

    const row = await screen.findByRole("button", { name: "切换渲染引擎" });
    fireEvent.click(row);
    expect(mocks.navigate).toHaveBeenCalledWith("/client-switch");
  });

  it("webview-only 能力（ADR-0062）不渲染入口行", async () => {
    mocks.getClientKinds.mockResolvedValue({ kinds: ["webview"] });
    mocks.supportsClientSwitch.mockImplementation(
      (kinds) => !(kinds !== null && kinds.includes("webview") && !kinds.includes("lynx")),
    );
    render(() => <SettingsClient />);

    // 能力列表经 onSettled 异步加载，轮询等待入口行随能力降级而隐藏
    await vi.waitFor(() => {
      expect(screen.queryByText("切换渲染引擎")).toBeNull();
    });
  });

  it("自动回退开关行：渲染开关（初值 true），change 事件乐观切换并写入 false", async () => {
    render(() => <SettingsClient />);

    expect(await screen.findByText("自动回退 WebView")).toBeDefined();
    const sw = document.querySelector("fluent-switch[aria-label='自动回退 WebView']");
    expect(sw).not.toBeNull();

    // fluent-switch 的 change 是自定义事件（非 Solid 委托），经 fluentOn 挂载——
    // 直接 dispatch 验证真实链路（先例：FluentDialog.test.tsx switch 用例）
    sw!.dispatchEvent(new CustomEvent("change", { bubbles: true }));

    await vi.waitFor(() => expect(mocks.writeAutoFallbackSwitch).toHaveBeenCalledTimes(1));
    expect(mocks.writeAutoFallbackSwitch).toHaveBeenCalledWith(false);
  });

  it("生效双态行：降级快照（effective ≠ preferred）→ 显示「首选 X · 本次生效 Y」+ 原因文案", async () => {
    // oracle：快照结构 = Java EngineRoute.snapshotLine 反序列化形态（spec §3）；
    // 文案 = zh 字典（settings.client.effectiveState / engineFallback.reason.lynx_unavailable）
    mocks.readEngineState.mockResolvedValue({
      preferred: "lynx",
      effective: "webview",
      reason: "lynx_unavailable",
    });
    render(() => <SettingsClient />);

    expect(await screen.findByText("首选 Lynx · 本次生效 WebView")).toBeDefined();
    expect(await screen.findByText("Lynx 引擎在本机不可用，已改用 WebView")).toBeDefined();
  });

  it("生效双态行：按首选运行（effective === preferred）或无快照 → 不渲染", async () => {
    mocks.readEngineState.mockResolvedValue({
      preferred: "lynx",
      effective: "lynx",
      reason: "preferred",
    });
    render(() => <SettingsClient />);

    expect(await screen.findByText("切换渲染引擎")).toBeDefined();
    expect(screen.queryByText(/首选 Lynx · 本次生效/)).toBeNull();
    expect(screen.queryByText(/已改用 WebView/)).toBeNull();
  });
});
