import type { Component } from "solid-js";
import { currentTab, setContentType, contentType } from "../stores/uiStore";
import { user, isLoggedIn } from "../stores/authStore";
import { loading as recLoading } from "../stores/recommendedStore";
import { loading as folLoading } from "../stores/followStore";
import UserAvatar from "../components/UserAvatar";
import RecommendedFeed from "../components/RecommendedFeed";
import FollowFeed from "../components/FollowFeed";
import NavBar from "../components/NavBar";
import PageTransition from "../components/PageTransition";
import { scrollToTop } from "../utils/scrollToTop";
import { createScrollBehavior } from "../primitives/scroll/createScrollBehavior";
import { markContentReady } from "@/native/splashBridge";

const HomePage: Component = () => {
  const navigate = useNavigate();
  const { visible: headerVisible, suppress: suppressHeaderVisibility } = createScrollBehavior();

  // ── Splash Screen 关闭控制 ──
  // 合并两个 Feed 的 loading 状态：任一变为 true 即触发 splash 关闭
  let splashDismissed = false;
  createEffect(() => {
    if (splashDismissed) return;
    if (recLoading() || folLoading()) {
      splashDismissed = true;
      setTimeout(() => markContentReady(), 350);
    }
  });

  // 兜底超时
  onMount(() => {
    setTimeout(() => {
      if (!splashDismissed) {
        splashDismissed = true;
        markContentReady();
      }
    }, 800);
  });

  return (
    <>
      <PageTransition>
        <div class="pb-16">
          {/* ── Shared Header ── */}
          <header
            class="sticky top-0 z-20 surface-appbar h-12 flex items-center justify-between px-4 transition-transform duration-[var(--durationNormal)] ease-[var(--curveEasyEase)]"
            classList={{
              "translate-y-0": headerVisible(),
              "-translate-y-full": !headerVisible(),
            }}
            onDblClick={scrollToTop}
          >
            <h1
              class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] tracking-tight leading-none flex items-center gap-2 min-w-0"
              classList={{ "cursor-pointer": isLoggedIn() }}
              onClick={() => isLoggedIn() && navigate({ to: "/me" })}
            >
              <Show when={isLoggedIn() && user()} fallback={<>Pictelio</>}>
                <UserAvatar />
                <span class="truncate max-w-[120px]">{user()!.name}</span>
              </Show>
            </h1>

            {/* ── Content type toggle ── */}
            <div class="flex items-center bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusSmall)] p-0.5 gap-0.5">
              <button
                class="px-2.5 py-1 rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase100)] font-semibold transition-all active:scale-95 appearance-none border-none outline-none cursor-pointer"
                classList={{
                  "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]":
                    contentType() === "illust",
                  "bg-transparent text-[var(--colorNeutralForeground2)]":
                    contentType() !== "illust",
                }}
                onClick={() => setContentType("illust")}
              >
                插画
              </button>
              <button
                class="px-2.5 py-1 rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase100)] font-semibold transition-all active:scale-95 appearance-none border-none outline-none cursor-pointer"
                classList={{
                  "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]":
                    contentType() === "novel",
                  "bg-transparent text-[var(--colorNeutralForeground2)]": contentType() !== "novel",
                }}
                onClick={() => setContentType("novel")}
              >
                小说
              </button>
            </div>
          </header>

          {/* ── Tab content panels (CSS display toggling) ── */}
          <div
            style={{ display: currentTab() === "recommended" ? "block" : "none" }}
          >
            <RecommendedFeed suppressHeaderVisibility={suppressHeaderVisibility} />
          </div>
          <div
            style={{ display: currentTab() === "follow" ? "block" : "none" }}
          >
            <FollowFeed suppressHeaderVisibility={suppressHeaderVisibility} />
          </div>
        </div>
      </PageTransition>

      <NavBar />
    </>
  );
};

export default HomePage;
