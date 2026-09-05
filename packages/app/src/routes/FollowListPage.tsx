import type { Component } from "solid-js";
import { resolveImageUrl } from "../utils/imageLoader";
import NavBar from "../components/NavBar";
import PageTransition from "../components/PageTransition";
import LoadingSpinner from "../components/LoadingSpinner";
import { SENTINEL_MARGIN } from "../primitives/rootMargins";
import { createSentinel } from "@/primitives/visibility";
import { createScrollBehavior } from "../primitives/scroll/createScrollBehavior";
import { scrollToTop } from "../utils/scrollToTop";
import { goBack } from "../services/backTransitionService";
import {
  users,
  loading,
  error,
  loadList,
  loadMore,
  reset,
  toggleFollow,
  type FollowMode,
} from "../stores/followListStore";
import { user } from "../stores/authStore";

interface Props {
  mode: FollowMode;
}

function AvatarFallback(props: { class?: string }) {
  return (
    <div
      class={`flex items-center justify-center bg-[var(--colorNeutralBackground2)] ${props.class || ""}`}
    >
      <svg
        width="60%"
        height="60%"
        viewBox="0 0 24 24"
        fill="none"
        class="text-[var(--colorNeutralForegroundDisabled)]"
      >
        <circle cx="12" cy="8" r="4" fill="currentColor" />
        <path d="M5 21c0-4 3.1-7 7-7s7 3 7 7" fill="currentColor" />
      </svg>
    </div>
  );
}

function avatarUrl(urls: { medium?: string; px_50x50?: string; px_170x170?: string }): string {
  const src = urls.medium || urls.px_170x170 || urls.px_50x50 || "";
  return resolveImageUrl(src);
}

const FollowListPage: Component<Props> = (props) => {
  const navigate = useNavigate();
  const routeParams = useParams();
  const { visible: headerVisible } = createScrollBehavior();

  // 组件挂载后立即发起数据请求（不在 loader 中阻塞导航）
  onMount(() => {
    const uid = routeParams.id ? Number(routeParams.id) : user()?.id;
    if (uid && uid > 0) {
      loadList(props.mode, uid);
    }
  });

  // 组件卸载时重置列表状态
  onCleanup(() => {
    reset();
  });

  const { attach: sentinelAttach } = createSentinel({
    rootMargin: SENTINEL_MARGIN,
    enabled: () => !loading(),
    onTrigger: () => loadMore(),
  });

  return (
    <>
      <PageTransition>
        <div class="pb-16">
          {/* Header */}
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
              on:click={() => goBack()}
            >
              ←
            </fluent-button>
            <h1 class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--pageCardTextPrimary)] tracking-tight leading-none">
              {props.mode === "following" ? "关注" : "粉丝"}
            </h1>
          </header>

          {/* User list */}
          <div class="px-4 flex flex-col" style={{ gap: "var(--spacingVerticalS)" }}>
            {error() && (
              <div class="text-center py-4 px-4 rounded-[var(--borderRadiusMedium)] bg-[var(--colorStatusDangerBackground2)] text-[var(--colorStatusDangerForeground1)]">
                <p class="[font-size:var(--fontSizeBase200)]">
                  {error()?.message ?? "加载失败，请重试"}
                </p>
              </div>
            )}

            <For each={users()}>
              {(preview, index) => (
                <div
                  class="surface-card p-3 hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] cursor-pointer select-none"
                  onClick={() => navigate(`/user/${preview.user.id}`)}
                >
                  <div class="flex items-center gap-3">
                    <div class="relative w-10 h-10 flex-shrink-0">
                      <AvatarFallback class="absolute inset-0 rounded-[var(--borderRadiusCircular)]" />
                      <img
                        src={avatarUrl(preview.user.profile_image_urls)}
                        alt={preview.user.name}
                        class="absolute inset-0 w-full h-full rounded-[var(--borderRadiusCircular)] object-cover"
                        onError={(e) => ((e.target as HTMLElement).style.display = "none")}
                      />
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="[font-size:var(--fontSizeBase300)] font-semibold text-[var(--pageCardTextPrimary)] truncate">
                        {preview.user.name}
                      </p>
                      <p class="[font-size:var(--fontSizeBase100)] text-[var(--pageCardTextSecondary)] truncate">
                        @{preview.user.account}
                      </p>
                    </div>
                    {/* 关注按钮（非当前用户时显示） */}
                    <Show when={preview.user.is_followed != null}>
                      <button
                        class="inline-flex items-center justify-center min-h-[40px] font-semibold [font-size:var(--fontSizeBase100)] cursor-pointer select-none transition-colors duration-[var(--durationFast)] ease-[var(--curveEasyEase)] active:scale-[0.95] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[var(--colorStrokeFocus2)] appearance-none border-none bg-transparent p-0 px-[var(--spacingHorizontalS)] flex-shrink-0"
                        classList={{
                          "text-[var(--colorBrandForeground1)] hover:text-[var(--colorBrandForeground1Hover)]":
                            !preview.user.is_followed,
                          "text-[var(--colorNeutralForeground3)] hover:text-[var(--colorStatusDangerForeground2)]":
                            preview.user.is_followed,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFollow(index());
                        }}
                        aria-label={preview.user.is_followed ? "取消关注" : "关注"}
                      >
                        {preview.user.is_followed ? "已关注" : "关注"}
                      </button>
                    </Show>
                  </div>
                  {preview.illusts && preview.illusts.length > 0 && (
                    <div class="flex gap-1.5 mt-2">
                      {preview.illusts.slice(0, 3).map((illust) => (
                        <img
                          src={resolveImageUrl(illust.image_urls.square_medium)}
                          alt={illust.title}
                          class="h-12 aspect-square rounded-[var(--borderRadiusSmall)] object-cover"
                          loading="lazy"
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </For>

            {loading() && users().length === 0 && (
              <div class="flex flex-col" style={{ gap: "var(--spacingVerticalS)" }}>
                {/* 骨架屏 */}
                {Array.from({ length: 5 }).map(() => (
                  <div class="surface-card p-3">
                    <div class="flex items-center gap-3">
                      <div class="w-10 h-10 rounded-[var(--borderRadiusCircular)] bg-[var(--colorNeutralBackground2)] flex-shrink-0" />
                      <div class="flex-1 flex flex-col gap-1.5">
                        <div class="h-4 rounded w-24 bg-[var(--colorNeutralBackground2)]" />
                        <div class="h-3 rounded w-16 bg-[var(--colorNeutralBackground2)]" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {loading() && <LoadingSpinner text="加载中..." />}

            {!loading() && users().length === 0 && !error() && (
              <p class="text-[var(--colorNeutralForeground2)] text-center py-8 [font-size:var(--fontSizeBase300)]">
                {props.mode === "following" ? "还没有关注任何人" : "还没有粉丝"}
              </p>
            )}

            <div ref={sentinelAttach} class="h-1" />
          </div>
        </div>
      </PageTransition>

      <NavBar />
    </>
  );
};

export default FollowListPage;
