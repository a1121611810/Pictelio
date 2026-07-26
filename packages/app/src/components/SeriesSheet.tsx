import {
  type Component,
  Show,
  createSignal,
  createEffect,
  For,
  onCleanup,
  createMemo,
} from "solid-js";
import { loadSeries, loadSeriesNext, type NovelSeriesDetailResponse } from "../api/novel";
import type { PixivNovel } from "../api/types";
import SeriesSheetItem from "./SeriesSheetItem";
import LoadingSpinner from "./LoadingSpinner";
import { SHEET_LAZY_MARGIN } from "../primitives/rootMargins";
import { createSentinel } from "@/primitives/visibility";
import { getSeries, setSeries } from "../stores/novelCache";


interface Props {
  seriesId: number;
  seriesTitle: string;
  authorName: string;
  authorId: number;
  isOpen: boolean;
  onClose: () => void;
  onNovelSelect?: (id: number) => void;
  onAuthorClick?: () => void;
  activeNovelId?: number;
}

const SeriesSheet: Component<Props> = (props) => {
  // SeriesSheet 不再负责导航；选择小说后回调外部。

  const [novels, setNovels] = createSignal<PixivNovel[]>([]);
  const [seriesDetail, setSeriesDetail] = createSignal<
    NovelSeriesDetailResponse["novel_series_detail"] | null
  >(null);
  const [loading, setLoading] = createSignal(false);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [hasMore, setHasMore] = createSignal(false);
  const [nextUrl, setNextUrl] = createSignal<string | null>(null);
  const [scrollContainer, setScrollContainer] = createSignal<HTMLDivElement | null>(null);
  const [activeItemEl, setActiveItemEl] = createSignal<HTMLElement | null>(null);
  const [hasScrolledToActive, setHasScrolledToActive] = createSignal(false);

  let abortController: AbortController | null = null;

  const { attach: sentinelAttach } = createSentinel({
    root: scrollContainer,
    rootMargin: SHEET_LAZY_MARGIN,
    enabled: () => hasMore() && !loadingMore() && !loading(),
    onTrigger: () => loadMore(),
  });

  createEffect(() => {
    if (props.isOpen && props.seriesId) {
      reset();
      loadInitial();
    } else {
      reset();
    }
  });

  onCleanup(() => {
    abortController?.abort();
  });

  function reset() {
    abortController?.abort();
    abortController = null;
    setNovels([]);
    setSeriesDetail(null);
    setLoading(false);
    setLoadingMore(false);
    setError(null);
    setHasMore(false);
    setNextUrl(null);
    setActiveItemEl(null);
    setHasScrolledToActive(false);
  }

  function applyResult(result: NovelSeriesDetailResponse, append: boolean) {
    setSeriesDetail(result.novel_series_detail);
    if (append) {
      setNovels((prev) => [...prev, ...result.novels]);
    } else {
      setNovels(result.novels);
    }
    setHasMore(result.next_url != null);
    setNextUrl(result.next_url);
  }

  async function loadInitial() {
    const cached = await getSeries(props.seriesId);
    if (cached) {
      applyResult(
        {
          novel_series_detail: cached.detail,
          novels: cached.novels,
          next_url: cached.nextUrl,
        } as NovelSeriesDetailResponse,
        false,
      );
    }

    abortController?.abort();
    abortController = new AbortController();

    setLoading(true);
    setError(null);

    const [err, result] = await tryAsync(loadSeries(props.seriesId));
    if (!abortController.signal.aborted) {
      if (!err) {
        applyResult(result, false);
        await setSeries(props.seriesId, {
          detail: result.novel_series_detail,
          novels: result.novels,
          nextUrl: result.next_url,
        });
      }
      setLoading(false);
      if (err) {
        setError((err as { message?: string }).message ?? "加载失败");
        return;
      }
    }
  }

  async function loadMore() {
    if (!hasMore() || loadingMore() || loading()) {
      return;
    }
    const url = nextUrl();
    if (!url) {
      return;
    }

    setLoadingMore(true);

    const [err, result] = await tryAsync(loadSeriesNext(url));
    if (!err) {
      applyResult(result, true);
    }
    setLoadingMore(false);
    if (err) {
      setError((err as { message?: string }).message ?? "加载失败");
      return;
    }
  }

  async function refetch() {
    abortController?.abort();
    abortController = new AbortController();
    setNovels([]);
    setSeriesDetail(null);
    setHasMore(false);
    setNextUrl(null);
    setError(null);
    setLoading(true);
    const [err, result] = await tryAsync(loadSeries(props.seriesId));
    if (!abortController?.signal.aborted) {
      if (err) {
        setError((err as { message?: string }).message ?? "加载失败");
      } else {
        applyResult(result, false);
        void setSeries(props.seriesId, {
          detail: result.novel_series_detail,
          novels: result.novels,
          nextUrl: result.next_url,
        });
      }
      setLoading(false);
    }
  }

  // 打开 Sheet 时锁定背景滚动
  createEffect(() => {
    if (props.isOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      onCleanup(() => {
        document.body.style.overflow = prev;
      });
    }
  });

  // 自动加载直到找到 activeNovelId，并滚动到可视区域
  createEffect(() => {
    const activeId = props.activeNovelId;
    if (activeId == null || hasScrolledToActive()) {
      return;
    }

    const currentNovels = novels();
    const found = currentNovels.some((n) => n.id === activeId);

    if (found) {
      // 等待 DOM 渲染后滚动
      requestAnimationFrame(() => {
        const el = activeItemEl();
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          setHasScrolledToActive(true);
        }
      });
    } else if (hasMore() && !loadingMore() && !loading()) {
      loadMore();
    }
  });

  function close() {
    props.onClose();
  }

  function handleItemClick(id: number) {
    close();
    props.onNovelSelect?.(id);
  }

  const isActive = (id: number) => props.activeNovelId != null && id === props.activeNovelId;

  const totalCount = createMemo(() => {
    const detail = seriesDetail();
    return detail?.total_character_count ?? 0;
  });

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50">
        {/* Scrim */}
        <div
          class="absolute inset-0"
          style="background-color:var(--colorScrim)"
          onClick={close}
          role="button"
          aria-label="关闭"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && close()}
        />

        {/* Sheet panel */}
        <div
          ref={setScrollContainer}
          class="absolute bottom-0 left-0 right-0 surface-appbar rounded-t-[var(--borderRadius4XLarge)] shadow-[var(--elevation28)]"
          style="max-height:80vh;overflow-y:auto;animation:fluent-slide-down var(--durationGentle) var(--curveDecelerateMid) both"
        >
          {/* Drag handle */}
          <div class="flex justify-center pt-2 pb-1">
            <div class="w-10 h-1 rounded-[var(--borderRadiusCircular)] bg-[var(--colorNeutralStroke1)]" />
          </div>

          {/* Header */}
          <div class="flex items-center justify-between px-5 pt-1 pb-2">
            <h2 class="[font-size:var(--fontSizeBase500)] font-semibold text-[var(--colorNeutralForeground1)]">
              系列作品
            </h2>
            <button
              class="w-10 h-10 flex items-center justify-center rounded-[var(--borderRadiusSmall)] text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorNeutralBackground2)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer"
              onClick={close}
              aria-label="关闭"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                  d="M15.14 4.86a.67.67 0 0 0-.95 0L10 9.05 5.81 4.86a.67.67 0 0 0-.95.95L9.05 10l-4.19 4.19a.67.67 0 0 0 .95.95L10 10.95l4.19 4.19a.67.67 0 0 0 .95-.95L10.95 10l4.19-4.19a.67.67 0 0 0 0-.95z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>

          <fluent-divider style="margin-inline:var(--spacingHorizontalXL)" />

          {/* ── Series metadata ── */}
          <div class="px-5 py-3">
            <h3 class="[font-size:var(--fontSizeBase400)] font-bold text-[var(--colorNeutralForeground1)] leading-tight">
              {props.seriesTitle}
            </h3>
            <button
              class="[font-size:var(--fontSizeBase200)] text-[var(--colorBrandForeground1)] hover:underline bg-transparent border-none p-0 cursor-pointer mt-1"
              onClick={() => {
                close();
                props.onAuthorClick?.();
              }}
            >
              @{props.authorName}
            </button>

            <Show when={seriesDetail()}>
              <p class="[font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)] mt-1">
                总字数: {totalCount().toLocaleString()}字 · {novels().length}部作品
                {hasMore() ? "+" : ""}
              </p>
            </Show>
          </div>

          <fluent-divider style="margin-inline:var(--spacingHorizontalXL)" />

          {/* ── Content area ── */}
          <div class="min-h-[160px]">
            {/* Loading state */}
            <Show when={loading() && novels().length === 0}>
              <div class="flex justify-center py-8">
                <LoadingSpinner text="加载中..." />
              </div>
            </Show>

            {/* Error state */}
            <Show when={error()}>
              <div class="flex flex-col items-center justify-center py-8 gap-3 px-5">
                <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorStatusDangerForeground1)] text-center">
                  加载失败：{error()}
                </p>
                <button
                  class="px-4 py-1.5 rounded-[var(--borderRadiusMedium)] bg-[var(--colorBrandBackground)] text-white [font-size:var(--fontSizeBase200)] font-medium border-none cursor-pointer active:scale-95 transition-all"
                  onClick={() => refetch()}
                >
                  重试
                </button>
              </div>
            </Show>

            {/* Novel list */}
            <Show when={novels().length > 0}>
              <div class="py-1">
                <For each={novels()}>
                  {(novel) => (
                    <SeriesSheetItem
                      novel={novel}
                      isActive={isActive(novel.id)}
                      ref={isActive(novel.id) ? setActiveItemEl : undefined}
                      onClick={handleItemClick}
                    />
                  )}
                </For>
              </div>
            </Show>

            {/* Empty state */}
            <Show when={!loading() && !error() && novels().length === 0 && seriesDetail()}>
              <p class="text-center py-8 [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
                暂无作品
              </p>
            </Show>

            {/* Load more sentinel */}
            <Show when={hasMore()}>
              <div ref={sentinelAttach} class="h-1" />
            </Show>

            {/* Loading more indicator */}
            <Show when={loadingMore()}>
              <div class="flex justify-center py-4">
                <fluent-spinner size="tiny" />
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default SeriesSheet;
