// @vitest-environment happy-dom
/**
 * IllustTypeBadge — 类型角标公共组件契约测试（Ticket #211 / spec: docs/specs/work-type-badges.md / ADR-0113）。
 *
 * 期望值出处（oracle）：spec 决策 3——动图 = 播放图标 +「动图」文字；多图 = 叠页图标 + 页数数字；
 * 并存时动图在前。断言只针对外部可观察行为（渲染文案与顺序），不耦合内部 DOM 结构。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import IllustTypeBadge from "@/components/IllustTypeBadge";

describe("IllustTypeBadge", () => {
  afterEach(() => cleanup());

  it("普通单图静态插画（illust, page_count=1）→ 不渲染任何角标", () => {
    const { container } = render(() => (
      <IllustTypeBadge illust={{ type: "illust", page_count: 1 }} />
    ));
    expect(container.querySelector("[data-testid='illust-type-badges']")).toBeNull();
  });

  it("动图（ugoira）→ 渲染「动图」角标", () => {
    render(() => <IllustTypeBadge illust={{ type: "ugoira", page_count: 1 }} />);
    expect(screen.getByText("动图")).toBeTruthy();
  });

  it("多图（page_count=3）→ 渲染页数「3」", () => {
    render(() => <IllustTypeBadge illust={{ type: "manga", page_count: 3 }} />);
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("并存异常数据（ugoira, page_count=5）→ 两角标并排且动图在前", () => {
    render(() => <IllustTypeBadge illust={{ type: "ugoira", page_count: 5 }} />);
    const group = screen.getByTestId("illust-type-badges");
    const text = group.textContent ?? "";
    const ugoiraIdx = text.indexOf("动图");
    const multiIdx = text.indexOf("5");
    expect(ugoiraIdx).toBeGreaterThanOrEqual(0);
    expect(multiIdx).toBeGreaterThan(ugoiraIdx);
  });
});
