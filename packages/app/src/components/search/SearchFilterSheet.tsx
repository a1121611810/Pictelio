import { createSignal, For, Show, type Component } from "solid-js";
import {
  BOOKMARK_BANDS,
  countActiveFilters,
  DEFAULT_SEARCH_FILTERS,
  type AiOverride,
  type BookmarkBand,
  type PeriodPreset,
  type RatioPattern,
  type SearchFilters,
} from "@pictelio/search-core";

/**
 * 搜索筛选面板（webview 底部 Sheet，#477 拍板变体 A；ReaderSettingsSheet 范式）。
 *
 * 交互语义（#476 拍板，spec §5）：
 * - 即改即搜：每次变更立即经 onChange 上报（父级 450ms 去抖后重搜）；
 * - 再点已选项回默认 = 逐维可清；「清除全部」仅在有激活筛选时出现；
 * - scope=novel 时比例/分辨率置灰**不清值**（仅插画维度，切回恢复）；
 * - 热门排序时收藏数置灰 + 标注（popular-preview 服务端忽略区间，#478）；
 * - AI 覆盖行只管本次搜索（#479）：跟随设置/全部显示/隐藏 AI，无「仅看」档。
 * 受控组件：状态单点在父级 searchStore（本组件不持有筛选状态，自定义日期的
 * 输入中间态除外——挂载期快照初始化，Show 卸载即弃）。
 */

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** 当前筛选（受控） */
  filters: () => SearchFilters;
  /** 搜索范围：scope=novel 时插画专属维度置灰 */
  scope: () => "all" | "illust" | "novel";
  /** 排序：热门时收藏数置灰（命名避开 Array#sort 以免触发 oxlint 误报） */
  currentSort: () => "date_desc" | "date_asc" | "popular_desc";
  /** 即改即搜入口（父级 450ms 去抖） */
  onChange: (next: SearchFilters) => void;
}

const PERIOD_PRESET_OPTIONS: { value: "1d" | "1w" | "1m" | "6m" | "1y"; label: string }[] = [
  { value: "1d", label: "24 小时内" },
  { value: "1w", label: "一周内" },
  { value: "1m", label: "一个月内" },
  { value: "6m", label: "半年内" },
  { value: "1y", label: "一年内" },
];

const RATIO_OPTIONS: { value: RatioPattern; label: string }[] = [
  { value: "landscape", label: "横图" },
  { value: "portrait", label: "竖图" },
  { value: "square", label: "方图" },
];

const RES_OPTIONS: { value: number; label: string }[] = [
  { value: 1000, label: "≥1000px" },
  { value: 2000, label: "≥2000px" },
  { value: 3000, label: "≥3000px" },
];

const AI_OPTIONS: { value: AiOverride; label: string }[] = [
  { value: "follow", label: "跟随设置" },
  { value: "all", label: "全部显示" },
  { value: "hide", label: "隐藏 AI" },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 以下四个为模块级纯函数：单调用点内完成联合类型窄化（跨 accessor 调用 TS 无法窄化），
 * 且不闭包组件 props（oxlint perf：避免每次渲染重建）。 */
function isPreset(filters: SearchFilters, v: PeriodPreset): boolean {
  return filters.period.kind === "preset" && filters.period.preset === v;
}

function toggledPreset(filters: SearchFilters, v: PeriodPreset): SearchFilters["period"] {
  return isPreset(filters, v) ? { kind: "any" } : { kind: "preset", preset: v };
}

function isBand(filters: SearchFilters, band: BookmarkBand): boolean {
  const cur = filters.bookmark;
  return cur !== null && cur.min === band.min && cur.max === band.max;
}

function toggledBookmark(filters: SearchFilters, band: BookmarkBand): SearchFilters {
  const cur = filters.bookmark;
  const isSame = cur !== null && cur.min === band.min && cur.max === band.max;
  return { ...filters, bookmark: isSame ? null : { ...band } };
}

function FilterChip(props: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      class={[
        "px-3 py-1.5 rounded-[var(--borderRadiusMedium)] [font-size:var(--fontSizeBase200)] transition-all active:scale-95 appearance-none border-none outline-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-40",
        {
          "bg-[var(--colorBrandBackground)] text-[var(--colorNeutralForegroundOnBrand)] font-semibold":
            props.active,
          "bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground3)]":
            !props.active,
        },
      ]}
      disabled={props.disabled ?? false}
      aria-pressed={props.active ? "true" : "false"}
      onClick={() => {
        if (!props.disabled) props.onClick();
      }}
    >
      {props.label}
    </button>
  );
}

const SearchFilterSheet: Component<Props> = (props) => {
  // 自定义日期输入中间态：打开时从受控值初始化（Show 卸载即弃，重开重置）
  const initial = props.filters();
  const [customStart, setCustomStart] = createSignal(
    initial.period.kind === "custom" ? initial.period.start : "",
  );
  const [customEnd, setCustomEnd] = createSignal(
    initial.period.kind === "custom" ? initial.period.end : "",
  );

  const ratioDisabled = () => props.scope() === "novel";
  const bookmarkDisabled = () => props.currentSort() === "popular_desc";

  function setPeriod(next: SearchFilters["period"]): void {
    props.onChange({ ...props.filters(), period: next });
  }

  /** 自定义日期提交：双字段齐且有序才生效（spec Q3）；双清 → 回「不限」 */
  function commitCustomDates(s: string, e: string): void {
    if (DATE_RE.test(s) && DATE_RE.test(e) && s <= e) {
      props.onChange({ ...props.filters(), period: { kind: "custom", start: s, end: e } });
    } else if (s === "" && e === "") {
      props.onChange({ ...props.filters(), period: { kind: "any" } });
    }
  }

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50">
        {/* Scrim */}
        <div
          class="absolute inset-0"
          style="background-color:var(--colorScrim)"
          onClick={() => props.onClose()}
        />

        {/* Sheet panel — ReaderSettingsSheet 同款纯色卡片 */}
        <div
          class="absolute bottom-0 left-0 right-0 bg-[var(--colorNeutralBackground1)] rounded-t-[var(--borderRadius3XLarge)] shadow-[var(--elevation28)]"
          style="max-height:80vh;overflow-y:auto;animation:fluent-slide-down var(--durationGentle) var(--curveDecelerateMid) both"
        >
          {/* Drag handle */}
          <div class="flex justify-center pt-2 pb-1">
            <div class="w-10 h-1 rounded-[var(--borderRadiusCircular)] bg-[var(--colorNeutralStroke1)]" />
          </div>

          {/* Header：筛选 + 清除全部（仅激活时出现，#476 Q6）+ 关闭 */}
          <div class="flex items-center justify-between px-5 pt-1 pb-2">
            <h2 class="[font-size:var(--fontSizeBase500)] font-semibold text-[var(--colorNeutralForeground1)]">
              筛选
            </h2>
            <div class="flex items-center gap-2">
              <Show when={countActiveFilters(props.filters()) > 0}>
                <button
                  class="px-2 py-1 rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase200)] text-[var(--colorBrandForeground1)] hover:bg-[var(--colorNeutralBackground2)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer"
                  onClick={() => {
                    setCustomStart("");
                    setCustomEnd("");
                    props.onChange({ ...DEFAULT_SEARCH_FILTERS });
                  }}
                  aria-label="清除全部筛选"
                >
                  清除全部
                </button>
              </Show>
              <button
                class="w-8 h-8 flex items-center justify-center rounded-[var(--borderRadiusMedium)] text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorNeutralBackground2)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer"
                onClick={() => props.onClose()}
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
          </div>

          <fluent-divider style="margin-inline:var(--spacingHorizontalXL)"></fluent-divider>

          <div class="px-5 py-3 flex flex-col gap-5">
            {/* ── 期间 ── */}
            <div role="group" aria-label="投稿期间">
              <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground1)] mb-2">
                期间
              </p>
              <div class="flex flex-wrap gap-2">
                <FilterChip
                  label="全部"
                  active={props.filters().period.kind === "any"}
                  onClick={() => setPeriod({ kind: "any" })}
                />
                <For each={PERIOD_PRESET_OPTIONS}>
                  {(opt) => (
                    <FilterChip
                      label={opt.label}
                      active={isPreset(props.filters(), opt.value)}
                      onClick={() => setPeriod(toggledPreset(props.filters(), opt.value))}
                    />
                  )}
                </For>
                <span
                  class={[
                    "px-3 py-1.5 rounded-[var(--borderRadiusMedium)] [font-size:var(--fontSizeBase200)]",
                    {
                      "bg-[var(--colorBrandBackground)] text-[var(--colorNeutralForegroundOnBrand)] font-semibold":
                        props.filters().period.kind === "custom",
                      "bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground3)]":
                        props.filters().period.kind !== "custom",
                    },
                  ]}
                >
                  自定义
                </span>
              </div>
              {/* 自定义起止（YYYY-MM-DD）：双字段齐且有序才生效（spec Q3 生效时机） */}
              <div class="flex items-center gap-2 mt-2">
                <input
                  type="date"
                  class="px-2 py-1 rounded-[var(--borderRadiusSmall)] border border-[var(--colorNeutralStroke2)] bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)]"
                  value={customStart()}
                  onInput={(e) => {
                    setCustomStart(e.currentTarget.value);
                    commitCustomDates(e.currentTarget.value, customEnd());
                  }}
                  aria-label="开始日期"
                />
                <span class="text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase200)]">
                  →
                </span>
                <input
                  type="date"
                  class="px-2 py-1 rounded-[var(--borderRadiusSmall)] border border-[var(--colorNeutralStroke2)] bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)]"
                  value={customEnd()}
                  onInput={(e) => {
                    setCustomEnd(e.currentTarget.value);
                    commitCustomDates(customStart(), e.currentTarget.value);
                  }}
                  aria-label="结束日期"
                />
              </div>
            </div>

            {/* ── 收藏数（热门下置灰：popular-preview 服务端忽略区间，#478） ── */}
            <div role="group" aria-label="收藏数">
              <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground1)] mb-2">
                收藏数
              </p>
              <div class="flex flex-wrap gap-2">
                <FilterChip
                  label="不限"
                  active={props.filters().bookmark === null}
                  disabled={bookmarkDisabled()}
                  onClick={() => props.onChange({ ...props.filters(), bookmark: null })}
                />
                <For each={BOOKMARK_BANDS}>
                  {(band) => (
                    <FilterChip
                      // 官方带宽是闭区间（iOS picker 同款区间文案）；无上界档用「1000+」
                      label={band.max === null ? `${band.min}+` : `${band.min}-${band.max}`}
                      active={isBand(props.filters(), band)}
                      disabled={bookmarkDisabled()}
                      onClick={() => props.onChange(toggledBookmark(props.filters(), band))}
                    />
                  )}
                </For>
              </div>
              <Show when={bookmarkDisabled()}>
                <p class="mt-1.5 [font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)]">
                  热门榜不支持按收藏数筛（切回最新/最早恢复）
                </p>
              </Show>
            </div>

            {/* ── 比例（仅插画：scope=novel 置灰不清值，#476 Q4） ── */}
            <div role="group" aria-label="比例">
              <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground1)] mb-2">
                比例
                <span class="ml-2 [font-size:var(--fontSizeBase100)] font-normal text-[var(--colorBrandForeground1)] border border-[var(--colorBrandStroke1)] rounded-[var(--borderRadiusSmall)] px-1">
                  仅插画
                </span>
              </p>
              <div class="flex flex-wrap gap-2">
                <FilterChip
                  label="全部"
                  active={props.filters().ratio === null}
                  disabled={ratioDisabled()}
                  onClick={() => props.onChange({ ...props.filters(), ratio: null })}
                />
                <For each={RATIO_OPTIONS}>
                  {(opt) => (
                    <FilterChip
                      label={opt.label}
                      active={props.filters().ratio === opt.value}
                      disabled={ratioDisabled()}
                      onClick={() =>
                        props.onChange({
                          ...props.filters(),
                          ratio: props.filters().ratio === opt.value ? null : opt.value,
                        })
                      }
                    />
                  )}
                </For>
              </div>
              <Show when={ratioDisabled()}>
                <p class="mt-1.5 [font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)]">
                  切到「插画」范围后可用（已设的值会保留）
                </p>
              </Show>
            </div>

            {/* ── 分辨率（仅插画：同上） ── */}
            <div role="group" aria-label="分辨率">
              <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground1)] mb-2">
                分辨率
                <span class="ml-2 [font-size:var(--fontSizeBase100)] font-normal text-[var(--colorBrandForeground1)] border border-[var(--colorBrandStroke1)] rounded-[var(--borderRadiusSmall)] px-1">
                  仅插画
                </span>
              </p>
              <div class="flex flex-wrap gap-2">
                <FilterChip
                  label="不限"
                  active={props.filters().minPixels === null}
                  disabled={ratioDisabled()}
                  onClick={() => props.onChange({ ...props.filters(), minPixels: null })}
                />
                <For each={RES_OPTIONS}>
                  {(opt) => (
                    <FilterChip
                      label={opt.label}
                      active={props.filters().minPixels === opt.value}
                      disabled={ratioDisabled()}
                      onClick={() =>
                        props.onChange({
                          ...props.filters(),
                          minPixels: props.filters().minPixels === opt.value ? null : opt.value,
                        })
                      }
                    />
                  )}
                </For>
              </div>
            </div>

            {/* ── AI 作品（#479：只管本次搜索；「仅看」仅经设置，面板不设档） ── */}
            <div role="group" aria-label="AI 作品">
              <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground1)] mb-2">
                AI 作品
              </p>
              <div class="flex flex-wrap gap-2">
                <For each={AI_OPTIONS}>
                  {(opt) => (
                    <FilterChip
                      label={opt.label}
                      active={props.filters().aiOverride === opt.value}
                      onClick={() => props.onChange({ ...props.filters(), aiOverride: opt.value })}
                    />
                  )}
                </For>
              </div>
              <p class="mt-1.5 [font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)]">
                只影响本次搜索，不改动设置里的 AI 偏好
              </p>
            </div>
          </div>

          {/* Footer padding */}
          <div class="h-4" />
        </div>
      </div>
    </Show>
  );
};

export default SearchFilterSheet;
