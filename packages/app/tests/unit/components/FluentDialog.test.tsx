// @vitest-environment happy-dom
/**
 * FluentDialog 封装组件单元测试。
 *
 * 验证封装把 open prop 正确转成对 fluent-dialog 组件 show()/hide() 的调用，
 * 并处理 close 事件与卸载清理。加载真实 @fluentui/web-components 定义。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import "@fluentui/web-components/dialog.js";
import FluentDialog from "@/components/ui/FluentDialog";

function innerOpen(container: HTMLElement): boolean | undefined {
  const host = container.querySelector("fluent-dialog") as HTMLElement | undefined;
  return host?.shadowRoot?.querySelector("dialog")?.open;
}

describe("FluentDialog", () => {
  beforeAll(async () => {
    await customElements.whenDefined("fluent-dialog");
  });

  it("open=true 打开，open=false 关闭", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const [open, setOpen] = createSignal(false);

    render(
      () => (
        <FluentDialog open={open()} aria-label="测试对话框">
          <h3 slot="title">t</h3>
        </FluentDialog>
      ),
      container,
    );

    await new Promise((r) => setTimeout(r, 100));
    expect(innerOpen(container)).toBe(false);

    setOpen(true);
    await new Promise((r) => setTimeout(r, 120));
    expect(innerOpen(container)).toBe(true);

    setOpen(false);
    await new Promise((r) => setTimeout(r, 120));
    expect(innerOpen(container)).toBe(false);
  });

  it("初始 open=true 直接打开", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    render(
      () => (
        <FluentDialog open aria-label="静态打开">
          <h3 slot="title">t</h3>
        </FluentDialog>
      ),
      container,
    );
    await new Promise((r) => setTimeout(r, 150));
    expect(innerOpen(container)).toBe(true);
  });

  it("组件卸载时若仍开着应关闭", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const dispose = render(
      () => (
        <FluentDialog open aria-label="卸载测试">
          <h3 slot="title">t</h3>
        </FluentDialog>
      ),
      container,
    );
    await new Promise((r) => setTimeout(r, 150));
    const host = container.querySelector("fluent-dialog") as HTMLElement;
    expect(host.shadowRoot?.querySelector("dialog")?.open).toBe(true);

    dispose();
    await new Promise((r) => setTimeout(r, 50));
    expect(host.shadowRoot?.querySelector("dialog")?.open).toBe(false);
  });
});
