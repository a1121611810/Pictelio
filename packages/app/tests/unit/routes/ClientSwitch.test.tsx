// @vitest-environment happy-dom
/**
 * ClientSwitch — 切换渲染引擎说明页（/client-switch，T2）。
 *
 * 覆盖：页面渲染关键内容（标题 / 当前引擎 / 能力列表 / 确认按钮）、
 * 确认按钮触发 switchClient("lynx")、失败 reason → toast 映射
 *（timeout → 切换超时；write-failed/restart-failed → 切换失败；busy 静默）、
 * 能力读取失败降级为未知、E2E 钩子结果契约（title 序列）。
 *
 * mock 模式参照 tests/unit/utils/clientSwitch.test.ts：mock @capacitor/preferences、
 * @/native/ClientInfo 与 @/utils/clientSwitch；useNavigate 参照 NovelDetail.test.tsx。
 *
 * __E2E__ 单测环境不做编译期 define（见 vitest.config.ts），用 vi.stubGlobal 运行时注入：
 * 既有用例 stub false（对齐生产默认），钩子契约用例 stub true。
 * Oracle 来源（测试硬约束 6）：E2E 钩子 title 契约 = ADR-0159 决策 2 /
 * docs/specs/engine-switch-e2e-recovery.md 决策 4 的字面量
 *（E2E-HOOK-CALLED → E2E-SWITCH-OK / E2E-SWITCH-<REASON>）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    // __E2E__ 默认 stub false（对齐生产构建语义，钩子块不注册）
    vi.stubGlobal("__E2E__", false);
    mocks.readClientKind.mockResolvedValue("webview");
    mocks.getClientKinds.mockResolvedValue({ kinds: ["webview", "lynx"] });
    mocks.switchClient.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

    // Solid 2.0 语义修正：onSettled 中的 async 初始化（setCurrent(await readClientKind())）
    // 在微任务 flush 后才提交；原 `findByText("Lynx")` 会被「两引擎差异」区块的静态标题
    // 立即命中而失去等待意义，导致后续同步 getByText 在 state 落地前执行。
    // 改为直接等待仅当 current() === "lynx" 才渲染的目标文案（findByText 自带轮询等待）。
    await screen.findByText("当前以 Lynx 渲染引擎运行。");
    expect(screen.getByText("当前以 Lynx 渲染引擎运行。")).toBeDefined();
  });
});

describe("ClientSwitch E2E 钩子结果契约（ADR-0159 决策 2 / spec 决策 4）", () => {
  /** 钩子经 window.pictelioE2e 暴露（组件内 Record cast 注册，测试侧同型读取） */
  function e2eHook(): { confirmSwitchClient: () => void } {
    const h = (window as unknown as Record<string, unknown>).pictelioE2e as
      | { confirmSwitchClient: () => void }
      | undefined;
    expect(h).toBeDefined();
    return h!;
  }

  beforeEach(() => {
    // 本 describe 是外层 describe 的顶层兄弟（非嵌套），外层 beforeEach 不生效——
    // 必须自给全部前置（cleanup / clearAllMocks / 默认 mock），不依赖外层残留状态
    //（ADR-0159 复审 #4）。
    cleanup();
    vi.clearAllMocks();
    // __E2E__ stub true：注册钩子块（生产仅 --mode e2e 构建注册，单测运行时注入）
    vi.stubGlobal("__E2E__", true);
    mocks.readClientKind.mockResolvedValue("webview");
    mocks.getClientKinds.mockResolvedValue({ kinds: ["webview", "lynx"] });
    mocks.switchClient.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("调用钩子立即置 title=E2E-HOOK-CALLED，结算后置 E2E-SWITCH-OK", async () => {
    render(() => <ClientSwitch />);

    e2eHook().confirmSwitchClient();

    // 立即标记：同步（先于任何 await），E2E 可区分「钩子已调」与「结算中」
    expect(document.title).toBe("E2E-HOOK-CALLED");
    // flush 微任务等待结算（vi.waitFor 轮询，参照本文件既有异步断言模式）
    await vi.waitFor(() => expect(document.title).toBe("E2E-SWITCH-OK"));
  });

  it("切换失败（reason=timeout）→ title=E2E-SWITCH-TIMEOUT", async () => {
    mocks.switchClient.mockResolvedValue({ ok: false, reason: "timeout" });
    render(() => <ClientSwitch />);

    e2eHook().confirmSwitchClient();

    expect(document.title).toBe("E2E-HOOK-CALLED");
    await vi.waitFor(() => expect(document.title).toBe("E2E-SWITCH-TIMEOUT"));
  });
});
