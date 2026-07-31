import type { Accessor } from "solid-js";
import { loadDetail, fetchNovelData, type NovelImagesMap } from "@/api/novel";
import type { PixivNovel, SeriesNavigation } from "@/api/types";
import { peekEntry, getEntry, setEntry, type CacheEntry } from "@/stores/novelCache";

export interface NovelLoaderResult {
  novelData: Accessor<PixivNovel | null>;
  novelHtml: Accessor<string | null>;
  novelImages: Accessor<NovelImagesMap>;
  novelNav: Accessor<SeriesNavigation | null>;
  detailLoading: Accessor<boolean>;
  detailError: Accessor<string | null>;
}

/**
 * 小说详情页数据加载器。
 *
 * 封装了按 novelId 加载作品元数据、正文、系列导航与内嵌图片映射的生命周期，
 * 并解决 `createEffect` 因读取自身写入的 signal 而自我触发的问题。
 *
 * 缓存策略：
 *   1. 同步热缓存（peekEntry）— 系列切章同帧渲染，不闪 loading
 *   2. 异步 IndexedDB（getEntry）— 冷启动后无需网络请求
 *   3. 网络请求（loadDetail + fetchNovelData）
 */
export function createNovelLoader(novelId: Accessor<number>): NovelLoaderResult {
  const [novelData, setNovelData] = createSignal<PixivNovel | null>(null);
  const [novelHtml, setNovelHtml] = createSignal<string | null>(null);
  const [novelImages, setNovelImages] = createSignal<NovelImagesMap>({});
  const [novelNav, setNovelNav] = createSignal<SeriesNavigation | null>(null);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [detailError, setDetailError] = createSignal<string | null>(null);

  let abortController: AbortController | null = null;

  /** 将 CacheEntry 批量写入 signals（共享给同步和异步路径） */
  function applyEntry(entry: CacheEntry) {
    batch(() => {
      setNovelData(entry.detail);
      setNovelHtml(entry.text);
      setNovelImages(entry.images ?? {});
      setNovelNav(entry.nav);
      setDetailLoading(false);
    });
  }

  createEffect(() => {
    const id = novelId();
    if (!id) {
      return;
    }

    // 读取旧状态但不对其产生依赖，避免设值后自我触发。
    const hadData = untrack(() => novelData()) != null;
    const hadHtml = untrack(() => novelHtml()) != null;

    // 1. 同步热缓存（系列切章同帧渲染）
    const hot = peekEntry(id);
    if (hot) {
      applyEntry(hot);
      return;
    }

    abortController?.abort();
    abortController = new AbortController();
    const signal = abortController.signal;

    setDetailLoading(!hadData);
    setDetailError(null);
    if (!hadData) {
      setNovelData(null);
    }
    if (!hadHtml) {
      setNovelHtml(null);
    }
    setNovelImages({});

    // 2. 异步：IndexedDB → 网络
    void tryAsync(
      (async () => {
        const [entryErr, entry] = await tryAsync(getEntry(id));
        if (signal.aborted) return;
        if (!entryErr && entry) {
          applyEntry(entry);
          return;
        }

        // 3. 网络请求（并行）
        const [[detailErr, detail], [novelErr, novelResult]] = await Promise.all([
          tryAsync(loadDetail(id)),
          tryAsync(fetchNovelData(id)),
        ]);
        if (signal.aborted) return;

        const loadedNovel = novelErr ? { text: "", navigation: {}, images: {} } : novelResult!;

        if (detailErr) {
          setDetailError((detailErr as { message?: string }).message ?? "加载失败");
          setDetailLoading(false);
          return;
        }

        const networkEntry: CacheEntry = {
          detail: detail!.novel,
          text: loadedNovel.text,
          nav: loadedNovel.navigation,
          images: loadedNovel.images ?? {},
        };
        applyEntry(networkEntry);
        if (networkEntry.text) {
          setEntry(id, networkEntry);
        }
      })(),
    );
  });

  onCleanup(() => {
    abortController?.abort();
  });

  return {
    novelData,
    novelHtml,
    novelImages,
    novelNav,
    detailLoading,
    detailError,
  };
}
