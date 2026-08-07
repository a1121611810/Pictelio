// @vitest-environment happy-dom
/**
 * PrototypePersonalCenter — /me 页面 UI 原型容器（开发模式，?variant= 分发）。
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

vi.mock("@/components/me/prototype/VariantA", () => ({
  default: () => <div data-testid="me-variant-a" />,
}));
vi.mock("@/components/me/prototype/VariantB", () => ({
  default: () => <div data-testid="me-variant-b" />,
}));
vi.mock("@/components/me/prototype/VariantC", () => ({
  default: () => <div data-testid="me-variant-c" />,
}));
vi.mock("@/components/ui/PrototypeSwitcher", () => ({
  default: (props: { variants: { key: string }[] }) => (
    <div data-testid="switcher" data-variants={props.variants.map((v) => v.key).join(",")} />
  ),
}));

import PrototypePersonalCenter from "@/components/me/prototype/PrototypePersonalCenter";

const profileState = {
  targetUserId: () => 1,
  displayUser: () => ({ id: 1, name: "T", account: "t" }),
  isCurrentUser: () => true,
  isRootUserPage: () => true,
  totalWorks: () => 0,
  avatarUrl: () => "",
  avatarErrored: () => false,
  setAvatarErrored: vi.fn(),
};

const props = {
  profileState,
  profile: () => null,
  actions: {
    works: vi.fn(),
    bookmarks: vi.fn(),
    following: vi.fn(),
    followers: vi.fn(),
    settings: vi.fn(),
    back: vi.fn(),
    search: vi.fn(),
  },
};

describe("PrototypePersonalCenter ?variant= 分发", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.params = {};
  });

  it("无 variant 参数时回落变体 A", () => {
    render(() => <PrototypePersonalCenter {...props} />);
    expect(screen.getByTestId("me-variant-a")).toBeDefined();
    expect(screen.queryByTestId("me-variant-b")).toBeNull();
    expect(screen.queryByTestId("me-variant-c")).toBeNull();
  });

  it("variant=A/B/C 各自渲染对应变体", () => {
    mocks.params = { variant: "A" };
    render(() => <PrototypePersonalCenter {...props} />);
    expect(screen.getByTestId("me-variant-a")).toBeDefined();

    cleanup();
    mocks.params = { variant: "B" };
    render(() => <PrototypePersonalCenter {...props} />);
    expect(screen.getByTestId("me-variant-b")).toBeDefined();
    expect(screen.queryByTestId("me-variant-a")).toBeNull();

    cleanup();
    mocks.params = { variant: "C" };
    render(() => <PrototypePersonalCenter {...props} />);
    expect(screen.getByTestId("me-variant-c")).toBeDefined();
  });

  it("非法 variant 值回落变体 A", () => {
    mocks.params = { variant: "X" };
    render(() => <PrototypePersonalCenter {...props} />);
    expect(screen.getByTestId("me-variant-a")).toBeDefined();
  });

  it("切换条收到 A/B/C 三个变体定义", () => {
    render(() => <PrototypePersonalCenter {...props} />);
    const sw = screen.getByTestId("switcher");
    expect(sw.getAttribute("data-variants")).toBe("A,B,C");
  });
});
