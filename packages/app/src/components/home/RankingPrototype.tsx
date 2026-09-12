/**
 * RankingPrototype — 排行榜融合形态 UI 原型（PROTOTYPE，throwaway：裁决后即弃，不入 main）。
 *
 * 问题：排行榜不新增首页分类时，三种「与推荐融合」的形态哪种观感/层级最好？
 * 变体（/home?variant= 切换；浮动底栏 ←/→ 或键盘方向键循环）：
 *   a  strip      — 横滑条注入：推荐 Feed 顶部「今日排行 Top 20」横滑缩略图（RelatedStripRow 同形态），尾部「全部」可进榜单页（A+C 组合预览）
 *   b  subtab     — 推荐 tab 子 tab 扩展：混合/插画/漫画/排行，排行=页内榜单列表（mode + 日期回看收在列表上方）
 *   c  entrypage  — 顶部一行 chips 入口 + 就地全屏榜单页（榜单头返回 + mode 切换 + 日期回看 + 榜单行）
 * 数据：mock——优先取推荐 Feed 已加载的真实插画倒序重排（真实图片密度下判定），不足 20 补 SVG 渐变占位；
 *       零新增网络请求、零持久化；榜单点击不跳转（只读原型）。
 * 门禁：仅 import.meta.env.DEV 且 URL 带 ?variant= 时渲染；变体仅挂推荐×插画面板，小说面板不受影响。
 */
import type { JSX } from "@solidjs/web";
import type { Component } from "solid-js";
import { createSignal, For, onSettled, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { PixivIllust } from "@/api/types";
import { t, type I18nKey } from "@/i18n";
import { illusts as recIllusts } from "@/stores/recommendedStore";
import { resolveImageUrl } from "@/utils/imageLoader";

// ── 变体注册 ──

type ProtoVariant = "a" | "b" | "c";

// i18n: 模块加载期不能调 t()，存 labelKey 渲染时翻译
const VARIANTS: { key: ProtoVariant; labelKey: I18nKey }[] = [
  { key: "a", labelKey: "ranking.protoVariantA" },
  { key: "b", labelKey: "ranking.protoVariantB" },
  { key: "c", labelKey: "ranking.protoVariantC" },
];

/** URL query → 变体（非法/缺省 = 不启用原型） */
export function parseProtoVariant(v: unknown): ProtoVariant | undefined {
  if (typeof v !== "string") return undefined;
  if (v === "a" || v === "b" || v === "c") return v;
  return undefined;
}

// ── mock 榜单数据 ──

interface RankEntry {
  rank: number;
  title: string;
  author: string;
  bookmarks: number;
  img: string;
}

/** SVG 渐变占位图（无真实 feed 数据时兜底；data URI，无网络依赖） */
function placeholderImg(seed: number): string {
  const hue = (seed * 47) % 360;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='hsl(${hue},45%,62%)'/>` +
    `<stop offset='1' stop-color='hsl(${(hue + 40) % 360},45%,38%)'/>` +
    `</linearGradient></defs>` +
    `<rect width='160' height='160' fill='url(%23g)'/>` +
    `<text x='50%' y='60%' font-size='52' font-family='sans-serif' fill='rgba(255,255,255,0.85)' text-anchor='middle'>${seed}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** 榜单 mock：推荐 Feed 真实插画倒序重排（与下方主列表视觉区分），不足补占位 */
function buildRankEntries(count: number): RankEntry[] {
  const pool = recIllusts();
  const out: RankEntry[] = [];
  for (let i = 0; i < count; i++) {
    const rank = i + 1;
    const src: PixivIllust | undefined = pool[pool.length - 1 - i];
    if (src) {
      const raw = src.image_urls.square_medium || src.image_urls.medium || src.image_urls.large;
      out.push({
        rank,
        title: src.title,
        author: src.user.name,
        bookmarks: src.total_bookmarks,
        img: raw ? resolveImageUrl(raw) : placeholderImg(rank),
      });
    } else {
      out.push({
        rank,
        // i18n: mock 文案构造时快照（瞬态）——真实作品标题/画师名本就不翻译，切语言后重挂载再生效
        title: t("ranking.mock.entryTitle", { rank }),
        author: t("ranking.mock.artistSample", { rank }),
        bookmarks: 20000 - rank * 437,
        img: placeholderImg(rank),
      });
    }
  }
  return out;
}

// ── 共用：榜单列表（mode 切换 + 日期回看 + 榜单行）──

// i18n: mode 名存 key 渲染时翻译；变体 C 入口 chips 复用前 4 个
const RANK_MODE_KEYS = [
  "ranking.mode.daily",
  "ranking.mode.weekly",
  "ranking.mode.monthly",
  "ranking.mode.newcomer",
  "ranking.mode.original",
  "ranking.mode.r18",
] as const satisfies readonly I18nKey[];

const ENTRY_MODE_KEYS = RANK_MODE_KEYS.slice(0, 4);

const fmtDate = (offset: number): string => {
  const d = new Date(Date.now() - offset * 86400000);
  return t("ranking.dateLong", {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
  });
};

const RankedList: Component<{ initialMode?: number }> = (props) => {
  const [mode, setMode] = createSignal(props.initialMode ?? 0);
  // 日期回看：offset = 往前推的天数（0 = 今日；未来无数据 → next 在 0 时禁用）
  const [offset, setOffset] = createSignal(0);
  const entries = buildRankEntries(20);

  return (
    <div>
      {/* mode 切换 chips（横滚） */}
      <div class="flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label={t("ranking.modeListAria")}>
        <For each={RANK_MODE_KEYS}>
          {(m, i) => (
            <button
              type="button"
              role="tab"
              aria-pressed={mode() === i() ? "true" : "false"}
              onClick={() => setMode(i())}
              class={[
                "h-10 flex-none cursor-pointer appearance-none rounded-full border border-[var(--colorNeutralStroke1)] px-4 outline-none transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] active:scale-95 [font-size:var(--fontSizeBase200)] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]",
                {
                  "bg-[var(--colorBrandBackground2)] font-semibold text-[var(--colorBrandForeground1)] border-transparent":
                    mode() === i(),
                  "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground1Hover)]":
                    mode() !== i(),
                },
              ]}
            >
              {t(m)}
            </button>
          )}
        </For>
      </div>

      {/* 日期回看行 */}
      <div class="flex items-center justify-center gap-2 py-2">
        <button
          type="button"
          aria-label={t("ranking.prevDayAria")}
          onClick={() => setOffset(offset() + 1)}
          class="flex h-10 w-10 cursor-pointer items-center justify-center appearance-none rounded-[var(--borderRadiusCircular)] border-none text-[var(--colorNeutralForeground2)] outline-none transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-95 focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M15 4 L7 12 L15 20"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <span class="flex items-center gap-2 [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)]">
          {fmtDate(offset())}
          <Show when={offset() === 0}>
            <span class="rounded-full bg-[var(--colorBrandBackground2)] px-2 py-0.5 font-semibold text-[var(--colorBrandForeground1)] [font-size:var(--fontSizeBase100)]">
              {t("ranking.today")}
            </span>
          </Show>
        </span>
        <button
          type="button"
          aria-label={t("ranking.nextDayAria")}
          disabled={offset() === 0}
          onClick={() => setOffset(Math.max(0, offset() - 1))}
          class="flex h-10 w-10 cursor-pointer items-center justify-center appearance-none rounded-[var(--borderRadiusCircular)] border-none text-[var(--colorNeutralForeground2)] outline-none transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-95 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M9 4 L17 12 L9 20"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* 榜单行（只读原型：不跳转详情） */}
      <div class="flex flex-col" role="list" aria-label={t("ranking.listAria")}>
        <For each={entries}>
          {(e) => (
            <div
              role="listitem"
              class="flex items-center gap-3 border-b border-[var(--colorNeutralStroke2)] px-4 py-2 transition-colors duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorNeutralBackground1Hover)]"
            >
              <span
                class={[
                  "w-8 flex-none text-center font-semibold [font-size:var(--fontSizeBase400)]",
                  {
                    "text-[var(--colorBrandForeground1)]": e.rank <= 3,
                    "text-[var(--colorNeutralForeground3)]": e.rank > 3,
                  },
                ]}
              >
                {e.rank}
              </span>
              <img
                src={e.img}
                alt=""
                loading="lazy"
                decoding="async"
                class="h-14 w-14 flex-none rounded-[var(--borderRadiusMedium)] object-cover select-none"
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase300)]">
                  {e.title}
                </span>
                <span class="block truncate text-[var(--colorNeutralForeground2)] [font-size:var(--fontSizeBase200)]">
                  {e.author}
                </span>
              </span>
              <span class="flex-none text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase200)]">
                ★{e.bookmarks.toLocaleString()}
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

// ── 共用：就地榜单页（C 的正文 / A「全部」的目标视图）──

const RankingPageView: Component<{ onBack: () => void; initialMode?: number }> = (props) => (
  <div class="pt-1">
    <div class="flex items-center gap-1 px-3 pt-2">
      <button
        type="button"
        aria-label={t("ranking.backToRecommendedAria")}
        onClick={props.onBack}
        class="flex h-10 w-10 flex-none cursor-pointer items-center justify-center appearance-none rounded-[var(--borderRadiusCircular)] border-none text-[var(--colorNeutralForeground2)] outline-none transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-95 focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M15 4 L7 12 L15 20"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <h2 class="font-semibold text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase400)]">
        {t("ranking.title")}
      </h2>
    </div>
    <RankedList initialMode={props.initialMode} />
  </div>
);

// ── 变体 A：横滑条注入（RelatedStripRow 同形态）──

const VariantA: Component<{ feed: JSX.Element; onOpenAll: () => void }> = (props) => {
  const [dismissed, setDismissed] = createSignal(false);
  const entries = buildRankEntries(20);
  return (
    <>
      <Show when={!dismissed()}>
        <div class="px-4 pt-3">
          <div class="rounded-[var(--borderRadiusLarge)] border border-[var(--colorNeutralStroke2)] bg-[var(--colorNeutralBackground2)] px-[var(--spacingHorizontalS)] py-[var(--spacingVerticalS)]">
            {/* 标题行 */}
            <div class="flex items-center justify-between">
              <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground2)]">
                {t("ranking.todayTop", { count: entries.length })}
              </p>
              <button
                type="button"
                aria-label={t("ranking.collapseAria")}
                onClick={() => setDismissed(true)}
                class="flex h-8 w-8 items-center justify-center rounded-[var(--borderRadiusCircular)] text-[var(--colorNeutralForeground3)] transition-colors duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4.397 4.553l.073-.084a.75.75 0 0 1 .977-.073l.084.073L12 10.94l6.47-6.47a.75.75 0 0 1 1.06 1.06L13.06 12l6.47 6.47a.75.75 0 0 1 .073.977l-.073.084a.75.75 0 0 1-.977.073l-.084-.073L12 13.06l-6.47 6.47a.75.75 0 0 1-1.06-1.06L10.94 12l-6.47-6.47a.75.75 0 0 1-.073-.977z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>
            {/* 横向缩略图 + 名次角标 */}
            <div class="mt-2 flex gap-2 overflow-x-auto pb-1" role="list" aria-label={t("ranking.todayListAria")}>
              <For each={entries}>
                {(e) => (
                  <div role="listitem" class="relative w-20 flex-shrink-0">
                    <img
                      src={e.img}
                      alt={t("ranking.entryAlt", { rank: e.rank, title: e.title })}
                      loading="lazy"
                      decoding="async"
                      class="h-20 w-20 rounded-[var(--borderRadiusMedium)] object-cover select-none"
                    />
                    <span
                      class={[
                        "absolute bottom-0 left-0 rounded-br-[var(--borderRadiusMedium)] rounded-tl-[var(--borderRadiusMedium)] px-1.5 py-0.5 font-semibold [font-size:var(--fontSizeBase100)]",
                        {
                          "bg-[var(--colorBrandForeground1)] text-[var(--colorNeutralForegroundOnBrand)]":
                            e.rank <= 3,
                          "bg-[var(--colorNeutralForeground2)] text-[var(--colorNeutralForegroundOnBrand)]":
                            e.rank > 3,
                        },
                      ]}
                    >
                      {e.rank}
                    </span>
                  </div>
                )}
              </For>
              {/* 尾部「全部」入口（A+C 组合预览） */}
              <button
                type="button"
                aria-label={t("ranking.viewAllAria")}
                onClick={props.onOpenAll}
                class="flex h-20 w-20 flex-none cursor-pointer flex-col items-center justify-center gap-1 appearance-none rounded-[var(--borderRadiusMedium)] border border-dashed border-[var(--colorNeutralStroke2)] text-[var(--colorNeutralForeground2)] outline-none transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] [font-size:var(--fontSizeBase200)] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
              >
                {t("ranking.viewAll")}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M9 4 L17 12 L9 20"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </Show>
      {props.feed}
    </>
  );
};

// ── 变体 B：推荐子 tab 扩展（混合/插画/漫画/排行）──

// i18n: 子 tab 名存 key 渲染时翻译
const SUB_TAB_KEYS = [
  "ranking.subtab.mixed",
  "ranking.subtab.illust",
  "ranking.subtab.manga",
  "ranking.subtab.rank",
] as const satisfies readonly I18nKey[];

const VariantB: Component<{ feed: JSX.Element }> = (props) => {
  const [sub, setSub] = createSignal(0);
  return (
    <>
      <div class="flex gap-2 overflow-x-auto px-4 pt-3" role="tablist" aria-label={t("ranking.subtabListAria")}>
        <For each={SUB_TAB_KEYS}>
          {(tabKey, i) => (
            <button
              type="button"
              role="tab"
              aria-pressed={sub() === i() ? "true" : "false"}
              onClick={() => setSub(i())}
              class={[
                "h-10 flex-none cursor-pointer appearance-none rounded-full border px-4 outline-none transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] active:scale-95 [font-size:var(--fontSizeBase200)] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]",
                {
                  "border-transparent bg-[var(--colorBrandBackground2)] font-semibold text-[var(--colorBrandForeground1)]":
                    sub() === i(),
                  "border-[var(--colorNeutralStroke1)] bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground1Hover)]":
                    sub() !== i(),
                },
              ]}
            >
              {t(tabKey)}
            </button>
          )}
        </For>
      </div>
      <Show when={sub() === 3} fallback={props.feed}>
        <RankedList />
      </Show>
    </>
  );
};

// ── 变体 C：顶部一行 chips 入口 + 就地榜单页（页面由外层 Show 承载）──

const VariantC: Component<{ feed: JSX.Element; onOpen: (mode: number) => void }> = (props) => (
  <>
    <div class="flex items-center gap-2 overflow-x-auto px-4 pt-3" aria-label={t("ranking.entryAria")}>
      <span class="flex flex-none items-center gap-1 font-semibold text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase300)]">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M3 8 L7 12 L12 5 L17 12 L21 8 L19 18 H5 Z" />
        </svg>
        {t("ranking.title")}
      </span>
      <For each={ENTRY_MODE_KEYS}>
        {(m, i) => (
          <button
            type="button"
            onClick={() => props.onOpen(i())}
            class="h-10 flex-none cursor-pointer appearance-none rounded-full border border-[var(--colorNeutralStroke1)] bg-[var(--colorNeutralBackground1)] px-4 text-[var(--colorNeutralForeground2)] outline-none transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorNeutralBackground1Hover)] hover:text-[var(--colorNeutralForeground1)] active:scale-95 [font-size:var(--fontSizeBase200)] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
          >
            {t(m)}
          </button>
        )}
      </For>
    </div>
    {props.feed}
  </>
);

// ── 浮动切换器（原型工具，非被评测设计的一部分）──

const PrototypeSwitcher: Component<{ current: ProtoVariant }> = (props) => {
  const navigate = useNavigate();
  const cycle = (dir: 1 | -1) => {
    const idx = VARIANTS.findIndex((v) => v.key === props.current);
    const next = VARIANTS[(idx + dir + VARIANTS.length) % VARIANTS.length];
    void navigate(`/home?variant=${next.key}`, { replace: true });
  };
  onSettled(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") cycle(-1);
      if (e.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const label = () => {
    const labelKey = VARIANTS.find((v) => v.key === props.current)?.labelKey;
    return labelKey ? t(labelKey) : "";
  };
  return (
    <div
      class="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[var(--colorNeutralForeground1)] px-2 py-1 text-[var(--colorNeutralForegroundOnBrand)] shadow-[var(--elevation8)]"
      role="group"
      aria-label={t("ranking.protoSwitchAria")}
    >
      <button
        type="button"
        aria-label={t("ranking.protoPrevAria")}
        onClick={() => cycle(-1)}
        class="flex h-9 w-9 cursor-pointer items-center justify-center appearance-none rounded-full border-none bg-transparent outline-none transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] active:scale-90 focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M15 4 L7 12 L15 20"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <span class="min-w-28 text-center [font-size:var(--fontSizeBase200)]">{label()}</span>
      <button
        type="button"
        aria-label={t("ranking.protoNextAria")}
        onClick={() => cycle(1)}
        class="flex h-9 w-9 cursor-pointer items-center justify-center appearance-none rounded-full border-none bg-transparent outline-none transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] active:scale-90 focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M9 4 L17 12 L9 20"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
  );
};

// ── 出口 ──

const RankingPrototype: Component<{ variant: ProtoVariant; feed: JSX.Element }> = (props) => {
  const [pageOpen, setPageOpen] = createSignal(false);
  const [pageMode, setPageMode] = createSignal(0);
  const openPage = (mode: number) => {
    setPageMode(mode);
    setPageOpen(true);
  };
  return (
    <>
      <Show
        when={!pageOpen()}
        fallback={<RankingPageView onBack={() => setPageOpen(false)} initialMode={pageMode()} />}
      >
        {props.variant === "a" ? (
          <VariantA feed={props.feed} onOpenAll={() => openPage(0)} />
        ) : props.variant === "b" ? (
          <VariantB feed={props.feed} />
        ) : (
          <VariantC feed={props.feed} onOpen={openPage} />
        )}
      </Show>
      <PrototypeSwitcher current={props.variant} />
    </>
  );
};

export default RankingPrototype;
