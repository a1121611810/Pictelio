/**
 * VariantD — 无 Tab，抽屉导航（沉浸式信息流）。
 * 整体风格：首页直接是推荐内容（contentType 切换器 + 瀑布流/列表），
 * 右上角菜单按钮唤起底部抽屉（A2 卡片：推荐/关注/收藏/历史/设置），
 * 抽屉项点击切换内容域并收起。无底部导航。
 * 结构差异（vs 其他变体）：导航完全隐藏，主交互是抽屉。
 */
import type { Component } from "solid-js";
import { createSignal, onMount, Show, Suspense } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { contentType } from "@/stores/uiStore";
import { isLoggedIn, user } from "@/stores/authStore";
import UserAvatar from "@/components/UserAvatar";
import FluentIcon from "@/components/ui/FluentIcon";
import { scrollToTop } from "@/utils/scrollToTop";
import {
  IllustFeedSlot,
  NovelFeedSlot,
  ContentTypeToggleA2,
  HistoryListA2,
  type HomeTab,
} from "./shared";

const MENU: { key: HomeTab; label: string; icon: Parameters<typeof FluentIcon>[0]["name"] }[] = [
  { key: "recommended", label: "推荐", icon: "home" },
  { key: "follow", label: "关注", icon: "people" },
  { key: "bookmarks", label: "收藏", icon: "bookmark" },
  { key: "history", label: "历史", icon: "history" },
];

const VariantD: Component = () => {
  const navigate = useNavigate();
  const [tab, setTab] = createSignal<HomeTab>("recommended");
  const [open, setOpen] = createSignal(false);

  onMount(() => {
    scrollToTop();
  });

  function pick(key: HomeTab) {
    setTab(key);
    setOpen(false);
    scrollToTop();
  }

  return (
    <div class="pb-8">
      {/* ── 顶栏：头像 + 名字 + 菜单按钮 ── */}
      <div class="sticky top-0 z-20 bg-[var(--colorNeutralBackground3)] px-4 pt-3 pb-2 flex items-center gap-2">
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
          onClick={() => setOpen(true)}
          aria-label="打开导航"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M2.75 5.5a.75.75 0 0 1 .75-.75h13a.75.75 0 0 1 0 1.5h-13a.75.75 0 0 1-.75-.75Zm0 4.5a.75.75 0 0 1 .75-.75h13a.75.75 0 0 1 0 1.5h-13a.75.75 0 0 1-.75-.75Zm0 4.5a.75.75 0 0 1 .75-.75h13a.75.75 0 0 1 0 1.5h-13a.75.75 0 0 1-.75-.75Z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>

      {/* ── contentType 切换器（居中）── */}
      <Show when={tab() !== "history"}>
        <div class="flex justify-center px-4 py-1">
          <div class="w-44">
            <ContentTypeToggleA2 />
          </div>
        </div>
      </Show>

      {/* ── 内容域（当前 Tab）── */}
      <Show when={tab() === "recommended"}>
        <Show when={contentType() === "illust"} fallback={<NovelFeedSlot tab="recommended" />}>
          <IllustFeedSlot tab="recommended" />
        </Show>
      </Show>
      <Show when={tab() === "follow"}>
        <Show when={contentType() === "illust"} fallback={<NovelFeedSlot tab="follow" />}>
          <IllustFeedSlot tab="follow" />
        </Show>
      </Show>
      <Show when={tab() === "bookmarks"}>
        <Show when={contentType() === "illust"} fallback={<NovelFeedSlot tab="bookmarks" />}>
          <IllustFeedSlot tab="bookmarks" />
        </Show>
      </Show>
      <Show when={tab() === "history"}>
        <div class="px-4 pt-3">
          <Suspense fallback={null}>
            <HistoryListA2
              onOpen={(type, id) =>
                void navigate(type === "illust" ? `/illust/${id}` : `/novel/${id}`)
              }
            />
          </Suspense>
        </div>
      </Show>

      {/* ── 底部抽屉（A2 卡片，16px 圆角）── */}
      <Show when={open()}>
        <div class="fixed inset-0 z-50">
          <div
            class="absolute inset-0"
            style={{ background: "var(--colorScrim)" }}
            onClick={() => setOpen(false)}
          />
          <div class="absolute bottom-0 left-0 right-0 bg-[var(--colorNeutralBackground1)] rounded-t-[var(--borderRadius3XLarge)] shadow-[var(--elevation28)]">
            <div class="flex justify-center pt-2 pb-1">
              <div class="w-10 h-1 rounded-[var(--borderRadiusCircular)] bg-[var(--colorNeutralStroke1)]" />
            </div>
            <div class="px-4 py-2 flex flex-col">
              {MENU.map((m) => (
                <button
                  class="flex items-center gap-3 px-2 py-3.5 rounded-[var(--borderRadiusMedium)] [font-size:var(--fontSizeBase200)] font-medium transition-all active:scale-[0.98] appearance-none border-none outline-none cursor-pointer"
                  classList={{
                    "text-[var(--colorBrandForeground1)] bg-[var(--colorBrandBackground2)]":
                      tab() === m.key,
                    "text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorNeutralBackground2)]":
                      tab() !== m.key,
                  }}
                  onClick={() => pick(m.key)}
                >
                  <FluentIcon name={m.icon} active={tab() === m.key} />
                  {m.label}
                </button>
              ))}
              <button
                class="flex items-center gap-3 px-2 py-3.5 rounded-[var(--borderRadiusMedium)] [font-size:var(--fontSizeBase200)] font-medium text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorNeutralBackground2)] active:scale-[0.98] transition-all appearance-none border-none outline-none cursor-pointer"
                onClick={() => void navigate("/settings")}
              >
                <FluentIcon name="settings" />
                设置
              </button>
              <div class="h-4" />
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default VariantD;
