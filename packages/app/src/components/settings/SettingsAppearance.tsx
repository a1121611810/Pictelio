import { type Component } from "solid-js";
import ThemeSelector from "../ThemeSelector";
import {
  autoHideNavBar,
  setAutoHideNavBar,
  showDetailStairs,
  setShowDetailStairs,
} from "../../stores/settingsStore";
import { persistScrollRestoration, setPersistScrollRestoration } from "../../stores/uiStore";
import { currentLocale, setLanguage, t, type Locale } from "../../i18n";

const LANGUAGES: readonly Locale[] = ["zh-CN", "en"];

const LANGUAGE_AUTONYMS: Record<Locale, string> = {
  "zh-CN": "简体中文",
  en: "English",
};

const SettingsAppearance: Component = () => {
  const navigate = useNavigate();

  return (
    <div class="py-3 flex flex-col">
      <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground3)] uppercase tracking-wide mb-1">
        {t("settings.appearance.sectionTitle")}
      </p>

      {/* 明暗主题选择器 */}
      <div class="py-3">
        <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug mb-2">
          {t("settings.appearance.theme")}
        </p>
        <ThemeSelector />
      </div>

      {/* 详情页楼梯导航开关 */}
      <div class="flex items-center justify-between py-3">
        <div class="flex items-center gap-3 min-w-0">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M3 6.25A3.25 3.25 0 0 1 6.25 3h11.5A3.25 3.25 0 0 1 21 6.25v11.5A3.25 3.25 0 0 1 17.75 21H6.25A3.25 3.25 0 0 1 3 17.75V6.25zM6.25 4.5A1.75 1.75 0 0 0 4.5 6.25V9h2.25V5.25A1.72 1.72 0 0 0 6.25 4.5z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div class="min-w-0">
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              {t("settings.appearance.detailStairs")}
              <span class="inline-flex items-center ml-1 px-[var(--spacingHorizontalXS)] py-[var(--spacingVerticalXXS)] rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase100)] font-semibold text-[var(--colorPaletteGreenForeground2)] bg-[var(--colorPaletteGreenBackground2)] align-middle">
                Beta
              </span>
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              {t("settings.appearance.detailStairsDesc")}
            </p>
          </div>
        </div>
        <fluent-switch
          checked={showDetailStairs()}
          ref={fluentOn("change", () => setShowDetailStairs(!showDetailStairs()))}
          aria-label={t("settings.appearance.detailStairs")}
        />
      </div>

      {/* 自动隐藏导航栏开关 */}
      <div class="flex items-center justify-between py-3">
        <div class="flex items-center gap-3 min-w-0">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M3.75 5.25a.75.75 0 0 0 0 1.5h16.5a.75.75 0 0 0 0-1.5H3.75zm0 4.5a.75.75 0 0 0 0 1.5h16.5a.75.75 0 0 0 0-1.5H3.75zm0 4.5a.75.75 0 0 0 0 1.5h11.5a.75.75 0 0 0 0-1.5H3.75z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div class="min-w-0">
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              {t("settings.appearance.autoHideNav")}
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              {t("settings.appearance.autoHideNavDesc")}
            </p>
          </div>
        </div>
        <fluent-switch
          checked={autoHideNavBar()}
          ref={fluentOn("change", () => setAutoHideNavBar(!autoHideNavBar()))}
          aria-label={t("settings.appearance.autoHideNav")}
        />
      </div>

      {/* 持久化滚动恢复开关 */}
      <div class="flex items-center justify-between py-3">
        <div class="flex items-center gap-3 min-w-0">
          <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M7 7a1 1 0 1 0 0 2h10a1 1 0 1 0 0-2H7zM6 12a1 1 0 0 1 1-1h10a1 1 0 1 1 0 2H7a1 1 0 0 1-1-1zm1 3a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2H7zM2 5.75A3.75 3.75 0 0 1 5.75 2h12.5A3.75 3.75 0 0 1 22 5.75v12.5A3.75 3.75 0 0 1 18.25 22H5.75A3.75 3.75 0 0 1 2 18.25V5.75zM5.75 3.5c-.46 0-.84.166-1.16.516-.335.367-.59.902-.59 1.734v12.5c0 .832.255 1.367.59 1.734.32.35.7.516 1.16.516h12.5c.46 0 .84-.166 1.16-.516.335-.367.59-.902.59-1.734V5.75c0-.832-.255-1.367-.59-1.734-.32-.35-.7-.516-1.16-.516H5.75z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div class="min-w-0">
            <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              {t("settings.appearance.persistScroll")}
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              {t("settings.appearance.persistScrollDesc")}
            </p>
          </div>
        </div>
        <fluent-switch
          checked={persistScrollRestoration()}
          ref={fluentOn("change", (e: Event) => {
            const turningOn = (e.target as HTMLInputElement)?.checked;
            if (turningOn) {
              // 开启需要二次确认（说明影响）：跳确认页，确认后才真正开启并自动返回
              void navigate("/scroll-restoration-confirm");
            } else {
              // 关闭直接生效（默认行为，无需确认）
              setPersistScrollRestoration(false);
            }
          })}
          aria-label={t("settings.appearance.persistScroll")}
        />
      </div>

      {/* 界面语言（抽取原型 #496：跟随系统 + 手动覆盖 + 即时切换；回退跟随系统的入口属 spec 范围） */}
      <div class="flex items-center justify-between py-3 gap-3">
        <div class="min-w-0">
          <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
            {t("settings.appearance.language")}
          </p>
          <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
            {t("settings.appearance.languageDesc")}
          </p>
        </div>
        <div
          class="flex items-center gap-2 flex-shrink-0"
          role="group"
          aria-label={t("settings.appearance.language")}
        >
          {LANGUAGES.map((lang) => (
            <button
              class={`px-[var(--spacingHorizontalM)] py-[var(--spacingVerticalS)] rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase300)] border border-[var(--colorNeutralStroke1)] ${
                currentLocale() === lang
                  ? "bg-[var(--colorBrandBackground)] text-[var(--colorNeutralForegroundOnBrand)] border-[var(--colorBrandBackground)]"
                  : "bg-[var(--colorNeutralBackground3)] text-[var(--colorNeutralForeground1)]"
              }`}
              aria-pressed={currentLocale() === lang ? "true" : "false"}
              onClick={() => setLanguage(lang)}
            >
              {LANGUAGE_AUTONYMS[lang]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SettingsAppearance;
