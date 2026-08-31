// @vitest-environment happy-dom
/**
 * SettingsSections — 设置页 8 卡分组装配（2026-09 归类整理）。
 *
 * Oracle：用户选定方案「按功能域拆 8 卡」——顺序为 显示与交互 / 内容与过滤 /
 * 图片 / 翻译 / 客户端 / 更新与关于 / 账户 / 退出登录(danger)；
 * - 图片卡接收 onActionToast（清除图片缓存归入图片卡）
 * - 账户卡不再接收 onActionToast（更新/关于条目已拆出）
 *
 * 各分区卡的内容正确性由各自组件测试覆盖（如 SettingsClient.test.tsx），
 * 本测试只锁装配顺序与 props 接线，防分组回归。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";

const mocks = vi.hoisted(() => ({
  onOpenBlocklist: vi.fn(),
  onClearData: vi.fn(),
  onDeleteAccount: vi.fn(),
  onActionToast: vi.fn(),
  onLogout: vi.fn(),
}));

vi.mock("@/components/settings/SettingsAppearance", () => ({
  default: () => <div data-testid="sec-appearance" />,
}));
vi.mock("@/components/settings/SettingsContent", () => ({
  default: (props: { onOpenBlocklist?: () => void }) => (
    <div data-testid="sec-content" data-prop-on-open-blocklist={String(!!props.onOpenBlocklist)} />
  ),
}));
vi.mock("@/components/settings/SettingsImage", () => ({
  default: (props: { onActionToast?: (msg: string) => void }) => (
    <div data-testid="sec-image" data-prop-on-action-toast={String(!!props.onActionToast)} />
  ),
}));
vi.mock("@/components/settings/SettingsTranslate", () => ({
  default: () => <div data-testid="sec-translate" />,
}));
vi.mock("@/components/settings/SettingsClient", () => ({
  default: () => <div data-testid="sec-client" />,
}));
vi.mock("@/components/settings/SettingsUpdate", () => ({
  default: () => <div data-testid="sec-update" />,
}));
vi.mock("@/components/settings/SettingsAccount", () => ({
  default: (props: {
    onClearData?: () => void;
    onDeleteAccount?: () => void;
    onActionToast?: (msg: string) => void;
  }) => (
    <div
      data-testid="sec-account"
      data-prop-on-clear-data={String(!!props.onClearData)}
      data-prop-on-delete-account={String(!!props.onDeleteAccount)}
      data-prop-on-action-toast={String(!!props.onActionToast)}
    />
  ),
}));
vi.mock("@/components/settings/LogoutRow", () => ({
  default: () => <div data-testid="sec-logout" />,
}));
vi.mock("@solidjs/router", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  } as typeof actual;
});

import SettingsSections from "@/components/settings/SettingsSections";

describe("SettingsSections 8 卡分组装配", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("按 8 卡顺序渲染：显示交互/内容/图片/翻译/客户端/更新/账户/退出登录", () => {
    render(() => (
      <SettingsSections
        isLoggedIn={() => true}
        onLogout={mocks.onLogout}
        onOpenBlocklist={mocks.onOpenBlocklist}
        onClearData={mocks.onClearData}
        onDeleteAccount={mocks.onDeleteAccount}
        onActionToast={mocks.onActionToast}
      />
    ));

    const order = [
      "sec-appearance",
      "sec-content",
      "sec-image",
      "sec-translate",
      "sec-client",
      "sec-update",
      "sec-account",
      "sec-logout",
    ];
    const actual = order.map((id) => document.querySelector(`[data-testid="${id}"]`));
    expect(actual.every(Boolean), "8 卡应全部渲染").toBe(true);
    expect(
      actual.map((el) => el!.getAttribute("data-testid")),
      "卡片顺序应符合 8 卡方案",
    ).toEqual(order);
  });

  it("props 接线：内容卡接 onOpenBlocklist，图片卡接 onActionToast", () => {
    render(() => (
      <SettingsSections
        isLoggedIn={() => true}
        onLogout={mocks.onLogout}
        onOpenBlocklist={mocks.onOpenBlocklist}
        onClearData={mocks.onClearData}
        onDeleteAccount={mocks.onDeleteAccount}
        onActionToast={mocks.onActionToast}
      />
    ));

    expect(
      document
        .querySelector('[data-testid="sec-content"]')!
        .getAttribute("data-prop-on-open-blocklist"),
    ).toBe("true");
    expect(
      document
        .querySelector('[data-testid="sec-image"]')!
        .getAttribute("data-prop-on-action-toast"),
    ).toBe("true");
  });

  it("账户卡只接数据/账号回调，不再接 onActionToast（更新条目已拆出）", () => {
    render(() => (
      <SettingsSections
        isLoggedIn={() => true}
        onLogout={mocks.onLogout}
        onOpenBlocklist={mocks.onOpenBlocklist}
        onClearData={mocks.onClearData}
        onDeleteAccount={mocks.onDeleteAccount}
        onActionToast={mocks.onActionToast}
      />
    ));

    const account = document.querySelector('[data-testid="sec-account"]')!;
    expect(account.getAttribute("data-prop-on-clear-data")).toBe("true");
    expect(account.getAttribute("data-prop-on-delete-account")).toBe("true");
    expect(account.getAttribute("data-prop-on-action-toast")).toBe("false");
  });
});
