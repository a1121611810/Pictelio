// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";

const mockNavigate = vi.fn();
const mockBack = vi.fn();

const loaderData = () => ({
  error: null,
  novel: {
    id: 42,
    title: "Test Novel",
    user: { id: 1, name: "Author", account: "author", profile_image_urls: {} },
    image_urls: { square_medium: "", medium: "", large: "" },
    tags: [],
    page_count: 1,
    text_length: 1000,
    is_bookmarked: false,
    total_bookmarks: 0,
    total_view: 0,
    x_restrict: 0,
    create_date: "2026-01-01T00:00:00Z",
  },
  text: "第一段正文内容\n\n[uploadedimage:24980988]\n\n[newpage]\n\n第二段正文内容",
  nav: {},
  images: {
    "24980988": {
      novelImageId: "24980988",
      sl: "2",
      urls: {
        "240mw": "https://example.com/240.jpg",
        "480mw": "https://example.com/480.jpg",
        "1200x1200": "https://example.com/1200.jpg",
        "128x128": "https://example.com/128.jpg",
        original: "https://example.com/original.png",
      },
    },
  },
});

vi.mock("@tanstack/solid-router", () => ({
  useParams: () => () => ({ id: "42" }),
  useNavigate: () => mockNavigate,
  useRouter: () => ({ history: { back: mockBack } }),
}));

vi.mock("@/stores/novelCache", () => ({
  peekEntry: () => undefined,
  getEntry: () => Promise.resolve(undefined),
  setEntry: () => Promise.resolve(),
  loadNovelEntry: () =>
    Promise.resolve({
      detail: loaderData().novel,
      text: loaderData().text,
      nav: loaderData().nav,
      images: loaderData().images,
    }),
}));

vi.mock("@/components/PixivImage", () => ({
  default: () => <div data-testid="pixiv-image" />,
}));

vi.mock("@/components/NovelSearchBar", () => ({
  default: () => <div data-testid="novel-search-bar" />,
}));

vi.mock("@/components/ReaderSettingsSheet", () => ({
  default: () => <div data-testid="reader-settings-sheet" />,
}));

vi.mock("@/components/SeriesSheet", () => ({
  default: () => <div data-testid="series-sheet" />,
}));

vi.mock("@/components/PageTransition", () => ({
  default: (props: { children?: unknown }) => <div>{props.children}</div>,
}));

vi.mock("@/components/ui/FluentIcon", () => ({
  default: () => <span>icon</span>,
}));

vi.mock("@tanstack/solid-virtual", () => {
  // Shared state for Virtualizer constructor
  return {
    Virtualizer: vi.fn(function VirtualizerMock(
      this: Record<string, unknown>,
      opts: { count?: number; estimateSize?: (i: number) => number },
    ) {
      let count = opts.count ?? 0;
      let estimateSize = opts.estimateSize ?? (() => 100);

      function computeItems() {
        const items: Array<{
          index: number;
          key: number;
          start: number;
          size: number;
          end: number;
          lane: number;
        }> = [];
        let y = 0;
        for (let i = 0; i < count; i++) {
          const h = estimateSize(i);
          items.push({ index: i, key: i, start: y, size: h, end: y + h, lane: 0 });
          y += h;
        }
        return items;
      }

      function computeTotalSize() {
        const items = computeItems();
        return items.length > 0 ? items[items.length - 1].start + items[items.length - 1].size : 0;
      }

      this.setOptions = vi.fn((newOpts: Record<string, unknown>) => {
        if (typeof newOpts.count === "number") count = newOpts.count;
        if (typeof newOpts.estimateSize === "function") estimateSize = newOpts.estimateSize;
      });
      this.measure = vi.fn();
      this.getVirtualItems = vi.fn(() => computeItems());
      this.getTotalSize = vi.fn(() => computeTotalSize());
      this.scrollToOffset = vi.fn();
      this.scrollToIndex = vi.fn();
      this.takeSnapshot = vi.fn(() => {
        const items = [];
        for (let i = 0; i < count; i++) {
          items.push({ index: i, key: i, start: i * 100, size: 100, end: (i + 1) * 100, lane: 0 });
        }
        return items;
      });
      this.isScrolling = false;
      this.getDistanceFromEnd = vi.fn(() => 0);
      this.isAtEnd = vi.fn(() => true);
      this.measureElement = vi.fn();
      this._didMount = vi.fn(() => vi.fn());
      this._willUpdate = vi.fn();
      Object.defineProperty(this, "scrollOffset", {
        get: () => (this as any).__scrollOffset ?? 0,
        set: (v: number) => {
          (this as any).__scrollOffset = v;
        },
        configurable: true,
      });
    }),
    observeWindowRect: vi.fn(),
    observeWindowOffset: vi.fn(),
    windowScroll: vi.fn(),
    createWindowVirtualizer: vi.fn(() => ({
      getVirtualItems: vi.fn(() => []),
      getTotalSize: vi.fn(() => 0),
      scrollToOffset: vi.fn(),
      get scrollOffset() {
        return 0;
      },
      takeSnapshot: vi.fn(() => []),
      isScrolling: false,
    })),
    createVirtualizer: vi.fn(() => ({
      getVirtualItems: vi.fn(() => []),
      getTotalSize: vi.fn(() => 0),
      scrollToOffset: vi.fn(),
      get scrollOffset() {
        return 0;
      },
      takeSnapshot: vi.fn(() => []),
      isScrolling: false,
    })),
  };
});

vi.mock("@/utils/novelImageDimensions", () => ({
  loadNovelImageDimensions: () => Promise.resolve({}),
}));

globalThis.ResizeObserver = vi.fn(function ResizeObserver() {
  return {
    observe: vi.fn(),
    disconnect: vi.fn(),
  };
}) as unknown as typeof ResizeObserver;

globalThis.IntersectionObserver = vi.fn(function IntersectionObserver() {
  return {
    observe: vi.fn(),
    disconnect: vi.fn(),
  };
}) as unknown as typeof IntersectionObserver;

import NovelDetail from "@/routes/NovelDetail";

describe("NovelDetail content rendering", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      value: 1000,
    });
    window.innerWidth = 1000;
    window.innerHeight = 800;
  });

  it("renders text paragraphs, embedded images and page breaks", async () => {
    render(() => <NovelDetail />);

    await screen.findByText("Test Novel");

    expect(screen.getByText("Test Novel")).toBeDefined();
    expect(screen.getByText("第一段正文内容")).toBeDefined();
    expect(screen.getByText("第二段正文内容")).toBeDefined();
    expect(document.querySelectorAll("figure.novel-image-block").length).toBeGreaterThanOrEqual(0);
    expect(document.querySelectorAll("hr.novel-page-break").length).toBeGreaterThanOrEqual(0);
  });
});
