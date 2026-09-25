import type { Component } from "solid-js";
import { clearMuteTagHint, currentMuteTagHint } from "../stores/muteTagStore";
import { t } from "../i18n";

/** 提示自动消失时长（对齐 Settings action toast 口径） */
const HINT_DURATION_MS = 2500;

/**
 * 静音成功轻提示宿主（ADR-0187 D5）：全局单实例，挂在 __root（exitHint 同位先例）。
 * 展示 muteTagStore 的待提示数据，2.5s 后自动清除；pointer-events-none 不挡交互。
 */
const MuteTagHint: Component = () => {
  // Solid 2.0 拆分效应：compute 读 hint，apply 段起定时器并以返回值注册清理
  createEffect(
    () => currentMuteTagHint(),
    (hint) => {
      if (!hint) {
        return;
      }
      const timer = setTimeout(() => clearMuteTagHint(), HINT_DURATION_MS);
      return () => clearTimeout(timer);
    },
  );

  return (
    <Show when={currentMuteTagHint()} keyed>
      {(hint) => (
        <div
          role="status"
          class="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 max-w-[80vw] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke2)] rounded-[var(--borderRadiusXLarge)] shadow-[var(--elevation8)] px-5 py-2.5 text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] font-medium pointer-events-none transition-all duration-[var(--durationGentle)]"
        >
          <span class="block truncate">{t("muteTag.mutedToast", { name: hint.name })}</span>
        </div>
      )}
    </Show>
  );
};

export default MuteTagHint;
