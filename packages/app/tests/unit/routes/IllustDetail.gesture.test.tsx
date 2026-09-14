// @vitest-environment happy-dom
/**
 * IllustDetail 心形手势（ADR-0160 D3/D4；spec docs/specs/bookmark-tags.md 用户故事 1/2）。
 *
 * 覆盖本功能唯一「语义翻转」点：详情页心形长按 500ms = 打开收藏面板（原「私密直存」语义
 * 升级），单击 = 快速收藏（公开、无标签、爆发动效不变）。此前 `tests/unit/**` 对该窗口
 * 零覆盖（agent-browser / android-e2e 不在 CI 的 pnpm test 内），本文件是 CI 内机器防线。
 *
 * oracle 溯源（测试硬约束 #6）：
 * - 长按阈值 500ms + 单击/长按语义分流 = ADR-0160 D3/D4、spec D3「webview 长按 500ms」；
 * - 快速收藏载荷 (illustId, "public") 无 tags = spec D1/D3（公开 + 零决策）；
 * - 面板出现即可见 `data-testid="bookmark-panel"` = BookmarkPanel 既有测试契约（同选择器）。
 *
 * mock 范围（跟 tests/unit/routes/NovelDetail.test.tsx 惯例）：数据层（@/api/illust）、
 * 与手势无关的重子组件、路由参数与浏览器观察器；BookmarkPanel / BottomActionBar 保留
 * 真实实现——被测入口（`button[aria-label="收藏"]`）由 BottomActionBar 提供，
 * 面板 DOM 由真实 BookmarkPanel 提供（其数据层已 mock）。
 *
 * 环境注意：本页含「数值初值 0」的动态文本（total_bookmarks 等），依赖
 * tests/setup/happy-dom-textcontent.ts 的 happy-dom textContent 数值强转补丁——
 * 缺它时 Solid 的数值文本节点会丢失并在更新时抛 TypeError（详见该 setup 文件）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import type { PixivIllust } from "@/api/types";

const api = vi.hoisted(() => ({
  loadDetail: vi.fn(),
  addBookmark: vi.fn(),
  deleteBookmark: vi.fn(),
  followUser: vi.fn(),
  unfollowUser: vi.fn(),
  loadUgoiraMetadata: vi.fn(),
  streamUgoiraFrames: vi.fn(),
  downloadAndExtractUgoira: vi.fn(),
  // 收藏面板（真实实现）的预填与标签库数据源
  loadBookmarkDetail: vi.fn(),
  loadUserBookmarkTags: vi.fn(),
}));

vi.mock("@/api/illust", () => ({ ...api }));
vi.mock("@/stores/authStore", () => ({ user: () => ({ id: 42 }) }));
vi.mock("@/stores/backGestureStore", () => ({ pushOverlay: vi.fn(), popOverlay: vi.fn() }));
vi.mock("@/stores/historyStore", () => ({ recordVisit: vi.fn() }));
vi.mock("@/stores/blockStore", () => ({ blockUser: vi.fn(), isBlocked: () => false }));
vi.mock("@/stores/downloadStore", () => ({ enqueueDownloads: vi.fn() }));
vi.mock("@/stores/settingsStore", () => ({
  ugoiraMode: () => "fflate",
  ugoiraDownloadFormat: () => "zip",
  detailQuality: () => "large",
  showDetailStairs: () => false,
}));
vi.mock("@/services/backTransitionService", () => ({ goBack: vi.fn() }));
vi.mock("@/utils/galleryDownload", () => ({
  originalPageUrls: () => [],
  buildImageTasks: () => [],
  buildUgoiraTask: () => ({}),
}));
vi.mock("@/components/PixivImage", () => ({ default: () => <div data-testid="pixiv-image" /> }));
vi.mock("@/components/HeartBurstEffect", () => ({
  default: () => <div data-testid="heart-burst" />,
}));
vi.mock("@/components/PageTransition", () => ({
  default: (props: { children?: unknown }) => <div>{props.children}</div>,
}));
vi.mock("@/components/LazyDetailImage", () => ({
  default: () => <div data-testid="lazy-detail-image" />,
}));
vi.mock("@/components/ImageViewer", () => ({ default: () => <div /> }));
vi.mock("@/components/UgoiraViewer", () => ({ default: () => <div /> }));
vi.mock("@/components/CommentOverlay", () => ({ default: () => <div /> }));
vi.mock("@/components/ReportSheet", () => ({ default: () => <div /> }));
vi.mock("@/components/IllustActionMenu", () => ({ default: () => <div /> }));
vi.mock("@/components/IllustTags", () => ({ default: () => <div /> }));
vi.mock("@/components/DetailHeader", () => ({ default: () => <div /> }));
vi.mock("@/components/illust/PagePickerSheet", () => ({ default: () => <div /> }));
vi.mock("@/components/skeletons/IllustDetailSkeleton", () => ({ default: () => <div /> }));
vi.mock("@solid-primitives/intersection-observer", () => ({
  createIntersectionObserver: () => [[]],
}));
vi.mock("@solidjs/router", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useParams: () => ({ id: "123" }),
    useNavigate: () => vi.fn(),
  } as typeof actual;
});

import IllustDetail from "@/routes/IllustDetail";

/** 详情页数据层最小真值（loadDetail → { illust }） */
const ILLUST = {
  id: 123,
  title: "手势用例",
  type: "illust",
  page_count: 1,
  image_urls: { medium: "proxy/medium.jpg", large: "proxy/large.jpg" },
  meta_single_page: { original_image_url: "proxy/original.jpg" },
  meta_pages: [],
  width: 800,
  height: 600,
  tags: [{ name: "原创" }],
  is_bookmarked: false,
  total_bookmarks: 0,
  total_comments: 0,
  total_view: 0,
  x_restrict: 0,
  user: {
    id: 1,
    name: "作者",
    account: "author",
    is_followed: false,
    profile_image_urls: { medium: "" },
  },
  create_date: "2026-01-01T00:00:00Z",
  caption: "",
} as unknown as PixivIllust;

/** flush：microtask 链（Solid 2.0 写批处理在微任务；定时器推进另行 advanceTimersByTimeAsync） */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  // happy-dom 无 IntersectionObserver：IllustDetail 底部操作条显隐观察需要（不影响断言）
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): [] {
        return [];
      }
    },
  );
  api.loadDetail.mockResolvedValue({ illust: ILLUST });
  api.addBookmark.mockResolvedValue(undefined);
  api.deleteBookmark.mockResolvedValue(undefined);
  // 面板打开时的预填/标签库：未收藏真值（真机 probe 语义）+ 空标签库
  api.loadBookmarkDetail.mockResolvedValue({ is_bookmarked: false, restrict: "public", tags: [] });
  api.loadUserBookmarkTags.mockResolvedValue({ bookmark_tags: [], next_url: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("IllustDetail 心形手势（长按 = 面板 / 单击 = 快速收藏）", () => {
  it("长按 500ms：打开收藏面板且不写收藏（ADR-0160 D3/D4）", async () => {
    vi.useFakeTimers();
    render(() => <IllustDetail />);
    await flush();

    const heart = screen.getByLabelText("收藏");
    fireEvent.pointerDown(heart);
    await vi.advanceTimersByTimeAsync(600);
    await flush();

    expect(screen.queryByTestId("bookmark-panel")).not.toBeNull();
    expect(api.addBookmark).not.toHaveBeenCalled();
  });

  it("长按后面板已开、松手仍不得走快速收藏（长按不得双触发）", async () => {
    vi.useFakeTimers();
    render(() => <IllustDetail />);
    await flush();

    const heart = screen.getByLabelText("收藏");
    fireEvent.pointerDown(heart);
    await vi.advanceTimersByTimeAsync(600);
    await flush();
    expect(screen.queryByTestId("bookmark-panel")).not.toBeNull();

    // 关键：长按开面板后松手，pointerup 不得再触发快速收藏（生产靠 longPressTimer 归零抑制）
    fireEvent.pointerUp(heart);
    await flush();

    expect(api.addBookmark).not.toHaveBeenCalled();
    expect(screen.queryByTestId("bookmark-panel")).not.toBeNull();
  });

  it("单击（<500ms）：快速收藏 public + 无标签，不打开面板（spec D1/D3）", async () => {
    vi.useFakeTimers();
    render(() => <IllustDetail />);
    await flush();

    const heart = screen.getByLabelText("收藏");
    fireEvent.pointerDown(heart);
    await flush();
    fireEvent.pointerUp(heart);
    await flush();

    expect(api.addBookmark).toHaveBeenCalledWith(123, "public");
    expect(screen.queryByTestId("bookmark-panel")).toBeNull();
  });
});
