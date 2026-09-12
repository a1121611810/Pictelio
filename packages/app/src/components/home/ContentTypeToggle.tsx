/**
 * ContentTypeToggle — 插画 / 小说内容类型切换器（首页 C 框架）。
 *
 * 分段控件：NeutralBackground2 容器（p-0.5 + Medium 圆角），激活项 NeutralBackground1
 * 浮起（elevation2 阴影），未激活项透明底 + NeutralForeground2。绑定全局
 * contentType / setContentType（uiStore，经 settings registry 持久化，切页不变）。
 */
import type { Component } from "solid-js";
import { contentType, setContentType, type ContentType } from "@/stores/uiStore";
import { t, type I18nKey } from "../../i18n";

const OPTIONS: { key: ContentType; labelKey: I18nKey }[] = [
  { key: "illust", labelKey: "home.contentToggle.illust" },
  { key: "novel", labelKey: "home.contentToggle.novel" },
];

const ContentTypeToggle: Component = () => (
  <div class="flex items-center gap-0.5 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)] p-0.5">
    {OPTIONS.map((opt) => (
      <button
        data-testid={`content-type-${opt.key}`}
        class={[
          "flex-1 cursor-pointer appearance-none border-none px-3 py-1 font-semibold outline-none transition-all active:scale-95 [font-size:var(--fontSizeBase100)]",
          {
            "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]":
              contentType() === opt.key,
            "bg-transparent text-[var(--colorNeutralForeground2)]": contentType() !== opt.key,
          },
        ]}

        onClick={() => void setContentType(opt.key)}
        aria-pressed={contentType() === opt.key ? "true" : "false"}
      >
        {t(opt.labelKey)}
      </button>
    ))}
  </div>
);

export default ContentTypeToggle;
