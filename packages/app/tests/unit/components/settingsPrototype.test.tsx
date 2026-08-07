// @vitest-environment happy-dom
/**
 * PrototypeSettings — 设置页 UI 原型容器（开发模式，?variant= 分发）。
 *
 * 覆盖：默认/非法参数回落 A；variant=A|B|C 正确分发；切换条收到三个变体定义。
 * 三个变体组件 mock 为轻量 stub，专注验证分发逻辑（变体自身是纯展示组件）。
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

vi.mock("@/components/settings/prototype/VariantA", () => ({
  default: () => <div data-testid="variant-a" />,
}));
vi.mock("@/components/settings/prototype/VariantA2", () => ({
  default: () => <div data-testid="variant-a2" />,
}));
vi.mock("@/components/settings/prototype/VariantA3", () => ({
  default: () => <div data-testid="variant-a3" />,
}));
vi.mock("@/components/settings/prototype/VariantB", () => ({
  default: () => <div data-testid="variant-b" />,
}));
vi.mock("@/components/settings/prototype/VariantC", () => ({
  default: () => <div data-testid="variant-c" />,
}));
vi.mock("@/components/settings/prototype/PrototypeSwitcher", () => ({
  default: (props: { variants: { key: string }[] }) => (
    <div data-testid="switcher" data-variants={props.variants.map((v) => v.key).join(",")} />
  ),
}));

import PrototypeSettings from "@/components/settings/prototype/PrototypeSettings";

const props = {
  isLoggedIn: () => false,
  onLogout: vi.fn(),
  onOpenBlocklist: vi.fn(),
  setAgeGateMessage: vi.fn(),
  onClearData: vi.fn(),
  onDeleteAccount: vi.fn(),
  onActionToast: vi.fn(),
};

describe("PrototypeSettings ?variant= 分发", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.params = {};
  });

  it("无 variant 参数时回落变体 A", () => {
    render(() => <PrototypeSettings {...props} />);
    expect(screen.getByTestId("variant-a")).toBeDefined();
    expect(screen.queryByTestId("variant-b")).toBeNull();
    expect(screen.queryByTestId("variant-c")).toBeNull();
  });

  it("variant=A 渲染变体 A", () => {
    mocks.params = { variant: "A" };
    render(() => <PrototypeSettings {...props} />);
    expect(screen.getByTestId("variant-a")).toBeDefined();
  });

  it("variant=A2 渲染变体 A2", () => {
    mocks.params = { variant: "A2" };
    render(() => <PrototypeSettings {...props} />);
    expect(screen.getByTestId("variant-a2")).toBeDefined();
    expect(screen.queryByTestId("variant-a")).toBeNull();
  });

  it("variant=A3 渲染变体 A3", () => {
    mocks.params = { variant: "A3" };
    render(() => <PrototypeSettings {...props} />);
    expect(screen.getByTestId("variant-a3")).toBeDefined();
    expect(screen.queryByTestId("variant-a")).toBeNull();
  });

  it("variant=B 渲染变体 B", () => {
    mocks.params = { variant: "B" };
    render(() => <PrototypeSettings {...props} />);
    expect(screen.getByTestId("variant-b")).toBeDefined();
    expect(screen.queryByTestId("variant-a")).toBeNull();
  });

  it("variant=C 渲染变体 C", () => {
    mocks.params = { variant: "C" };
    render(() => <PrototypeSettings {...props} />);
    expect(screen.getByTestId("variant-c")).toBeDefined();
  });

  it("非法 variant 值回落变体 A", () => {
    mocks.params = { variant: "X" };
    render(() => <PrototypeSettings {...props} />);
    expect(screen.getByTestId("variant-a")).toBeDefined();
  });

  it("切换条收到 A/A2/A3/B/C 五个变体定义", () => {
    render(() => <PrototypeSettings {...props} />);
    const sw = screen.getByTestId("switcher");
    expect(sw.getAttribute("data-variants")).toBe("A,A2,A3,B,C");
  });
});
