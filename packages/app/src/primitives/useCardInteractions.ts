import type { Accessor } from "solid-js";
import type { PixivIllust } from "../api/types";
import { addBookmark, deleteBookmark, followUser, unfollowUser } from "../api/illust";
import { openBookmarkPanel } from "../stores/bookmarkPanelStore";

interface CardInteractions {
  bookmarked: Accessor<boolean>;
  toggleBookmark: (e: MouseEvent) => Promise<void>;
  isFollowed: Accessor<boolean>;
  following: Accessor<boolean>;
  toggleFollow: (e: MouseEvent) => Promise<void>;
  bookmarkBurstTrigger: Accessor<number>;
  onPointerDown: (e: PointerEvent) => void;
  onPointerUp: (e: PointerEvent) => void;
  onPointerLeave: () => void;
}

export function useCardInteractions(illust: PixivIllust): CardInteractions {
  const [bookmarked, setBookmarked] = createSignal(illust.is_bookmarked);
  const [bookmarkBurstTrigger, setBookmarkBurstTrigger] = createSignal(0);
  const [isFollowed, setIsFollowed] = createSignal(illust.user.is_followed ?? false);
  const [following, setFollowing] = createSignal(false);

  let longPressTimer: ReturnType<typeof setTimeout>;

  const toggleFollow = async (e: MouseEvent) => {
    e.stopPropagation();
    if (following()) {
      return;
    }
    const prev = isFollowed();
    setIsFollowed(!prev);
    setFollowing(true);
    const [err] = await tryAsync(prev ? unfollowUser(illust.user.id) : followUser(illust.user.id));
    setFollowing(false);
    if (err) {
      setIsFollowed(prev);
    }
  };

  /** 快速收藏（公开）：卡片心形短按路径。可见性/标签的深度编辑走长按收藏面板（#545）。 */
  const toggleBookmark = async (e: MouseEvent) => {
    e.stopPropagation();
    if (bookmarked()) {
      const [err] = await tryAsync(deleteBookmark(illust.id));
      if (!err) {
        setBookmarked(false);
      }
    } else {
      const [err] = await tryAsync(addBookmark(illust.id, "public"));
      if (!err) {
        setBookmarked(true);
        setBookmarkBurstTrigger((n) => n + 1);
      }
    }
  };

  const onPointerDown = (_e: PointerEvent) => {
    longPressTimer = setTimeout(() => {
      // 长按 = 收藏面板（#541 裁决：与详情页同语义，私密直存退役；
      // 不分收藏状态——已收藏时长按不再误触取消收藏）
      openBookmarkPanel({
        illustId: illust.id,
        isBookmarked: bookmarked(),
        workTags: illust.tags.map((tag) => tag.name),
        onSaved: () => {
          if (!bookmarked()) {
            setBookmarked(true);
            setBookmarkBurstTrigger((n) => n + 1);
          }
        },
      });
      longPressTimer = 0 as any;
    }, 500);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = 0 as any;
      toggleBookmark(e);
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
    onPointerDown,
    onPointerUp,
    onPointerLeave,
  };
}
