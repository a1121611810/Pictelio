import type { Component } from "solid-js";
import type { PixivIllust, PixivNovel, ApiError, ContentType } from "../api/types";
import type { LayoutMode } from "../primitives/types";
import VirtualFeed from "./VirtualFeed";
import NovelVirtualFeed from "./NovelVirtualFeed";

interface Props {
  contentType: ContentType;
  illusts: PixivIllust[];
  novels: PixivNovel[];
  loading: boolean;
  error: ApiError | null;
  hasMore: boolean;
  onIllustClick: (id: number) => void;
  onNovelClick: (id: number) => void;
  onAuthorClick?: (userId: number) => void;
  onLoadMore: () => void;
  onRefresh: () => Promise<void> | void;
  layoutMode?: LayoutMode;
}

const UserWorksFeed: Component<Props> = (props) => {
  return (
    <Switch>
      <Match when={props.contentType === "illust"}>
        <VirtualFeed
          illusts={props.illusts}
          loading={props.loading}
          error={props.error}
          hasMore={props.hasMore}
          onIllustClick={props.onIllustClick}
          onAuthorClick={props.onAuthorClick}
          onLoadMore={props.onLoadMore}
          onRefresh={props.onRefresh}
          layoutMode={props.layoutMode}
        />
      </Match>
      <Match when={props.contentType === "novel"}>
        <NovelVirtualFeed
          novels={props.novels}
          loading={props.loading}
          error={props.error}
          hasMore={props.hasMore}
          onNovelClick={props.onNovelClick}
          onAuthorClick={props.onAuthorClick}
          onLoadMore={props.onLoadMore}
          onRefresh={props.onRefresh}
        />
      </Match>
    </Switch>
  );
};

export default UserWorksFeed;
