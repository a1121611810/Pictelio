/**
 * VariantA — 底部 Tab 精修版。
 * 整体风格：极简顶栏（仅头像/名字）+ 内容区顶部居中 contentType 切换器，
 * 内容全宽优先；Tab 仍在底部（NavBar），卡片 A2（8px + 1px 边框）。
 * 结构差异（vs 其他变体）：导航在底部，contentType 下沉到内容区顶部 sticky。
 */
import type { Component } from "solid-js";
import { onMount, Show, Suspense } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { currentTab, contentType } from "@/stores/uiStore";
import { isLoggedIn, user } from "@/stores/authStore";
import UserAvatar from "@/components/UserAvatar";
import NavBar from "@/components/NavBar";
import { scrollToTop } from "@/utils/scrollToTop";
import {
  HomeTabPanel,
  IllustFeedSlot,
  NovelFeedSlot,
  ContentTypeToggleA2,
  HistoryListA2,
} from "./shared";

const VariantA: Component = () => {
  const navigate = useNavigate();

  onMount(() => {
    scrollToTop();
  });

  return (
    <>
      <div class="pb-16">
        {/* ── 极简顶栏：仅头像 + 名字 ── */}
        <div class="sticky top-0 z-20 bg-[var(--colorNeutralBackground3)] px-4 pt-3 pb-1">
          <div class="h-10 flex items-center">
            <h1
              class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] tracking-tight leading-none flex items-center gap-2 min-w-0 cursor-pointer"
              onClick={() => isLoggedIn() && navigate("/me")}
            >
              <Show when={isLoggedIn() && user()} fallback={<>Pictelio</>}>
                <UserAvatar />
                <span class="truncate max-w-[160px]">{user()!.name}</span>
              </Show>
            </h1>
          </div>
        </div>

        {/* ── 内容区顶部 sticky：contentType 切换器（居中窄条）── */}
        <Show when={currentTab() !== "history"}>
          <div class="sticky top-[52px] z-10 flex justify-center px-4 py-2 bg-[var(--colorNeutralBackground3)]">
            <div class="w-44">
              <ContentTypeToggleA2 />
            </div>
          </div>
        </Show>

        {/* ── Tab 内容面板（全宽内容）── */}
        <HomeTabPanel tab="recommended" active={currentTab() === "recommended"}>
          <Show when={contentType() === "illust"} fallback={<NovelFeedSlot tab="recommended" />}>
            <IllustFeedSlot tab="recommended" />
          </Show>
        </HomeTabPanel>
        <HomeTabPanel tab="follow" active={currentTab() === "follow"}>
          <Show when={contentType() === "illust"} fallback={<NovelFeedSlot tab="follow" />}>
            <IllustFeedSlot tab="follow" />
          </Show>
        </HomeTabPanel>
        <HomeTabPanel tab="bookmarks" active={currentTab() === "bookmarks"}>
          <Show when={contentType() === "illust"} fallback={<NovelFeedSlot tab="bookmarks" />}>
            <IllustFeedSlot tab="bookmarks" />
          </Show>
        </HomeTabPanel>
        <HomeTabPanel tab="history" active={currentTab() === "history"}>
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
      <NavBar />
    </>
  );
};

export default VariantA;
