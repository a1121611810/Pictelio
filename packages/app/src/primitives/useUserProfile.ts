import { createSignal, createEffect, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import { Capacitor } from "@capacitor/core";
import { user } from "@/stores/authStore";
import { profile, viewedUser } from "@/stores/userStore";
import { resolveImageUrl, loadImage } from "@/utils/imageLoader";

const isNative = Capacitor.isNativePlatform();

export interface UseUserProfileResult {
  targetUserId: Accessor<number>;
  displayUser: Accessor<ReturnType<typeof user>>;
  isCurrentUser: Accessor<boolean>;
  isRootUserPage: Accessor<boolean>;
  totalWorks: Accessor<number>;
  avatarUrl: Accessor<string>;
  avatarErrored: Accessor<boolean>;
  setAvatarErrored: (v: boolean) => void;
}

export function useUserProfile(
  getPathname: () => string,
  getParamsId: () => string | undefined,
  propsUserId?: string,
): UseUserProfileResult {
  const targetUserId = (): number => {
    const pathname = getPathname();
    if (pathname === "/me") return user()?.id ?? 0;
    return Number(propsUserId || getParamsId() || user()?.id || 0);
  };

  const displayUser = (): ReturnType<typeof user> => viewedUser() || user();

  const isCurrentUser = (): boolean => {
    if (getPathname() === "/me") return true;
    return targetUserId() === user()?.id;
  };

  const isRootUserPage = (): boolean => /^\/(?:me|user\/\d+)$/.test(getPathname());

  const totalWorks = (): number =>
    (profile()?.total_illusts ?? 0) +
    (profile()?.total_manga ?? 0) +
    (profile()?.total_novels ?? 0);

  //── 头像加载 ──
  const [avatarUrl, setAvatarUrl] = createSignal("");
  const [avatarErrored, setAvatarErrored] = createSignal(false);

  createEffect(() => {
    const u = displayUser();
    if (!u) {
      setAvatarUrl("");
      return;
    }
    const src = u.profile_image_urls.px_50x50 || u.profile_image_urls.medium || "";
    if (!src) {
      setAvatarUrl("");
      return;
    }
    setAvatarErrored(false);
    if (isNative) {
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
      });
      loadImage(src)
        .then((r) => {
          if (!cancelled) {
            setAvatarUrl(r.url);
            r.cleanup();
          }
        })
        .catch(() => {
          if (!cancelled) setAvatarErrored(true);
        });
    } else {
      setAvatarUrl(resolveImageUrl(src));
    }
  });

  return {
    targetUserId,
    displayUser,
    isCurrentUser,
    isRootUserPage,
    totalWorks,
    avatarUrl,
    avatarErrored,
    setAvatarErrored,
  };
}
