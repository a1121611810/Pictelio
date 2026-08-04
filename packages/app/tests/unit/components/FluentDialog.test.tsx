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
import "@fluentui/web-components/dialog-body.js";
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

  // ── slot 契约（ADR-0062）──
  // fluent-dialog 命名 slot 全在内部 fluent-dialog-body 上：
  // 标题 → title，正文 → body 默认 slot（.content），按钮 → action（单数）。
  // 封装内须包 body 并把调用方的 slot="actions"（复数）重映射为 action（单数）。

  it("children 被包在 fluent-dialog-body 中", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    render(
      () => (
        <FluentDialog open aria-label="结构测试">
          <h3 slot="title">标题</h3>
          <p>正文内容</p>
          <fluent-button slot="actions" appearance="primary">
            确认
          </fluent-button>
        </FluentDialog>
      ),
      container,
    );
    await new Promise((r) => setTimeout(r, 120));

    const body = container.querySelector("fluent-dialog fluent-dialog-body");
    expect(body, "children 应包在 fluent-dialog-body 中").toBeTruthy();
  });

  it("标题投影到 title slot、正文进 body 默认 slot、按钮重映射为 action（单数）", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    render(
      () => (
        <FluentDialog open aria-label="投影测试">
          <h3 slot="title">标题</h3>
          <p>正文内容</p>
          <fluent-button slot="actions" appearance="secondary">
            取消
          </fluent-button>
          <fluent-button slot="actions" appearance="primary">
            确认
          </fluent-button>
        </FluentDialog>
      ),
      container,
    );
    await new Promise((r) => setTimeout(r, 120));

    const body = container.querySelector("fluent-dialog-body") as HTMLElement;
    expect(body).toBeTruthy();

    // 标题：保留 slot="title"
    const title = body.querySelector('[slot="title"]');
    expect(title?.textContent, "标题应投影到 title slot").toContain("标题");

    // 正文：裸元素进默认 slot（不带 slot 属性）
    const content = body.querySelector("p");
    expect(content?.textContent, "正文应进 body 默认 slot").toContain("正文内容");
    expect(content?.getAttribute("slot"), "正文不应携带 slot 属性").toBeNull();

    // 按钮：slot="actions"（复数）应被重映射为 action（单数）
    const buttons = [...body.querySelectorAll("fluent-button")];
    expect(buttons.length).toBe(2);
    for (const btn of buttons) {
      expect(btn.getAttribute("slot"), "按钮 slot 应重映射为 action（单数）").toBe("action");
    }
  });

  it('正文带 slot="content"（错误 slot）时剥除后进默认 slot', async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    render(
      () => (
        <FluentDialog open aria-label="content slot 修正">
          <div slot="title">标题</div>
          <div slot="content" class="content-body">
            正文
          </div>
          <fluent-button slot="actions" appearance="primary">
            确认
          </fluent-button>
        </FluentDialog>
      ),
      container,
    );
    await new Promise((r) => setTimeout(r, 120));

    const content = container.querySelector(".content-body");
    // slot="content" 不存在于 fluent-dialog-body，须剥除使其落入默认 slot
    expect(
      content?.getAttribute("slot"),
      '错误的 slot="content" 应被剥除（落入默认 slot）',
    ).toBeNull();
  });
});
