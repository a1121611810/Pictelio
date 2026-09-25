import type { Component } from "solid-js";
import { mutedTags, unmuteTag } from "../stores/muteTagStore";
import { t } from "../i18n";

function names() {
  return [...mutedTags()];
}

interface MuteTagSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * 静音标签管理面板（ADR-0187 D5）：复刻 BlocklistSheet 形态——
 * scrim + 底部 sheet + 把手 + 列表行「标签名 + 取消静音」+ 空态。
 */
const MuteTagSheet: Component<MuteTagSheetProps> = (props) => {
  function close() {
    props.onClose();
  }

  return (
    <div class="fixed inset-0 z-50">
      {/* Scrim */}
      <div class="absolute inset-0" style="background-color:var(--colorScrim)" onClick={close} />
      {/* Sheet — slides up from bottom */}
      <div
        class="absolute bottom-0 left-0 right-0 surface-appbar rounded-t-[var(--borderRadius4XLarge)] shadow-[var(--elevation28)]"
        style="max-height:70vh;overflow-y:auto;animation:fluent-slide-down var(--durationGentle) var(--curveDecelerateMid) both"
      >
        {/* Drag handle */}
        <div class="flex justify-center pt-2 pb-1">
          <div class="w-10 h-1 rounded-[var(--borderRadiusCircular)] bg-[var(--colorNeutralStroke1)]" />
        </div>

        {/* Header */}
        <div class="flex items-center justify-between px-5 pt-1 pb-2">
          <h2 class="[font-size:var(--fontSizeBase500)] font-semibold text-[var(--colorNeutralForeground1)]">
            {t("muteTag.sheet.title")}
          </h2>
          <fluent-button
            appearance="subtle"
            aria-label={t("muteTag.sheet.closeAria")}
            ref={fluentOn("click", close)}
            class="w-8 h-8 p-0 min-w-8"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M15.14 4.86a.67.67 0 0 0-.95 0L10 9.05 5.81 4.86a.67.67 0 0 0-.95.95L9.05 10l-4.19 4.19a.67.67 0 0 0 .95.95L10 10.95l4.19 4.19a.67.67 0 0 0 .95-.95L10.95 10l4.19-4.19a.67.67 0 0 0 0-.95z"
                fill="currentColor"
              />
            </svg>
          </fluent-button>
        </div>

        {/* Divider */}
        <fluent-divider style="margin-inline:var(--spacingHorizontalXL)"></fluent-divider>

        {/* Muted tag list */}
        <div class="px-5 py-3 min-h-[160px]">
          <Show
            when={names().length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center py-10 gap-3">
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                  class="text-[var(--colorNeutralForeground3)]"
                >
                  <path
                    d="M2 4.28a.75.75 0 0 1 1.06-1.06l17.72 17.72a.75.75 0 1 1-1.06 1.06l-2.56-2.56H3.75A1.75 1.75 0 0 1 2 17.69V4.28zm3.06-1.28h11.19c.97 0 1.75.78 1.75 1.75v13.41c0 .3-.08.59-.21.84L5.06 3zm2.69 10.75h6.5a.75.75 0 0 0 0-1.5h-6.5a.75.75 0 0 0 0 1.5z"
                    fill="currentColor"
                  />
                </svg>
                <p class="[font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground3)]">
                  {t("muteTag.sheet.empty")}
                </p>
              </div>
            }
          >
            <div class="flex flex-col gap-2">
              {names().map((name) => (
                <div class="flex items-center justify-between px-3 py-3 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)]">
                  <div class="min-w-0">
                    <p class="[font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)] truncate">
                      {name}
                    </p>
                  </div>
                  <fluent-button
                    appearance="secondary"
                    ref={fluentOn("click", () => void unmuteTag(name))}
                    aria-label={t("muteTag.sheet.unmuteAria", { name })}
                  >
                    {t("muteTag.sheet.unmute")}
                  </fluent-button>
                </div>
              ))}
            </div>
          </Show>
        </div>

        {/* Footer hint */}
        <div class="px-5 pb-6 pt-2">
          <p class="text-center [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
            {t("muteTag.sheet.hint")}
          </p>
        </div>
      </div>
    </div>
  );
};

export default MuteTagSheet;
