// @vitest-environment happy-dom
/**
 * SettingsDirectAccess — 设置页「网络直连」卡（ticket #391 T6）。
 *
 * 覆盖：状态展示渲染（当前路线 / 双通道熔断徽标 / IP 表条目数）；开关交互写
 * store（持久化契约由 directAccessStore.test.ts 单独覆盖，此处断言状态翻转）；
 * 命令按钮委托 @/native/DirectAccess 桥（含 busy 态防重复）；手动 IP 表编辑
 * 非法 JSON / 非法条目拒绝保存并给出可见提示。
 *
 * <b>Oracle 溯源</b>：
 * <ul>
 *   <li>状态渲染 fixture = Java PixivApiPlugin.directAccessStatusCore resolve 的
 *       JSObject 字段（switchState/imageChannel/apiChannel/tableEntries/tableSource/
 *       lastFetchAtMillis）；</li>
 *   <li>文案映射（直连中/系统路线/未配置；正常/已熔断/半开探测）= ticket #391
 *       「当前路线（直连中/系统路线/未配置）+ 相位徽标色语义」；</li>
 *   <li>拒保存提示 = ticket 验收「非法 JSON 拒绝保存 + 提示」（对齐图床
 *       validateHostInput 先例），校验语义由 store 测试差分覆盖，此处只锁接线。</li>
 * </ul>
 *
 * mock 说明：使用<b>真实</b> directAccessStore（settings registry 写盘经 write gate
 * 冷态只进内存，@capacitor/preferences 另行 mock 兜底防真实 IO——vi.mock 用 @/
 * 全路径，vitest 按解析后的绝对路径拦截相对/别名两种 import 形态）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";

const mocks = vi.hoisted(() => ({
  directAccessStatus: vi.fn(),
  directAccessCommand: vi.fn(),
}));

vi.mock("@/native/DirectAccess", () => ({
  DIRECT_ACCESS_DEFAULT_STATUS: {
    switchState: "UNSET",
    imageChannel: "CLOSED",
    apiChannel: "CLOSED",
    tableEntries: 0,
    tableSource: "builtin",
    lastFetchAtMillis: 0,
  },
  directAccessStatus: mocks.directAccessStatus,
  directAccessCommand: mocks.directAccessCommand,
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async () => ({ value: null })),
    set: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  },
}));

import SettingsDirectAccess from "@/components/settings/SettingsDirectAccess";
import {
  directAccessState,
  directAccessRuntime,
  setDirectAccessEnabled,
  setManualEntries,
} from "@/stores/directAccessStore";

/** Java directAccessStatus 快照 fixture（字段 = directAccessStatusCore resolve 形态） */
function snapshot(over: Record<string, unknown> = {}) {
  return {
    switchState: "UNSET",
    imageChannel: "CLOSED",
    apiChannel: "CLOSED",
    tableEntries: 0,
    tableSource: "builtin",
    lastFetchAtMillis: 0,
    ...over,
  };
}

describe("SettingsDirectAccess 网络直连卡", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    // 真实 store 为模块级单例：每用例归零（写盘 gate 冷态，仅内存）
    setDirectAccessEnabled(false);
    setManualEntries([]);
    mocks.directAccessStatus.mockResolvedValue(snapshot());
  });

  it("渲染状态展示：标题/当前路线/双通道徽标/IP 表条目数", async () => {
    mocks.directAccessStatus.mockResolvedValue(
      snapshot({
        switchState: "ON",
        apiChannel: "OPEN",
        tableEntries: 4,
        tableSource: "manual+remote+builtin",
      }),
    );

    render(() => <SettingsDirectAccess />);

    expect(await screen.findByText("直连模式")).toBeDefined();
    expect(await screen.findByText("直连中")).toBeDefined(); // 当前路线 = ON
    // 图片通道 CLOSED + API 通道 OPEN：徽标各一处「正常」/「已熔断」
    expect(await screen.findByText("已熔断")).toBeDefined();
    expect(screen.getAllByText("正常").length).toBe(1);
    expect(await screen.findByText("4 条（manual+remote+builtin）")).toBeDefined();
    expect(directAccessRuntime().switchState).toBe("ON");
  });

  it("默认（UNSET/CLOSED）渲染：未配置 + 双通道正常", async () => {
    render(() => <SettingsDirectAccess />);

    expect(await screen.findByText("未配置")).toBeDefined();
    expect(screen.getAllByText("正常").length).toBe(2);
    expect(await screen.findByText("0 条（builtin）")).toBeDefined();
  });

  it("开关交互：点击行翻转 store 开关位", async () => {
    render(() => <SettingsDirectAccess />);

    const row = await screen.findByRole("button", { name: "启用网络直连" });
    fireEvent.click(row);
    expect(directAccessState().enabled).toBe(true);

    fireEvent.click(row);
    expect(directAccessState().enabled).toBe(false);
  });

  it("重置熔断按钮委托桥（busy 态防重复，完成后刷新运行时状态）", async () => {
    let resolveCommand!: (v: { ok: boolean }) => void;
    mocks.directAccessCommand.mockImplementationOnce(
      () => new Promise((res) => (resolveCommand = res)),
    );

    render(() => <SettingsDirectAccess />);
    await screen.findByText("未配置");

    fireEvent.click(screen.getByRole("button", { name: "重置熔断" }));
    expect(mocks.directAccessCommand).toHaveBeenCalledWith("reset");

    // busy 态：按钮禁用 + 文案切换（防重复触发）
    const busyBtn = screen.getByRole("button", { name: "重置中…" }) as HTMLButtonElement;
    expect(busyBtn.disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "立即更新 IP 表" }) as HTMLButtonElement).disabled,
    ).toBe(true); // 同 busy 批次一并禁用
    expect(mocks.directAccessCommand).toHaveBeenCalledTimes(1);

    resolveCommand({ ok: true });
    expect(await screen.findByText("熔断已重置（双通道恢复正常）")).toBeDefined();
    // 完成后退出 busy，并经桥刷新了运行时状态（挂载 1 次 + 命令完成后 1 次）
    expect(
      (screen.getByRole("button", { name: "立即更新 IP 表" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(mocks.directAccessStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("立即更新 IP 表按钮委托桥并透传 started=false 文案", async () => {
    mocks.directAccessCommand.mockResolvedValueOnce({ ok: true, started: false });

    render(() => <SettingsDirectAccess />);
    await screen.findByText("未配置");

    fireEvent.click(screen.getByRole("button", { name: "立即更新 IP 表" }));

    expect(mocks.directAccessCommand).toHaveBeenCalledWith("refresh");
    expect(await screen.findByText("IP 表更新已在进行中")).toBeDefined();
  });

  it("桥 reject 时错误可见（禁静默）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.directAccessCommand.mockRejectedValueOnce(new Error("bridge down"));

    render(() => <SettingsDirectAccess />);
    await screen.findByText("未配置");

    fireEvent.click(screen.getByRole("button", { name: "重置熔断" }));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByRole("alert").textContent).toContain("熔断重置命令失败");
    warnSpy.mockRestore();
  });

  it("手动 IP 表编辑：非法 JSON 拒绝保存 + 可见提示", async () => {
    render(() => <SettingsDirectAccess />);

    fireEvent.click(await screen.findByRole("button", { name: "手动 IP 表编辑" }));
    const editor = await screen.findByRole("textbox", { name: "手动 IP 表 JSON" });
    expect((editor as HTMLTextAreaElement).value).toBe("[]"); // 当前手动表预填

    fireEvent.input(editor, { target: { value: "[{bad json" } });
    fireEvent.click(screen.getByRole("button", { name: "保存手动 IP 表" }));

    expect(screen.getByRole("alert").textContent).toContain("JSON 解析失败");
    expect(directAccessState().manual).toEqual([]); // 拒保存
  });

  it("手动 IP 表编辑：非法条目拒绝保存（host 空白）", async () => {
    render(() => <SettingsDirectAccess />);

    fireEvent.click(await screen.findByRole("button", { name: "手动 IP 表编辑" }));
    const editor = await screen.findByRole("textbox", { name: "手动 IP 表 JSON" });
    fireEvent.input(editor, {
      target: { value: JSON.stringify([{ host: "", ip: "1.2.3.4" }]) },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存手动 IP 表" }));

    expect(screen.getByRole("alert").textContent).toContain("host 不能为空");
    expect(directAccessState().manual).toEqual([]);
  });

  it("手动 IP 表编辑：合法条目保存进 store（非法 IP 条目同样拒保存）", async () => {
    render(() => <SettingsDirectAccess />);

    fireEvent.click(await screen.findByRole("button", { name: "手动 IP 表编辑" }));
    const editor = await screen.findByRole("textbox", { name: "手动 IP 表 JSON" });

    fireEvent.input(editor, {
      target: { value: JSON.stringify([{ host: "i.pximg.net", ip: "256.0.0.1" }]) },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存手动 IP 表" }));
    expect(screen.getByRole("alert").textContent).toContain("IPv4");
    expect(directAccessState().manual).toEqual([]);

    fireEvent.input(editor, {
      target: { value: JSON.stringify([{ host: "i.pximg.net", ip: "210.140.139.131" }]) },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存手动 IP 表" }));

    expect(await screen.findByText("手动 IP 表已保存")).toBeDefined();
    expect(directAccessState().manual).toEqual([{ host: "i.pximg.net", ip: "210.140.139.131" }]);
  });
});
