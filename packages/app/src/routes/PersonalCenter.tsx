import type { Component } from "solid-js";
import { useNavigate, useParams, useLocation } from "@solidjs/router";
import { setCurrentTab, currentTab, type Tab } from "@/stores/uiStore";
import { profile, loadProfile } from "@/stores/userStore";
import { useUserProfile } from "@/primitives/useUserProfile";
import FluentIcon from "@/components/ui/FluentIcon";

interface Props {
  userId?: string;
  children?: any;
}

/** 为 role="button" 的 div 提供键盘激活（Enter/Space） */
function handleKeyDown(e: KeyboardEvent, action: () => void) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    action();
  }
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

  return (
    <Show when={profileState.isRootUserPage()} fallback={props.children}>
      <div class="min-h-screen bg-[var(--pageCardBg)]">
        {/* 顶部栏：返回按钮 + 搜索入口 */}
        <div class="flex items-center justify-between px-4 pt-3">
          <fluent-button
            appearance="subtle"
            aria-label="返回"
            on:click={() => window.history.back()}
            class="w-10 h-10 p-0 min-w-10"
          >
            ←
          </fluent-button>

          <div
            class="flex items-center gap-1.5 rounded-full bg-[var(--pageCardSearchBg)] px-4 py-2 cursor-pointer active:scale-[0.97] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
            onClick={() => void navigate("/search")}
            onKeyDown={(e) => handleKeyDown(e, () => navigate("/search"))}
            role="button"
            tabIndex={0}
            aria-label="搜索"
          >
            <FluentIcon name="search" size={16} />
            <span class="text-sm text-[var(--pageCardTextSecondary)]">搜索</span>
          </div>
        </div>

        {/* 用户信息卡片 */}
        <div class="px-4 mt-4">
          <div class="bg-[var(--pageCardSurface)] rounded-[var(--pageCardRadius)] p-5 flex items-center gap-4 shadow-[var(--pageCardShadow)]">
            <Show
              when={!profileState.avatarErrored() && profileState.avatarUrl()}
              fallback={
                <div class="w-14 h-14 rounded-full bg-[var(--colorBrandBackground)] flex items-center justify-center text-[var(--colorNeutralForegroundInverted)] [font-size:var(--fontSizeBase500)] font-semibold flex-shrink-0">
                  {profileState.displayUser()?.name?.charAt(0) || "P"}
                </div>
              }
            >
              <img
                src={profileState.avatarUrl()}
                alt={profileState.displayUser()?.name ?? ""}
                class="w-14 h-14 rounded-full object-cover flex-shrink-0"
                onError={() => profileState.setAvatarErrored(true)}
              />
            </Show>
            <div class="flex-1 min-w-0">
              <div class="text-lg font-bold text-[var(--pageCardTextPrimary)] truncate font-sans">
                {profileState.displayUser()?.name || "Pictelio"}
              </div>
            </div>
          </div>
        </div>

        {/* 功能菜单卡片组 */}
        <div class="px-4 mt-4">
          <div class="bg-[var(--pageCardSurface)] rounded-[var(--pageCardRadius)] shadow-[var(--pageCardShadow)]">
            {/* 我的作品 */}
            <div
              class="flex items-center px-5 py-4 gap-3 cursor-pointer active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] border-b border-[var(--pageCardBorder)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
              onClick={() => void navigate(`/user/${profileState.targetUserId()}/illusts`)}
              onKeyDown={(e) =>
                handleKeyDown(e, () => navigate(`/user/${profileState.targetUserId()}/illusts`))
              }
              role="button"
              tabIndex={0}
              aria-label={profileState.isCurrentUser() ? "我的作品" : "TA 的作品"}
            >
              <FluentIcon name="image" size={22} />
              <span class="flex-1 text-base font-medium text-[var(--pageCardTextPrimary)] font-sans">
                {profileState.isCurrentUser() ? "我的作品" : "TA 的作品"}
              </span>
              <span class="text-sm text-[var(--pageCardTextSecondary)] mr-1">
                {profileState.totalWorks()}
              </span>
              <FluentIcon name="chevronRight" size={16} />
            </div>

            <Show when={profileState.isCurrentUser()}>
              {/* 我的收藏 */}
              <div
                class="flex items-center px-5 py-4 gap-3 cursor-pointer active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] border-b border-[var(--pageCardBorder)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
                onClick={() => {
                  setCurrentTab("bookmarks");
                  void navigate("/home");
                }}
                onKeyDown={(e) =>
                  handleKeyDown(e, () => {
                    setCurrentTab("bookmarks");
                    navigate("/home");
                  })
                }
                role="button"
                tabIndex={0}
                aria-label="我的收藏"
              >
                <FluentIcon name="bookmark" size={22} />
                <span class="flex-1 text-base font-medium text-[var(--pageCardTextPrimary)] font-sans">
                  我的收藏
                </span>
                <FluentIcon name="chevronRight" size={16} />
              </div>
            </Show>

            {/* 我的关注 */}
            <div
              class="flex items-center px-5 py-4 gap-3 cursor-pointer active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] border-b border-[var(--pageCardBorder)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
              onClick={() =>
                void navigate(
                  profileState.isCurrentUser()
                    ? (() => {
                        setCurrentTab("follow");
                        return "/home";
                      })()
                    : `/user/${profileState.targetUserId()}/following`,
                )
              }
              onKeyDown={(e) =>
                handleKeyDown(e, () =>
                  navigate(
                    profileState.isCurrentUser()
                      ? (() => {
                          setCurrentTab("follow");
                          return "/home";
                        })()
                      : `/user/${profileState.targetUserId()}/following`,
                  ),
                )
              }
              role="button"
              tabIndex={0}
              aria-label={profileState.isCurrentUser() ? "我的关注" : "TA 的关注"}
            >
              <FluentIcon name="people" size={22} />
              <span class="flex-1 text-base font-medium text-[var(--pageCardTextPrimary)] font-sans">
                {profileState.isCurrentUser() ? "我的关注" : "TA 的关注"}
              </span>
              <span class="text-sm text-[var(--pageCardTextSecondary)] mr-1">
                {profile()?.total_follow_users ?? 0}
              </span>
              <FluentIcon name="chevronRight" size={16} />
            </div>

            {/* 我的粉丝 */}
            <div
              class="flex items-center px-5 py-4 gap-3 cursor-pointer active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
              onClick={() =>
                void navigate(
                  profileState.isCurrentUser()
                    ? "/my/followers"
                    : `/user/${profileState.targetUserId()}/followers`,
                )
              }
              onKeyDown={(e) =>
                handleKeyDown(e, () =>
                  navigate(
                    profileState.isCurrentUser()
                      ? "/my/followers"
                      : `/user/${profileState.targetUserId()}/followers`,
                  ),
                )
              }
              role="button"
              tabIndex={0}
              aria-label={profileState.isCurrentUser() ? "我的粉丝" : "TA 的粉丝"}
            >
              <FluentIcon name="people" size={22} />
              <span class="flex-1 text-base font-medium text-[var(--pageCardTextPrimary)] font-sans">
                {profileState.isCurrentUser() ? "我的粉丝" : "TA 的粉丝"}
              </span>
              <FluentIcon name="chevronRight" size={16} />
            </div>
          </div>
        </div>

        <Show when={profileState.isCurrentUser()}>
          {/* 设置卡片 */}
          <div class="px-4 mt-3">
            <div class="bg-[var(--pageCardSurface)] rounded-[var(--pageCardRadius)] shadow-[var(--pageCardShadow)]">
              <div
                class="flex items-center px-5 py-4 gap-3 cursor-pointer active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
                onClick={() => void navigate("/settings")}
                onKeyDown={(e) => handleKeyDown(e, () => navigate("/settings"))}
                role="button"
                tabIndex={0}
                aria-label="设置"
              >
                <FluentIcon name="settings" size={22} />
                <span class="flex-1 text-base font-medium text-[var(--pageCardTextPrimary)] font-sans">
                  设置
                </span>
                <FluentIcon name="chevronRight" size={16} />
              </div>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
};

export default PersonalCenter;
