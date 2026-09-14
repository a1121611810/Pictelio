// @vitest-environment happy-dom
/**
 * BookmarkPanel 收藏面板（spec docs/specs/bookmark-tags.md D5–D7/D11、ADR-0160 D2/D5/D7）。
 *
 * oracle 溯源：
 * - 交互与错误语义 = spec 用户故事 7–12 / D5/D6（预填真值 / 上限拒收 / 保存失败回滚 /
 *   标签库失败不阻塞保存 / 无真值禁存）；
 * - 「已选 = detail.tags 中 is_registered 的项」= ADR-0160 D5（预填依据）；
 * - 「保存载荷 (illustId, restrict, tags)」= spec D1/D4（空格 join 的线上格式由
 *   tests/unit/api/illust.test.ts 契约测试锁定，此处锁定 UI→API 的参数形状）；
 * - 「可见性切换按分库重拉标签库」= spec D7。
 * i18n 断言用 zh-CN 源语言文案（源语言静态内联，t() 恒返回 string）。
 * Solid 2.0：effect 在渲染后异步落定 + 微任务批处理，断言前需 flush（tick）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import type { ComponentProps } from "solid-js";
import BookmarkPanel from "@/components/BookmarkPanel";

const api = vi.hoisted(() => ({
  addBookmark: vi.fn(() => Promise.resolve()),
  loadBookmarkDetail: vi.fn(),
  loadUserBookmarkTags: vi.fn(),
}));

const auth = vi.hoisted(() => ({ user: vi.fn() }));

vi.mock("@/api/illust", () => ({
  addBookmark: api.addBookmark,
  loadBookmarkDetail: api.loadBookmarkDetail,
  loadUserBookmarkTags: api.loadUserBookmarkTags,
}));

vi.mock("@/stores/authStore", () => ({ user: auth.user }));

/** 供断言 console.warn（测试硬约束 #3）同时避免测试输出噪音 */
let warnSpy: ReturnType<typeof vi.spyOn>;

/** flush：两轮微任务 + 一个宏任务窗口，覆盖 panel 内 promise 链落定 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function renderPanel(overrides: Partial<ComponentProps<typeof BookmarkPanel>> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const result = render(() => (
    <BookmarkPanel
      illustId={123}
      isBookmarked={false}
      workTags={["原创"]}
      isOpen
      onClose={onClose}
      onSaved={onSaved}
      {...overrides}
    />
  ));
  return { onClose, onSaved, ...result };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  auth.user.mockReturnValue({ id: 42 });
  api.addBookmark.mockResolvedValue(undefined);
  api.loadBookmarkDetail.mockResolvedValue(null);
  api.loadUserBookmarkTags.mockResolvedValue({ bookmark_tags: [], next_url: null });
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("BookmarkPanel 预填", () => {
  it("已收藏：勾选 detail 中 is_registered 的标签、恢复可见性、保存文案为「保存修改」", async () => {
    api.loadBookmarkDetail.mockResolvedValue({
      is_bookmarked: true,
      restrict: "private",
      tags: [
        { name: "夜景", is_registered: true },
        { name: "未注册的建议", is_registered: false },
      ],
    });
    renderPanel({ isBookmarked: true });
    await tick();

    expect(screen.getByText("已选标签（1/10）")).toBeTruthy();
    expect(screen.getByLabelText("移除标签 夜景")).toBeTruthy();
    expect(screen.queryByLabelText("移除标签 未注册的建议")).toBeNull();
    expect(screen.getByText("私密").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("保存修改")).toBeTruthy();
  });

  it("未收藏（bookmark_detail 为 null）：无已选标签、保存文案为「收藏」", async () => {
    renderPanel();
    await tick();

    expect(screen.getByText("尚未选择标签")).toBeTruthy();
    expect(screen.getByText("收藏")).toBeTruthy();
    expect(screen.getByText("公开").getAttribute("aria-pressed")).toBe("true");
  });

  it("未登录（无 userId）：标签库不进请求，显式降级提示", async () => {
    auth.user.mockReturnValue(null);
    renderPanel();
    await tick();

    expect(api.loadUserBookmarkTags).not.toHaveBeenCalled();
    expect(screen.getByText("标签库加载失败，仍可手动输入")).toBeTruthy();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[BookmarkPanel]"));
  });

  it("契约破坏：bookmark_detail 缺 is_bookmarked → warn + 按未收藏（不得误判为已收藏）", async () => {
    // oracle：lynx 侧同语义（app-lynx/src/composables/useBookmarkPanel.ts applyPrefill）
    // + 真机 probe：未收藏也返回对象，故缺字段是契约破坏而非已收藏信号。
    api.loadBookmarkDetail.mockResolvedValue({ restrict: "public", tags: [] });
    // 宿主快照声称已收藏：预设方向错误的实现会回落到「已收藏」（保存文案「保存修改」）
    renderPanel({ isBookmarked: true });
    await tick();

    expect(screen.getByTestId("bookmark-panel-save").textContent).toBe("收藏");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("is_bookmarked"));
  });

  it("契约破坏：标签库响应缺 bookmark_tags → warn + 空候选（保存不受阻）", async () => {
    api.loadUserBookmarkTags.mockResolvedValue({ next_url: null });
    renderPanel();
    await tick();

    expect(screen.getByText("暂无历史标签")).toBeTruthy();
    expect(screen.getByTestId("bookmark-panel-save").hasAttribute("disabled")).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("bookmark_tags"));
  });
});

describe("BookmarkPanel 选择与保存", () => {
  it("勾选标签库 chip 后保存：addBookmark 收到 (illustId, restrict, tags) 并回调 onSaved", async () => {
    api.loadUserBookmarkTags.mockResolvedValue({
      bookmark_tags: [{ name: "风景", count: 3 }],
      next_url: null,
    });
    const { onSaved, onClose } = renderPanel({ illustId: 777 });
    await tick();

    fireEvent.click(screen.getByLabelText("标签 风景，使用过 3 次"));
    await tick();
    expect(screen.getByLabelText("移除标签 风景")).toBeTruthy();

    fireEvent.click(screen.getByText("收藏"));
    await tick();

    expect(api.addBookmark).toHaveBeenCalledWith(777, "public", ["风景"]);
    // onSaved 契约无参（宿主自行读取页面收藏态；ADR-0160 D2 覆盖式编辑恒为「收藏」方向）
    expect(onSaved).toHaveBeenCalledWith();
    expect(onClose).toHaveBeenCalled();
  });

  it("可见性切到私密：按新分库重拉标签库", async () => {
    renderPanel();
    await tick();
    expect(api.loadUserBookmarkTags).toHaveBeenLastCalledWith(
      42,
      "public",
      undefined,
      expect.anything(),
    );

    fireEvent.click(screen.getByText("私密"));
    await tick();
    expect(api.loadUserBookmarkTags).toHaveBeenLastCalledWith(
      42,
      "private",
      undefined,
      expect.anything(),
    );
  });

  it("已选 10 个后第 11 个被拒收并给出上限反馈（spec 用户故事 9）", async () => {
    const tags = Array.from({ length: 11 }, (_, i) => ({ name: `t${i}`, count: i }));
    api.loadUserBookmarkTags.mockResolvedValue({ bookmark_tags: tags, next_url: null });
    renderPanel();
    await tick();

    for (const tag of tags) {
      fireEvent.click(screen.getByLabelText(new RegExp(`^标签 ${tag.name}，`)));
      await tick();
    }

    expect(screen.getByText("已选标签（10/10）")).toBeTruthy();
    expect(screen.getByText("最多只能选择 10 个标签")).toBeTruthy();
    expect(screen.queryByLabelText("移除标签 t10")).toBeNull();
  });

  it("新建标签：空格提交 token；重复与空串分别给出反馈（spec D11 / 用户故事 11）", async () => {
    renderPanel();
    await tick();
    const input = screen.getByPlaceholderText("输入后按空格或回车添加");

    // 空格提交当前 token（Solid 2.0：写批处理在微任务，输入与提交是两次事件，需分别 flush）
    fireEvent.input(input, { target: { value: "新标签" } });
    await tick();
    fireEvent.keyDown(input, { key: " " });
    await tick();
    expect(screen.getByLabelText("移除标签 新标签")).toBeTruthy();

    // 重复
    fireEvent.input(input, { target: { value: "新标签" } });
    await tick();
    fireEvent.keyDown(input, { key: " " });
    await tick();
    expect(screen.getByText("该标签已在已选中")).toBeTruthy();

    // 空串（纯空格）
    fireEvent.input(input, { target: { value: "   " } });
    await tick();
    fireEvent.keyDown(input, { key: " " });
    await tick();
    expect(screen.getByText("标签不能为空")).toBeTruthy();
  });

  it("已选标签可移除（chip 点击取消勾选）", async () => {
    renderPanel();
    await tick();
    const input = screen.getByPlaceholderText("输入后按空格或回车添加");
    fireEvent.input(input, { target: { value: "临时" } });
    await tick();
    fireEvent.keyDown(input, { key: " " });
    await tick();
    expect(screen.getByText("已选标签（1/10）")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("移除标签 临时"));
    await tick();
    expect(screen.getByText("尚未选择标签")).toBeTruthy();
  });

  it("新建成功即清除此前反馈（成功清、失败留）", async () => {
    renderPanel();
    await tick();
    const input = screen.getByPlaceholderText("输入后按空格或回车添加");

    fireEvent.input(input, { target: { value: "已有" } });
    await tick();
    fireEvent.keyDown(input, { key: " " });
    await tick();

    // 重复 → 反馈出现（失败保留）
    fireEvent.input(input, { target: { value: "已有" } });
    await tick();
    fireEvent.keyDown(input, { key: " " });
    await tick();
    expect(screen.getByText("该标签已在已选中")).toBeTruthy();

    // 再成功新建 → 反馈清除
    fireEvent.input(input, { target: { value: "新的" } });
    await tick();
    fireEvent.keyDown(input, { key: " " });
    await tick();
    expect(screen.getByLabelText("移除标签 新的")).toBeTruthy();
    expect(screen.queryByText("该标签已在已选中")).toBeNull();
  });
});

describe("BookmarkPanel 错误路径（禁止静默降级，测试硬约束 #3）", () => {
  it("预填失败：显示错误并禁用保存（无真值不覆盖）", async () => {
    api.loadBookmarkDetail.mockRejectedValue(new Error("boom"));
    renderPanel();
    await tick();

    expect(screen.getByText(/收藏状态获取失败/)).toBeTruthy();
    expect(screen.getByText("收藏").hasAttribute("disabled")).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[BookmarkPanel]"),
      expect.anything(),
    );
  });

  it("预填失败展示：ApiError 走 messageKey 的 i18n 渲染，不回退 message 快照", async () => {
    // oracle：src/i18n/locales/zh-CN/error.ts 的 error.api.unauthorized 字面量
    // 「登录已过期 (HTTP {{status}}){{detail}}」+ params（src/api/client.ts classifyError）。
    // message 快照恒为简中（src/api/types.ts ApiError 注释），英文 locale 下直用即泄漏中文。
    api.loadBookmarkDetail.mockRejectedValue({
      type: "UNAUTHORIZED",
      message: "SHOULD-NOT-RENDER",
      messageKey: "error.api.unauthorized",
      params: { status: 401, detail: "" },
    });
    renderPanel();
    await tick();

    expect(screen.getByText(/收藏状态获取失败：登录已过期 \(HTTP 401\)/)).toBeTruthy();
    expect(screen.queryByText(/SHOULD-NOT-RENDER/)).toBeNull();
  });

  it("标签库失败：降级提示但保存可用", async () => {
    api.loadUserBookmarkTags.mockRejectedValue(new Error("net down"));
    renderPanel();
    await tick();

    expect(screen.getByText("标签库加载失败，仍可手动输入")).toBeTruthy();
    expect(screen.getByText("收藏").hasAttribute("disabled")).toBe(false);
  });

  it("保存失败：提示错误 + 回滚到预填态 + 不回调 onSaved/onClose", async () => {
    api.loadBookmarkDetail.mockResolvedValue({
      is_bookmarked: true,
      restrict: "public",
      tags: [{ name: "夜景", is_registered: true }],
    });
    api.addBookmark.mockRejectedValue(new Error("HTTP 500"));
    const { onSaved, onClose } = renderPanel({ isBookmarked: true });
    await tick();

    // 偏离预填态：移除既有标签 + 新建一个
    fireEvent.click(screen.getByLabelText("移除标签 夜景"));
    await tick();
    const input = screen.getByPlaceholderText("输入后按空格或回车添加");
    fireEvent.input(input, { target: { value: "新加的" } });
    await tick();
    fireEvent.keyDown(input, { key: " " });
    await tick();
    expect(screen.getByLabelText("移除标签 新加的")).toBeTruthy();

    fireEvent.click(screen.getByText("保存修改"));
    await tick();

    expect(screen.getByText(/保存失败/)).toBeTruthy();
    expect(screen.getByLabelText("移除标签 夜景")).toBeTruthy();
    expect(screen.queryByLabelText("移除标签 新加的")).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
