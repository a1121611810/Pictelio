// @vitest-environment happy-dom
/**
 * SettingsClient — 设置页「切换渲染引擎」入口行（T2）。
 *
 * 覆盖：full 能力（双引擎）时渲染入口行；点击行导航到 /client-switch 说明页
 *（不再打开确认弹窗）；webview-only 能力（ADR-0062）时不渲染入口。
 *
 * mock 模式参照 tests/unit/routes/ClientSwitch.test.tsx 与
 * tests/unit/utils/clientSwitch.test.ts。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";

const mocks = vi.hoisted(() => ({
  readClientKind: vi.fn(),
  supportsClientSwitch: vi.fn(),
  getClientKinds: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/utils/clientSwitch", () => ({
  readClientKind: mocks.readClientKind,
  supportsClientSwitch: mocks.supportsClientSwitch,
  switchClient: vi.fn(),
}));
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

    // 能力列表经 onMount 异步加载，轮询等待入口行随能力降级而隐藏
    await vi.waitFor(() => {
      expect(screen.queryByText("切换渲染引擎")).toBeNull();
    });
  });
});
