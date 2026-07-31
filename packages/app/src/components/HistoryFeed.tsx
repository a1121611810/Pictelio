import type { Component } from "solid-js";
import { useLiveQuery, eq, ilike, gte, lte, and } from "@tanstack/solid-db";
import { historyCollection, removeHistoryEntry, clearAllHistory } from "@/stores/historyStore";
import { user } from "@/stores/authStore";
import { showR18, showR18G } from "@/stores/settingsStore";
import { resolveImageUrl } from "@/utils/imageLoader";
import FluentIcon from "@/components/ui/FluentIcon";

type TimelineItem =
  | { type: "header"; dateLabel: string; id: string }
  | { type: "entry"; entry: import("@/stores/historyStore").HistoryEntry; id: string };

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function buildTimeline(entries: import("@/stores/historyStore").HistoryEntry[]): TimelineItem[] {
  if (entries.length === 0) return [];
  const sorted = entries.toSorted((a, b) => b.visitedAt - a.visitedAt);
  const result: TimelineItem[] = [];
  let currentDate = "";
  for (const entry of sorted) {
    const dateLabel = formatDate(entry.visitedAt);
    if (dateLabel !== currentDate) {
      currentDate = dateLabel;
      result.push({ type: "header", dateLabel, id: `header-${dateLabel}` });
    }
    result.push({ type: "entry", entry, id: `entry-${entry.key}` });
  }
  return result;
}

function dateToStartTs(dateStr: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  return isNaN(d.getTime()) ? null : d.getTime();
}

function dateToEndTs(dateStr: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T23:59:59.999");
  return isNaN(d.getTime()) ? null : d.getTime();
}

function highlightText(text: string, query: string): string | ReturnType<typeof markHighlight> {
  if (!query || !text) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return text;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return markHighlight(before, match, after);
}

function markHighlight(before: string, match: string, after: string) {
  return (
    <>
      {before}
      <mark class="history-search-highlight">{match}</mark>
      {after}
    </>
  );
}

const HistoryFeed: Component = () => {
  const navigate = useNavigate();
  const currentUser = user;
  const [confirmingClear, setConfirmingClear] = createSignal(false);

  const [searchInput, setSearchInput] = createSignal("");
  const [searchQuery, setSearchQuery] = createSignal("");

  createEffect(() => {
    const value = searchInput();
    const timer = setTimeout(() => setSearchQuery(value), 300);
    onCleanup(() => clearTimeout(timer));
  });

  const [dateStartStr, setDateStartStr] = createSignal("");
  const [dateEndStr, setDateEndStr] = createSignal("");

  const startTimestamp = createMemo(() => dateToStartTs(dateStartStr()));
  const endTimestamp = createMemo(() => dateToEndTs(dateEndStr()));

  const query = useLiveQuery((q) => {
    const search = searchQuery();
    const tsStart = startTimestamp();
    const tsEnd = endTimestamp();
    const uid = String(currentUser()?.id ?? "");

    return q
      .from({ h: historyCollection })
      .where(({ h }) => {
        const conds = [eq(h.userId, uid)];
        if (search) conds.push(ilike(h.title, `%${search}%`));
        if (tsStart !== null) conds.push(gte(h.visitedAt, tsStart));
        if (tsEnd !== null) conds.push(lte(h.visitedAt, tsEnd));
        let expr = conds[0];
        for (let i = 1; i < conds.length; i++) {
          expr = and(expr, conds[i]);
        }
        return expr;
      })
      .orderBy(({ h }) => h.visitedAt, "desc");
  });

  const hasActiveFilters = createMemo(
    () =>
      searchInput() !== "" || searchQuery() !== "" || dateStartStr() !== "" || dateEndStr() !== "",
  );

  const activeFilterCount = createMemo(() => {
    let count = 0;
    if (searchQuery() !== "") count++;
    if (dateStartStr() !== "") count++;
    if (dateEndStr() !== "") count++;
    return count;
  });

  function clearFilters() {
    setSearchInput("");
    setSearchQuery("");
    setDateStartStr("");
    setDateEndStr("");
  }

  const items = createMemo<TimelineItem[]>(() => {
    const data = query() as import("@/stores/historyStore").HistoryEntry[] | undefined;
    if (!data || data.length === 0) return [];
    return buildTimeline(data);
  });

  const handleClearAll = async () => {
    if (!confirmingClear()) {
      setConfirmingClear(true);
      setTimeout(() => setConfirmingClear(false), 3000);
      return;
    }
    await clearAllHistory();
    setConfirmingClear(false);
  };

  return (
    <div class="flex flex-col h-screen bg-[var(--colorNeutralBackground2)]">
      {/* Header */}
      <header class="flex items-center justify-between px-4 pt-4 pb-2">
        <h1
          style={{
            "font-size": "var(--fontSizeBase500)",
            "font-weight": "var(--fontWeightSemibold)",
            color: "var(--colorNeutralForeground1)",
          }}
        >
          浏览历史
        </h1>
        <Show when={items().length > 0} fallback={null}>
          <button
            class="history-clear-btn"
            classList={{ "history-clear-btn-confirm": confirmingClear() }}
            onClick={handleClearAll}
            aria-label="清空浏览历史"
          >
            {confirmingClear() ? "确认清空？" : "清空"}
          </button>
        </Show>
      </header>

      {/* Search & Filter bar */}
      <div class="px-4 pb-1 flex flex-col gap-1">
        <div class="history-search-bar">
          <FluentIcon name="search" size={18} />
          <input
            type="search"
            value={searchInput()}
            onInput={(e) => setSearchInput(e.currentTarget.value)}
            placeholder="搜索标题..."
            aria-label="搜索历史记录标题"
            class="history-search-input"
          />
          <Show when={searchInput() !== ""}>
            <button
              onClick={() => setSearchInput("")}
              class="flex items-center justify-center min-w-10 min-h-10 appearance-none border-none outline-none cursor-pointer rounded-[var(--borderRadiusSmall)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground2)] hover:text-[var(--colorNeutralForeground1)] active:scale-[0.95] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)] transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)]"
              aria-label="清除搜索"
            >
              <FluentIcon name="dismiss" size={16} />
            </button>
          </Show>
        </div>

        <div class="flex items-center gap-2 px-1 py-1.5">
          <label class="flex items-center gap-1 text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase200)] whitespace-nowrap">
            从
            <input
              type="date"
              value={dateStartStr()}
              onInput={(e) => setDateStartStr(e.currentTarget.value)}
              class="history-date-input"
              aria-label="开始日期"
            />
          </label>
          <span class="text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase200)]">
            —
          </span>
          <label class="flex items-center gap-1 text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase200)] whitespace-nowrap">
            至
            <input
              type="date"
              value={dateEndStr()}
              onInput={(e) => setDateEndStr(e.currentTarget.value)}
              class="history-date-input"
              aria-label="结束日期"
            />
          </label>
          <Show when={hasActiveFilters()}>
            <button
              onClick={clearFilters}
              class="ml-auto text-[var(--colorBrandForeground1)] [font-size:var(--fontSizeBase200)] font-medium appearance-none border-none bg-transparent cursor-pointer hover:underline active:opacity-70 focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
              aria-label="清除筛选条件"
            >
              清除筛选
            </button>
          </Show>
        </div>
      </div>

      {/* Content */}
      <Show
        when={!query.isLoading}
        fallback={
          <div class="flex-1 flex flex-col items-center justify-center gap-3">
            <div class="text-[var(--colorNeutralForeground3)] animate-spin">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="2"
                  opacity="0.2"
                />
                <path
                  d="M12 2a10 10 0 0 1 10 10"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              </svg>
            </div>
            <span
              style={{
                "font-size": "var(--fontSizeBase300)",
                color: "var(--colorNeutralForeground3)",
              }}
            >
              加载历史记录...
            </span>
          </div>
        }
      >
        <Show
          when={items().length > 0}
          fallback={
            <div class="flex-1 flex flex-col items-center justify-center gap-3">
              <Show when={hasActiveFilters()}>
                <FluentIcon name="search" size={48} />
                <div class="flex flex-col items-center gap-1">
                  <span
                    style={{
                      "font-size": "var(--fontSizeBase300)",
                      color: "var(--colorNeutralForeground2)",
                    }}
                  >
                    未找到匹配的记录
                  </span>
                  <button
                    onClick={clearFilters}
                    class="text-[var(--colorBrandForeground1)] [font-size:var(--fontSizeBase200)] font-medium appearance-none border-none bg-transparent cursor-pointer hover:underline active:opacity-70 focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
                  >
                    清除筛选条件
                  </button>
                </div>
              </Show>
              <Show when={!hasActiveFilters()}>
                <FluentIcon name="history" size={48} />
                <div class="flex flex-col items-center gap-1">
                  <span
                    style={{
                      "font-size": "var(--fontSizeBase300)",
                      color: "var(--colorNeutralForeground2)",
                    }}
                  >
                    暂无浏览记录
                  </span>
                  <span
                    style={{
                      "font-size": "var(--fontSizeBase200)",
                      color: "var(--colorNeutralForeground3)",
                    }}
                  >
                    浏览过的作品会出现在这里
                  </span>
                </div>
              </Show>
            </div>
          }
        >
          <div
            class="px-4 pb-1"
            style={{
              "font-size": "var(--fontSizeBase200)",
              color: "var(--colorNeutralForeground3)",
            }}
          >
            <Show when={activeFilterCount() > 0}>共 {items().length} 条结果</Show>
          </div>

          <div class="flex-1 overflow-auto px-4 pb-20">
            {items().map((item) => {
              if (item.type === "header") {
                return (
                  <div
                    class="mt-2 mb-1"
                    style={{
                      "font-size": "var(--fontSizeBase200)",
                      color: "var(--colorNeutralForeground3)",
                      "font-weight": "var(--fontWeightSemibold)",
                    }}
                  >
                    {item.dateLabel}
                  </div>
                );
              }
              const e = item.entry;
              const hideByR18 =
                (e.xRestrict === 1 && !showR18()) || (e.xRestrict === 2 && !showR18G());
              return (
                <div
                  class="surface-card flex items-center gap-[var(--spacingHorizontalM)] p-[var(--spacingHorizontalM)] mt-[var(--spacingVerticalM)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--colorStrokeFocus2)] focus-visible:outline-offset-2 transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)]"
                  onClick={() => {
                    void navigate(e.type === "illust" ? `/illust/${e.id}` : `/novel/${e.id}`);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      void navigate(e.type === "illust" ? `/illust/${e.id}` : `/novel/${e.id}`);
                    }
                  }}
                >
                  <div
                    class="relative flex-shrink-0 w-10 h-10 rounded-[var(--borderRadiusMedium)] overflow-hidden"
                    style={{ background: "var(--colorNeutralBackground2)" }}
                  >
                    {e.thumbnailUrl && (
                      <img
                        src={resolveImageUrl(e.thumbnailUrl)}
                        alt={e.title}
                        class={`w-full h-full object-cover ${hideByR18 ? "filter blur-[8px]" : ""}`}
                      />
                    )}
                    {hideByR18 && (
                      <span
                        class="absolute flex items-center justify-center rounded-[var(--borderRadiusSmall)]"
                        style={{
                          top: "var(--strokeWidthThick)",
                          left: "var(--strokeWidthThick)",
                          "font-size": "var(--fontSizeBase100)",
                          padding: "1px 3px",
                          background: "var(--colorStatusDangerBackground2)",
                          color: "var(--colorStatusDangerForeground1)",
                          "font-weight": "var(--fontWeightBold)",
                        }}
                      >
                        {e.xRestrict === 2 ? "R18G" : "R-18"}
                      </span>
                    )}
                  </div>
                  <div class="flex-1 min-w-0">
                    <div
                      class="truncate"
                      style={{
                        "font-size": "var(--fontSizeBase300)",
                        "line-height": "var(--lineHeightBase300)",
                        color: "var(--colorNeutralForeground1)",
                      }}
                    >
                      {highlightText(e.title, searchQuery())}
                    </div>
                    <div
                      class="mt-0.5 flex items-center gap-1"
                      style={{
                        "font-size": "var(--fontSizeBase200)",
                        "line-height": "var(--lineHeightBase200)",
                        color: "var(--colorNeutralForeground3)",
                      }}
                    >
                      <Show when={e.authorId} fallback={<span>{e.userName}</span>}>
                        <button
                          class="bg-transparent border-none p-0 cursor-pointer text-[var(--colorBrandForeground1)] hover:underline truncate min-h-[40px] active:scale-[0.98] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            void navigate(`/user/${e.authorId}`);
                          }}
                        >
                          {e.userName}
                        </button>
                      </Show>
                      <span>
                        · {formatTime(e.visitedAt)} · {e.visitCount}次
                      </span>
                    </div>
                  </div>
                  <button
                    class="history-delete-btn"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      removeHistoryEntry(e.key);
                    }}
                    aria-label={`删除 ${e.title}`}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </Show>
      </Show>
    </div>
  );
};

export default HistoryFeed;
