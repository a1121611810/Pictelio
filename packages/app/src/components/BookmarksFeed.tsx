import type { Component } from "solid-js";
import { contentType } from "../stores/uiStore";
import IllustBookmarks from "../routes/IllustBookmarks";
import NovelBookmarks from "../routes/NovelBookmarks";

const BookmarksFeed: Component = () => {
  return (
    <Show
      when={contentType() === "illust"}
      fallback={<NovelBookmarks />}
    >
      <IllustBookmarks />
    </Show>
  );
};

export default BookmarksFeed;
