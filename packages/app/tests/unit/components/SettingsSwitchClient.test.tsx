// @vitest-environment happy-dom
/**
 * SettingsDialogs — 切换渲染引擎对话框回归测试。
 *
 * Bug：设置页点击「切换渲染引擎」无反应。
 * 根因：@fluentui/web-components 的 fluent-dialog 没有 open 属性绑定，
 * 只有 show()/hide() 方法；直接用 open={...} 会把值写到宿主 DOM property，
 * 组件内部从不读取，内部 <dialog> 永远不开。
 * 修复：FluentDialog 封装通过 ref + show()/hide() 驱动。
 *
 * 本测试加载真实组件定义，直接观察内部 <dialog> 的 open 状态。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import "@fluentui/web-components/dialog.js";
import SettingsDialogs from "@/components/settings/SettingsDialogs";

function innerDialogOpen(container: HTMLElement, ariaLabel: string): boolean | undefined {
  const host = [...container.querySelectorAll("fluent-dialog")].find(
    (d) => d.getAttribute("aria-label") === ariaLabel,
  ) as HTMLElement | undefined;
  const inner = host?.shadowRoot?.querySelector("dialog");
  return inner?.open;
}

describe("SettingsDialogs — 切换渲染引擎对话框", () => {
  beforeAll(async () => {
    await customElements.whenDefined("fluent-dialog");
  });

  it("dialogType 变为 switchClient 时内部 <dialog> 应真正打开", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const [dialogType, setDialogType] = createSignal<
      "clear" | "deleteAccount" | "switchClient" | null
    >(null);

    render(
      () => (
        <SettingsDialogs
          showBlocklist={false}
          onCloseBlocklist={() => {}}
          dialogType={dialogType()}
          onCloseDialog={() => setDialogType(null)}
          onConfirmClear={() => {}}
          onConfirmSwitchClient={() => {}}
          onConfirmDelete={() => {}}
        />
      ),
      container,
    );

    // 初始：关闭
    await new Promise((r) => setTimeout(r, 100));
    expect(innerDialogOpen(container, "切换到 Lynx 客户端？")).toBe(false);

    // 用户点击「切换渲染引擎」→ dialogType 变为 switchClient
    setDialogType("switchClient");
    await new Promise((r) => setTimeout(r, 150));

    expect(
      innerDialogOpen(container, "切换到 Lynx 客户端？"),
      "switchClient 对话框的内部 <dialog> 应打开",
    ).toBe(true);
    // 其他对话框不应被误开
    expect(innerDialogOpen(container, "清除所有本地数据？")).toBe(false);
    expect(innerDialogOpen(container, "删除 Pixiv 账号？")).toBe(false);

    // 关闭后应真正关闭
    setDialogType(null);
    await new Promise((r) => setTimeout(r, 150));
    expect(innerDialogOpen(container, "切换到 Lynx 客户端？")).toBe(false);
  });
});
