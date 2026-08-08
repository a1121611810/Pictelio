import { type RouteDefinition } from "@solidjs/router";
import RootLayout from "@/routes/__root";

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
import Settings from "@/routes/Settings";
import ClientSwitch from "@/routes/ClientSwitch";
import ScrollRestorationConfirm from "@/routes/ScrollRestorationConfirm";

/** /user/:id/followers 和 /my/followers 共享的视图 */
const FollowersPage = () => <FollowListPage mode="followers" />;

// ─── 路由配置 ───
export const routes: RouteDefinition[] = [
  {
    path: "/",
    component: RootLayout,
    children: [
      { path: "/login", component: Login },
      { path: "/home", component: HomePage },
      { path: "/illust/:id", component: IllustDetail },
      { path: "/debug", component: DebugImage },
      { path: "/novel/:id", component: NovelDetail },
      { path: "/search", component: Search },
      { path: "/me", component: PersonalCenter },
      { path: "/about", component: About },
      { path: "/image-host", component: ImageHostSettings },
      { path: "/image-cache", component: ImageCacheSettings },
      { path: "/settings", component: Settings },
      { path: "/client-switch", component: ClientSwitch },
      { path: "/age-confirmation", component: AgeConfirmation },
      { path: "/scroll-restoration-confirm", component: ScrollRestorationConfirm },
      { path: "/user/:id", component: PersonalCenter },
      { path: "/user/:id/illusts", component: UserIllusts },
      { path: "/user/:id/following", component: () => <FollowListPage mode="following" /> },
      { path: "/user/:id/followers", component: FollowersPage },
      { path: "/my/followers", component: FollowersPage },
      { path: "/*all", component: HomePage },
    ],
  },
];
