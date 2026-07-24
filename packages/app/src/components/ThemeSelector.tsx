import { type Component, For } from "solid-js";
import {
  pageStyleTheme,
  setPageStyleTheme,
  getTheme,
  setThemePersisted,
  type PageStyleThemeId,
} from "@/stores/themeStore";
import FluentIcon from "@/components/ui/FluentIcon";

const PAGE_STYLE_OPTIONS: {
  id: PageStyleThemeId;
  label: string;
  icon: Parameters<typeof FluentIcon>[0]["name"];
}[] = [
  { id: "fluent", label: "Fluent 默认", icon: "home" },
  { id: "card", label: "卡片式", icon: "image" },
];

const THEME_OPTIONS: {
  id: "light" | "dark" | "system";
  label: string;
  icon: Parameters<typeof FluentIcon>[0]["name"];
}[] = [
  { id: "light", label: "浅色", icon: "weatherSunny" },
  { id: "system", label: "跟随系统", icon: "settings" },
  { id: "dark", label: "深色", icon: "weatherMoon" },
];

const ThemeSelector: Component = () => {
  return (
    <div class="flex flex-col gap-4">
      {/* 页面风格 */}
      <div>
        <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-2">
          页面风格
        </p>
        <div class="grid grid-cols-2 gap-3" role="group" aria-label="页面风格选择">
          <For each={PAGE_STYLE_OPTIONS}>
            {(option) => {
              const selected = () => pageStyleTheme() === option.id;
              return (
                <button
                  type="button"
                  role="button"
                  aria-pressed={selected()}
                  aria-label={option.label}
                  onClick={() => setPageStyleTheme(option.id)}
                  class="flex flex-col items-center gap-2 p-4 rounded-[var(--borderRadiusMedium)] border transition-all duration-[var(--durationFast)] appearance-none bg-transparent cursor-pointer"
                  classList={{
                    "border-[var(--colorCompoundBrandStroke)]": selected(),
                    "bg-[var(--colorNeutralBackground2)]": selected(),
                    "border-[var(--colorNeutralStroke2)]": !selected(),
                    "hover:border-[var(--colorNeutralStroke1)]": !selected(),
                    "hover:bg-[var(--colorNeutralBackground2)]": !selected(),
                    "active:scale-[0.97]": true,
                  }}
                >
                  <FluentIcon name={option.icon} size={24} />
                  <span
                    class="[font-size:var(--fontSizeBase200)] font-medium"
                    classList={{
                      "text-[var(--colorCompoundBrandForeground1)]": selected(),
                      "text-[var(--colorNeutralForeground1)]": !selected(),
                    }}
                  >
                    {option.label}
                  </span>
                </button>
              );
            }}
          </For>
        </div>
      </div>

      {/* 明暗主题 */}
      <div>
        <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-2">
          明暗主题
        </p>
        <div class="grid grid-cols-3 gap-3" role="group" aria-label="明暗主题选择">
          <For each={THEME_OPTIONS}>
            {(option) => {
              const selected = () => getTheme() === option.id;
              return (
                <button
                  type="button"
                  role="button"
                  aria-pressed={selected()}
                  aria-label={option.label}
                  onClick={() => setThemePersisted(option.id)}
                  class="flex flex-col items-center gap-2 p-4 rounded-[var(--borderRadiusMedium)] border transition-all duration-[var(--durationFast)] appearance-none bg-transparent cursor-pointer"
                  classList={{
                    "border-[var(--colorCompoundBrandStroke)]": selected(),
                    "bg-[var(--colorNeutralBackground2)]": selected(),
                    "border-[var(--colorNeutralStroke2)]": !selected(),
                    "hover:border-[var(--colorNeutralStroke1)]": !selected(),
                    "hover:bg-[var(--colorNeutralBackground2)]": !selected(),
                    "active:scale-[0.97]": true,
                  }}
                >
                  <FluentIcon name={option.icon} size={24} />
                  <span
                    class="[font-size:var(--fontSizeBase200)] font-medium"
                    classList={{
                      "text-[var(--colorCompoundBrandForeground1)]": selected(),
                      "text-[var(--colorNeutralForeground1)]": !selected(),
                    }}
                  >
                    {option.label}
                  </span>
                </button>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
};

export default ThemeSelector;
