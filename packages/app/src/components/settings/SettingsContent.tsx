import type { Component } from "solid-js";
import {
  showR18,
  setShowR18,
  showR18G,
  setShowR18G,
  aiFilterMode,
  setAiFilterMode,
  relatedInjection,
  setRelatedInjection,
} from "../../stores/settingsStore";
import type { AiFilterMode } from "../../utils/aiFilter";
import FluentIcon from "../ui/FluentIcon";
import { t, type I18nKey } from "../../i18n";

// 模块级常量存 key，渲染时 t(key)（i18n B2：不许模块加载时快照文案）
const AI_FILTER_OPTIONS: { value: AiFilterMode; label: I18nKey }[] = [
  { value: "show", label: "settings.content.aiFilter.show" },
  { value: "mask", label: "settings.content.aiFilter.mask" },
  { value: "only", label: "settings.content.aiFilter.only" },
];

interface SettingsContentProps {
  onOpenBlocklist: () => void;
}

const SettingsContent: Component<SettingsContentProps> = (props) => {
  return (
    <div class="py-3 flex flex-col">
      <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-1">
        {t("settings.content.sectionTitle")}
      </p>

      {/* 显示 R18 内容开关行 */}
      <div class="flex items-center justify-between py-3">
        <div class="flex items-center gap-3">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6.25 3A3.25 3.25 0 0 0 3 6.25v11.5A3.25 3.25 0 0 0 6.25 21h11.5A3.25 3.25 0 0 0 21 17.75V6.25A3.25 3.25 0 0 0 17.75 3H6.25zm0 1.5h11.5a1.75 1.75 0 0 1 1.75 1.75v11.5c0 .966-.784 1.75-1.75 1.75H6.25a1.75 1.75 0 0 1-1.75-1.75V6.25c0-.966.784-1.75 1.75-1.75zM7 8.75A1.75 1.75 0 0 1 8.75 7h.084A1.75 1.75 0 0 1 10.5 8.84v.33a1.75 1.75 0 0 1-1.75 1.75l-.084-.001A1.75 1.75 0 0 1 7 9.08V8.75zm6.5 0A1.75 1.75 0 0 1 15.25 7h.084A1.75 1.75 0 0 1 17 8.84v.33a1.75 1.75 0 0 1-1.75 1.75l-.084-.001A1.75 1.75 0 0 1 13.5 9.08V8.75zM8.724 15.5a.75.75 0 0 0 0 1.5h6.552a.75.75 0 0 0 0-1.5H8.724z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div>
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              {t("settings.content.showR18")}
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              {t("settings.content.showR18Desc")}
            </p>
          </div>
        </div>

        <fluent-switch
          checked={showR18()}
          ref={fluentOn("change", () => setShowR18(!showR18()))}
          aria-label={t("settings.content.showR18")}
        />
      </div>

      {/* 显示 R-18G 内容开关行 */}
      <div class="flex items-center justify-between py-3">
        <div class="flex items-center gap-3">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M10.82 2.001a1.752 1.752 0 0 1 2.36 0c.53.47 6.07 5.42 8.587 11.508.168.405.233.815.233 1.211a4.751 4.751 0 0 1-4.755 4.752 4.4 4.4 0 0 1-1.77-.427L15.5 19c-3.428 0-5.26 0-7-.027a4.753 4.753 0 0 1-4.727-4.725c0-.397.065-.807.233-1.211C6.525 7.422 12.065 2.472 12.595 2l.005.005L10.82 2zm1.18 1.44c-.26.28-5.643 5.058-8.065 10.798a3.28 3.28 0 0 0-.185.796 3.253 3.253 0 0 0 3.24 3.222c1.678.026 3.412.027 6.76.027h.225c.236 0 .473.07.675.2l.022.014a2.9 2.9 0 0 0 1.163.277 3.251 3.251 0 0 0 3.188-2.538c.031-.22.049-.443.052-.667v-.048a3.25 3.25 0 0 0-.157-.813C16.846 8.498 11.463 3.72 11.2 3.44L12 2.64l-.8.8h.001zM12 8.001a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zm0 1.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div>
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              {t("settings.content.showR18G")}
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              {t("settings.content.showR18GDesc")}
            </p>
          </div>
        </div>

        <fluent-switch
          checked={showR18G()}
          ref={fluentOn("change", () => setShowR18G(!showR18G()))}
          aria-label={t("settings.content.showR18G")}
        />
      </div>

      {/* 相关作品注入行开关（spec docs/specs/related-injection.md） */}
      <div class="flex items-center justify-between py-3">
        <div class="flex items-center gap-3">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <FluentIcon name="imageMultiple" size={24} />
          </div>
          <div>
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              {t("settings.content.relatedInjection")}
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              {t("settings.content.relatedInjectionDesc")}
            </p>
          </div>
        </div>

        <fluent-switch
          checked={relatedInjection()}
          ref={fluentOn("change", () => void setRelatedInjection(!relatedInjection()))}
          aria-label={t("settings.content.relatedInjection")}
        />
      </div>

      {/* AI 作品三态过滤（ADR-0155）：显示 / 遮罩 / 仅看 */}
      <div class="py-3">
        <div class="flex items-center gap-3">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <FluentIcon name="filter" size={24} />
          </div>
          <div>
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              {t("settings.content.aiFilter.title")}
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              {t("settings.content.aiFilter.desc")}
            </p>
          </div>
        </div>

        <div class="mt-3 grid grid-cols-3 gap-2" role="group" aria-label={t("settings.content.aiFilter.groupLabel")}>
          <For each={AI_FILTER_OPTIONS}>
            {(option) => {
              const selected = () => aiFilterMode() === option.value;
              return (
                <button
                  type="button"
                  aria-pressed={selected() ? "true" : "false"}
                  aria-label={t(option.label)}
                  onClick={() => void setAiFilterMode(option.value)}
                  class={[
                    "flex items-center justify-center py-2 min-h-10 rounded-[var(--borderRadiusMedium)] border transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] appearance-none cursor-pointer [font-size:var(--fontSizeBase300)] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]",
                    {
                      "border-[var(--colorCompoundBrandStroke)] bg-[var(--colorNeutralBackground2)] text-[var(--colorCompoundBrandForeground1)] font-semibold":
                        selected(),
                      "border-[var(--colorNeutralStroke2)] bg-transparent text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground2)]":
                        !selected(),
                      "active:scale-[0.97]": true,
                    },
                  ]}
                >
                  {t(option.label)}
                </button>
              );
            }}
          </For>
        </div>
      </div>

      {/* 管理屏蔽列表 */}
      <div
        class="flex items-center justify-between py-3 cursor-pointer hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)] rounded-[var(--borderRadiusMedium)] -mx-2 px-2"
        onClick={() => props.onOpenBlocklist()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            props.onOpenBlocklist();
          }
        }}
        role="button"
        tabindex="0"
        aria-label={t("settings.content.blocklist")}
      >
        <div class="flex items-center gap-3">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm4.25 6.25a.75.75 0 0 1 0 1.06l-8.5 8.5a.75.75 0 1 1-1.06-1.06l8.5-8.5a.75.75 0 0 1 1.06 0z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div>
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              {t("settings.content.blocklist")}
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              {t("settings.content.blocklistDesc")}
            </p>
          </div>
        </div>
        {/* Chevron right */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          class="flex-shrink-0 text-[var(--colorNeutralForeground3)] ml-2"
        >
          <path
            d="M8.22 4.22a.75.75 0 0 1 1.06 0l7.25 7.25a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06-1.06L15.19 12 8.22 5.28a.75.75 0 0 1 0-1.06z"
            fill="currentColor"
          />
        </svg>
      </div>
    </div>
  );
};

export default SettingsContent;
