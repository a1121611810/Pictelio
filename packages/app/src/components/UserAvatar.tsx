import type { Component } from "solid-js";
import { Capacitor } from "@capacitor/core";
import { user } from "../stores/authStore";
import { loadImage, resolveImageUrl } from "../utils/imageLoader";

const isNative = Capacitor.isNativePlatform();

const UserAvatar: Component = () => {
  const [avatarUrl, setAvatarUrl] = createSignal("");
  const [errored, setErrored] = createSignal(false);

  createEffect(() => {
    const u = user();
    if (!u) {
      return;
    }
    const src = u.profile_image_urls.px_50x50 || u.profile_image_urls.medium || "";
    console.log(src, !!u.profile_image_urls.px_50x50, !!u.profile_image_urls.medium);
    if (!src) {
      return;
    }
    if (isNative) {
      void tryAsync(
        loadImage(src).then((r) => {
          setAvatarUrl(r.url);
        }),
      );
    } else {
      const url = resolveImageUrl(src);
      setAvatarUrl(url);
    }
  });

  return (
    <>
      <Show when={!errored() && avatarUrl()}>
        <img
          data-testid="user-avatar"
          src={avatarUrl()}
          class="w-6 h-6 rounded-[var(--borderRadiusCircular)] flex-shrink-0"
          onError={() => setErrored(true)}
        />
      </Show>
      <Show when={errored() || !avatarUrl()}>
        <div
          data-testid="user-avatar"
          class="w-6 h-6 rounded-[var(--borderRadiusCircular)] flex-shrink-0 flex items-center justify-center bg-[var(--colorNeutralBackground2)]"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            class="text-[var(--colorNeutralForegroundDisabled)]"
          >
            <circle cx="12" cy="8" r="4" fill="currentColor" />
            <path d="M5 21c0-4 3.1-7 7-7s7 3 7 7" fill="currentColor" />
          </svg>
        </div>
      </Show>
    </>
  );
};

export default UserAvatar;
