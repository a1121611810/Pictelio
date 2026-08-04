// @vitest-environment happy-dom
/**
 * fluent-dialog 契约守护测试。
 *
 * @fluentui/web-components 的 Dialog 没有 open 属性绑定，
 * 只有 show()/hide() 方法。设置 open 属性/特性不会打开内部 <dialog>。
 * 本测试锁定这一契约，防止未来误用 open={...} 或依赖版本变更悄悄改变行为。
 */
import { describe, it, expect, beforeAll } from "vitest";
import "@fluentui/web-components/dialog.js";

describe("fluent-dialog 契约", () => {
  beforeAll(async () => {
    await customElements.whenDefined("fluent-dialog");
  });

  it("open DOM property 不影响内部 <dialog>", async () => {
    const el = document.createElement("fluent-dialog");
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 120));

    const inner = el.shadowRoot?.querySelector("dialog");
    expect(inner?.open).toBe(false);

    (el as any).open = true;
    await new Promise((r) => setTimeout(r, 80));
    expect(inner?.open, "设置 open property 不应打开内部 dialog").toBe(false);
  });

  it("open attribute 不影响内部 <dialog>", async () => {
    const el = document.createElement("fluent-dialog");
    el.setAttribute("open", "");
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 120));

    const inner = el.shadowRoot?.querySelector("dialog");
    expect(inner?.open, "设置 open attribute 不应打开内部 dialog").toBe(false);
  });

  it("show()/hide() 控制内部 <dialog>", async () => {
    const el = document.createElement("fluent-dialog") as any;
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 120));

    const inner = () => el.shadowRoot?.querySelector("dialog");
    el.show();
    await new Promise((r) => setTimeout(r, 80));
    expect(inner()?.open).toBe(true);

    el.hide();
    await new Promise((r) => setTimeout(r, 80));
    expect(inner()?.open).toBe(false);
  });
});
