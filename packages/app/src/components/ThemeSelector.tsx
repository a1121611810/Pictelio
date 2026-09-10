import type { Component } from "solid-js";
import { getTheme, setThemePersisted } from "@/stores/themeStore";
import FluentIcon from "@/components/ui/FluentIcon";

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
    <div class="grid grid-cols-3 gap-3" role="group" aria-label="明暗主题选择">
      <For each={THEME_OPTIONS}>
        {(option) => {
          const selected = () => getTheme() === option.id;
          return (
            <button
              type="button"
              role="button"
              aria-pressed={selected() ? "true" : "false"}
              aria-label={option.label}
              onClick={() => setThemePersisted(option.id)}
              class={[
                "flex flex-col items-center gap-2 p-4 rounded-[var(--borderRadiusMedium)] border transition-all duration-[var(--durationFast)] appearance-none bg-transparent cursor-pointer",
                {
                  "border-[var(--colorCompoundBrandStroke)]": selected(),
                  "bg-[var(--colorNeutralBackground2)]": selected(),
                  "border-[var(--colorNeutralStroke2)]": !selected(),
                  "hover:border-[var(--colorNeutralStroke1)]": !selected(),
                  "hover:bg-[var(--colorNeutralBackground2)]": !selected(),
                  "active:scale-[0.97]": true,
                },
              ]}
            >
              <FluentIcon name={option.icon} size={24} />
              <span
                class={[
                  "[font-size:var(--fontSizeBase200)] font-medium",
                  {
                    "text-[var(--colorCompoundBrandForeground1)]": selected(),
                    "text-[var(--colorNeutralForeground1)]": !selected(),
                  },
                ]}
              >
                {option.label}
              </span>
            </button>
          );
        }}
      </For>
    </div>
  );
};

export default ThemeSelector;
