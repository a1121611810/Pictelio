import { createSignal } from "solid-js";

import type { Accessor } from "solid-js";
import type { PixivIllust } from "../api/types";
import { addBookmark, deleteBookmark, followUser, unfollowUser } from "../api/illust";

export interface CardInteractions {
  bookmarked: Accessor<boolean>;
  toggleBookmark: (e: MouseEvent, privateBookmark?: boolean) => Promise<void>;
  isFollowed: Accessor<boolean>;
  following: Accessor<boolean>;
  toggleFollow: (e: MouseEvent) => Promise<void>;
  bookmarkBurstTrigger: Accessor<number>;
  privateHint: Accessor<boolean>;
  onPointerDown: (e: PointerEvent) => void;
  onPointerUp: (e: PointerEvent) => void;
  onPointerLeave: () => void;
}

export function useCardInteractions(illust: PixivIllust): CardInteractions {
  const [bookmarked, setBookmarked] = createSignal(illust.is_bookmarked);
  const [bookmarkBurstTrigger, setBookmarkBurstTrigger] = createSignal(0);
  const [privateHint, setPrivateHint] = createSignal(false);
  const [isFollowed, setIsFollowed] = createSignal(illust.user.is_followed ?? false);
  const [following, setFollowing] = createSignal(false);

  let longPressTimer: ReturnType<typeof setTimeout>;
  let hintTimer: ReturnType<typeof setTimeout>;

  const toggleFollow = async (e: MouseEvent) => {
    e.stopPropagation();
    if (following()) {
      return;
    }
    const prev = isFollowed();
    setIsFollowed(!prev);
    setFollowing(true);
    const [err] = await tryAsync(
      prev ? unfollowUser(illust.user.id) : followUser(illust.user.id),
    );
    setFollowing(false);
    if (err) {
      setIsFollowed(prev);
    }
  };

  const showPrivateToast = () => {
    setPrivateHint(true);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => setPrivateHint(false), 1500);
  };

  const toggleBookmark = async (e: MouseEvent, privateBookmark = false) => {
    e.stopPropagation();
    if (bookmarked()) {
      const [err] = await tryAsync(deleteBookmark(illust.id));
      if (!err) {
        setBookmarked(false);
      }
    } else {
      const [err] = await tryAsync(addBookmark(illust.id, privateBookmark ? "private" : "public"));
      if (!err) {
        setBookmarked(true);
        setBookmarkBurstTrigger((n) => n + 1);
        if (privateBookmark) {
          showPrivateToast();
        }
      }
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    longPressTimer = setTimeout(() => {
      toggleBookmark(e as any, true);
      longPressTimer = 0 as any;
    }, 500);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = 0 as any;
      toggleBookmark(e as any, false);
    }
  };

  const onPointerLeave = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = 0 as any;
    }
  };

  return {
    bookmarked,
    toggleBookmark,
    isFollowed,
    following,
    toggleFollow,
    bookmarkBurstTrigger,
    privateHint,
    onPointerDown,
    onPointerUp,
    onPointerLeave,
  };
}
