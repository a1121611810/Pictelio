// @vitest-environment happy-dom
/**
 * PrototypeIllust — /illust 详情页 UI 原型容器（开发模式，?variant= 分发）。
 *
 * 覆盖：默认/非法参数回落 A；variant=A|B|C 正确分发；切换条收到三个变体定义。
 * 三个变体组件 mock 为轻量 stub，专注验证分发逻辑。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";

const mocks = vi.hoisted(() => ({
  params: {} as Record<string, string | undefined>,
  navigate: vi.fn(),
}));

vi.mock("@solidjs/router", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useSearchParams: () => [mocks.params],
    useNavigate: () => mocks.navigate,
  } as typeof actual;
});

vi.mock("@/components/illust/prototype/VariantA", () => ({
  default: () => <div data-testid="illust-variant-a" />,
}));
vi.mock("@/components/illust/prototype/VariantC", () => ({
  default: () => <div data-testid="illust-variant-c" />,
}));
vi.mock("@/components/ui/PrototypeSwitcher", () => ({
  default: (props: { variants: { key: string }[] }) => (
    <div data-testid="switcher" data-variants={props.variants.map((v) => v.key).join(",")} />
  ),
}));

import PrototypeIllust from "@/components/illust/prototype/PrototypeIllust";

const props = {
  illust: () => null,
  imageUrls: () => [],
  coverUrl: () => "",
  isUgoira: () => false,
  isFollowed: () => false,
  following: () => false,
  bookmarking: () => false,
  openViewer: vi.fn(),
  toggleBookmark: vi.fn(),
  onBookmarkPointerDown: vi.fn(),
  onBookmarkPointerUp: vi.fn(),
  toggleFollow: vi.fn(),
  setShowActionMenu: vi.fn(),
  setShowComments: vi.fn(),
  handleCaptionClick: vi.fn(),
};

describe("PrototypeIllust ?variant= 分发", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.params = {};
  });

  it("无 variant 参数时回落变体 A", () => {
    render(() => <PrototypeIllust {...props} />);
    expect(screen.getByTestId("illust-variant-a")).toBeDefined();
    expect(screen.queryByTestId("illust-variant-c")).toBeNull();
  });

  it("variant=A/C 各自渲染对应变体", () => {
    mocks.params = { variant: "A" };
    render(() => <PrototypeIllust {...props} />);
    expect(screen.getByTestId("illust-variant-a")).toBeDefined();

    cleanup();
    mocks.params = { variant: "C" };
    render(() => <PrototypeIllust {...props} />);
    expect(screen.getByTestId("illust-variant-c")).toBeDefined();
    expect(screen.queryByTestId("illust-variant-a")).toBeNull();
  });

  it("非法 variant 值回落变体 A", () => {
    mocks.params = { variant: "X" };
    render(() => <PrototypeIllust {...props} />);
    expect(screen.getByTestId("illust-variant-a")).toBeDefined();
  });

  it("切换条收到 A/C 两个变体定义", () => {
    render(() => <PrototypeIllust {...props} />);
    const sw = screen.getByTestId("switcher");
    expect(sw.getAttribute("data-variants")).toBe("A,C");
  });
});
