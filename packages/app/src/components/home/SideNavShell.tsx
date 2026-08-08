/**
 * SideNavShell — 首页 C 框架外壳（Win11 设置式侧边导航列，ADR-0075）。
 *
 * 左侧 56px sticky 全高 icon 导航列：搜索入口 + 推荐/关注/收藏/历史四 Tab +
 * 底部设置 / 我的（UserAvatar）。选中 Tab 以 BrandBackground2 圆角块高亮。
 * 右侧内容区：sticky 页面大标题（当前 Tab 名）+ 用户名副标题 + contentType
 * 切换器（历史 Tab 隐藏）+ 内容域插槽 renderPanel(tab)。
 * 历史 Tab 内建（A2 行卡列表 + 清空按钮），不经过 renderPanel。
 */
import type { Component, JSX } from "solid-js";
import { createSignal, For, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { user } from "@/stores/authStore";
import { currentTab, setCurrentTab } from "@/stores/uiStore";
import {
  historyCollection,
  historyVersion,
  removeHistoryEntry,
  clearAllHistory,
  type HistoryEntry,
} from "@/stores/historyStore";
import UserAvatar from "@/components/UserAvatar";
import FluentIcon, { type FluentIconName } from "@/components/ui/FluentIcon";
import ContentTypeToggle from "@/components/home/ContentTypeToggle";
import HistoryRowCard from "@/components/home/HistoryRowCard";
import { scrollToTop } from "@/utils/scrollToTop";

/** 首页内容域 Tab（历史内建，不进入 renderPanel）。 */
export type HomeTab = "recommended" | "follow" | "bookmarks" | "history";

interface SideNavShellProps {
  /** 内容域插槽：tab 非 history 时调用（历史由 shell 内建） */
  renderPanel: (tab: HomeTab) => JSX.Element;
}

const SHELL_TABS: { key: HomeTab; label: string; icon: FluentIconName }[] = [
  { key: "recommended", label: "推荐", icon: "home" },
  { key: "follow", label: "关注", icon: "people" },
  { key: "bookmarks", label: "收藏", icon: "bookmark" },
  { key: "history", label: "历史", icon: "history" },
];

/**
 * 初始 Tab：读取全局 currentTab（NavBar / PersonalCenter 入口会预设该值，
 * 例如「我的收藏」→ bookmarks），非法值（如 "me"）兜底 recommended。
 */
function initialHomeTab(): HomeTab {
  const t = currentTab();
  if (t === "recommended" || t === "follow" || t === "bookmarks" || t === "history") {
    return t;
  }
  return "recommended";
}

/** 当前用户的历史条目（响应 historyVersion，按访问时间倒序）。 */
function historyRows(): HistoryEntry[] {
  historyVersion[0]();
  const uid = String(user()?.id ?? "");
  return historyCollection.toArray
    .filter((e) => e.userId === uid)
    .toSorted((a, b) => b.visitedAt - a.visitedAt);
}

/** 历史 Tab 面板：A2 行卡列表（HistoryRowCard）+ 清空按钮 + 空态。 */
const HistoryPanel: Component<{
  onOpen: (type: HistoryEntry["type"], id: number) => void;
}> = (props) => {
  const rows = () => historyRows();
  return (
    <div class="px-4 pt-2">
      <div class="flex items-center justify-between px-1 pb-2">
        <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
          浏览历史
        </span>
        <button
          class="cursor-pointer appearance-none border-none px-2 py-1 font-medium outline-none transition-all active:scale-95 [font-size:var(--fontSizeBase200)] text-[var(--colorDangerForeground)] hover:bg-[var(--colorDangerBackground)]"
          onClick={() => void clearAllHistory()}
          aria-label="清空浏览历史"
        >
          清空
        </button>
      </div>
      <Show
        when={rows().length > 0}
        fallback={
          <div class="flex flex-col items-center gap-2 py-16">
            <p class="[font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground2)]">
              暂无浏览记录
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
              浏览过的作品会出现在这里
            </p>
          </div>
        }
      >
        <div class="flex flex-col gap-[var(--spacingVerticalM)]">
          <For each={rows()}>
            {(e) => (
              <HistoryRowCard
                entry={e}
                onOpen={() => props.onOpen(e.type, e.id)}
                onDelete={() => removeHistoryEntry(e.key)}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

const SideNavShell: Component<SideNavShellProps> = (props) => {
  const navigate = useNavigate();
  // 局部 Tab 状态：初始值桥接全局 currentTab，切换时反向同步，
  // 保证 NavBar / PersonalCenter 入口的 Tab 预设与首页选择保持一致。
  const [tab, setTab] = createSignal<HomeTab>(initialHomeTab());

  onMount(() => {
    scrollToTop();
  });

  const selectTab = (next: HomeTab) => {
    setTab(next);
    setCurrentTab(next);
  };

  const openHistoryEntry = (type: HistoryEntry["type"], id: number) =>
    void navigate(type === "illust" ? `/illust/${id}` : `/novel/${id}`);

  return (
    <div class="flex min-h-screen bg-[var(--colorNeutralBackground2)] pb-6">
      {/* ── 左侧导航列（56px sticky 全高）── */}
      <nav
        class="sticky top-0 flex h-screen w-14 flex-none flex-col items-center gap-1 pt-3"
        aria-label="主导航"
      >
        <button
          class="mb-2 flex h-11 w-11 cursor-pointer items-center justify-center rounded-[var(--borderRadiusMedium)] border-none text-[var(--colorNeutralForeground2)] outline-none transition-all hover:bg-[var(--colorNeutralBackground1)] hover:text-[var(--colorNeutralForeground1)] active:scale-95 appearance-none"
          onClick={() => void navigate("/search")}
          aria-label="搜索"
        >
          <FluentIcon name="search" />
        </button>
        {SHELL_TABS.map((t) => (
          <button
            class="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[var(--borderRadiusMedium)] border-none outline-none transition-all active:scale-95 appearance-none"
            classList={{
              "bg-[var(--colorBrandBackground2)] text-[var(--colorBrandForeground1)]":
                tab() === t.key,
              "text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground1Hover)]":
                tab() !== t.key,
            }}
            onClick={() => selectTab(t.key)}
            aria-current={tab() === t.key ? "page" : undefined}
            aria-label={t.label}
          >
            <FluentIcon name={t.icon} active={tab() === t.key} />
          </button>
        ))}
        <div class="flex-1" />
        <button
          class="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[var(--borderRadiusMedium)] border-none text-[var(--colorNeutralForeground2)] outline-none transition-all hover:bg-[var(--colorNeutralBackground1Hover)] hover:text-[var(--colorNeutralForeground1)] active:scale-95 appearance-none"
          onClick={() => void navigate("/settings")}
          aria-label="设置"
        >
          <FluentIcon name="settings" />
        </button>
        <button
          class="mb-3 flex h-11 w-11 cursor-pointer items-center justify-center rounded-[var(--borderRadiusMedium)] border-none outline-none transition-all hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-95 appearance-none"
          onClick={() => void navigate("/me")}
          aria-label="我的"
        >
          <UserAvatar />
        </button>
      </nav>

      {/* ── 右侧内容区 ── */}
      <div class="min-w-0 flex-1">
        <div class="sticky top-0 z-20 flex items-end justify-between gap-3 bg-[var(--colorNeutralBackground2)] px-4 pb-2 pt-4">
          <div class="min-w-0">
            <h1 class="leading-tight tracking-tight [font-size:var(--fontSizeBase500)] font-semibold text-[var(--colorNeutralForeground1)]">
              {SHELL_TABS.find((t) => t.key === tab())?.label}
            </h1>
            <p class="mt-0.5 truncate [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
              {user()?.name ?? "Pictelio"} 的首页
            </p>
          </div>
          <Show when={tab() !== "history"}>
            <div class="w-36 flex-none">
              <ContentTypeToggle />
            </div>
          </Show>
        </div>

        <Show when={tab() !== "history"} fallback={<HistoryPanel onOpen={openHistoryEntry} />}>
          {props.renderPanel(tab())}
        </Show>
      </div>
    </div>
  );
};

export default SideNavShell;
