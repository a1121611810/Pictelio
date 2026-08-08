/**
 * VariantC — 侧边导航列 + 内容区（Win11 设置式）【深入版，用户选定】
 *
 * Win11 设置应用特征落地：
 *  - 左侧导航列：icon 竖排 + 选中项圆角高亮块（BrandBackground2 + 品牌色图标），
 *    顶部固定搜索入口，底部固定「设置」+「我的」（头像）
 *  - 右侧内容区：页面大标题（当前 Tab 名）+ contentType 切换器，
 *    内容域全宽（插画瀑布流 / 小说 A2 卡 / 历史 A2 行卡 + 清空入口）
 *  - 导航列背景与页面同层（Win11 设置导航无独立底色），卡片 A2（8px + 1px 边框）
 */
import type { Component } from "solid-js";
import { createSignal, onMount, Show, Suspense } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { contentType } from "@/stores/uiStore";
import { isLoggedIn, user } from "@/stores/authStore";
import UserAvatar from "@/components/UserAvatar";
import FluentIcon, { type FluentIconName } from "@/components/ui/FluentIcon";
import { scrollToTop } from "@/utils/scrollToTop";
import { clearAllHistory } from "@/stores/historyStore";
import {
  HomeTabPanel,
  IllustFeedSlot,
  NovelFeedSlot,
  ContentTypeToggleA2,
  HistoryListA2,
  type HomeTab,
} from "./shared";

const TABS: { key: HomeTab; label: string; icon: FluentIconName }[] = [
  { key: "recommended", label: "推荐", icon: "home" },
  { key: "follow", label: "关注", icon: "people" },
  { key: "bookmarks", label: "收藏", icon: "bookmark" },
  { key: "history", label: "历史", icon: "history" },
];

const VariantC: Component = () => {
  const navigate = useNavigate();
  const [tab, setTab] = createSignal<HomeTab>("recommended");

  onMount(() => {
    scrollToTop();
  });

  return (
    <div class="flex min-h-screen bg-[var(--colorNeutralBackground2)] pb-6">
      {/* ── 左侧导航列（与页面同背景，Win11 设置式）── */}
      <nav
        class="sticky top-0 h-screen w-14 flex-none flex flex-col items-center pt-3 gap-1"
        aria-label="主导航"
      >
        {/* 顶部固定：搜索入口（Win11 设置顶部搜索位） */}
        <button
          class="w-11 h-11 flex items-center justify-center rounded-[var(--borderRadiusMedium)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground2)] hover:text-[var(--colorNeutralForeground1)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer mb-2"
          onClick={() => void navigate("/search")}
          aria-label="搜索"
        >
          <FluentIcon name="search" />
        </button>

        {/* 主导航项（Win11 选中态：圆角高亮块 + 品牌色图标） */}
        {TABS.map((t) => (
          <button
            class="w-11 h-11 flex items-center justify-center rounded-[var(--borderRadiusMedium)] transition-all active:scale-95 appearance-none border-none outline-none cursor-pointer"
            classList={{
              "bg-[var(--colorBrandBackground2)] text-[var(--colorBrandForeground1)]":
                tab() === t.key,
              "text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground1Hover)]":
                tab() !== t.key,
            }}
            onClick={() => setTab(t.key)}
            aria-current={tab() === t.key ? "page" : undefined}
            aria-label={t.label}
          >
            <FluentIcon name={t.icon} active={tab() === t.key} />
          </button>
        ))}

        <div class="flex-1" />

        {/* 底部固定：设置 + 我的（Win11 设置固定底部项） */}
        <button
          class="w-11 h-11 flex items-center justify-center rounded-[var(--borderRadiusMedium)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground1Hover)] hover:text-[var(--colorNeutralForeground1)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer"
          onClick={() => void navigate("/settings")}
          aria-label="设置"
        >
          <FluentIcon name="settings" />
        </button>
        <button
          class="w-11 h-11 flex items-center justify-center rounded-[var(--borderRadiusMedium)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer mb-3"
          onClick={() => isLoggedIn() && navigate("/me")}
          aria-label="我的"
        >
          <UserAvatar />
        </button>
      </nav>

      {/* ── 右侧内容区 ── */}
      <div class="flex-1 min-w-0">
        {/* 顶部：页面大标题（当前 Tab 名）+ contentType */}
        <div class="sticky top-0 z-20 bg-[var(--colorNeutralBackground2)] px-4 pt-4 pb-2 flex items-end justify-between gap-3">
          <div class="min-w-0">
            <h1 class="[font-size:var(--fontSizeBase500)] font-semibold text-[var(--colorNeutralForeground1)] tracking-tight leading-tight">
              {TABS.find((t) => t.key === tab())?.label}
            </h1>
            <p class="mt-0.5 truncate [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
              <Show when={isLoggedIn() && user()} fallback={<>Pictelio</>}>
                {user()!.name} 的首页
              </Show>
            </p>
          </div>
          <Show when={tab() !== "history"}>
            <div class="flex-none w-36">
              <ContentTypeToggleA2 />
            </div>
          </Show>
        </div>

        {/* Tab 内容面板 */}
        <HomeTabPanel tab="recommended" active={tab() === "recommended"}>
          <Show
            when={contentType() === "illust"}
            fallback={<NovelFeedSlot tab="recommended" layout="rows" />}
          >
            <IllustFeedSlot tab="recommended" />
          </Show>
        </HomeTabPanel>
        <HomeTabPanel tab="follow" active={tab() === "follow"}>
          <Show
            when={contentType() === "illust"}
            fallback={<NovelFeedSlot tab="follow" layout="rows" />}
          >
            <IllustFeedSlot tab="follow" />
          </Show>
        </HomeTabPanel>
        <HomeTabPanel tab="bookmarks" active={tab() === "bookmarks"}>
          <Show
            when={contentType() === "illust"}
            fallback={<NovelFeedSlot tab="bookmarks" layout="rows" />}
          >
            <IllustFeedSlot tab="bookmarks" />
          </Show>
        </HomeTabPanel>
        <HomeTabPanel tab="history" active={tab() === "history"}>
          <div class="px-4 pt-2">
            <div class="flex items-center justify-between px-1 pb-2">
              <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
                浏览历史
              </span>
              <button
                class="px-2 py-1 rounded-[var(--borderRadiusMedium)] [font-size:var(--fontSizeBase200)] font-medium text-[var(--colorDangerForeground)] hover:bg-[var(--colorDangerBackground)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer"
                onClick={() => void clearAllHistory()}
                aria-label="清空浏览历史"
              >
                清空
              </button>
            </div>
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
    </div>
  );
};

export default VariantC;
