// @vitest-environment happy-dom
/**
 * ClientSwitch — 切换渲染引擎说明页（/client-switch，T2）。
 *
 * 覆盖：页面渲染关键内容（标题 / 当前引擎 / 能力列表 / 确认按钮）、
 * 确认按钮触发 switchClient("lynx")、失败 reason → toast 映射
 *（timeout → 切换超时；write-failed/restart-failed → 切换失败；busy 静默）、
 * 能力读取失败降级为未知。
 *
 * mock 模式参照 tests/unit/utils/clientSwitch.test.ts：mock @capacitor/preferences、
 * @/native/ClientInfo 与 @/utils/clientSwitch；useNavigate 参照 NovelDetail.test.tsx。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";

const mocks = vi.hoisted(() => ({
  readClientKind: vi.fn(),
  switchClient: vi.fn(),
  getClientKinds: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: vi.fn(), set: vi.fn() },
}));
vi.mock("@/native/ClientInfo", () => ({
  ClientInfo: { getClientKinds: mocks.getClientKinds },
}));
vi.mock("@/utils/clientSwitch", () => ({
  readClientKind: mocks.readClientKind,
  switchClient: mocks.switchClient,
  supportsClientSwitch: vi.fn(),
}));
vi.mock("@solidjs/router", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  } as typeof actual;
});

import ClientSwitch from "@/routes/ClientSwitch";

describe("ClientSwitch 切换渲染引擎说明页", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.readClientKind.mockResolvedValue("webview");
    mocks.getClientKinds.mockResolvedValue({ kinds: ["webview", "lynx"] });
    mocks.switchClient.mockResolvedValue({ ok: true });
  });

  it("渲染标题、当前引擎、能力列表与确认按钮", async () => {
    render(() => <ClientSwitch />);

    expect(screen.getByText("切换渲染引擎")).toBeDefined();
    // 当前引擎：readClientKind 默认 webview（页面同时可能在能力列表中出现 WebView）
    expect((await screen.findAllByText("WebView")).length).toBeGreaterThanOrEqual(1);
    // 能力列表渲染 Lynx 引擎项
    await screen.findByText("Lynx");
    await screen.findByText("实验性渲染内核");
    // 确认切换按钮
    expect(screen.getByText("确认切换")).toBeDefined();
  });

  it("点击确认切换按钮触发 switchClient('lynx')，成功后 toast 提示", async () => {
    render(() => <ClientSwitch />);

    const btn = await screen.findByText("确认切换");
    fireEvent.click(btn);

    await vi.waitFor(() => expect(mocks.switchClient).toHaveBeenCalledTimes(1));
    expect(mocks.switchClient).toHaveBeenCalledWith("lynx");
    await screen.findByText("已切换到 Lynx，正在重启…");
  });

  it("失败 reason=timeout → toast 切换超时，请重试", async () => {
    mocks.switchClient.mockResolvedValue({ ok: false, reason: "timeout" });
    render(() => <ClientSwitch />);

    const btn = await screen.findByText("确认切换");
    fireEvent.click(btn);

    await screen.findByText("切换超时，请重试");
  });

  it("失败 reason=write-failed / restart-failed → toast 切换失败，请重试", async () => {
    for (const reason of ["write-failed", "restart-failed"] as const) {
      cleanup();
      mocks.switchClient.mockResolvedValue({ ok: false, reason });
      render(() => <ClientSwitch />);

      const btn = await screen.findByText("确认切换");
      fireEvent.click(btn);

      await screen.findByText("切换失败，请重试");
    }
  });

  it("失败 reason=busy → 静默，不弹任何 toast", async () => {
    mocks.switchClient.mockResolvedValue({ ok: false, reason: "busy" });
    render(() => <ClientSwitch />);

    const btn = await screen.findByText("确认切换");
    fireEvent.click(btn);
    await vi.waitFor(() => expect(mocks.switchClient).toHaveBeenCalled());

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("切换超时，请重试")).toBeNull();
    expect(screen.queryByText("切换失败，请重试")).toBeNull();
    expect(screen.queryByText("已切换到 Lynx，正在重启…")).toBeNull();
  });

  it("能力读取失败（原生插件不可用）→ 降级为未知并保守渲染", async () => {
    mocks.getClientKinds.mockRejectedValue(new Error("no native plugin"));
    render(() => <ClientSwitch />);

    await screen.findByText("未知（当前环境无法读取包能力信息）");
  });

  it("readClientKind 为 lynx 时当前引擎显示 Lynx", async () => {
    mocks.readClientKind.mockResolvedValue("lynx");
    // 能力列表仅 webview，避免列表项 Lynx 干扰当前引擎断言
    mocks.getClientKinds.mockResolvedValue({ kinds: ["webview"] });
    render(() => <ClientSwitch />);

    await screen.findByText("Lynx");
    expect(screen.getByText("当前以 Lynx 渲染引擎运行。")).toBeDefined();
  });
});
