import type { Accessor } from "solid-js";
import { Capacitor } from "@capacitor/core";
import { user } from "@/stores/authStore";
import { profile, viewedUser } from "@/stores/userStore";
import { resolveImageUrl, loadImage } from "@/utils/imageLoader";

const isNative = Capacitor.isNativePlatform();

/** 当前展示的用户（本人或浏览中的用户），模块级 store signal，无需在 hook 内重建 */
const displayUser = (): ReturnType<typeof user> => viewedUser() || user();

/** 作品总数，全部来自模块级 store signal */
const totalWorks = (): number =>
  (profile()?.total_illusts ?? 0) + (profile()?.total_manga ?? 0) + (profile()?.total_novels ?? 0);

interface UseUserProfileResult {
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

  const isCurrentUser = (): boolean => {
    if (getPathname() === "/me") return true;
    return targetUserId() === user()?.id;
  };

  const isRootUserPage = (): boolean => /^\/(?:me|user\/\d+)$/.test(getPathname());

  //── 头像加载 ──
  const [avatarUrl, setAvatarUrl] = createSignal("");
  const [avatarErrored, setAvatarErrored] = createSignal(false);

  // 2.0 拆分效应：compute 段只读并提取头像 URL 普通值，写 signal / 异步预载移入 apply 段，
  // 取消标记经 apply 返回的 cleanup 注销
  createEffect(
    () => {
      const u = displayUser();
      if (!u) {
        return { src: "", hasUser: false };
      }
      return {
        src: u.profile_image_urls.px_50x50 || u.profile_image_urls.medium || "",
        hasUser: true,
      };
    },
    ({ src, hasUser }) => {
      if (!hasUser) {
        setAvatarUrl("");
        return;
      }
      if (!src) {
        setAvatarUrl("");
        return;
      }
      setAvatarErrored(false);
      if (isNative) {
        let cancelled = false;
        void tryAsync(
          (async () => {
            const [err, r] = await tryAsync(loadImage(src));
            if (cancelled) return;
            if (err) {
              setAvatarErrored(true);
              return;
            }
            setAvatarUrl(r!.url);
            r!.cleanup();
          })(),
        );
        return () => {
          cancelled = true;
        };
      } else {
        setAvatarUrl(resolveImageUrl(src));
      }
    },
  );

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
