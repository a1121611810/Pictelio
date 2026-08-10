import type { Component } from "solid-js";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { PixivIllustTag } from "@/api/types";
import SearchableTag from "@/components/SearchableTag";
import { useContainerWidth } from "@/primitives/useContainerWidth";
import { computeVisibleTags } from "./adaptiveTagFit";

/**
 * 自适应标签行（用户确认的简单方案）：
 * - 单行；不满一行时全部显示、无「+N」
 * - 溢出时右侧固定预留「+N」宽度，左侧完整 chip 尽量多放，
 *   剩余宽度再塞一个「截断 chip」（内容超出用省略号），其余折叠「+N」
 *
 * 实现：隐藏测量层（absolute + visibility:hidden）实测每个 chip 与「+N」的真实宽度，
 * 交给 computeVisibleTags 纯函数贪心。翻译名正常显示在 chip 内。
 *
 * ready 门控：测量/宽度未就绪时渲染占位（不显示 chip），避免
 * 「全部显示被裁」或「只剩 +N」或反馈循环（曾导致概率性只显示一个）。
 */

interface AdaptiveTagsProps {
  /** 全部标签 */
  tags: PixivIllustTag[];
  /** 「+N」点击——进详情看全部标签 */
  onOverflowClick: () => void;
}

const chipClass =
  "flex-shrink-0 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground3)] px-[var(--spacingHorizontalXS)] py-[var(--spacingVerticalXXS)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground3Hover)] [font-size:var(--fontSizeBase100)] [line-height:var(--lineHeightBase100)]";

const plusNClass =
  "inline-flex flex-shrink-0 cursor-pointer items-center rounded-[var(--borderRadiusMedium)] bg-[var(--colorBrandBackground)] px-[var(--spacingHorizontalXS)] py-[var(--spacingVerticalXXS)] text-[var(--colorNeutralForegroundOnBrand)] hover:bg-[var(--colorBrandBackgroundHover)] [font-size:var(--fontSizeBase100)] [line-height:var(--lineHeightBase100)]";

/** 占位高度：chip 实际高度（12px 字号 + 上下 4px padding + 行高） */
const ROW_HEIGHT = 22;

const AdaptiveTags: Component<AdaptiveTagsProps> = (props) => {
  const { width, ref } = useContainerWidth();
  let measureEl: HTMLDivElement | undefined;
  const [chipWidths, setChipWidths] = createSignal<number[]>([]);
  const [plusWidth, setPlusWidth] = createSignal(0);
  /** tick：测量/宽度变化后强制组件重渲染（保证可见层/截断 chip 的 max-width 同步） */
  const [tick, setTick] = createSignal(0);

  /** 从隐藏测量层读取全部 chip 与「+N」的真实宽度 */
  const measure = () => {
    const el = measureEl;
    const total = props.tags.length;
    if (!el || total === 0) return;
    const children = Array.from(el.children) as HTMLElement[];
    if (children.length < total + 1) return;
    setChipWidths(children.slice(0, total).map((c) => c.offsetWidth));
    setPlusWidth((children[total] as HTMLElement).offsetWidth);
    setTick((t) => t + 1);
  };

  /** 测量与宽度均就绪后才渲染结果（ready 前显示占位，杜绝反馈循环） */
  const ready = () => chipWidths().length === props.tags.length && width() > 0;

  const fit = createMemo(() => {
    void tick();
    if (!ready()) return null;
    return computeVisibleTags(chipWidths(), plusWidth(), width());
  });

  const visibleTags = () => props.tags.slice(0, fit()?.visible ?? 0);
  const remaining = () => fit()?.remaining ?? 0;
  /** 截断 chip：占满剩余宽度，文字超出用省略号（用户：第二个宽度 = 剩余宽度，超出点点点） */
  const partialTag = () => {
    const f = fit();
    return f?.partialWidth != null ? props.tags[f.visible] : undefined;
  };
  const partialText = () => {
    const t = partialTag();
    if (!t) return "";
    return t.translated_name ? `${t.name}（${t.translated_name}）` : t.name;
  };

  // 截断 chip 外层 ref：命令式写入 max-width（JSX style 动态值实测不可靠，未写入 DOM）
  let partialRef: HTMLSpanElement | undefined;
  createEffect(() => {
    const f = fit();
    if (partialRef && f?.partialWidth != null) {
      partialRef.style.maxWidth = `${f.partialWidth}px`;
    }
  });

  // 测量层就绪后读数；ResizeObserver 持续监听（旋转/字体加载/容器变化重测）
  onMount(() => {
    measure();
    const el = measureEl;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  });

  // 标签变化后重测（等渲染完成再读宽度）
  createEffect(() => {
    void props.tags;
    requestAnimationFrame(measure);
  });

  return (
    <div ref={ref} class="relative mt-[var(--spacingVerticalXS)]">
      {/* 测量层：absolute + visibility:hidden，不占布局；渲染全部 chip + 「+N」占位（文本用总数最宽值） */}
      <div
        ref={(el) => {
          measureEl = el;
        }}
        class="pointer-events-none absolute inset-0 flex items-center gap-[var(--spacingHorizontalXXS)]"
        style={{ visibility: "hidden" }}
        aria-hidden="true"
      >
        <For each={props.tags}>
          {(tag) => (
            <SearchableTag name={tag.name} translatedName={tag.translated_name} class={chipClass} />
          )}
        </For>
        {/* +N 占位用最宽文本（+总数），偏保守折叠，保证 +N 不溢出 */}
        <span class={plusNClass}>{`+${props.tags.length}`}</span>
      </div>

      {/* 可见层：ready 前占位（保高），ready 后渲染完整 chip + 截断 chip + 「+N」 */}
      <Show when={fit()} fallback={<div style={{ height: `${ROW_HEIGHT}px` }} />}>
        <div class="flex items-center gap-[var(--spacingHorizontalXXS)] overflow-hidden">
          {visibleTags().map((tag) => (
            <SearchableTag name={tag.name} translatedName={tag.translated_name} class={chipClass} />
          ))}
          <Show when={partialTag()}>
            <span
              ref={(el) => {
                partialRef = el;
              }}
              class={`${chipClass} min-w-0 overflow-hidden`}
              role="button"
              tabIndex={0}
              aria-label={`搜索标签：${partialTag()!.name}`}
              onClick={(e) => {
                e.stopPropagation();
                props.onOverflowClick();
              }}
            >
              {/* min-w-0：flex 子项收缩到 maxWidth 约束的宽度，truncate 省略号才生效 */}
              <span class="block min-w-0 truncate">{partialText()}</span>
            </span>
          </Show>
          <Show when={remaining() > 0}>
            <span
              class={plusNClass}
              role="button"
              tabIndex={0}
              aria-label={`还有 ${remaining()} 个标签，查看详情`}
              onClick={(e) => {
                e.stopPropagation();
                props.onOverflowClick();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  props.onOverflowClick();
                }
              }}
            >
              +{remaining()}
            </span>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default AdaptiveTags;
