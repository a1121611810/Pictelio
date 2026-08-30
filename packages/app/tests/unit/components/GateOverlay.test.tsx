// @vitest-environment happy-dom
/**
 * GateOverlay 门槛过渡面单测（#253）。
 *
 * oracle 溯源：交互语义来自规格 docs/specs/ota-web-bundle.md「门槛 UX」节
 * （D4 裁决：全屏面合并 T1/T2——自愈中非错误样式；失败阻断态两出口 = 重试更新 +
 * 前往下载 APK；无 release URL 时下载按钮不渲染）。
 * mock 全部桩化 otaService 信号（组件只读信号 + 触发 selfHeal，不实现逻辑）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "solid-js/web";

const mockOtaService = vi.hoisted(() => ({
  gateActive: vi.fn(() => false),
  gateHealing: vi.fn(() => false),
  gateError: vi.fn(() => ""),
  gateFloor: vi.fn<string | null>(() => null),
  selfHeal: vi.fn(),
}));
const mockSettings = vi.hoisted(() => ({
  latestReleaseUrl: vi.fn(() => "https://example.com/releases/v9.9.9"),
  latestVersion: vi.fn(() => "9.9.9"),
}));

vi.mock("@/services/otaService", () => mockOtaService);
vi.mock("@/stores/settingsStore", () => mockSettings);

import GateOverlay from "@/components/GateOverlay";

describe("GateOverlay 门槛过渡面", () => {
  let dispose: (() => void) | null = null;
  let container: HTMLElement;

  const mount = () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    dispose = render(() => <GateOverlay />, container);
  };

  beforeEach(() => {
    mockOtaService.gateActive.mockReturnValue(false);
    mockOtaService.gateHealing.mockReturnValue(false);
    mockOtaService.gateError.mockReturnValue("");
    mockOtaService.gateFloor.mockReturnValue(null);
    mockSettings.latestReleaseUrl.mockReturnValue("https://example.com/releases/v9.9.9");
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  const unmount = () => {
    dispose?.();
    dispose = null;
    container?.remove();
  };

  it("门槛未激活 → 不渲染任何内容", () => {
    mount();
    expect(container.textContent).toBe("");
    unmount();
  });

  it("自愈中 → 「正在更新…」非错误样式（无阻断按钮）", () => {
    mockOtaService.gateActive.mockReturnValue(true);
    mockOtaService.gateHealing.mockReturnValue(true);
    mount();
    expect(container.textContent).toContain("正在更新");
    expect(container.querySelector("fluent-button")).toBeNull();
    unmount();
  });

  it("自愈失败 → 阻断态：标题 + 错误信息 + floor + 两出口", () => {
    mockOtaService.gateActive.mockReturnValue(true);
    mockOtaService.gateHealing.mockReturnValue(false);
    mockOtaService.gateError.mockReturnValue("checksum");
    mockOtaService.gateFloor.mockReturnValue("3.22.0");
    mount();
    expect(container.textContent).toContain("需要更新后才能继续使用");
    expect(container.textContent).toContain("checksum");
    expect(container.textContent).toContain("3.22.0");
    const buttons = [...container.querySelectorAll("fluent-button")];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(["重试更新", "前往下载 v9.9.9"]);
    unmount();
  });

  it("重试更新 → selfHeal()；前往下载 → window.open(releaseUrl)", () => {
    mockOtaService.gateActive.mockReturnValue(true);
    mount();
    const buttons = [...container.querySelectorAll("fluent-button")];
    (buttons[0] as unknown as { click: () => void }).click();
    expect(mockOtaService.selfHeal).toHaveBeenCalledTimes(1);
    (buttons[1] as unknown as { click: () => void }).click();
    expect(window.open).toHaveBeenCalledWith(
      "https://example.com/releases/v9.9.9",
      "_blank",
      "noopener,noreferrer",
    );
    unmount();
  });

  it("无 release URL → 只保留重试出口（防锁死在无出口页面）", () => {
    mockOtaService.gateActive.mockReturnValue(true);
    mockSettings.latestReleaseUrl.mockReturnValue("");
    mount();
    const buttons = [...container.querySelectorAll("fluent-button")];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(["重试更新"]);
    unmount();
  });
});
