import { For, Show, createEffect, createSignal } from "solid-js";
import type { Component } from "solid-js";
import FluentDialog from "../ui/FluentDialog";
import PixivImage from "../PixivImage";
import { fluentOn } from "../../primitives/fluentOn";

interface PagePickerSheetProps {
  open: boolean;
  /** 各页展示用 URL（medium/large，作缩略图） */
  pageUrls: string[];
  /** 批量保存进行中（禁用确认按钮） */
  busy?: boolean;
  onClose: () => void;
  onConfirm: (pages: number[]) => void;
}

/**
 * 多图作品选页面板（spec docs/specs/image-save-download.md §5）：
 * 缩略图多选 + 全选/清除；打开时默认全选（批量下载 = 默认全选、按需取消）。
 * 确认回调上抛升序页号数组，保存流程由 IllustDetail 编排。
 */
const PagePickerSheet: Component<PagePickerSheetProps> = (props) => {
  const [selected, setSelected] = createSignal<Set<number>>(new Set());

  // 每次打开重置为全选（批量语义的默认值）——Solid 2.0 拆分 compute/apply
  createEffect(
    () => props.open,
    (open) => {
      if (open) {
        setSelected(new Set<number>(props.pageUrls.map((_, i) => i)));
      }
    },
  );

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) {
        next.delete(i);
      } else {
        next.add(i);
      }
      return next;
    });
  };

  const allSelected = () => selected().size === props.pageUrls.length && props.pageUrls.length > 0;

  const confirm = () => {
    if (!selected().size || props.busy) {
      return;
    }
    props.onConfirm([...selected()].toSorted((a, b) => a - b));
  };

  return (
    <FluentDialog open={props.open} onClose={props.onClose} aria-label="选择要保存的页">
      <h3 slot="title">选择要保存的页</h3>
      <div class="grid grid-cols-3 gap-2 max-h-[55vh] overflow-y-auto">
        <For each={props.pageUrls}>
          {(url, i) => (
            <button
              type="button"
              class={`relative aspect-square overflow-hidden rounded-[var(--borderRadiusMedium)] border-2 transition-colors duration-[var(--durationFast)] appearance-none p-0 cursor-pointer focus-visible:outline focus-visible:outline-offset-1 focus-visible:outline-[var(--colorStrokeFocus2)] ${
                selected().has(i())
                  ? "border-[var(--colorBrandForeground1)]"
                  : "border-[var(--colorBrandStroke1)]"
              }`}
              onClick={() => toggle(i())}
              aria-pressed={selected().has(i()) ? "true" : "false"}
              aria-label={`第 ${i() + 1} 页${selected().has(i()) ? "（已选）" : ""}`}
            >
              <PixivImage
                src={url}
                alt={`第 ${i() + 1} 页`}
                width={200}
                height={200}
                class="w-full h-full object-cover"
              />
              {/* 选中遮罩：右上 ✓ 角标 + 细描边强化 */}
              <Show when={selected().has(i())}>
                <span class="absolute top-1 right-1 w-5 h-5 rounded-[var(--borderRadiusCircular)] bg-[var(--colorBrandBackground)] text-[var(--colorNeutralForegroundOnBrand)] flex items-center justify-center [font-size:var(--fontSizeBase100)]">
                  ✓
                </span>
              </Show>
              <span class="absolute bottom-0 inset-x-0 bg-[var(--colorOverlayBackground)]/60 text-[var(--colorOverlayForeground)] text-center [font-size:var(--fontSizeBase100)] py-0.5">
                {i() + 1}
              </span>
            </button>
          )}
        </For>
      </div>
      <div class="mt-3 flex items-center gap-2">
        <button
          type="button"
          class="text-[var(--colorBrandForeground1)] [font-size:var(--fontSizeBase200)] font-medium hover:underline appearance-none bg-transparent border-none cursor-pointer p-1 focus-visible:outline focus-visible:outline-[var(--colorStrokeFocus2)]"
          onClick={() => {
            if (allSelected()) {
              setSelected(new Set<number>());
            } else {
              setSelected(new Set<number>(props.pageUrls.map((_, i) => i)));
            }
          }}
        >
          {allSelected() ? "清除全选" : "全选"}
        </button>
        <span class="ml-auto [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)]">
          已选 {selected().size} / {props.pageUrls.length} 页
        </span>
        <fluent-button
          appearance="primary"
          disabled={selected().size === 0 || props.busy}
          ref={fluentOn("click", confirm)}
        >
          {props.busy ? "保存中…" : `保存（${selected().size}）`}
        </fluent-button>
      </div>
    </FluentDialog>
  );
};

export default PagePickerSheet;
