import type { Component } from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import FluentIcon from "@/components/ui/FluentIcon";
import TagInput from "@/components/ui/TagInput";
import { createSearchStore } from "@/stores/searchStore";
import SearchResults from "@/components/SearchResults";
import { createScrollBehavior } from "@/primitives/scroll/createScrollBehavior";
import type { SearchScope, SearchSort } from "@/api/types";
import PageTransition from "@/components/PageTransition";
import { scrollToTop } from "@/utils/scrollToTop";

const SCOPE_OPTIONS: { value: SearchScope; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "illust", label: "插画·漫画" },
  { value: "novel", label: "小说" },
];

const SORT_OPTIONS: { value: SearchSort; label: string }[] = [
  { value: "date_desc", label: "最新" },
  { value: "date_asc", label: "最早" },
  { value: "popular_desc", label: "热门" },
];

/** 获取当前 scope 的中文标签 */
function scopeLabel(value: SearchScope): string {
  return SCOPE_OPTIONS.find((o) => o.value === value)?.label ?? "全部";
}

const Search: Component = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const store = createSearchStore();

  // ── Tag chips ──
  const [tags, setTags] = createSignal<string[]>([]);

  /** tags 变化时同步到 store，并触发防抖搜索 */
  function handleTagsChange(newTags: string[]) {
    setTags(newTags);
    store.setKeyword(newTags.join(" "));
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (newTags.length > 0) {
        addToHistory(newTags.join(" "));
        const qs = new URLSearchParams({
          word: newTags.join(" "),
          scope: store.scope(),
          sort: store.toSorted(),
        }).toString();
        void navigate(`/search?${qs}`);
        store.executeSearch();
      }
    }, 300);
  }

  // ── Local state: search history, autocomplete, type filter ──
  const [searchHistory, setSearchHistory] = createSignal<string[]>([]);
  const MAX_HISTORY = 50;

  function addToHistory(word: string) {
    if (!word.trim()) return;
    setSearchHistory((prev) => {
      const filtered = prev.filter((h) => h !== word);
      return [word, ...filtered].slice(0, MAX_HISTORY);
    });
  }

  function removeFromHistory(word: string) {
    setSearchHistory((prev) => prev.filter((h) => h !== word));
  }

  function clearHistory() {
    setSearchHistory([]);
  }

  // ── Back-to-top state & compact header state ──
  const BACK_TO_TOP_THRESHOLD = 300;
  const SCROLL_HEADER_THRESHOLD = 150;
  const SCROLL_DIRECTION_DEADZONE = 10;
  const sb = createScrollBehavior({ directionThreshold: SCROLL_DIRECTION_DEADZONE });
  const showBackToTop = sb.scrolledPast(BACK_TO_TOP_THRESHOLD);
  const [showCompactHeader, setShowCompactHeader] = createSignal(false);

  // ── Scroll-driven compact header ──
  const pastHeaderThreshold = sb.scrolledPast(SCROLL_HEADER_THRESHOLD);
  const scrollDirection = sb.direction;

  createEffect(() => {
    if (!pastHeaderThreshold()) {
      setShowCompactHeader(false);
      return;
    }
    const d = scrollDirection();
    // Compact header: show when scrolled past threshold AND scrolling up
    if (d === "up") setShowCompactHeader(true);
    else if (d === "down") setShowCompactHeader(false);
  });

  // ── 从 URL word 参数同步到 tags + keyword ──
  function syncFromUrl(word: string) {
    setTags(word.split(" ").filter(Boolean));
    store.setKeyword(word);
  }

  // ── Sync URL params → store ──
  let prevUrlWord: string | undefined;
  createEffect(() => {
    const params = searchParams as Record<string, string | undefined>;
    if (params.word !== undefined && params.word !== prevUrlWord) {
      prevUrlWord = params.word;
      syncFromUrl(params.word);
      if (hydrated()) {
        // Hydration 后的 URL 变化（浏览器前进/后退）触发搜索
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          store.executeSearch();
        }, 300);
      }
    }
    if (params.scope) store.setScope(params.scope as SearchScope);
    if (params.sort) store.setSort(params.sort as SearchSort);
  });

  // ── Execute search on URL param hydration (only on initial load / deep links) ──
  const [hydrated, setHydrated] = createSignal(false);
  createEffect(() => {
    const params = searchParams as Record<string, string | undefined>;
    if (!hydrated() && params.word?.trim()) {
      setHydrated(true);
      const word = params.word.trim();
      syncFromUrl(word);
      if (params.scope) store.setScope(params.scope as SearchScope);
      if (params.sort) store.setSort(params.sort as SearchSort);
      store.executeSearch();
    }
    if (!hydrated() && params.word === undefined) {
      setHydrated(true);
    }
  });

  // ── Debounced search execution ──
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(debounceTimer));
  function handleClearSearch() {
    clearTimeout(debounceTimer);
    setTags([]);
    store.setKeyword("");
    void navigate("/search");
  }

  function handleScopeChange(scope: SearchScope) {
    store.setScope(scope);
    const kw = store.keyword().trim();
    if (kw) {
      clearTimeout(debounceTimer);
      const qs = new URLSearchParams({ word: kw, scope, sort: store.toSorted() }).toString();
      void navigate(`/search?${qs}`);
      store.executeSearch();
    }
  }

  function handleSortChange(sort: SearchSort) {
    store.setSort(sort);
    const kw = store.keyword().trim();
    if (kw) {
      clearTimeout(debounceTimer);
      const qs = new URLSearchParams({ word: kw, scope: store.scope(), sort }).toString();
      void navigate(`/search?${qs}`);
      store.executeSearch();
    }
  }

  let mainInputRef: HTMLInputElement | undefined;

  /** 聚焦紧凑 header 的搜索框时滚回顶部显示完整搜索栏 */
  function onCompactInputFocus() {
    scrollToTop();
    // 稍后聚焦主搜索框
    setTimeout(() => mainInputRef?.focus(), 350);
  }

  const hasActiveSearch = createMemo(() => store.keyword().trim() !== "");

  return (
    <PageTransition>
      {/* ── Compact header — 滚出阈值后上滑展示 ── */}
      <header
        class="fixed top-0 left-0 right-0 z-30 surface-appbar transition-transform duration-[var(--durationNormal)] ease-[var(--curveEasyEase)]"
        classList={{
          "translate-y-0": showCompactHeader(),
          "-translate-y-full": !showCompactHeader(),
        }}
      >
        <div class="flex items-center gap-2 px-4 h-12 max-w-3xl mx-auto">
          <button
            class="flex items-center justify-center min-w-10 min-h-10 rounded-[var(--borderRadiusSmall)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-95 transition-all duration-[var(--durationFast)] flex-shrink-0"
            onClick={() => window.history.back()}
            aria-label="返回"
          >
            <FluentIcon name="chevronLeft" size={20} />
          </button>

          <div class="flex items-center gap-1.5 flex-1 min-w-0 bg-[var(--colorNeutralBackground1)] rounded-[var(--borderRadiusMedium)] border border-[var(--colorNeutralStroke2)] px-[var(--spacingHorizontalMNudge)] py-[var(--spacingVerticalSNudge)]">
            <Show
              when={tags().length > 0}
              fallback={
                <span
                  class="flex items-center gap-1.5 text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase300)] select-none cursor-pointer"
                  onClick={onCompactInputFocus}
                >
                  <FluentIcon name="search" size={16} />
                  <span>搜索</span>
                </span>
              }
            >
              <div
                class="flex items-center gap-1 flex-1 min-w-0 cursor-pointer overflow-hidden"
                onClick={onCompactInputFocus}
              >
                <FluentIcon name="search" size={16} />
                <For each={tags()}>
                  {(tag) => (
                    <span class="inline-flex items-center px-1.5 py-0.5 rounded-[var(--borderRadiusSmall)] bg-[var(--colorBrandBackground2)] text-[var(--colorBrandForeground1)] text-xs truncate max-w-[80px]">
                      {tag}
                    </span>
                  )}
                </For>
              </div>
            </Show>
            <Show when={tags().length > 0}>
              <button
                class="flex items-center justify-center min-w-8 min-h-8 rounded-[var(--borderRadiusSmall)] text-[var(--colorNeutralForeground3)] hover:bg-[var(--colorNeutralBackground2)] hover:text-[var(--colorNeutralForeground1)] active:scale-90 transition-all duration-[var(--durationFast)]"
                onClick={(e) => {
                  e.stopPropagation();
                  handleClearSearch();
                }}
                aria-label="清除搜索"
              >
                <FluentIcon name="dismiss" size={16} />
              </button>
            </Show>
          </div>

          {/* Compact filter indicator */}
          <button
            class="flex-shrink-0 text-xs text-[var(--colorNeutralForeground3)] whitespace-nowrap px-[var(--spacingHorizontalXS)] py-[var(--spacingVerticalXXS)] rounded-[var(--borderRadiusSmall)] hover:bg-[var(--colorNeutralBackground1Hover)] transition-colors duration-[var(--durationFast)]"
            onClick={() => scrollToTop()}
            aria-label="切换筛选"
          >
            {scopeLabel(store.scope())}
          </button>
        </div>
      </header>

      <div class="pb-16">
        <div class="max-w-3xl mx-auto">
          {/* ── Search bar — Fluent 2 flat surface card ── */}
          <div class="surface-card mx-4 mt-4 flex items-center gap-2 px-[var(--spacingHorizontalM)] py-[var(--spacingVerticalM)]">
            <button
              class="flex items-center justify-center min-w-10 min-h-10 rounded-[var(--borderRadiusSmall)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-95 transition-all duration-[var(--durationFast)] flex-shrink-0"
              onClick={() => window.history.back()}
              aria-label="返回"
            >
              <FluentIcon name="chevronLeft" size={20} />
            </button>
            <span class="flex-shrink-0 text-[var(--colorNeutralForeground3)] leading-[normal]">
              <FluentIcon name="search" size={20} />
            </span>
            <TagInput
              tags={tags()}
              onTagsChange={handleTagsChange}
              placeholder="输入标签，空格/回车添加"
              inputRef={(el) => (mainInputRef = el)}
            />
            <Show when={tags().length > 0}>
              <button
                class="flex items-center justify-center min-w-8 min-h-8 rounded-[var(--borderRadiusSmall)] text-[var(--colorNeutralForeground3)] hover:bg-[var(--colorNeutralBackground2)] hover:text-[var(--colorNeutralForeground1)] active:scale-90 transition-all duration-[var(--durationFast)]"
                onClick={() => handleClearSearch()}
                aria-label="清除搜索"
              >
                <FluentIcon name="dismiss" size={18} />
              </button>
            </Show>
          </div>

          {/* ── Scope + Sort controls — Fluent 2 tabs + inline sort ── */}
          <div class="px-4 mt-4 mb-3 flex flex-col gap-[var(--spacingVerticalM)]">
            <div
              class="flex border-b border-[var(--colorNeutralStroke2)]"
              role="radiogroup"
              aria-label="搜索范围"
            >
              <For each={SCOPE_OPTIONS}>
                {(opt) => (
                  <button
                    class="flex-1 pb-[var(--spacingVerticalSNudge)] [font-size:var(--fontSizeBase300)] font-medium text-center transition-all duration-[var(--durationFast)] focus-visible:outline-[var(--colorStrokeFocus2)] focus-visible:outline-2 focus-visible:outline-offset-1 relative"
                    classList={{
                      "text-[var(--colorBrandForeground1)]": store.scope() === opt.value,
                      "text-[var(--colorNeutralForeground3)] hover:text-[var(--colorNeutralForeground1)]":
                        store.scope() !== opt.value,
                    }}
                    onClick={() => handleScopeChange(opt.value)}
                    role="radio"
                    aria-checked={store.scope() === opt.value}
                  >
                    {opt.label}
                    {store.scope() === opt.value && (
                      <span class="absolute bottom-0 left-0 right-0 h-[var(--strokeWidthThick)] bg-[var(--colorBrandStroke1)] rounded-full" />
                    )}
                  </button>
                )}
              </For>
            </div>

            <div
              class="flex items-center justify-center gap-[var(--spacingHorizontalS)]"
              role="group"
              aria-label="排序方式"
            >
              <For each={SORT_OPTIONS}>
                {(opt, index) => (
                  <>
                    <Show when={index() > 0}>
                      <span
                        class="text-[var(--colorNeutralForegroundDisabled)] text-xs select-none"
                        aria-hidden="true"
                      >
                        ·
                      </span>
                    </Show>
                    <button
                      class="[font-size:var(--fontSizeBase200)] transition-colors duration-[var(--durationFast)] focus-visible:outline-[var(--colorStrokeFocus2)] focus-visible:outline-2 focus-visible:outline-offset-1"
                      classList={{
                        "text-[var(--colorBrandForeground1)] font-semibold":
                          store.toSorted() === opt.value,
                        "text-[var(--colorNeutralForeground3)] hover:text-[var(--colorNeutralForeground1)]":
                          store.toSorted() !== opt.value,
                      }}
                      onClick={() => handleSortChange(opt.value)}
                    >
                      {opt.label}
                    </button>
                  </>
                )}
              </For>
            </div>
          </div>

          {/* ── Search history (when no keyword) ── */}
          <Show when={!hasActiveSearch()}>
            <SearchHistorySection
              history={searchHistory()}
              onSelect={(word) => {
                clearTimeout(debounceTimer);
                const tagList = word.split(" ").filter(Boolean);
                setTags(tagList);
                store.setKeyword(word);
                addToHistory(word);
                const qs = new URLSearchParams({
                  word,
                  scope: store.scope(),
                  sort: store.toSorted(),
                }).toString();
                void navigate(`/search?${qs}`);
                store.executeSearch();
              }}
              onRemove={(word) => removeFromHistory(word)}
              onClear={() => clearHistory()}
            />
          </Show>

          {/* ── Search results ── */}
          <Show when={hasActiveSearch()}>
            <div class="px-4">
              <SearchResults
                results={store.results()}
                loading={store.loading()}
                hasMore={store.hasMore()}
                onLoadMore={() => store.loadMore()}
                onIllustClick={(id) => navigate(`/illust/${id}`)}
                onNovelClick={(id) => navigate(`/novel/${id}`)}
                onAuthorClick={(id) => void navigate(`/user/${id}`)}
                onRefresh={() => store.executeSearch()}
                error={store.error()}
              />
            </div>
          </Show>
        </div>
      </div>

      {/* ── Back to top ── */}
      <Show when={showBackToTop()}>
        <button
          class="fixed z-20 bottom-24 right-4 w-11 h-11 flex items-center justify-center rounded-[var(--borderRadiusCircular)] bg-[var(--colorOverlaySurface)] backdrop-blur-[var(--backdropBlurDefault)] backdrop-saturate-[var(--backdropSaturateDefault)] border border-[var(--colorNeutralStroke2)] shadow-[var(--elevation4)] text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorOverlaySurfaceHover)] active:scale-90 transition-all duration-[var(--durationFast)]"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="回顶"
        >
          <FluentIcon name="chevronUp" size={20} />
        </button>
      </Show>
    </PageTransition>
  );
};

// ── Search history sub-component ──

interface HistoryProps {
  history: string[];
  onSelect: (word: string) => void;
  onRemove: (word: string) => void;
  onClear: () => void;
}

const SearchHistorySection: Component<HistoryProps> = (props) => {
  return (
    <div class="px-4">
      <Show
        when={props.history.length > 0}
        fallback={
          <div class="flex flex-col items-center gap-2 py-12 text-center">
            <span class="text-[var(--colorNeutralForeground4)]">
              <FluentIcon name="search" size={40} />
            </span>
            <p class="text-[var(--colorNeutralForeground3)] text-sm">输入关键词开始搜索</p>
          </div>
        }
      >
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold text-[var(--colorNeutralForeground1)]">最近搜索</h3>
          <button class="history-clear-btn" onClick={props.onClear}>
            清空
          </button>
        </div>
        <div class="flex flex-col gap-1">
          <For each={props.history}>
            {(word) => (
              <div class="flex items-center gap-2 px-3 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)] cursor-pointer hover:bg-[var(--colorNeutralBackground3)] transition-colors duration-[var(--durationFast)] min-h-[44px]">
                <span
                  class="flex-1 text-sm text-[var(--colorNeutralForeground1)] select-none truncate"
                  onClick={() => props.onSelect(word)}
                >
                  {word}
                </span>
                <button
                  class="min-w-9 min-h-9 flex items-center justify-center rounded-[var(--borderRadiusSmall)] text-[var(--colorNeutralForeground4)] hover:text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorNeutralBackground1)] active:scale-90 transition-all duration-[var(--durationFast)]"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onRemove(word);
                  }}
                  aria-label={`删除 ${word}`}
                >
                  <FluentIcon name="dismiss" size={14} />
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default Search;
