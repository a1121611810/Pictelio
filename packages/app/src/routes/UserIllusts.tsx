import type { Component } from "solid-js";
import { user } from "../stores/authStore";
import {
  illusts,
  novels,
  nextUrl,
  loading,
  error,
  contentType,
  load,
  loadMore,
  saveScrollPosition,
} from "../stores/userIllustsStore";
import { viewedUser } from "../stores/userStore";
import UserWorksFeed from "../components/UserWorksFeed";
import NavBar from "../components/NavBar";
import PageTransition from "../components/PageTransition";
import { layoutMode } from "../stores/settingsStore";
import { scrollToTop } from "../utils/scrollToTop";
import { createScrollBehavior } from "../primitives/scroll/createScrollBehavior";

const UserIllusts: Component = () => {
  const navigate = useNavigate();
  const router = useRouter();
  const params = useParams({ strict: false });
  const userId = () => Number(params().id);
  const { visible: headerVisible, suppress: suppressHeaderVisibility } = createScrollBehavior();

  // R18 开关切换时自动刷新
  onMount(() => {
    const handler = () => {
      const uid = userId();
      if (uid) {
        load(uid, contentType());
      }
    };
    window.addEventListener("r18Changed", handler);
    onCleanup(() => window.removeEventListener("r18Changed", handler));
  });

  function handleTabSwitch(type: "illust" | "manga" | "novel") {
    // Save current scroll position before switching; restoreScrollTop prop handles restoration
    saveScrollPosition(window.scrollY);
    load(userId(), type);
  }

  onCleanup(() => {
    saveScrollPosition(window.scrollY);
  });

  return (
    <>
      <PageTransition>
        <div class="pb-16">
          <header
            class="sticky top-0 z-20 surface-appbar h-12 flex items-center px-4 gap-3 transition-transform duration-[var(--durationNormal)] ease-[var(--curveEasyEase)]"
            classList={{
              "translate-y-0": headerVisible(),
              "-translate-y-full": !headerVisible(),
            }}
            onDblClick={scrollToTop}
          >
            <fluent-button
              appearance="subtle"
              aria-label="返回"
              class="w-8 h-8 p-0 min-w-8"
              on:click={() => router.history.back()}
            >
              ←
            </fluent-button>
            <h1 class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--pageCardTextPrimary)] tracking-tight leading-none truncate">
              {(viewedUser() || user())?.name ?? ""} 的作品
            </h1>
          </header>

          {/* Segmented: 插画 / 漫画 / 小说 */}
          <div class="px-4 py-3">
            <div class="flex bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusMedium)] p-1.5 gap-1">
              <button
                classList={{
                  "segmented-item-active": contentType() === "illust",
                  "segmented-item-inactive": contentType() !== "illust",
                }}
                onClick={() => handleTabSwitch("illust")}
              >
                插画
              </button>
              <button
                classList={{
                  "segmented-item-active": contentType() === "manga",
                  "segmented-item-inactive": contentType() !== "manga",
                }}
                onClick={() => handleTabSwitch("manga")}
              >
                漫画
              </button>
              <button
                classList={{
                  "segmented-item-active": contentType() === "novel",
                  "segmented-item-inactive": contentType() !== "novel",
                }}
                onClick={() => handleTabSwitch("novel")}
              >
                小说
              </button>
            </div>
          </div>

          <UserWorksFeed
            contentType={contentType()}
            illusts={illusts()}
            novels={novels()}
            loading={loading()}
            error={error()}
            hasMore={nextUrl() !== null}
            onIllustClick={(id) => void navigate({ to: `/illust/${id}` })}
            onNovelClick={(id) => void navigate({ to: `/novel/${id}` })}
            onAuthorClick={(id) => void navigate({ to: `/user/${id}` })}
            onLoadMore={loadMore}
            onRefresh={async () => {
              const uid = userId();
              if (uid) {
                await load(uid, contentType(), true);
              }
            }}
            layoutMode={layoutMode()}
            suppressHeaderVisibility={suppressHeaderVisibility}
          />
        </div>
      </PageTransition>

      <NavBar />
    </>
  );
};

export default UserIllusts;
