// @vitest-environment happy-dom
/**
 * PrototypeNovel — /novel 小说详情页 UI 原型容器（开发模式，?variant= 分发）。
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

vi.mock("@/components/novel/prototype/VariantA", () => ({
  default: () => <div data-testid="novel-variant-a" />,
}));
vi.mock("@/components/novel/prototype/VariantB", () => ({
  default: () => <div data-testid="novel-variant-b" />,
}));
vi.mock("@/components/novel/prototype/VariantC", () => ({
  default: () => <div data-testid="novel-variant-c" />,
}));
vi.mock("@/components/ui/PrototypeSwitcher", () => ({
  default: (props: { variants: { key: string }[] }) => (
    <div data-testid="switcher" data-variants={props.variants.map((v) => v.key).join(",")} />
  ),
}));

import PrototypeNovel from "@/components/novel/prototype/PrototypeNovel";

const props = {
  novelData: () => null,
  detailLoading: () => false,
  showHeaderTitle: () => true,
  searchOpen: () => false,
  footerHidden: () => false,
  onBack: vi.fn(),
  openSearch: vi.fn(),
  closeSearch: vi.fn(),
  onAuthorClick: vi.fn(),
  onSeriesClick: vi.fn(),
  onCommentsClick: vi.fn(),
  setTitleEl: vi.fn(),
  setSettingsOpen: vi.fn(),
  setTranslateOpen: vi.fn(),
  setSeriesOpen: vi.fn(),
  setShowComments: vi.fn(),
  footerNav: () => ({}),
  renderBody: () => null,
};

describe("PrototypeNovel ?variant= 分发", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.params = {};
  });

  it("无 variant 参数时回落变体 A", () => {
    render(() => <PrototypeNovel {...props} />);
    expect(screen.getByTestId("novel-variant-a")).toBeDefined();
    expect(screen.queryByTestId("novel-variant-b")).toBeNull();
    expect(screen.queryByTestId("novel-variant-c")).toBeNull();
  });

  it("variant=A/B/C 各自渲染对应变体", () => {
    mocks.params = { variant: "A" };
    render(() => <PrototypeNovel {...props} />);
    expect(screen.getByTestId("novel-variant-a")).toBeDefined();

    cleanup();
    mocks.params = { variant: "B" };
    render(() => <PrototypeNovel {...props} />);
    expect(screen.getByTestId("novel-variant-b")).toBeDefined();
    expect(screen.queryByTestId("novel-variant-a")).toBeNull();

    cleanup();
    mocks.params = { variant: "C" };
    render(() => <PrototypeNovel {...props} />);
    expect(screen.getByTestId("novel-variant-c")).toBeDefined();
  });

  it("非法 variant 值回落变体 A", () => {
    mocks.params = { variant: "X" };
    render(() => <PrototypeNovel {...props} />);
    expect(screen.getByTestId("novel-variant-a")).toBeDefined();
  });

  it("切换条收到 A/B/C 三个变体定义", () => {
    render(() => <PrototypeNovel {...props} />);
    const sw = screen.getByTestId("switcher");
    expect(sw.getAttribute("data-variants")).toBe("A,B,C");
  });
});
