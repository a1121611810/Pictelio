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

import Login from "@/routes/Login";
import AgeConfirmation from "@/routes/AgeConfirmation";
import IllustDetail from "@/routes/IllustDetail";
import DebugImage from "@/routes/DebugImage";
import HomePage from "@/routes/HomePage";
import PersonalCenter from "@/routes/PersonalCenter";
import UserIllusts from "@/routes/UserIllusts";
import About from "@/routes/About";
import ImageHostSettings from "@/routes/ImageHostSettings";
import ImageCacheSettings from "@/routes/ImageCacheSettings";
import FollowListPage from "@/routes/FollowListPage";
import NovelDetail from "@/routes/NovelDetail";
import Search from "@/routes/Search";
import LayoutSettings from "@/routes/LayoutSettings";
import Settings from "@/routes/Settings";

/** 将普通 Solid 组件断言为 TanStack RouteComponent，避免每处重复转换。 */
function asRoute(component: Component): RouteComponent {
  return component as unknown as RouteComponent;
}

/** 构造用户关注/粉丝列表路由的 loader，仅重置列表状态，组件内加载数据。 */
function makeFollowLoader(_mode: FollowMode) {
  return () => {
    resetFollowList();
    return {};
  };
}

const rootRoute = createRootRoute({ component: RootLayout });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "login",
  component: asRoute(Login),
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "home",
  loader: () => {
    // uiStore 默认为 "recommended"（处理首次启动）；NavBar 负责切 tab
    return {};
  },
  component: asRoute(HomePage),
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
  homeRoute,
  illustRoute,
  debugRoute,
  novelRoute,
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
