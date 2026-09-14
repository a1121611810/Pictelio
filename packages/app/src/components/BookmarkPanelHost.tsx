import { Show, createEffect, untrack, type Component } from "solid-js";
import { useLocation } from "@solidjs/router";
import BookmarkPanel from "./BookmarkPanel";
import {
  bookmarkPanelOpen,
  bookmarkPanelRequest,
  closeBookmarkPanel,
} from "../stores/bookmarkPanelStore";
import { pushOverlay, popOverlay } from "../stores/backGestureStore";

/**
 * 收藏面板全局单宿主（#545）：挂载于 __root，覆盖详情页 / 首页 feed / 搜索结果
 * 全部调用方。调用方经 bookmarkPanelStore.openBookmarkPanel 唤起；onSaved 无参
 * 回调由调用方闭包（卡片：置收藏 + 爆发动效；详情页：handleBookmarkSaved）。
 *
 * 返回键契约（ADR-0160 D3/D4）：面板打开时注册 overlay 栈，Android 返回先关面板
 * ——原详情页本地接线随面板全局化一并迁入本宿主。
 */
const BookmarkPanelHost: Component = () => {
  const location = useLocation();

  createEffect(
    () => bookmarkPanelOpen(),
    (open) => {
      if (open) {
        pushOverlay("bookmarkPanel", () => closeBookmarkPanel());
        return () => popOverlay("bookmarkPanel");
      }
    },
  );

  // 路由变化即关面板（复审 P2）：__root 在 pathname 变化时 clearOverlays() 不调
  // close 回调，程序化导航（如 401 登出跳 /login）会使开着的面板悬于新页且返回键
  // 失效——此处对齐旧「面板随路由卸载」行为。开态读取是一次性快照（不建立订阅，
  // 否则面板自身开关会重跑本 effect），按 STRICT_READ_UNTRACKED 处方 untrack。
  createEffect(
    () => location.pathname,
    () => {
      if (untrack(bookmarkPanelOpen)) closeBookmarkPanel();
    },
  );

  return (
    <Show when={bookmarkPanelRequest()}>
      {(req) => (
        <BookmarkPanel
          illustId={req().illustId}
          isBookmarked={req().isBookmarked}
          workTags={req().workTags}
          isOpen={bookmarkPanelOpen()}
          onClose={closeBookmarkPanel}
          onSaved={() => req().onSaved()}
        />
      )}
    </Show>
  );
};

export default BookmarkPanelHost;
