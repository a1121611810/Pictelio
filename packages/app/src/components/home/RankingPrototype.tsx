/**
 * RankingPrototype — 排行榜「范围层级」UI 原型（PROTOTYPE，throwaway：裁决后即弃，不入 main）。
 *
 * 问题：入口形态已定（方案 A 横滑条注入）。本轮的三个变体是**范围层级**——
 *       排行榜这件事做到哪一步，各自的实际观感与代价是什么？
 * 变体（/home?variant= 切换；浮动底栏 ←/→ 或键盘方向键循环）：
 *   s1  entryonly — 只做入口：横滑条看今日 Top 20，点图进作品详情；**无榜单页**（无「全部」入口、
 *                   无维度切换、无日期回看）
 *   s2  basicpage — 入口 + 简化榜单页：可切维度（日/周/月/新人/原创/R-18），仍只能看今日
 *   s3  fullpage  — 入口 + 完整榜单页：维度切换 + 按日期回看（今日标记、未来日期禁用）
 * 入口（三个变体完全一致）：推荐 Feed 顶部横滑条（RelatedStripRow 同形态）。
 * 数据：mock——优先取推荐 Feed 已加载的真实插画倒序重排（真实图片密度下判定），不足 20 补 SVG 渐变占位；
 *       零新增网络请求、零持久化；榜单点击不跳转（只读原型）。
 * 门禁：仅 import.meta.env.DEV 且 URL 带 ?variant= 时渲染；变体仅挂推荐×插画面板，小说面板不受影响。
 */
import type { JSX } from "@solidjs/web";
import type { Component } from "solid-js";
import { createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { PixivIllust } from "@/api/types";
import { t, type I18nKey } from "@/i18n";
import { illusts as recIllusts } from "@/stores/recommendedStore";
import { resolveImageUrl } from "@/utils/imageLoader";

// ── 变体注册（范围层级）──

type ProtoVariant = "s1" | "s2" | "s3";

// i18n: 模块加载期不能调 t()，存 labelKey 渲染时翻译
const VARIANTS: { key: ProtoVariant; labelKey: I18nKey; hintKey: I18nKey }[] = [
  { key: "s1", labelKey: "ranking.protoScopeS1", hintKey: "ranking.scopeHintS1" },
  { key: "s2", labelKey: "ranking.protoScopeS2", hintKey: "ranking.scopeHintS2" },
  { key: "s3", labelKey: "ranking.protoScopeS3", hintKey: "ranking.scopeHintS3" },
];

/** URL query → 变体（非法/缺省 = 不启用原型） */
export function parseProtoVariant(v: unknown): ProtoVariant | undefined {
  if (typeof v !== "string") return undefined;
  if (v === "s1" || v === "s2" || v === "s3") return v;
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

// ── 共用：榜单列表（维度切换 + 可选日期回看 + 榜单行）──

const RANK_MODE_KEYS = [
  "ranking.mode.daily",
  "ranking.mode.weekly",
  "ranking.mode.monthly",
  "ranking.mode.newcomer",
  "ranking.mode.original",
  "ranking.mode.r18",
] as const satisfies readonly I18nKey[];

const fmtDate = (offset: number): string => {
  const d = new Date(Date.now() - offset * 86400000);
  return t("ranking.dateLong", {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
  });
};

/** 榜单列表。showDate=false（S2）= 只有维度切换，永远看今日；true（S3）= 多一行日期回看。 */
const RankedList: Component<{ initialMode?: number; showDate: boolean }> = (props) => {
  // Solid 2 STRICT_READ_UNTRACKED 处方：body 内一次性读 props 用 untrack 显式快照（SideNavShell 同款）
  const [mode, setMode] = createSignal(untrack(() => props.initialMode ?? 0));
  // 日期回看：offset = 往前推的天数（0 = 今日；未来无数据 → next 在 0 时禁用）
  const [offset, setOffset] = createSignal(0);
  // memo = 追踪作用域：feed store 深层代理的读取必须留在追踪内（body 直读会刷数千条警告）；
  // 附带收益：feed 后到时榜单自动从占位图换成真实作品
  const entries = createMemo(() => buildRankEntries(20));

  return (
    <div>
      {/* 维度切换 chips（窄屏换行展示，不横滚裁切） */}
      <div
        class="flex flex-wrap gap-2 px-4 pb-1"
        role="tablist"
        aria-label={t("ranking.modeListAria")}
      >
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

      {/* 日期回看行：仅 S3（完整榜单页）有；S2 不渲染此块 = 只能看今日 */}
      <Show when={props.showDate}>
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
      </Show>

      {/* 榜单行（只读原型：不跳转详情） */}
      <div class="flex flex-col" role="list" aria-label={t("ranking.listAria")}>
        <For each={entries()}>
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
                class="h-14 w-14 flex-none rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground3)] object-cover select-none"
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

// ── 共用：就地榜单页（S2/S3 的「全部」目标视图）──

const RankingPageView: Component<{
  onBack: () => void;
  initialMode?: number;
  showDate: boolean;
}> = (props) => (
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
    <RankedList initialMode={props.initialMode} showDate={props.showDate} />
  </div>
);

// ── 入口（三变体一致）：横滑条注入（RelatedStripRow 同形态）──

/** showAll=false（S1）= 不渲染「全部」入口与标题行的跳转——排行榜到此为止，点图只进作品详情。 */
const RankingStripEntry: Component<{
  feed: JSX.Element;
  showAll: boolean;
  onOpenAll: () => void;
}> = (props) => {
  const [dismissed, setDismissed] = createSignal(false);
  // memo = 追踪作用域（body 直读 feed store 深层代理会刷 STRICT_READ_UNTRACKED 警告）
  const entries = createMemo(() => buildRankEntries(20));
  return (
    <>
      <Show when={!dismissed()}>
        <div class="px-4 pt-3">
          <div class="rounded-[var(--borderRadiusLarge)] border border-[var(--colorNeutralStroke2)] bg-[var(--colorNeutralBackground2)] px-[var(--spacingHorizontalS)] py-[var(--spacingVerticalS)]">
            {/* 标题行：左标题 + 右「全部（仅 S2/S3）/ 收起」 */}
            <div class="flex items-center justify-between">
              <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground2)]">
                {t("ranking.todayTop", { count: entries().length })}
              </p>
              <div class="flex items-center">
                <Show when={props.showAll}>
                  <button
                    type="button"
                    aria-label={t("ranking.viewAllAria")}
                    onClick={props.onOpenAll}
                    class="flex h-8 cursor-pointer items-center gap-0.5 appearance-none rounded-[var(--borderRadiusMedium)] border-none bg-transparent px-2 text-[var(--colorBrandForeground1)] outline-none transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] [font-size:var(--fontSizeBase200)] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
                  >
                    {t("ranking.viewAll")}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M9 4 L17 12 L9 20"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </button>
                </Show>
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
            </div>
            {/* 横向缩略图 + 名次角标 */}
            <div
              class="mt-2 flex gap-2 overflow-x-auto pb-1"
              role="list"
              aria-label={t("ranking.todayListAria")}
            >
              <For each={entries()}>
                {(e) => (
                  <div role="listitem" class="relative w-20 flex-shrink-0">
                    <img
                      src={e.img}
                      alt={t("ranking.entryAlt", { rank: e.rank, title: e.title })}
                      loading="lazy"
                      decoding="async"
                      class="h-20 w-20 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground3)] object-cover select-none"
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
            </div>
          </div>
        </div>
      </Show>
      {props.feed}
    </>
  );
};

// ── 浮动切换器 + 范围说明（原型工具，非被评测设计的一部分）──

const PrototypeSwitcher: Component<{ current: ProtoVariant }> = (props) => {
  const navigate = useNavigate();
  const cycle = (dir: 1 | -1) => {
    const idx = VARIANTS.findIndex((v) => v.key === props.current);
    const next = VARIANTS[(idx + dir + VARIANTS.length) % VARIANTS.length];
    void navigate(`/home?variant=${next.key}`, { replace: true });
  };
  onSettled(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))
        return;
      if (e.key === "ArrowLeft") cycle(-1);
      if (e.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const meta = () => VARIANTS.find((v) => v.key === props.current);
  return (
    <div
      class="fixed bottom-4 left-1/2 z-50 flex w-[min(92vw,40rem)] -translate-x-1/2 flex-col items-center gap-1 rounded-[var(--borderRadiusLarge)] bg-[var(--colorNeutralForeground1)] px-2 py-1.5 text-[var(--colorNeutralForegroundOnBrand)] shadow-[var(--elevation8)]"
      role="group"
      aria-label={t("ranking.protoSwitchAria")}
    >
      <div class="flex items-center gap-1">
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
        <span class="min-w-32 text-center [font-size:var(--fontSizeBase200)]">
          {meta() ? t(meta()!.labelKey) : ""}
        </span>
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
      {/* 范围说明：本变体给了什么 / 少了什么（原型注解，非界面设计的一部分） */}
      <p class="text-center [font-size:var(--fontSizeBase100)] leading-snug opacity-80">
        {meta() ? t(meta()!.hintKey) : ""}
      </p>
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
  // S1 无榜单页：入口不渲染「全部」，pageOpen 永不置位
  const hasPage = () => props.variant !== "s1";
  return (
    <>
      <Show
        when={pageOpen()}
        fallback={
          <RankingStripEntry feed={props.feed} showAll={hasPage()} onOpenAll={() => openPage(0)} />
        }
      >
        <RankingPageView
          onBack={() => setPageOpen(false)}
          initialMode={pageMode()}
          showDate={props.variant === "s3"}
        />
      </Show>
      <PrototypeSwitcher current={props.variant} />
    </>
  );
};

export default RankingPrototype;
