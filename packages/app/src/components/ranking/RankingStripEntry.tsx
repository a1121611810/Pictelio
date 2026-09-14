/**
 * RankingStripEntry — 推荐流顶部排行榜入口横滑条（spec docs/specs/ranking.md §5.1/§5.2；#516）。
 *
 * - 受设置开关 rankingEntry() 控制：关闭时不创建数据源、不发请求（Show 惰性建子）
 * - 固定「日榜 · 今日」：createRankingStore() 默认 (daily, today)，与榜单页共用同一 query key，
 *   因此进榜单页不产生第二次首屏请求
 * - 收起仅本次挂载有效（不持久化）；refreshEpoch 变化（下拉刷新）或重进页面即恢复
 * - 失败（无数据 + 有 error）隐藏入口并 warn（不留永久骨架，禁静默降级）
 */
import type { Component } from "solid-js";
import { For, Show, createEffect, createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { createRankingStore } from "@/stores/rankingStore";
import { rankingEntry } from "@/stores/settingsStore";
import { rankingCover } from "@/components/ranking/RankingRowCard";
import SkeletonShimmer from "@/components/SkeletonShimmer";
import FluentIcon from "@/components/ui/FluentIcon";
import { resolveImageUrl } from "@/utils/imageLoader";
import { t } from "@/i18n";
import { createDeferredMount } from "@/primitives/createDeferredMount";

/** 入口横滑条展示数（spec §3.4：取首屏 30 条的前 20） */
const STRIP_LIMIT = 20;

interface RankingStripEntryProps {
  /** 宿主 Feed 的刷新代：变化即恢复被收起的入口（spec §5.1「刷新恢复」） */
  refreshEpoch?: number;
}

const SkeletonStrip: Component = () => (
  <div class="mt-2 flex gap-2 pb-1" aria-hidden="true" data-testid="ranking-strip-skeleton">
    <For each={Array.from({ length: 6 })}>
      {() => <SkeletonShimmer class="h-20 w-20 flex-none rounded-[var(--borderRadiusMedium)]" />}
    </For>
  </div>
);

const StripInner: Component<RankingStripEntryProps> = (props) => {
  const navigate = useNavigate();
  const store = createRankingStore();
  const [dismissed, setDismissed] = createSignal(false);
  const items = () => store.entries().slice(0, STRIP_LIMIT);
  const failed = () => store.error() != null && items().length === 0;

  // 宿主下拉刷新（refreshEpoch 变化）→ 恢复入口；首次 apply 只记录基线，不写 signal
  let lastEpoch: number | undefined;
  createEffect(
    () => props.refreshEpoch,
    (epoch) => {
      if (lastEpoch !== undefined && epoch !== lastEpoch) setDismissed(false);
      lastEpoch = epoch;
    },
  );

  // 失败可见化（禁静默降级；入口失败即隐藏，不留永久骨架）
  createEffect(
    () => failed(),
    (isFailed) => {
      if (isFailed) {
        console.warn("[RankingStripEntry] 排行榜入口加载失败，隐藏入口", store.error());
      }
    },
  );

  onSettled(() => {
    void store
      .ensureLoaded()
      .catch((e: unknown) => console.warn("[RankingStripEntry] 排行榜入口加载失败", e));
  });

  return (
    <Show when={!dismissed() && !failed()}>
      <div class="px-4 pt-3">
        <div class="rounded-[var(--borderRadiusLarge)] border border-[var(--colorNeutralStroke2)] bg-[var(--colorNeutralBackground2)] px-[var(--spacingHorizontalS)] py-[var(--spacingVerticalS)]">
          <div class="flex items-center justify-between">
            <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground2)]">
              {t("ranking.entry.title", { count: STRIP_LIMIT })}
            </p>
            <div class="flex items-center">
              <button
                type="button"
                aria-label={t("ranking.entry.viewAllAria")}
                onClick={() => void navigate("/ranking")}
                class="flex h-10 cursor-pointer appearance-none items-center gap-0.5 rounded-[var(--borderRadiusMedium)] border-none bg-transparent px-2 text-[var(--colorBrandForeground1)] outline-none transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-98 [font-size:var(--fontSizeBase200)] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
              >
                {t("ranking.entry.viewAll")}
                <FluentIcon name="chevronRight" size={12} />
              </button>
              <button
                type="button"
                aria-label={t("ranking.entry.collapseAria")}
                onClick={() => setDismissed(true)}
                class="flex h-10 w-10 items-center justify-center rounded-[var(--borderRadiusCircular)] text-[var(--colorNeutralForeground3)] transition-colors duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-98 focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
              >
                <FluentIcon name="dismiss" size={16} />
              </button>
            </div>
          </div>
          <Show when={items().length > 0} fallback={<SkeletonStrip />}>
            <div
              class="mt-2 flex gap-2 overflow-x-auto pb-1"
              role="list"
              aria-label={t("ranking.entry.stripAria")}
            >
              <For each={items()}>
                {(e) => (
                  <div role="listitem" class="flex-none">
                    <button
                      type="button"
                      data-testid="ranking-strip-item"
                      aria-label={t("ranking.entry.itemAria", {
                        rank: e.rank,
                        title: e.illust.title,
                      })}
                      onClick={() => void navigate(`/illust/${e.illust.id}`)}
                      class="relative block w-20 cursor-pointer appearance-none rounded-[var(--borderRadiusMedium)] border-none bg-transparent p-0 outline-none transition-opacity duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:opacity-90 active:scale-98 focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
                    >
                      <img
                        src={resolveImageUrl(rankingCover(e.illust))}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        class="h-20 w-20 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground3)] object-cover select-none"
                      />
                      <span
                        class={[
                          "absolute bottom-0 left-0 rounded-br-[var(--borderRadiusMedium)] rounded-tl-[var(--borderRadiusMedium)] px-1.5 py-0.5 font-semibold [font-size:var(--fontSizeBase100)]",
                          {
                            "bg-[var(--colorBrandBackground)] text-[var(--colorNeutralForegroundOnBrand)]":
                              e.rank <= 3,
                            "bg-[var(--colorNeutralBackground3)] text-[var(--colorNeutralForeground1)]":
                              e.rank > 3,
                          },
                        ]}
                      >
                        {e.rank}
                      </span>
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
};

/** 开关关闭时不创建子组件 → 不构造数据源、不发请求 */
const RankingStripEntry: Component<RankingStripEntryProps> = (props) => {
  // 延迟挂载（createDeferredMount）：StripInner 会构造 v6 查询并读取其投影，
  // 若发生在路由过渡中会令过渡永不提交（登录后 navigate('/home') 停在 /login 的根因）。
  const ready = createDeferredMount();
  return (
    <Show when={ready() && rankingEntry()}>
      <StripInner refreshEpoch={props.refreshEpoch} />
    </Show>
  );
};

export default RankingStripEntry;
