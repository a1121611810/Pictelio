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

/**
 * 图片缓存设置页 — A（磁盘缓存）/ B（浏览器缓存）/ C（后台预取）三个独立开关。
 *
 * 布局参照 ImageHostSettings 和 About 页面风格：
 * surface-flyout 容器 + fluent-switch + 说明文字。
 */
const ImageCacheSettings: Component = () => {
  return (
    <div class="page">
      {/* Header */}
      <div class="flex items-center gap-3 p-4 border-b border-[var(--colorNeutralStroke2)]">
        <button
          class="text-[var(--colorNeutralForeground2)] hover:text-[var(--colorNeutralForeground1)]
                 p-1 -ml-1 min-w-[40px] min-h-[40px] flex items-center justify-center
                 focus-visible:outline-2 focus-visible:outline-[var(--colorStrokeFocus2)] focus-visible:outline-offset-2"
          onClick={() => goBack()}
          aria-label="返回"
        >
          ←
        </button>
        <h1 class="text-[var(--fontSizeHero700)] font-semibold text-[var(--colorNeutralForeground1)]">
          图片缓存
        </h1>
      </div>

      <div class="p-4 space-y-4">
        {/* A: 磁盘缓存 */}
        <div class="surface-flyout p-4">
          <div class="flex items-center justify-between mb-2">
            <h2 class="text-[var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)]">
              磁盘缓存
            </h2>
            <fluent-switch
              checked={imageCacheDisk()}
              onChange={(e: Event) => setImageCacheDisk((e.target as HTMLInputElement).checked)}
              aria-label="启用磁盘缓存"
            />
          </div>
          <p class="text-[var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
            将图片缓存到本地文件。开启后：重复浏览无需重新下载，
            重启应用后缓存仍在。磁盘缓存上限可在下方调节。
          </p>
        </div>

        {/* B: 浏览器缓存 */}
        <div class="surface-flyout p-4">
          <div class="flex items-center justify-between mb-2">
            <h2 class="text-[var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)]">
              浏览器缓存
            </h2>
            <fluent-switch
              checked={imageCacheBrowser()}
              onChange={(e: Event) => setImageCacheBrowser((e.target as HTMLInputElement).checked)}
              aria-label="启用浏览器缓存"
            />
          </div>
          <p class="text-[var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
            通过 HTTP 缓存头让浏览器缓存图片。开启后：同一张图在本次启动内
            不再请求网络，回滚浏览立即显示。
          </p>
        </div>

        {/* C: 后台预取 */}
        <div class="surface-flyout p-4">
          <div class="flex items-center justify-between mb-2">
            <h2 class="text-[var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)]">
              后台预取
            </h2>
            <fluent-switch
              checked={imageCachePrefetch()}
              onChange={(e: Event) => setImageCachePrefetch((e.target as HTMLInputElement).checked)}
              aria-label="启用后台预取"
            />
          </div>
          <p class="text-[var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
            提前加载视口外的图片。开启后：滚动更流畅，但消耗更多流量。 流量敏感用户建议关闭。
          </p>
        </div>

        {/* 磁盘缓存上限 */}
        <div class="surface-flyout p-4">
          <div class="flex items-center justify-between mb-2">
            <h2 class="text-[var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)]">
              磁盘缓存上限
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
            当前最多缓存约 {imageCacheDiskSize()} MB。 修改后新写入的缓存文件按新上限淘汰。
          </p>
        </div>

        {/* 说明 */}
        <p class="text-[var(--fontSizeBase100)] text-[var(--colorNeutralForegroundDisabled)] text-center pt-2">
          三个开关各自独立，修改后立即生效。
        </p>
      </div>
    </div>
  );
};

export default ImageCacheSettings;
