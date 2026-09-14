import { type Component } from "solid-js";
import {
  imageCacheDisk,
  setImageCacheDisk,
  imageCacheBrowser,
  setImageCacheBrowser,
  imageCachePrefetch,
  setImageCachePrefetch,
  imageCacheDiskSize,
  setImageCacheDiskSize,
} from "../stores/settingsStore";
import { goBack } from "../services/backTransitionService";
import { t } from "../i18n";
import PageTransition from "../components/PageTransition";

/**
 * 图片缓存设置页 — A（磁盘缓存）/ B（浏览器缓存）/ C（后台预取）三个独立开关。
 *
 * 布局参照 ImageHostSettings 和 About 页面风格：
 * surface-flyout 容器 + fluent-switch + 说明文字。
 */
const ImageCacheSettings: Component = () => {
  return (
    <PageTransition>
      <div class="page">
        {/* Header */}
        <div class="flex items-center gap-3 p-4 border-b border-[var(--colorNeutralStroke2)]">
          <button
            class="text-[var(--colorNeutralForeground2)] hover:text-[var(--colorNeutralForeground1)]
                 p-1 -ml-1 min-w-[40px] min-h-[40px] flex items-center justify-center
                 focus-visible:outline-2 focus-visible:outline-[var(--colorStrokeFocus2)] focus-visible:outline-offset-2"
            onClick={() => goBack()}
            aria-label={t("imageCache.back")}
          >
            ←
          </button>
          <h1 class="text-[var(--fontSizeHero700)] font-semibold text-[var(--colorNeutralForeground1)]">
            {t("imageCache.title")}
          </h1>
        </div>

        <div class="p-4 space-y-4">
          {/* A: 磁盘缓存 */}
          <div class="surface-flyout p-4">
            <div class="flex items-center justify-between mb-2">
              <h2 class="text-[var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)]">
                {t("imageCache.disk")}
              </h2>
              <fluent-switch
                checked={imageCacheDisk()}
                onChange={(e: Event) => setImageCacheDisk((e.target as HTMLInputElement).checked)}
                aria-label={t("imageCache.diskAria")}
              />
            </div>
            <p class="text-[var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              {t("imageCache.diskDesc")}
            </p>
          </div>

          {/* B: 浏览器缓存 */}
          <div class="surface-flyout p-4">
            <div class="flex items-center justify-between mb-2">
              <h2 class="text-[var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)]">
                {t("imageCache.browser")}
              </h2>
              <fluent-switch
                checked={imageCacheBrowser()}
                onChange={(e: Event) =>
                  setImageCacheBrowser((e.target as HTMLInputElement).checked)
                }
                aria-label={t("imageCache.browserAria")}
              />
            </div>
            <p class="text-[var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              {t("imageCache.browserDesc")}
            </p>
          </div>

          {/* C: 后台预取 */}
          <div class="surface-flyout p-4">
            <div class="flex items-center justify-between mb-2">
              <h2 class="text-[var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)]">
                {t("imageCache.prefetch")}
              </h2>
              <fluent-switch
                checked={imageCachePrefetch()}
                onChange={(e: Event) =>
                  setImageCachePrefetch((e.target as HTMLInputElement).checked)
                }
                aria-label={t("imageCache.prefetchAria")}
              />
            </div>
            <p class="text-[var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
              {t("imageCache.prefetchDesc")}
            </p>
          </div>

          {/* 磁盘缓存上限 */}
          <div class="surface-flyout p-4">
            <div class="flex items-center justify-between mb-2">
              <h2 class="text-[var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)]">
                {t("imageCache.diskLimit")}
              </h2>
              <span class="[font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorCompoundBrandForeground1)]">
                {imageCacheDiskSize()} MB
              </span>
            </div>
            <div class="flex items-center gap-3">
              <span class="[font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForegroundDisabled)]">
                50
              </span>
              <input
                type="range"
                min="50"
                max="1000"
                step="50"
                value={imageCacheDiskSize()}
                onInput={(e) => setImageCacheDiskSize(Number(e.currentTarget.value))}
                class="flex-1 h-1 rounded-[var(--borderRadiusCircular)] cursor-pointer"
                style={{ "accent-color": "var(--colorCompoundBrandBackground)" }}
              />
              <span class="[font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForegroundDisabled)]">
                1000
              </span>
            </div>
            <p class="text-[var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug mt-2">
              {t("imageCache.diskSizeNote", { size: imageCacheDiskSize() })}
            </p>
          </div>

          {/* 说明 */}
          <p class="text-[var(--fontSizeBase100)] text-[var(--colorNeutralForegroundDisabled)] text-center pt-2">
            {t("imageCache.independentNote")}
          </p>
        </div>
      </div>
    </PageTransition>
  );
};

export default ImageCacheSettings;
