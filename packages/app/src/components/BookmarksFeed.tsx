import type { Component } from "solid-js";
import { contentType } from "../stores/uiStore";
import IllustBookmarks from "../routes/IllustBookmarks";
import NovelBookmarks from "../routes/NovelBookmarks";

interface Props {
  suppressHeaderVisibility?: (durationMs?: number) => void;
}

const BookmarksFeed: Component<Props> = (props) => {
  return (
    <Show
      when={contentType() === "illust"}
      fallback={<NovelBookmarks suppressHeaderVisibility={props.suppressHeaderVisibility} />}
    >
      <IllustBookmarks suppressHeaderVisibility={props.suppressHeaderVisibility} />
    </Show>
  );
};

export default BookmarksFeed;
