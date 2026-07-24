import { type Component } from "solid-js";
import { Show } from "solid-js";
import type { PixivNovel, SeriesNavigation } from "../api/types";
import FluentIcon from "./ui/FluentIcon";

// ── 小说底部导航栏：上一章、目录、显示设置、下一章 ──

interface NovelFooterNavProps {
  novel: PixivNovel;
  novelNav: SeriesNavigation | null;
  footerHidden: boolean;
  onPrevChapter: (id: number) => void;
  onNextChapter: (id: number) => void;
  onOpenSeries: () => void;
  onOpenSettings: () => void;
}

const NovelFooterNav: Component<NovelFooterNavProps> = (props) => {
  return (
    <div
      class="fixed bottom-0 left-0 right-0 surface-appbar border-t border-[var(--colorNeutralStroke2)] px-4 py-2"
      style={{
        "z-index": 20,
        transform: props.footerHidden
          ? "translateY(calc(100% + 8px + env(safe-area-inset-bottom, 0px)))"
          : "translateY(0)",
        transition: "transform var(--durationNormal) var(--curveEasyEase)",
      }}
    >
      <div class="max-w-2xl mx-auto flex items-center justify-center gap-1 overflow-x-auto">
        <Show when={props.novel.series?.id ? props.novelNav?.prevNovel : undefined}>
          {(prev) => (
            <button
              class="flex-shrink-0 whitespace-nowrap px-3 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] font-medium hover:bg-[var(--colorNeutralBackground3)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer flex items-center gap-1"
              onClick={() => props.onPrevChapter(prev().id)}
            >
              ◀ 上一章
            </button>
          )}
        </Show>
        <Show when={props.novel.series?.id}>
          <button
            class="flex-shrink-0 whitespace-nowrap px-3 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] font-medium hover:bg-[var(--colorNeutralBackground3)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer flex items-center gap-2"
            onClick={() => props.onOpenSeries()}
            aria-label="打开系列目录"
          >
            <FluentIcon name="list" size={20} />
            目录
          </button>
        </Show>
        <button
          class="flex-shrink-0 whitespace-nowrap px-3 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] font-medium hover:bg-[var(--colorNeutralBackground3)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer flex items-center gap-2"
          onClick={() => props.onOpenSettings()}
        >
          <span class="font-bold tracking-tight" style={{ "font-size": "var(--fontSizeBase400)" }}>
            Aa
          </span>
          显示设置
        </button>
        <Show when={props.novel.series?.id ? props.novelNav?.nextNovel : undefined}>
          {(next) => (
            <button
              class="flex-shrink-0 whitespace-nowrap px-3 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorBrandBackground)] text-white [font-size:var(--fontSizeBase200)] font-medium hover:opacity-90 active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer flex items-center gap-1"
              onClick={() => props.onNextChapter(next().id)}
            >
              下一章 ▶
            </button>
          )}
        </Show>
      </div>
    </div>
  );
};

export default NovelFooterNav;
