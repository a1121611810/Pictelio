import type { Component } from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import FluentIcon from "@/components/ui/FluentIcon";
import TagInput from "@/components/ui/TagInput";
import { createSearchStore } from "@/stores/searchStore";
import SearchResults from "@/components/SearchResults";
import SearchFilterSheet from "@/components/search/SearchFilterSheet";
import {
  countActiveFilters,
  decodeFiltersQuery,
  encodeFiltersQuery,
  type SearchFilters,
} from "@pictelio/search-core";
import { createScrollBehavior } from "@/primitives/scroll/createScrollBehavior";
import type { SearchScope, SearchSort } from "@/api/types";
import PageTransition from "@/components/PageTransition";
import { t, type I18nKey } from "@/i18n";
import { scrollToTop } from "@/utils/scrollToTop";
import { goBack } from "@/services/backTransitionService";

// 模块级常量存 key，渲染时 t()（i18n 机械抽取规范）
const SCOPE_OPTIONS: { value: SearchScope; label: I18nKey }[] = [
  { value: "all", label: "searchPage.scopeAll" },
  { value: "illust", label: "searchPage.scopeIllust" },
  { value: "novel", label: "searchPage.scopeNovel" },
];

const SORT_OPTIONS: { value: SearchSort; label: I18nKey }[] = [
  { value: "date_desc", label: "searchPage.sortNewest" },
  { value: "date_asc", label: "searchPage.sortOldest" },
  { value: "popular_desc", label: "searchPage.sortPopular" },
];

/** 获取当前 scope 的标签（渲染时翻译） */
function scopeLabel(value: SearchScope): string {
  const key = SCOPE_OPTIONS.find((o) => o.value === value)?.label ?? "searchPage.scopeAll";
  return t(key);
}

const Search: Component = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const store = createSearchStore();

  // ── URL query 构建（word/scope/sort + 筛选段 fp/fd/fb/fr/fw/fa；spec §6.3）──
  function buildSearchQuery(): string {
    return new URLSearchParams({
      word: store.keyword().trim(),
      scope: store.scope(),
      sort: store.toSorted(),
      ...encodeFiltersQuery(store.filters()),
    }).toString();
  }

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
        void navigate(`/search?${buildSearchQuery()}`);
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
  // Solid 2.0 拆分效应：compute 提取快照（普通值），apply 段写 signal（合法）。
  const pastHeaderThreshold = sb.scrolledPast(SCROLL_HEADER_THRESHOLD);
  const scrollDirection = sb.direction;

  createEffect(
    () => ({ past: pastHeaderThreshold(), dir: scrollDirection() }),
    ({ past, dir }) => {
      if (!past) {
        setShowCompactHeader(false);
        return;
      }
      // Compact header: show when scrolled past threshold AND scrolling up
      if (dir === "up") setShowCompactHeader(true);
      else if (dir === "down") setShowCompactHeader(false);
    },
  );

  // ── 从 URL word 参数同步到 tags + keyword ──
  function syncFromUrl(word: string) {
    setTags(word.split(" ").filter(Boolean));
    store.setKeyword(word);
  }

  // ── Sync URL params → store ──
  // Solid 2.0 拆分效应：compute 读 searchParams 快照（含筛选六键，快照缺失会导致
  // 仅筛变化的 URL 更新不触发 effect），apply 段做 store 写与导航联动。
  let prevUrlWord: string | undefined;
  createEffect(
    () => {
      const params = searchParams as Record<string, string | undefined>;
      return {
        word: params.word,
        scope: params.scope,
        sort: params.sort,
        fp: params.fp,
        fd: params.fd,
        fb: params.fb,
        fr: params.fr,
        fw: params.fw,
        fa: params.fa,
      };
    },
    (snap) => {
      const { word, scope, sort } = snap;
      if (word !== undefined && word !== prevUrlWord) {
        prevUrlWord = word;
        syncFromUrl(word);
        if (hydrated()) {
          // Hydration 后的 URL 变化（浏览器前进/后退）触发搜索（防抖，异步安全）
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            store.executeSearch();
          }, 300);
        }
      }
      if (scope) store.setScope(scope as SearchScope);
      if (sort) store.setSort(sort as SearchSort);
      // 筛选段回填（浏览器前进/后退；spec §6.3）：解码结果与当前不同才写入并重搜——
      // 面板自身触发的 navigate 解码值与当前一致 → 不回环、不重复搜索。
      const urlFilters = decodeFiltersQuery(snap);
      if (JSON.stringify(urlFilters) !== JSON.stringify(store.filters())) {
        store.setFilters(urlFilters);
        if (store.keyword().trim() !== "") {
          clearTimeout(filterDebounceTimer);
          filterDebounceTimer = setTimeout(() => store.executeSearch(), 300);
        }
      }
    },
  );

  // ── Execute search on URL param hydration (only on initial load / deep links) ──
  const [hydrated, setHydrated] = createSignal(false);
  createEffect(
    () => {
      const params = searchParams as Record<string, string | undefined>;
      return {
        word: params.word,
        scope: params.scope,
        sort: params.sort,
        fp: params.fp,
        fd: params.fd,
        fb: params.fb,
        fr: params.fr,
        fw: params.fw,
        fa: params.fa,
        hydrated: hydrated(),
      };
    },
    ({ word, scope, sort, hydrated: isHydrated, ...filterSnap }) => {
      if (!isHydrated && word?.trim()) {
        setHydrated(true);
        const trimmed = word.trim();
        syncFromUrl(trimmed);
        if (scope) store.setScope(scope as SearchScope);
        if (sort) store.setSort(sort as SearchSort);
        store.setFilters(decodeFiltersQuery(filterSnap));
        // Solid 2.0：executeSearch 内部同步读 keyword()/scope()/sort()，而上面的 set
        // 尚未提交（微任务批处理）。此处的「set 后立即同步执行搜索」是命令式边界，
        // 显式 flush 保证 store 读到已提交的新值（语义与 1.x 同步可见一致）。
        flush();
        store.executeSearch();
      }
      if (!isHydrated && word === undefined) {
        setHydrated(true);
      }
    },
  );

  // ── Debounced search execution ──
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  // 筛选即改即搜去抖（spec §5.2：末次改动后 400-500ms）
  let filterDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    clearTimeout(debounceTimer);
    clearTimeout(filterDebounceTimer);
  });
  function handleClearSearch() {
    clearTimeout(debounceTimer);
    setTags([]);
    store.setKeyword("");
    void navigate("/search");
  }

  function handleScopeChange(scope: SearchScope) {
    store.setScope(scope);
    // Solid 2.0：executeSearch 内部同步读 scope()/keyword()，set 尚未提交（微任务批处理），
    // 直接调用会拿到旧 scope 静默失效——此处属「set 后立即同步执行搜索」的命令式边界，flush。
    flush();
    const kw = store.keyword().trim();
    if (kw) {
      clearTimeout(debounceTimer);
      void navigate(`/search?${buildSearchQuery()}`);
      store.executeSearch();
    }
  }

  function handleSortChange(sort: SearchSort) {
    store.setSort(sort);
    // Solid 2.0：同 handleScopeChange——set 后同步 executeSearch 前必须 flush 提交新值。
    flush();
    const kw = store.keyword().trim();
    if (kw) {
      clearTimeout(debounceTimer);
      void navigate(`/search?${buildSearchQuery()}`);
      store.executeSearch();
    }
  }

  /** 筛选面板变更入口（#476 即改即搜）：状态先落 store，末次改动 450ms 去抖后导航 + 重搜 */
  function handleFiltersChange(next: SearchFilters) {
    store.setFilters(next);
    if (store.keyword().trim() === "") return; // 空词只存状态（与 scope/sort 语义一致）
    clearTimeout(filterDebounceTimer);
    filterDebounceTimer = setTimeout(() => {
      void navigate(`/search?${buildSearchQuery()}`);
      store.executeSearch();
    }, 450);
  }

  let mainInputRef: HTMLInputElement | undefined;

  /** 聚焦紧凑 header 的搜索框时滚回顶部显示完整搜索栏 */
  function onCompactInputFocus() {
    scrollToTop();
    // 稍后聚焦主搜索框
    setTimeout(() => mainInputRef?.focus(), 350);
  }

  const hasActiveSearch = createMemo(() => store.keyword().trim() !== "");

  // ── 筛选面板（#477 变体 A：底部 Sheet；入口=筛选 icon+激活数徽标） ──
  const [filterSheetOpen, setFilterSheetOpen] = createSignal(false);
  const activeFilterCount = () => countActiveFilters(store.filters());

  return (
    <PageTransition>
      {/* ── Compact header — 滚出阈值后上滑展示 ── */}
      <header
        class={[
          "fixed top-0 left-0 right-0 z-30 surface-appbar transition-transform duration-[var(--durationNormal)] ease-[var(--curveEasyEase)]",
          {
            "translate-y-0": showCompactHeader(),
            "-translate-y-full": !showCompactHeader(),
          },
        ]}
      >
        <div class="flex items-center gap-2 px-4 h-12 max-w-3xl mx-auto">
          <button
            class="flex items-center justify-center min-w-10 min-h-10 rounded-[var(--borderRadiusSmall)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-95 transition-all duration-[var(--durationFast)] flex-shrink-0"
            onClick={() => goBack()}
            aria-label={t("searchPage.back")}
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
                  <span>{t("searchPage.search")}</span>
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
                aria-label={t("searchPage.clearSearchAria")}
              >
                <FluentIcon name="dismiss" size={16} />
              </button>
            </Show>
          </div>

          {/* Compact filter indicator */}
          <button
            class="flex-shrink-0 text-xs text-[var(--colorNeutralForeground3)] whitespace-nowrap px-[var(--spacingHorizontalXS)] py-[var(--spacingVerticalXXS)] rounded-[var(--borderRadiusSmall)] hover:bg-[var(--colorNeutralBackground1Hover)] transition-colors duration-[var(--durationFast)]"
            onClick={() => scrollToTop()}
            aria-label={t("searchPage.toggleFiltersAria")}
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
              onClick={() => goBack()}
              aria-label={t("searchPage.back")}
            >
              <FluentIcon name="chevronLeft" size={20} />
            </button>
            <span class="flex-shrink-0 text-[var(--colorNeutralForeground3)] leading-[normal]">
              <FluentIcon name="search" size={20} />
            </span>
            <TagInput
              tags={tags()}
              onTagsChange={handleTagsChange}
              placeholder={t("searchPage.searchPlaceholder")}
              inputRef={(el) => (mainInputRef = el)}
            />
            <Show when={tags().length > 0}>
              <button
                class="flex items-center justify-center min-w-8 min-h-8 rounded-[var(--borderRadiusSmall)] text-[var(--colorNeutralForeground3)] hover:bg-[var(--colorNeutralBackground2)] hover:text-[var(--colorNeutralForeground1)] active:scale-90 transition-all duration-[var(--durationFast)]"
                onClick={() => handleClearSearch()}
                aria-label={t("searchPage.clearSearchAria")}
              >
                <FluentIcon name="dismiss" size={18} />
              </button>
            </Show>
            {/* 筛选入口：icon + 激活数徽标（#476 Q6：0 激活时隐藏徽标） */}
            <button
              class="relative flex items-center justify-center min-w-10 min-h-10 rounded-[var(--borderRadiusSmall)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground2)] active:scale-90 transition-all duration-[var(--durationFast)] flex-shrink-0"
              onClick={() => setFilterSheetOpen(true)}
              aria-label={t("searchPage.filtersAria")}
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M2.5 3h15l-6 7v6l-3 1.5v-7.5l-6-7z" fill="currentColor" />
              </svg>
              <Show when={activeFilterCount() > 0}>
                <span class="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-[var(--borderRadiusCircular)] bg-[var(--colorBrandBackground)] text-[var(--colorNeutralForegroundOnBrand)] text-[var(--fontSizeBase100)] leading-4 text-center">
                  {activeFilterCount()}
                </span>
              </Show>
            </button>
          </div>

          {/* ── Scope + Sort controls — Fluent 2 tabs + inline sort ── */}
          <div class="px-4 mt-4 mb-3 flex flex-col gap-[var(--spacingVerticalM)]">
            <div
              class="flex border-b border-[var(--colorNeutralStroke2)]"
              role="radiogroup"
              aria-label={t("searchPage.scopeAria")}
            >
              <For each={SCOPE_OPTIONS}>
                {(opt) => (
                  <button
                    class={[
                      "flex-1 pb-[var(--spacingVerticalSNudge)] [font-size:var(--fontSizeBase300)] font-medium text-center transition-all duration-[var(--durationFast)] focus-visible:outline-[var(--colorStrokeFocus2)] focus-visible:outline-2 focus-visible:outline-offset-1 relative",
                      {
                        "text-[var(--colorBrandForeground1)]": store.scope() === opt.value,
                        "text-[var(--colorNeutralForeground3)] hover:text-[var(--colorNeutralForeground1)]":
                          store.scope() !== opt.value,
                      },
                    ]}

                    onClick={() => handleScopeChange(opt.value)}
                    role="radio"
                    // Solid 2.0：aria-checked 仅接受枚举字符串（"true"/"false"），不再收 boolean
                    aria-checked={store.scope() === opt.value ? "true" : "false"}
                  >
                    {t(opt.label)}
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
              aria-label={t("searchPage.sortAria")}
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
                      class={[
                        "[font-size:var(--fontSizeBase200)] transition-colors duration-[var(--durationFast)] focus-visible:outline-[var(--colorStrokeFocus2)] focus-visible:outline-2 focus-visible:outline-offset-1",
                        {
                          "text-[var(--colorBrandForeground1)] font-semibold":
                            store.toSorted() === opt.value,
                          "text-[var(--colorNeutralForeground3)] hover:text-[var(--colorNeutralForeground1)]":
                            store.toSorted() !== opt.value,
                        },
                      ]}

                      onClick={() => handleSortChange(opt.value)}
                    >
                      {t(opt.label)}
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
                void navigate(`/search?${buildSearchQuery()}`);
                // Solid 2.0：setKeyword 尚未提交（微任务批处理），executeSearch 同步读
                // keyword() 会拿到旧值静默失效——命令式边界，flush 后再执行。
                flush();
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
                paginationError={store.paginationError()}
              />
            </div>
          </Show>
        </div>
      </div>

      {/* ── 筛选面板（受控：状态在 searchStore，变更经 handleFiltersChange 即改即搜） ── */}
      <SearchFilterSheet
        isOpen={filterSheetOpen()}
        onClose={() => setFilterSheetOpen(false)}
        filters={() => store.filters()}
        scope={() => store.scope()}
        currentSort={() => store.toSorted()}
        onChange={handleFiltersChange}
      />

      {/* ── Back to top ── */}
      <Show when={showBackToTop()}>
        <button
          class="fixed z-20 bottom-24 right-4 w-11 h-11 flex items-center justify-center rounded-[var(--borderRadiusCircular)] bg-[var(--colorOverlaySurface)] backdrop-blur-[var(--backdropBlurDefault)] backdrop-saturate-[var(--backdropSaturateDefault)] border border-[var(--colorNeutralStroke2)] shadow-[var(--elevation4)] text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorOverlaySurfaceHover)] active:scale-90 transition-all duration-[var(--durationFast)]"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label={t("searchPage.backToTopAria")}
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
            <p class="text-[var(--colorNeutralForeground3)] text-sm">{t("searchPage.historyEmpty")}</p>
          </div>
        }
      >
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold text-[var(--colorNeutralForeground1)]">{t("searchPage.historyTitle")}</h3>
          <button class="history-clear-btn" onClick={props.onClear}>
            {t("searchPage.historyClear")}
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
                  aria-label={t("searchPage.removeHistoryAria", { word })}
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
