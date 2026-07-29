import type { Component } from "solid-js";
import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouteComponent,
} from "@tanstack/solid-router";
import RootLayout from "@/routes/__root";
import {
  reset as resetFollowList,
  type FollowMode,
} from "@/stores/followListStore";
import { setCurrentTab } from "@/stores/uiStore";
import { load as loadUserIllusts, contentType } from "@/stores/userIllustsStore";

/** 将普通 Solid 组件/懒加载组件断言为 TanStack RouteComponent，避免每处重复转换。 */
function asRoute(component: Component): RouteComponent {
  return component as unknown as RouteComponent;
}

/** Feed 页签类型。 */
type FeedTab = "recommended" | "follow";

/** 构造 Feed 路由的 loader，仅设置 tab，组件内加载数据。 */
function makeFeedLoader(tab: FeedTab) {
  return () => {
    setCurrentTab(tab);
    return {};
  };
}

/** 构造用户关注/粉丝列表路由的 loader，仅 mode 不同。 */
/** 构造用户关注/粉丝列表路由的 loader，仅重置列表状态，组件内加载数据。 */
function makeFollowLoader(_mode: FollowMode) {
  return () => {
    resetFollowList();
    return {};
  };
}

const Login = lazy(() => import("@/routes/Login"));
const AgeConfirmation = lazy(() => import("@/routes/AgeConfirmation"));
const IllustDetail = lazy(() => import("@/routes/IllustDetail"));
const DebugImage = lazy(() => import("@/routes/DebugImage"));
const Bookmarks = lazy(() => import("@/routes/Bookmarks"));
const TabFeedPage = lazy(() => import("@/routes/TabFeedPage"));
const PersonalCenter = lazy(() => import("@/routes/PersonalCenter"));
const UserIllusts = lazy(() => import("@/routes/UserIllusts"));
const About = lazy(() => import("@/routes/About"));
const ImageHostSettings = lazy(() => import("@/routes/ImageHostSettings"));
const ImageCacheSettings = lazy(() => import("@/routes/ImageCacheSettings"));
const FollowListPage = lazy(() => import("@/routes/FollowListPage"));
const NovelDetail = lazy(() => import("@/routes/NovelDetail"));
const HistoryPage = lazy(() => import("@/routes/HistoryPage"));
const Search = lazy(() => import("@/routes/Search"));
const LayoutSettings = lazy(() => import("@/routes/LayoutSettings"));
const Settings = lazy(() => import("@/routes/Settings"));

const rootRoute = createRootRoute({ component: RootLayout });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "login",
  component: asRoute(Login),
});

const recommendedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "recommended",
  loader: makeFeedLoader("recommended"),
  component: () => <TabFeedPage tab="recommended" />,
});

const followingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "following",
  loader: makeFeedLoader("follow"),
  component: () => <TabFeedPage tab="follow" />,
});

const illustRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "illust/$id",
  component: asRoute(IllustDetail),
});

const debugRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "debug",
  component: asRoute(DebugImage),
});

const novelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "novel/$id",
  component: asRoute(NovelDetail),
});

const bookmarksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "bookmarks",
  component: asRoute(Bookmarks),
});

const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "history",
  component: asRoute(HistoryPage),
});

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "search",
  component: asRoute(Search),
});

const meRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "me",
  loader: () => {
    setCurrentTab("me");
    return {};
  },
  component: asRoute(PersonalCenter),
});

const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "about",
  component: asRoute(About),
});

const imageHostRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "image-host",
  component: asRoute(ImageHostSettings),
});

const imageCacheRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "image-cache",
  component: asRoute(ImageCacheSettings),
});

const layoutSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "layout-settings",
  component: asRoute(LayoutSettings),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings",
  component: asRoute(Settings),
});

const ageConfirmationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "age-confirmation",
  component: asRoute(AgeConfirmation),
});

const userRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "user/$id",
  loader: ({ params }) => {
    setCurrentTab("me");
    return { userId: Number(params.id) };
  },
  component: asRoute(PersonalCenter),
});

const userIllustsRoute = createRoute({
  getParentRoute: () => userRoute,
  path: "illusts",
  loader: ({ params }) => {
    const uid = Number(params.id);
    // 提前触发数据加载（fire-and-forget），组件挂载后 TanStack Query 自动去重
    loadUserIllusts(uid, contentType());
    return { userId: uid };
  },
  component: asRoute(UserIllusts),
});

const userFollowingRoute = createRoute({
  getParentRoute: () => userRoute,
  path: "following",
  loader: makeFollowLoader("following"),
  component: () => <FollowListPage mode="following" />,
});

const userFollowersRoute = createRoute({
  getParentRoute: () => userRoute,
  path: "followers",
  loader: makeFollowLoader("followers"),
  component: () => <FollowListPage mode="followers" />,
});

const myFollowersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "my/followers",
  loader: () => {
    resetFollowList();
    return {};
  },
  component: () => <FollowListPage mode="followers" />,
});

const catchAllRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$",
  component: asRoute(Login),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  recommendedRoute,
  followingRoute,
  illustRoute,
  debugRoute,
  novelRoute,
  bookmarksRoute,
  historyRoute,
  searchRoute,
  meRoute,
  aboutRoute,
  imageHostRoute,
  imageCacheRoute,
  layoutSettingsRoute,
  settingsRoute,
  ageConfirmationRoute,
  userRoute.addChildren([userIllustsRoute, userFollowingRoute, userFollowersRoute]),
  myFollowersRoute,
  catchAllRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultStaleTime: 0,
  defaultPendingMs: 0,
  defaultPendingMinMs: 0,
});

// 声明路由类型，供 TanStack 的 type-safe 钩子使用
declare module "@tanstack/solid-router" {
  interface Register {
    router: typeof router;
  }
}
