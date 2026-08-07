// @vitest-environment happy-dom
/**
 * PrototypeHome — /home 页面 UI 原型容器（开发模式，?variant= 分发）。
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

vi.mock("@/components/home/prototype/VariantA", () => ({
  default: () => <div data-testid="home-variant-a" />,
}));
vi.mock("@/components/home/prototype/VariantDeep", () => ({
  default: () => <div data-testid="home-variant-d" />,
}));
vi.mock("@/components/home/prototype/VariantCompact", () => ({
  default: () => <div data-testid="home-variant-c" />,
}));
vi.mock("@/components/home/prototype/VariantImmersive", () => ({
  default: () => <div data-testid="home-variant-i" />,
}));
vi.mock("@/components/ui/PrototypeSwitcher", () => ({
  default: (props: { variants: { key: string }[] }) => (
    <div data-testid="switcher" data-variants={props.variants.map((v) => v.key).join(",")} />
  ),
}));

import PrototypeHome from "@/components/home/prototype/PrototypeHome";

const props = {
  headerVisible: () => true,
  effectiveTab: () => "recommended",
  isDomActive: () => true,
};

describe("PrototypeHome ?variant= 分发", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.params = {};
  });

  it("无 variant 参数时回落变体 A", () => {
    render(() => <PrototypeHome {...props} />);
    expect(screen.getByTestId("home-variant-a")).toBeDefined();
    expect(screen.queryByTestId("home-variant-d")).toBeNull();
    expect(screen.queryByTestId("home-variant-c")).toBeNull();
    expect(screen.queryByTestId("home-variant-i")).toBeNull();
  });

  it("variant=A/D/C/I 各自渲染对应变体", () => {
    mocks.params = { variant: "A" };
    render(() => <PrototypeHome {...props} />);
    expect(screen.getByTestId("home-variant-a")).toBeDefined();

    cleanup();
    mocks.params = { variant: "D" };
    render(() => <PrototypeHome {...props} />);
    expect(screen.getByTestId("home-variant-d")).toBeDefined();
    expect(screen.queryByTestId("home-variant-a")).toBeNull();

    cleanup();
    mocks.params = { variant: "C" };
    render(() => <PrototypeHome {...props} />);
    expect(screen.getByTestId("home-variant-c")).toBeDefined();

    cleanup();
    mocks.params = { variant: "I" };
    render(() => <PrototypeHome {...props} />);
    expect(screen.getByTestId("home-variant-i")).toBeDefined();
  });

  it("非法 variant 值回落变体 A", () => {
    mocks.params = { variant: "X" };
    render(() => <PrototypeHome {...props} />);
    expect(screen.getByTestId("home-variant-a")).toBeDefined();
  });

  it("切换条收到 A/D/C/I 四个变体定义", () => {
    render(() => <PrototypeHome {...props} />);
    const sw = screen.getByTestId("switcher");
    expect(sw.getAttribute("data-variants")).toBe("A,D,C,I");
  });
});
