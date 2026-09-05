import type { Component } from "solid-js";
import { useNavigate, useParams, useLocation } from "@solidjs/router";
import { setCurrentTab, currentTab, type Tab } from "@/stores/uiStore";
import { profile, loadProfile } from "@/stores/userStore";
import { useUserProfile } from "@/primitives/useUserProfile";
import FluentIcon from "@/components/ui/FluentIcon";
import SettingsCard from "@/components/settings/SettingsCard";
import { Avatar } from "@/components/me/Avatar";
import { MenuRow } from "@/components/me/MenuRow";
import { goBack } from "@/services/backTransitionService";
import PageTransition from "@/components/PageTransition";

interface Props {
  userId?: string;
  children?: any;
}

/**
 * 个人中心卸载时恢复进入前 tab 的纯逻辑（可单测）。
 * 仅当 currentTab 仍是 "me"（未被「我的收藏/我的关注」等导航改写）时恢复；
 * prevTab 为 "me"（从 /me 嵌套进入）时兜底 recommended。
 */
export function restoreCurrentTabOnCleanup(
  getCurrentTab: () => Tab,
  setTab: (tab: Tab) => void,
  prevTab: Tab,
): void {
  if (getCurrentTab() === "me") {
    setTab(prevTab === "me" ? "recommended" : prevTab);
  }
}

/**
 * 个人中心（/me 与 /user/:id 根路由）。
 *
 * A2 卡片化布局（ADR-0069 选定）：信息卡 / 菜单卡 / 设置卡均复用
 * `SettingsCard`（无边框、大圆角 2XLarge、单级 elevation2 柔和阴影），
 * 与设置页视觉统一；菜单行复用 `MenuRow`，头像复用 `Avatar`。
 */
const PersonalCenter: Component<Props> = (props) => {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();
  const profileState = useUserProfile(
    () => location.pathname,
    () => params.id,
    props.userId,
  );

  onMount(() => {
    // 记录进入个人中心前的 tab：返回 /home 时恢复，避免 currentTab 残留在 "me"——
    // HomePage 只渲染 recommended/follow/bookmarks/history 四个面板，currentTab 为
    // "me" 时四个面板全不渲染，表现为「从列表点作者/点自己进个人中心再返回，列表空白」
    // （模拟器实测复现的 bug 2/4）。
    const prevTab = currentTab();
    setCurrentTab("me");
    onCleanup(() => {
      restoreCurrentTabOnCleanup(currentTab, setCurrentTab, prevTab);
    });
    const uid = profileState.targetUserId();
    if (uid) {
      loadProfile(uid);
    }
  });

  // ── 导航动作集 ──
  const actions = {
    works: () => void navigate(`/user/${profileState.targetUserId()}/illusts`),
    bookmarks: () => {
      setCurrentTab("bookmarks");
      void navigate("/home");
    },
    following: () => {
      if (profileState.isCurrentUser()) {
        setCurrentTab("follow");
        void navigate("/home");
      } else {
        void navigate(`/user/${profileState.targetUserId()}/following`);
      }
    },
    followers: () =>
      void navigate(
        profileState.isCurrentUser()
          ? "/my/followers"
          : `/user/${profileState.targetUserId()}/followers`,
      ),
    settings: () => void navigate("/settings"),
    back: () => goBack(),
    search: () => void navigate("/search"),
  };

  return (
    <PageTransition>
      <Show when={profileState.isRootUserPage()} fallback={props.children}>
        <div class="min-h-screen bg-[var(--colorNeutralBackground3)]">
          {/* 顶部栏：返回按钮 + 搜索入口 */}
          <div class="flex items-center justify-between px-4 pt-3">
            <fluent-button
              appearance="subtle"
              aria-label="返回"
              on:click={actions.back}
              class="w-10 h-10 p-0 min-w-10"
            >
              ←
            </fluent-button>

            <div
              class="flex items-center gap-1.5 rounded-full bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke2)] px-4 py-2 cursor-pointer active:scale-[0.97] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
              onClick={actions.search}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  actions.search();
                }
              }}
              role="button"
              tabIndex={0}
              aria-label="搜索"
            >
              <FluentIcon name="search" size={16} />
              <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
                搜索
              </span>
            </div>
          </div>

          {/* 用户信息卡 */}
          <div class="px-4 mt-4">
            <SettingsCard tone="elevated">
              <div class="flex items-center gap-4">
                <Avatar
                  src={profileState.avatarUrl()}
                  errored={profileState.avatarErrored()}
                  name={profileState.displayUser()?.name ?? "P"}
                />
                <div class="flex-1 min-w-0">
                  <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] truncate leading-snug">
                    {profileState.displayUser()?.name || "Pictelio"}
                  </p>
                  <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] truncate leading-snug">
                    @{profileState.displayUser()?.account || ""}
                  </p>
                </div>
              </div>
            </SettingsCard>
          </div>

          {/* 功能菜单卡 */}
          <div class="px-4 mt-4">
            <SettingsCard tone="elevated">
              <MenuRow
                icon="image"
                label={profileState.isCurrentUser() ? "我的作品" : "TA 的作品"}
                count={profileState.totalWorks()}
                onClick={actions.works}
                ariaLabel={profileState.isCurrentUser() ? "我的作品" : "TA 的作品"}
              />
              <Show when={profileState.isCurrentUser()}>
                <MenuRow
                  icon="bookmark"
                  label="我的收藏"
                  onClick={actions.bookmarks}
                  ariaLabel="我的收藏"
                />
              </Show>
              <MenuRow
                icon="people"
                label={profileState.isCurrentUser() ? "我的关注" : "TA 的关注"}
                count={profile()?.total_follow_users ?? 0}
                onClick={actions.following}
                ariaLabel={profileState.isCurrentUser() ? "我的关注" : "TA 的关注"}
              />
              <MenuRow
                icon="people"
                label={profileState.isCurrentUser() ? "我的粉丝" : "TA 的粉丝"}
                onClick={actions.followers}
                ariaLabel={profileState.isCurrentUser() ? "我的粉丝" : "TA 的粉丝"}
              />
            </SettingsCard>
          </div>

          {/* 设置卡（仅本人） */}
          <Show when={profileState.isCurrentUser()}>
            <div class="px-4 mt-3">
              <SettingsCard tone="elevated">
                <MenuRow icon="settings" label="设置" onClick={actions.settings} ariaLabel="设置" />
              </SettingsCard>
            </div>
          </Show>
        </div>
      </Show>
    </PageTransition>
  );
};

export default PersonalCenter;
