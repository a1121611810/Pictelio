import type { Component } from "solid-js";
import { user } from "../stores/authStore";
import { viewedUser } from "../stores/userStore";
import { Capacitor } from "@capacitor/core";
import { resolveImageUrl, loadImage } from "../utils/imageLoader";
import { scrollToTop } from "../utils/scrollToTop";

interface Props {
  visible: boolean;
  onBack?: () => void;
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

const CollapsedHeader: Component<Props> = (props) => {
  const router = useRouter();
  const navigate = useNavigate();
  const displayUser = () => user() || viewedUser();
  const isNative = Capacitor.isNativePlatform();
  const [avatarUrl, setAvatarUrl] = createSignal("");
  const [errored, setErrored] = createSignal(false);

  createEffect(() => {
    const u = displayUser();
    if (!u) {
      setAvatarUrl("");
      return;
    }
    const src = u.profile_image_urls.medium || u.profile_image_urls.px_50x50 || "";
    if (!src) {
      setAvatarUrl("");
      return;
    }
    setErrored(false);
    if (isNative) {
      void tryAsync(loadImage(src).then((r) => setAvatarUrl(r.url)));
    } else {
      setAvatarUrl(resolveImageUrl(src));
    }
  });

  return (
    <header
      class="surface-appbar fixed top-0 left-0 right-0 z-30 h-12 flex items-center px-2
        transition-all duration-[var(--durationSlow)] ease-[var(--curveEasyEase)]
        bg-[var(--colorNeutralBackgroundAlpha)] backdrop-blur-[20px] saturate-[1.8]
        border-b border-[var(--colorNeutralStrokeAlpha2)]
        shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_1px_rgba(0,0,0,0.02)]"
      classList={{
        "translate-y-0 opacity-100 pointer-events-auto": props.visible,
        "-translate-y-full opacity-0 pointer-events-none": !props.visible,
      }}
      onDblClick={scrollToTop}
    >
      {/* 返回按钮 */}
      <fluent-button
        appearance="subtle"
        aria-label="返回"
        class="w-10 h-10 min-w-10 min-h-10 p-0 flex-shrink-0 flex items-center justify-center"
        on:click={() => (props.onBack ? props.onBack() : router.history.back())}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" fill="currentColor" />
        </svg>
      </fluent-button>

      {/* 中间：头像 + 用户名 */}
      <div class="flex-1 flex items-center gap-2 px-2 min-w-0">
        <div class="relative w-7 h-7 flex-shrink-0">
          <AvatarFallback class="absolute inset-0 rounded-[var(--borderRadiusCircular)]" />
          <Show when={!errored() && avatarUrl()}>
            <img
              src={avatarUrl()}
              alt={displayUser()?.name ?? ""}
              class="absolute inset-0 w-full h-full rounded-[var(--borderRadiusCircular)] object-cover"
              onError={() => setErrored(true)}
            />
          </Show>
        </div>
        <span class="text-sm font-semibold text-[var(--colorNeutralForeground1)] truncate leading-tight">
          {displayUser()?.name}
        </span>
      </div>

      {/* 设置按钮 */}
      <fluent-button
        appearance="subtle"
        aria-label="设置"
        class="w-10 h-10 min-w-10 min-h-10 p-0 flex-shrink-0 flex items-center justify-center"
        on:click={() => navigate({ to: "/settings" })}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
            fill="currentColor"
          />
        </svg>
      </fluent-button>
    </header>
  );
};

export default CollapsedHeader;
