import type { JSX } from "@solidjs/web";
/**
 * SideNavShell — 首页 C 框架外壳（Win11 设置式侧边导航列，ADR-0075）。
 *
 * 左侧 56px sticky 全高 icon 导航列：搜索入口 + 推荐/关注/收藏/历史四 Tab +
 * 底部设置 / 我的（UserAvatar）。选中 Tab 以 BrandBackground2 圆角块高亮。
 * 右侧内容区：sticky 页面大标题（当前 Tab 名）+ 用户名副标题 + contentType
 * 切换器（历史 Tab 隐藏）+ 内容域插槽 renderPanel(tab)。
 * 历史 Tab 内建（A2 行卡列表 + 清空按钮），不经过 renderPanel。
 */
/**
 * SideNavShell — 首页 C 框架外壳（Win11 设置式侧边导航列，ADR-0075）。
 *
 * 左侧 56px sticky 全高 icon 导航列：搜索入口 + 推荐/关注/收藏/历史四 Tab +
 * 底部设置 / 我的（UserAvatar）。选中 Tab 以 BrandBackground2 圆角块高亮。
 * 右侧内容区：sticky 页面大标题（当前 Tab 名）+ 用户名副标题 + contentType
 * 切换器（历史 Tab 隐藏）+ 内容域插槽 renderPanel(tab)。
 * 历史 Tab 内建（A2 行卡列表 + 清空按钮），不经过 renderPanel。
 */
import type { Component } from "solid-js";
import { createSignal, For, onSettled, Show } from "solid-js";
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
import { aiFilterMode } from "@/stores/settingsStore";
import { isAiHiddenByType } from "@/utils/aiFilter";
import UserAvatar from "@/components/UserAvatar";
import FluentIcon, { type FluentIconName } from "@/components/ui/FluentIcon";
import ContentTypeToggle from "@/components/home/ContentTypeToggle";
import HistoryRowCard from "@/components/home/HistoryRowCard";
import { scrollToTop } from "@/utils/scrollToTop";
import { t, type I18nKey } from "../../i18n";

/** 首页内容域 Tab（历史内建，不进入 renderPanel）。 */
export type HomeTab = "recommended" | "follow" | "bookmarks" | "history";

interface SideNavShellProps {
  /** 内容域插槽：tab 非 history 时调用（历史由 shell 内建） */
  renderPanel: (tab: HomeTab) => JSX.Element;
}

const SHELL_TABS: { key: HomeTab; labelKey: I18nKey; icon: FluentIconName }[] = [
  { key: "recommended", labelKey: "home.tab.recommended", icon: "home" },
  { key: "follow", labelKey: "home.tab.follow", icon: "people" },
  { key: "bookmarks", labelKey: "home.tab.bookmarks", icon: "bookmark" },
  { key: "history", labelKey: "home.tab.history", icon: "history" },
];

/**
 * 判定 uiStore.Tab 是否为 SideNavShell 可消费的合法 HomeTab。
 * uiStore.Tab 含 "me"（PersonalCenter 专用），SideNavShell 局部 tab 类型为
 * HomeTab 子集——PersonalCenter 写 setCurrentTab("me") 时本函数拦截。
 *
 * 提取为顶层纯函数以便单测与复用（SideNavShell 初始化 + 反向同步 effect
 * 共享同一白名单，避免漂移）。
 */
export function isValidHomeTab(tab: string): tab is HomeTab {
  return tab === "recommended" || tab === "follow" || tab === "bookmarks" || tab === "history";
}

/** 初始 Tab：读取全局 currentTab（NavBar / PersonalCenter 入口会预设该值，
 * 例如「我的收藏」→ bookmarks），非法值（如 "me"）兜底 recommended。
 */
function initialHomeTab(): HomeTab {
  const tab = currentTab();
  return isValidHomeTab(tab) ? tab : "recommended";
}

/** 当前用户的历史条目（响应 historyVersion + AI 模式，按访问时间倒序）。 */
function historyRows(): HistoryEntry[] {
  historyVersion[0]();
  const uid = String(currentUserId());
  const mode = aiFilterMode();
  return historyCollection.toArray
    .filter((e) => e.userId === uid && !isAiHiddenByType(e.aiType ?? 0, mode))
    .toSorted((a, b) => b.visitedAt - a.visitedAt);
}

/** 当前登录用户 id（字符串）——历史条目 userId 的存储口径。 */
function currentUserId(): string {
  return String(user()?.id ?? "");
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
          {t("home.history.title")}
        </span>
        <button
          class="cursor-pointer appearance-none border-none px-2 py-1 font-medium outline-none transition-all active:scale-95 [font-size:var(--fontSizeBase200)] text-[var(--colorDangerForeground)] hover:bg-[var(--colorDangerBackground)]"
          onClick={() => void clearAllHistory()}
          aria-label={t("home.history.clearAria")}
        >
          {t("home.history.clear")}
        </button>
      </div>
      <Show
        when={rows().length > 0}
        fallback={
          <div class="flex flex-col items-center gap-2 py-16">
            <p class="[font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground2)]">
              {t("home.history.empty")}
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
              {t("home.history.emptyHint")}
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
  // 局部 Tab 状态：初始值桥接全局 currentTab（untrack 显式一次性快照——组件体是
  // 非追踪上下文，Solid 2 STRICT_READ_UNTRACKED 处方），运行时同步由下方反向同步
  // effect 承担，保证 NavBar / PersonalCenter 入口的 Tab 预设与首页选择保持一致。
  const [tab, setTab] = createSignal<HomeTab>(untrack(initialHomeTab));

  // 反向同步：全局 currentTab → 局部 tab
  // - compute 仅追踪 currentTab() 一个依赖；同值守卫 + 非法 HomeTab 跳过
  //   在 compute 内判断（保证 apply 收到合法值）
  // - apply 负责 setTab 写入（SolidJS 2.0 要求 compute+apply 双函数，
  //   单函数形式运行时报 MISSING_EFFECT_FN）
  // - 同值守卫「短路多余 setTab 调用」：即使没有守卫 SolidJS createSignal
  //   setter 同值 no-op 也防死循环，但显式短路让 setTab 路径更清晰
  // - 非法 HomeTab 跳过：uiStore.Tab 含 "me"（PersonalCenter 专用），
  //   isValidHomeTab 拦截避免破坏 HomeTab 类型不变量
  createEffect(
    () => {
      const next = currentTab();
      if (next === tab()) return undefined; // 同值守卫
      return isValidHomeTab(next) ? next : undefined;
    },
    (next) => {
      if (next !== undefined) setTab(next);
    },
  );

  onSettled(() => {
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
        aria-label={t("home.sidenav.mainNavAria")}
      >
        <button
          class="mb-2 flex h-11 w-11 cursor-pointer items-center justify-center rounded-[var(--borderRadiusMedium)] border-none text-[var(--colorNeutralForeground2)] outline-none transition-all hover:bg-[var(--colorNeutralBackground1)] hover:text-[var(--colorNeutralForeground1)] active:scale-95 appearance-none"
          onClick={() => void navigate("/search")}
          aria-label={t("home.sidenav.searchAria")}
        >
          <FluentIcon name="search" />
        </button>
        {SHELL_TABS.map((item) => (
          <button
            class={[
              "flex h-11 w-11 cursor-pointer items-center justify-center rounded-[var(--borderRadiusMedium)] border-none outline-none transition-all active:scale-95 appearance-none",
              {
                "bg-[var(--colorBrandBackground2)] text-[var(--colorBrandForeground1)]":
                  tab() === item.key,
                "text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground1Hover)]":
                  tab() !== item.key,
              },
            ]}

            onClick={() => selectTab(item.key)}
            aria-current={tab() === item.key ? "page" : undefined}
            aria-label={t(item.labelKey)}
          >
            <FluentIcon name={item.icon} active={tab() === item.key} />
          </button>
        ))}
        <div class="flex-1" />
        <button
          class="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[var(--borderRadiusMedium)] border-none text-[var(--colorNeutralForeground2)] outline-none transition-all hover:bg-[var(--colorNeutralBackground1Hover)] hover:text-[var(--colorNeutralForeground1)] active:scale-95 appearance-none"
          onClick={() => void navigate("/settings")}
          aria-label={t("home.sidenav.settingsAria")}
        >
          <FluentIcon name="settings" />
        </button>
        <button
          class="mb-3 flex h-11 w-11 cursor-pointer items-center justify-center rounded-[var(--borderRadiusMedium)] border-none outline-none transition-all hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-95 appearance-none"
          onClick={() => void navigate("/me")}
          aria-label={t("home.sidenav.meAria")}
        >
          <UserAvatar />
        </button>
      </nav>

      {/* ── 右侧内容区 ── */}
      <div class="min-w-0 flex-1">
        <div class="sticky top-0 z-20 flex items-end justify-between gap-3 bg-[var(--colorNeutralBackground2)] px-4 pb-2 pt-4">
          <div class="min-w-0">
            <h1 class="leading-tight tracking-tight [font-size:var(--fontSizeBase500)] font-semibold text-[var(--colorNeutralForeground1)]">
              {t(SHELL_TABS.find((s) => s.key === tab())?.labelKey ?? "home.tab.recommended")}
            </h1>
            <p class="mt-0.5 truncate [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
              {t("home.sidenav.homeTitle", { name: user()?.name ?? "Pictelio" })}
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
