// @vitest-environment happy-dom
/** RankingR18Notice 契约（spec docs/specs/ranking.md §5.7；#515）：指引文案 + 两个操作。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import RankingR18Notice from "@/components/ranking/RankingR18Notice";

describe("RankingR18Notice", () => {
  afterEach(() => cleanup());

  it("渲染指引标题/正文与两个操作", () => {
    render(() => <RankingR18Notice onRetry={() => {}} />);
    expect(screen.getByText("R-18 榜单需要先在 pixiv 开启")).toBeTruthy();
    expect(screen.getByText(/pixiv 网页端开启/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "前往 pixiv 设置" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  });

  it("重试触发 onRetry；设置按钮打开 pixiv 浏览设置页", () => {
    const onRetry = vi.fn();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(() => <RankingR18Notice onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "前往 pixiv 设置" }));
    expect(open).toHaveBeenCalledWith(
      "https://www.pixiv.net/settings/viewing",
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();
  });
});
