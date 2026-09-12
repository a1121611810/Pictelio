import { Show, createSignal, type Component } from "solid-js";
import {
  NOVEL_EXPORT_FORMATS,
  NOVEL_EXPORT_FORMAT_LABELS,
  type NovelExportFormat,
  type NovelExportOptions,
} from "@pictelio/novel-export";
import { t, type I18nKey } from "../i18n";

interface ExportSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** 设置页的全局默认格式（打开时预选） */
  defaultFormat: NovelExportFormat;
  /** 设置页的内容开关快照（只读展示） */
  options: NovelExportOptions;
  /** 确认导出（本次临时格式，不写回全局） */
  onExport: (format: NovelExportFormat) => void;
}

/**
 * 小说导出面板（spec docs/specs/novel-export.md §7.1）：
 * 格式预选设置页默认值、可临时覆盖本次格式；内容开关只读展示（在设置页修改）。
 * 底部弹层形态（对齐 ReaderSettingsSheet 的 Sheet 契约）。
 */
/** 本次导出面板每个格式的 a11y 标签（存 i18n key，渲染时 t()；E2E 锚点断言渲染产物） */
const FORMAT_ARIA_LABELS: Record<NovelExportFormat, I18nKey> = {
  txt: "export.formatAria.txt",
  html: "export.formatAria.html",
  md: "export.formatAria.md",
  docx: "export.formatAria.docx",
  pdf: "export.formatAria.pdf",
  epub: "export.formatAria.epub",
  rtf: "export.formatAria.rtf",
  json: "export.formatAria.json",
  fb2: "export.formatAria.fb2",
};

/** 开关状态文案（模块级：不捕获组件作用域，避免每次渲染重建） */
const optionText = (on: boolean) => (on ? t("export.optionOn") : t("export.optionOff"));

const ExportSheet: Component<ExportSheetProps> = (props) => {
  // 初始预选设置页默认格式；关闭后由调用方卸载重建以复位（临时覆盖不写回设置）
  const [selected, setSelected] = createSignal<NovelExportFormat>(props.defaultFormat);

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50">
        {/* Scrim */}
        <div
          class="absolute inset-0"
          style="background-color:var(--colorScrim)"
          onClick={props.onClose}
        />

        {/* Sheet panel — A2 纯色卡片（ADR-0072） */}
        <div
          class="absolute bottom-0 left-0 right-0 bg-[var(--colorNeutralBackground1)] rounded-t-[var(--borderRadius3XLarge)] shadow-[var(--elevation28)]"
          style="max-height:80vh;overflow-y:auto;animation:fluent-slide-down var(--durationGentle) var(--curveDecelerateMid) both"
        >
          <div class="flex justify-center pt-2 pb-1">
            <div class="w-10 h-1 rounded-[var(--borderRadiusCircular)] bg-[var(--colorNeutralStroke1)]" />
          </div>

          <div class="flex items-center justify-between px-5 pt-1 pb-2">
            <h2 class="[font-size:var(--fontSizeBase500)] font-semibold text-[var(--colorNeutralForeground1)]">
              {t("export.title")}
            </h2>
            <button
              type="button"
              class="w-10 h-10 flex items-center justify-center rounded-[var(--borderRadiusMedium)] bg-transparent text-[var(--colorNeutralForeground1)] border-none outline-none cursor-pointer hover:bg-[var(--colorSubtleBackgroundHover)] active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--colorStrokeFocus2)]"
              aria-label={t("export.closeAria")}
              onClick={props.onClose}
            >
              ✕
            </button>
          </div>

          {/* 格式选择 */}
          <div class="px-5 py-2">
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)]">
              {t("export.formatLabel")}
            </p>
            <div class="flex flex-wrap bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusMedium)] p-1.5 gap-1 mt-2">
              {NOVEL_EXPORT_FORMATS.map((fmt) => (
                <button
                  type="button"
                  class={[
                    "flex-1 min-w-[3.5rem] py-[var(--spacingVerticalS)] px-[var(--spacingHorizontalS)] rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase200)] font-semibold transition-all ease-[var(--curveEasyEase)] active:scale-[0.98] appearance-none border-none outline-none cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--colorStrokeFocus2)]",
                    {
                      "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]":
                        selected() === fmt,
                      "bg-transparent text-[var(--colorNeutralForeground2)]": selected() !== fmt,
                    },
                  ]}
                  aria-label={t(FORMAT_ARIA_LABELS[fmt])}
                  aria-pressed={selected() === fmt ? "true" : "false"}
                  onClick={() => setSelected(fmt)}
                >
                  {NOVEL_EXPORT_FORMAT_LABELS[fmt]}
                </button>
              ))}
            </div>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] mt-2 leading-snug">
              {t("export.formatHint")}
            </p>
          </div>

          {/* 内容摘要（只读，在设置页修改） */}
          <div class="px-5 py-2">
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)]">
              {t("export.contentLabel")}
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)] mt-1 leading-snug">
              {t("export.contentSummary", {
                metadata: optionText(props.options.includeMetadata),
                cover: optionText(props.options.includeCover),
                inlineImages: optionText(props.options.includeInlineImages),
              })}
            </p>
            <p class="[font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)] mt-1 leading-snug">
              {t("export.contentHint")}
            </p>
          </div>

          <div class="px-5 pb-6 pt-3">
            <button
              type="button"
              class="w-full py-[var(--spacingVerticalM)] rounded-[var(--borderRadiusMedium)] bg-[var(--colorBrandBackground)] text-[var(--colorNeutralForegroundOnBrand)] border-none outline-none cursor-pointer [font-size:var(--fontSizeBase400)] font-semibold hover:opacity-90 active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--colorStrokeFocus2)]"
              aria-label={t("export.exportAria")}
              onClick={() => props.onExport(selected())}
            >
              {t("export.export")}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default ExportSheet;
