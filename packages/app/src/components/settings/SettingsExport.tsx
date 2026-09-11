import type { Component } from "solid-js";
import FluentIcon from "../ui/FluentIcon";
import {
  novelExportFormat,
  setNovelExportFormat,
  novelExportIncludeMetadata,
  setNovelExportIncludeMetadata,
  novelExportIncludeCover,
  setNovelExportIncludeCover,
  novelExportIncludeImages,
  setNovelExportIncludeImages,
} from "../../stores/settingsStore";
import {
  NOVEL_EXPORT_FORMATS,
  NOVEL_EXPORT_FORMAT_LABELS,
  type NovelExportFormat,
} from "@pictelio/novel-export";

/**
 * 设置页「导出」卡片（spec docs/specs/novel-export.md §6/§7.1）：
 * 小说导出的全局默认格式 + 三项内容开关（元数据 / 封面 / 正文内嵌插图，默认全开）。
 * 导出面板可临时覆盖本次格式；内容开关只在此处配置。
 */
/** 每个格式的 a11y 标签（显式字面量：便于 E2E 静态锚点校验，且避免模板拼接漂移） */
const FORMAT_ARIA_LABELS: Record<NovelExportFormat, string> = {
  txt: "小说导出格式 TXT",
  html: "小说导出格式 HTML",
  md: "小说导出格式 Markdown",
  docx: "小说导出格式 Word (.docx)",
  pdf: "小说导出格式 PDF",
  epub: "小说导出格式 EPUB",
  rtf: "小说导出格式 RTF",
  json: "小说导出格式 JSON",
  fb2: "小说导出格式 FB2",
};

const SettingsExport: Component = () => {
  return (
    <div class="py-3 flex flex-col">
      <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-1">
        导出
      </p>

      {/* 小说导出默认格式（全局统一） */}
      <div class="py-2">
        <div class="flex items-center gap-2 mb-2">
          <FluentIcon name="list" size={20} />
          <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
            小说导出格式
          </p>
        </div>
        <div class="flex flex-wrap bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusMedium)] p-1.5 gap-1">
          {NOVEL_EXPORT_FORMATS.map((fmt: NovelExportFormat) => (
            <button
              type="button"
              class={[
                "flex-1 min-w-[3.5rem] py-[var(--spacingVerticalS)] px-[var(--spacingHorizontalS)] rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase200)] font-semibold transition-all ease-[var(--curveEasyEase)] active:scale-[0.98] appearance-none border-none outline-none cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--colorStrokeFocus2)]",
                {
                  "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]":
                    novelExportFormat() === fmt,
                  "bg-transparent text-[var(--colorNeutralForeground2)]":
                    novelExportFormat() !== fmt,
                },
              ]}
              aria-label={FORMAT_ARIA_LABELS[fmt]}
              aria-pressed={novelExportFormat() === fmt ? "true" : "false"}
              onClick={() => void setNovelExportFormat(fmt)}
            >
              {NOVEL_EXPORT_FORMAT_LABELS[fmt]}
            </button>
          ))}
        </div>
        <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] mt-2 leading-snug">
          详情页导出时默认使用该格式；导出面板可临时覆盖本次格式，不影响此默认值。
        </p>
      </div>

      {/* 内容开关（默认全开） */}
      <div class="py-2 flex flex-col">
        <p class="[font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground2)] mb-1">
          导出内容
        </p>
        <ExportToggle
          icon="info"
          title="包含元数据"
          subtitle="标题、作者、标签、系列、发布日期与原文链接"
          checked={novelExportIncludeMetadata()}
          onToggle={() => void setNovelExportIncludeMetadata(!novelExportIncludeMetadata())}
        />
        <ExportToggle
          icon="image"
          title="包含封面"
          subtitle="在支持图片的格式（HTML/PDF/EPUB/DOCX/FB2）中嵌入封面"
          checked={novelExportIncludeCover()}
          onToggle={() => void setNovelExportIncludeCover(!novelExportIncludeCover())}
        />
        <ExportToggle
          icon="imageMultiple"
          title="包含正文插图"
          subtitle="嵌入正文中的 Pixiv 插图；文本格式（TXT/MD/RTF）仅保留图片链接"
          checked={novelExportIncludeImages()}
          onToggle={() => void setNovelExportIncludeImages(!novelExportIncludeImages())}
        />
      </div>
    </div>
  );
};

interface ExportToggleProps {
  icon: "info" | "image" | "imageMultiple";
  title: string;
  subtitle: string;
  checked: boolean;
  onToggle: () => void;
}

/** 设置行：图标 + 标题/副标题 + Fluent 开关（对齐 SettingsContent 既有行范式） */
const ExportToggle: Component<ExportToggleProps> = (props) => {
  return (
    <div class="flex items-center justify-between py-3">
      <div class="flex items-center gap-3 min-w-0">
        <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
          <FluentIcon name={props.icon} size={24} />
        </div>
        <div class="min-w-0">
          <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
            {props.title}
          </p>
          <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
            {props.subtitle}
          </p>
        </div>
      </div>
      <fluent-switch
        checked={props.checked}
        ref={fluentOn("change", props.onToggle)}
        aria-label={props.title}
      />
    </div>
  );
};

export default SettingsExport;
