/**
 * IllustTypeBadge — 类型角标公共组件（ADR-0113 / spec: docs/specs/work-type-badges.md）。
 *
 * 封面右上角图标化角标组：动图 = play 图标 +「动图」；多图 = imageMultiple 图标 + 页数数字。
 * 判定收敛在 resolveIllustTypeBadges 纯函数（./illustTypeBadges），本组件只做渲染。
 * 样式：磨砂半透明底（overlay token + backdrop-blur）圆角 chip + 白字，
 * 与左上分级标（R-18/R-18G/AI）位置相对，全部使用 Fluent token，无硬编码值。
 * 普通单图静态插画渲染为空（不占位）。
 *
 * 消费方：IllustSingleCard / ImageCard / GridCard（GridCard 用 size="compact"）。
 */
import { type Component, For, Show } from "solid-js";
import FluentIcon from "./ui/FluentIcon";
import { resolveIllustTypeBadges, type IllustTypeBadgeSource } from "./illustTypeBadges";

interface Props {
  /** 判定所需最小字段集（PixivIllust 结构兼容） */
  illust: IllustTypeBadgeSource;
  /** normal = 单列/瀑布流大卡；compact = 网格 3 列小卡 */
  size?: "normal" | "compact";
}

const IllustTypeBadge: Component<Props> = (props) => {
  const badges = () => resolveIllustTypeBadges(props.illust);
  const compact = () => props.size === "compact";

  return (
    <Show when={badges().length > 0}>
      <div
        data-testid="illust-type-badges"
        class="absolute top-[var(--spacingVerticalXS)] right-[var(--spacingHorizontalXS)] z-10 flex items-center gap-[var(--spacingHorizontalXXS)] pointer-events-none select-none"
      >
        <For each={badges()}>
          {(badge) => (
            <span
              class="flex items-center gap-[var(--spacingHorizontalXXS)] rounded-[var(--borderRadiusMedium)] bg-[var(--colorOverlayBackground)] backdrop-blur-sm text-[var(--colorOverlayForeground)] font-semibold"
              classList={{
                "px-[var(--spacingHorizontalXS)] py-[var(--spacingVerticalXXS)] [font-size:var(--fontSizeBase100)]":
                  compact(),
                "px-[var(--spacingHorizontalS)] py-[var(--spacingVerticalXXS)] [font-size:var(--fontSizeBase200)]":
                  !compact(),
              }}
            >
              <FluentIcon
                name={badge.kind === "ugoira" ? "play" : "imageMultiple"}
                size={compact() ? 12 : 14}
              />
              {badge.kind === "ugoira" ? "动图" : badge.pageCount}
            </span>
          )}
        </For>
      </div>
    </Show>
  );
};

export default IllustTypeBadge;
