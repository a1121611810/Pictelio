import type { Component } from "solid-js";
import { user, isLoggedIn } from "../stores/authStore";
import UserAvatar from "../components/UserAvatar";
import { setCurrentTab, contentType, setContentType } from "../stores/uiStore";
import NavBar from "../components/NavBar";
import PageTransition from "../components/PageTransition";
import IllustBookmarks from "./IllustBookmarks";
import NovelBookmarks from "./NovelBookmarks";
import { scrollToTop } from "../utils/scrollToTop";
import { createScrollBehavior } from "../primitives/scroll/createScrollBehavior";

const Bookmarks: Component = () => {
  const navigate = useNavigate();
  const { visible: headerVisible, suppress: suppressHeaderVisibility } = createScrollBehavior();

  onMount(() => {
    setCurrentTab("bookmarks");
  });

  return (
    <>
      <PageTransition>
        <div class="pb-16">
          <header
            class="sticky top-0 z-20 surface-appbar h-12 flex items-center px-4 justify-between transition-transform duration-[var(--durationNormal)] ease-[var(--curveEasyEase)]"
            classList={{
              "translate-y-0": headerVisible(),
              "-translate-y-full": !headerVisible(),
            }}
            onDblClick={scrollToTop}
          >
            <h1
              class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--pageCardTextPrimary)] tracking-tight leading-none flex items-center gap-2 min-w-0"
              classList={{ "cursor-pointer": isLoggedIn() }}
              onClick={() => isLoggedIn() && void navigate({ to: "/me" })}
            >
              <Show when={isLoggedIn() && user()} fallback={<>Pictelio</>}>
                <UserAvatar />
                <span class="truncate max-w-[120px]">{user()!.name}</span>
              </Show>
            </h1>

            {/* 收藏类型切换：插画 / 小说 */}
            <div class="flex items-center bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusSmall)] p-0.5 gap-0.5 flex-shrink-0">
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

          <Show
            when={contentType() === "illust"}
            fallback={<NovelBookmarks suppressHeaderVisibility={suppressHeaderVisibility} />}
          >
            <IllustBookmarks suppressHeaderVisibility={suppressHeaderVisibility} />
          </Show>
        </div>
      </PageTransition>

      <NavBar />
    </>
  );
};

export default Bookmarks;
