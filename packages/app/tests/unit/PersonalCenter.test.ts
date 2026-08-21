// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "solid-js/web";
import { createComponent } from "solid-js";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
}));

vi.mock("@/utils/imageLoader", () => ({
  resolveImageUrl: (url: string) => url,
  loadImage: vi.fn(),
}));

// Mock stores used by the component tree
vi.mock("@/stores/authStore", () => ({
  user: () => ({ id: 1, name: "TestUser", account: "test", profile_image_urls: {} }),
  isLoggedIn: () => true,
}));

vi.mock("@/stores/userStore", () => ({
  profile: () => ({
    total_illusts: 100,
    total_manga: 50,
    total_novels: 30,
    total_follow_users: 200,
    total_mypixiv_users: 300,
  }),
  viewedUser: () => null,
  loadProfile: vi.fn(),
}));

vi.mock("@/stores/uiStore", () => {
  const fns: Record<string, unknown> = {};
  const keys = [
    "setCurrentTab",
    "currentTab",
    "useDnsOverride",
    "setUseDnsOverride",
    "theme",
    "setThemePersisted",
    "listQuality",
    "setListQuality",
    "detailQuality",
    "setDetailQuality",
    "showR18",
    "setShowR18",
    "showR18G",
    "setShowR18G",
    "autoCheckUpdate",
    "setAutoCheckUpdate",
    "hasUpdate",
    "setHasUpdate",
    "isCheckingUpdate",
    "setIsCheckingUpdate",
    "latestVersion",
    "setLatestVersion",
    "checkCompleted",
    "setCheckCompleted",
    "setLatestReleaseUrl",
    "resetUiStore",
    "imageCachePrefetch",
    "autoHideNavBar",
    "showBookmarkBadge",
    "resolvedTheme",
    "imageQuality",
    "setImageQuality",
  ];
  for (const k of keys) fns[k] = vi.fn();
  fns.currentTab = () => mockCurrentTabValue;
  fns.setCurrentTab = (...args: unknown[]) => mockSetCurrentTab(...args);
  fns.useDnsOverride = () => false;
  fns.theme = () => "system";
  fns.resolvedTheme = () => "light";
  fns.listQuality = () => "medium";
  fns.detailQuality = () => "large";
  fns.showR18 = () => true;
  fns.showR18G = () => true;
  fns.ageConfirmed = () => true;
  fns.isAdult = () => true;
  fns.autoCheckUpdate = () => false;
  fns.hasUpdate = () => false;
  fns.isCheckingUpdate = () => false;
  fns.latestVersion = () => "";
  fns.checkCompleted = () => false;
  fns.imageCachePrefetch = () => false;
  fns.autoHideNavBar = () => false;
  fns.showBookmarkBadge = () => false;
  return fns;
});

// ── tab 状态可控 mock（bug 2/4 回归测试用）──
let mockCurrentTabValue = "recommended";
const mockSetCurrentTab = vi.fn();

vi.mock("@/primitives/useUserProfile", () => ({
  useUserProfile: () => ({
    targetUserId: () => 1,
    displayUser: () => ({ id: 1, name: "TestUser", account: "test", profile_image_urls: {} }),
    isCurrentUser: () => true,
    isRootUserPage: () => true,
    avatarUrl: () => "",
    avatarErrored: () => false,
    setAvatarErrored: () => {},
    totalWorks: () => 10,
  }),
}));

vi.mock("@solidjs/router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => () => ({}),
  useRouter: () => ({ history: { back: vi.fn() } }),
  useLocation: () => () => ({ pathname: "/me" }),
  Outlet: () => null,
}));

describe("PersonalCenter module", () => {
  beforeEach(() => {
    mockCurrentTabValue = "recommended";
    mockSetCurrentTab.mockReset();
  });

  it("loads and exports a component", async () => {
    const PersonalCenter = (await import("@/routes/PersonalCenter")).default;
    expect(PersonalCenter).toBeDefined();
    expect(typeof PersonalCenter).toBe("function");
  });

  // ── bug 2/4 回归：进入个人中心设置 currentTab=me，卸载时恢复进入前的 tab ──
  it("onMount 设置 currentTab=me", async () => {
    mockCurrentTabValue = "follow";
    const { default: PersonalCenter } = await import("@/routes/PersonalCenter");
    const container = document.createElement("div");
    document.body.appendChild(container);

    const dispose = render(() => createComponent(PersonalCenter, {}), container);
    expect(mockSetCurrentTab).toHaveBeenCalledWith("me");

    dispose();
    container.remove();
  });
});

// ── bug 2/4 回归：restoreCurrentTabOnCleanup 纯逻辑（卸载恢复 tab） ──
describe("restoreCurrentTabOnCleanup", () => {
  it("currentTab 仍是 me 时恢复进入前的 tab", async () => {
    const { restoreCurrentTabOnCleanup } = await import("@/routes/PersonalCenter");
    const setTab = vi.fn();
    restoreCurrentTabOnCleanup(() => "me", setTab, "follow");
    expect(setTab).toHaveBeenCalledWith("follow");
  });

  it("prevTab 为 me 时兜底 recommended", async () => {
    const { restoreCurrentTabOnCleanup } = await import("@/routes/PersonalCenter");
    const setTab = vi.fn();
    restoreCurrentTabOnCleanup(() => "me", setTab, "me");
    expect(setTab).toHaveBeenCalledWith("recommended");
  });

  it("currentTab 已被其他导航改写（bookmarks）时不覆盖", async () => {
    const { restoreCurrentTabOnCleanup } = await import("@/routes/PersonalCenter");
    const setTab = vi.fn();
    restoreCurrentTabOnCleanup(() => "bookmarks", setTab, "follow");
    expect(setTab).not.toHaveBeenCalled();
  });
});
