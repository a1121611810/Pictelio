/**
 * VariantB — 顶部横向滚动 Tab + 全宽内容（类 Instagram / 微博）。
 * 整体风格：导航上移到顶部两行（行1：头像/名字 + 搜索；行2：横向滚动 Tab），
 * 无底部导航；Tab 局部 signal；卡片 A2（8px + 1px 边框）。
 * 结构差异（vs 其他变体）：导航在顶部横向滚动，内容全宽沉浸。
 */
import type { Component } from "solid-js";
import { createSignal, onMount, Show, Suspense } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { contentType } from "@/stores/uiStore";
import { isLoggedIn, user } from "@/stores/authStore";
import UserAvatar from "@/components/UserAvatar";
import { scrollToTop } from "@/utils/scrollToTop";
import {
  HomeTabPanel,
  IllustFeedSlot,
  NovelFeedSlot,
  ContentTypeToggleA2,
  HistoryListA2,
  type HomeTab,
} from "./shared";

const TABS: { key: HomeTab; label: string }[] = [
  { key: "recommended", label: "推荐" },
  { key: "follow", label: "关注" },
  { key: "bookmarks", label: "收藏" },
  { key: "history", label: "历史" },
];

const VariantB: Component = () => {
  const navigate = useNavigate();
  const [tab, setTab] = createSignal<HomeTab>("recommended");

  onMount(() => {
    scrollToTop();
  });

  return (
    <>
      <div class="pb-10">
        {/* ── 顶部两行 ── */}
        <div class="sticky top-0 z-20 bg-[var(--colorNeutralBackground3)] px-4 pt-3 pb-2 flex flex-col gap-2">
          {/* 行1：头像/名字 + 搜索 */}
          <div class="h-9 flex items-center">
            <h1
              class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] tracking-tight leading-none flex items-center gap-2 min-w-0 cursor-pointer"
              onClick={() => isLoggedIn() && navigate("/me")}
            >
              <Show when={isLoggedIn() && user()} fallback={<>Pictelio</>}>
                <UserAvatar />
                <span class="truncate max-w-[140px]">{user()!.name}</span>
              </Show>
            </h1>
            <button
              class="ml-auto w-8 h-8 flex items-center justify-center rounded-[var(--borderRadiusMedium)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground2)] hover:text-[var(--colorNeutralForeground1)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer"
              onClick={() => void navigate("/search")}
              aria-label="搜索"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                  d="M8.5 3a5.5 5.5 0 1 0 3.44 9.79l4.13 4.14a.75.75 0 1 0 1.06-1.06l-4.13-4.14A5.5 5.5 0 0 0 8.5 3Zm-4 5.5a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
          {/* 行2：横向滚动 Tab（下划线激活）+ contentType */}
          <div class="flex items-center gap-3">
            <div class="flex-1 flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden">
              {TABS.map((t) => (
                <button
                  class="flex-none px-3 py-1.5 rounded-[var(--borderRadiusMedium)] [font-size:var(--fontSizeBase200)] font-semibold transition-all active:scale-95 appearance-none border-none outline-none cursor-pointer"
                  classList={{
                    "text-[var(--colorBrandForeground1)] bg-[var(--colorBrandBackground2)]":
                      tab() === t.key,
                    "text-[var(--colorNeutralForeground2)]": tab() !== t.key,
                  }}
                  onClick={() => setTab(t.key)}
                  aria-current={tab() === t.key ? "page" : undefined}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <Show when={tab() !== "history"}>
              <div class="flex-none">
                <ContentTypeToggleA2 />
              </div>
            </Show>
          </div>
        </div>

        {/* ── Tab 内容面板（全宽）── */}
        <HomeTabPanel tab="recommended" active={tab() === "recommended"}>
          <Show when={contentType() === "illust"} fallback={<NovelFeedSlot tab="recommended" />}>
            <IllustFeedSlot tab="recommended" />
          </Show>
        </HomeTabPanel>
        <HomeTabPanel tab="follow" active={tab() === "follow"}>
          <Show when={contentType() === "illust"} fallback={<NovelFeedSlot tab="follow" />}>
            <IllustFeedSlot tab="follow" />
          </Show>
        </HomeTabPanel>
        <HomeTabPanel tab="bookmarks" active={tab() === "bookmarks"}>
          <Show when={contentType() === "illust"} fallback={<NovelFeedSlot tab="bookmarks" />}>
            <IllustFeedSlot tab="bookmarks" />
          </Show>
        </HomeTabPanel>
        <HomeTabPanel tab="history" active={tab() === "history"}>
          <div class="px-4 pt-3">
            <Suspense fallback={null}>
              <HistoryListA2
                onOpen={(type, id) =>
                  void navigate(type === "illust" ? `/illust/${id}` : `/novel/${id}`)
                }
              />
            </Suspense>
          </div>
        </HomeTabPanel>
      </div>
    </>
  );
};

export default VariantB;
