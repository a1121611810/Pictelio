import { createSignal } from "solid-js";
import { settings } from "@/settings";
import type { UgoiraExtractMode } from "../api/illust";

// ── 类型定义 ──

export type ImageQuality = "medium" | "large" | "original";
export type LayoutMode = "waterfall" | "single" | "grid";
export type NovelLayoutMode = "list" | "coverWall" | "textList";

// ── 持久化键名 ──

const PREF_KEY_LAYOUT_MODE = "layout_mode";
const PREF_KEY_AUTO_HIDE_NAV_BAR = "auto_hide_nav_bar";
const PREF_KEY_SHOW_R18 = "show_r18";
const PREF_KEY_SHOW_R18G = "show_r18g";
const PREF_KEY_SHOW_DETAIL_STAIRS = "show_detail_stairs";
const PREF_KEY_AGE_CONFIRMED = "age_confirmed";
const PREF_KEY_IS_ADULT = "is_adult";
const PREF_KEY_AUTO_CHECK_UPDATE = "auto_check_update";
const PREF_KEY_NOVEL_LAYOUT_MODE = "novel_layout_mode";
const PREF_KEY_IMAGE_CACHE_DISK = "image_cache_disk";
const PREF_KEY_IMAGE_CACHE_BROWSER = "image_cache_browser";
const PREF_KEY_IMAGE_CACHE_PREFETCH = "image_cache_prefetch";
const PREF_KEY_IMAGE_CACHE_DISK_SIZE = "image_cache_disk_size";
const PREF_KEY_DISMISSED_UPDATE_VERSION = "dismissed_update_version";
const PREF_KEY_UGOIRA_MODE = "settings_ugoira_mode";

// ── 持久化设置（统一 settings registry 管理）──
// 各持久化项用 settings.define 声明，signal 状态由 registry 管理。
// 旧存储 key 与格式（bool 存 "true"/"false"、number 存 "300"、枚举存裸字符串）全部兼容。
// loadXxxPreference 均为兼容存根：数据加载已由 registry 的 hydrateAll 承担（Phase 4 接入），
// 但因 __root.tsx 仍调用它们，故保留空实现以维持签名。

// ── 布局 ──

const layoutModeHandle = settings.define<LayoutMode>({
  key: PREF_KEY_LAYOUT_MODE,
  default: "waterfall",
  validate: (v): v is LayoutMode => v === "waterfall" || v === "single" || v === "grid",
});

export const layoutMode = () => layoutModeHandle.value();
export async function setLayoutMode(mode: LayoutMode): Promise<void> {
  layoutModeHandle.set(mode);
  window.dispatchEvent(new CustomEvent("layoutModeChanged"));
}

/** 兼容存根：registry hydrateAll 已加载，Phase 4 移除 */
const novelLayoutModeHandle = settings.define<NovelLayoutMode>({
  key: PREF_KEY_NOVEL_LAYOUT_MODE,
  default: "list",
  validate: (v): v is NovelLayoutMode => v === "list" || v === "coverWall" || v === "textList",
});

export const novelLayoutMode = () => novelLayoutModeHandle.value();
export async function setNovelLayoutMode(mode: NovelLayoutMode): Promise<void> {
  novelLayoutModeHandle.set(mode);
  window.dispatchEvent(new CustomEvent("novelLayoutModeChanged"));
}

/** 兼容存根：registry hydrateAll 已加载，Phase 4 移除 */
const autoHideNavBarHandle = settings.define<boolean>({
  key: PREF_KEY_AUTO_HIDE_NAV_BAR,
  default: true,
});

export const autoHideNavBar = () => autoHideNavBarHandle.value();
export async function setAutoHideNavBar(enabled: boolean): Promise<void> {
  autoHideNavBarHandle.set(enabled);
}

/** 兼容存根：registry hydrateAll 已加载，Phase 4 移除 */
// ── 内容过滤 ──

const showR18Handle = settings.define<boolean>({
  key: PREF_KEY_SHOW_R18,
  default: false,
});

export const showR18 = () => showR18Handle.value();
export async function setShowR18(enabled: boolean): Promise<void> {
  showR18Handle.set(enabled);
  window.dispatchEvent(new CustomEvent("r18Changed"));
}

/** 兼容存根：registry hydrateAll 已加载，Phase 4 移除 */
const showR18GHandle = settings.define<boolean>({
  key: PREF_KEY_SHOW_R18G,
  default: false,
});

export const showR18G = () => showR18GHandle.value();
export async function setShowR18G(enabled: boolean): Promise<void> {
  showR18GHandle.set(enabled);
  window.dispatchEvent(new CustomEvent("r18gChanged"));
}

/** 兼容存根：registry hydrateAll 已加载，Phase 4 移除 */
const showDetailStairsHandle = settings.define<boolean>({
  key: PREF_KEY_SHOW_DETAIL_STAIRS,
  default: false,
});

export const showDetailStairs = () => showDetailStairsHandle.value();
export async function setShowDetailStairs(enabled: boolean): Promise<void> {
  showDetailStairsHandle.set(enabled);
}

/** 兼容存根：registry hydrateAll 已加载，Phase 4 移除 */
// ── 年龄确认（age_confirmed / is_adult 双键联动）──
// 「非成人强制关 R18/R18G」不能放 apply 钩子：hydrateAll 并行加载时，
// show_r18 的 hydrate 可能先于 is_adult 的 apply 写回 true，覆盖强制关闭值。
// 改为串行的 applyAgeRestriction()，在 hydrateAll 之后显式调用（__root.tsx）。
const ageConfirmedHandle = settings.define<boolean>({
  key: PREF_KEY_AGE_CONFIRMED,
  default: false,
});
const isAdultHandle = settings.define<boolean>({
  key: PREF_KEY_IS_ADULT,
  default: false,
});

export const ageConfirmed = () => ageConfirmedHandle.value();
export const isAdult = () => isAdultHandle.value();

/** 非成人强制关闭 R18/R18G 并持久化（原 loadAgePreference 语义，hydrateAll 后串行调用） */
export async function applyAgeRestriction(): Promise<void> {
  if (!isAdult()) {
    await setShowR18(false);
    await setShowR18G(false);
  }
}

/** 兼容存根：registry hydrateAll 已加载，Phase 4 移除 */
export async function setAgeConfirmation(confirmed: boolean, adult: boolean): Promise<void> {
  ageConfirmedHandle.set(confirmed);
  isAdultHandle.set(adult);
  // adult=false 时强制关 R18/R18G（与 applyAgeRestriction 相同语义）
  if (!adult) {
    await setShowR18(false);
    await setShowR18G(false);
  }
}

// ── 动图播放方案（T3）：fflate 默认 / range 流式取帧 ──

const ugoiraModeHandle = settings.define<UgoiraExtractMode>({
  key: PREF_KEY_UGOIRA_MODE,
  default: "fflate",
  validate: (v): v is UgoiraExtractMode => v === "fflate" || v === "range",
});

export const ugoiraMode = () => ugoiraModeHandle.value();
export async function setUgoiraMode(mode: UgoiraExtractMode): Promise<void> {
  ugoiraModeHandle.set(mode);
}

/** 兼容存根：registry hydrateAll 已加载，Phase 4 移除 */
// ── 图片缓存三层开关（ADR-0003）──
// A: Java 磁盘缓存 / B: 浏览器缓存头 / C: JS 预取，三项独立 define（key 各自持久化）。

const imageCacheDiskHandle = settings.define<boolean>({
  key: PREF_KEY_IMAGE_CACHE_DISK,
  default: true,
});
const imageCacheBrowserHandle = settings.define<boolean>({
  key: PREF_KEY_IMAGE_CACHE_BROWSER,
  default: true,
});
const imageCachePrefetchHandle = settings.define<boolean>({
  key: PREF_KEY_IMAGE_CACHE_PREFETCH,
  default: true,
});

export const imageCacheDisk = () => imageCacheDiskHandle.value();
export async function setImageCacheDisk(v: boolean): Promise<void> {
  imageCacheDiskHandle.set(v);
}

export const imageCacheBrowser = () => imageCacheBrowserHandle.value();
export async function setImageCacheBrowser(v: boolean): Promise<void> {
  imageCacheBrowserHandle.set(v);
}

export const imageCachePrefetch = () => imageCachePrefetchHandle.value();
export async function setImageCachePrefetch(v: boolean): Promise<void> {
  imageCachePrefetchHandle.set(v);
}

// 单位 MB，范围 50～1000，按 50 取整
const imageCacheDiskSizeHandle = settings.define<number>({
  key: PREF_KEY_IMAGE_CACHE_DISK_SIZE,
  default: 300,
});

export const imageCacheDiskSize = () => imageCacheDiskSizeHandle.value();
export async function setImageCacheDiskSize(v: number): Promise<void> {
  const clamped = Math.max(50, Math.min(1000, Math.round(v / 50) * 50));
  imageCacheDiskSizeHandle.set(clamped);
}

// ── 更新检测 ──

const autoCheckUpdateHandle = settings.define<boolean>({
  key: PREF_KEY_AUTO_CHECK_UPDATE,
  default: true,
});

export const autoCheckUpdate = () => autoCheckUpdateHandle.value();
export async function setAutoCheckUpdate(enabled: boolean): Promise<void> {
  autoCheckUpdateHandle.set(enabled);
}

/** 兼容存根：registry hydrateAll 已加载，Phase 4 移除 */
const lastDismissedVersionHandle = settings.define<string>({
  key: PREF_KEY_DISMISSED_UPDATE_VERSION,
  default: "",
});

export const lastDismissedVersion = () => lastDismissedVersionHandle.value();
export async function setLastDismissedVersion(v: string): Promise<void> {
  lastDismissedVersionHandle.set(v);
}

/** 兼容存根：registry hydrateAll 已加载，Phase 4 移除 */
// ── 图片质量（纯内存，不持久化）──

const [listQuality, setListQuality] = createSignal<ImageQuality>("medium");
const [detailQuality, setDetailQuality] = createSignal<ImageQuality>("medium");
export { listQuality, setListQuality, detailQuality, setDetailQuality };

// ── 更新检测运行态（纯内存，不持久化）──

const [hasUpdate, setHasUpdate] = createSignal(false);
const [latestVersion, setLatestVersion] = createSignal("");
const [latestReleaseUrl, setLatestReleaseUrl] = createSignal("");
const [latestChangelog, setLatestChangelog] = createSignal("");
const [isCheckingUpdate, setIsCheckingUpdate] = createSignal(false);
const [checkCompleted, setCheckCompleted] = createSignal(false);
const [showUpdateDialog, setShowUpdateDialog] = createSignal(false);
export {
  hasUpdate,
  setHasUpdate,
  latestVersion,
  setLatestVersion,
  latestReleaseUrl,
  setLatestReleaseUrl,
  latestChangelog,
  setLatestChangelog,
  isCheckingUpdate,
  setIsCheckingUpdate,
  checkCompleted,
  setCheckCompleted,
  showUpdateDialog,
  setShowUpdateDialog,
};

// ── 重置所有设置到默认值 ──

/** 重置所有设置项为默认值，并尽可能持久化。 */
export async function resetSettingsStore(): Promise<void> {
  setListQuality("medium");
  setDetailQuality("medium");
  await setAutoHideNavBar(true);
  await setImageCacheDisk(true);
  await setImageCacheBrowser(true);
  await setImageCachePrefetch(true);
  await setImageCacheDiskSize(300);
  await setShowR18(false);
  await setShowR18G(false);
  await setLayoutMode("waterfall");
  await setNovelLayoutMode("list");
  await setShowDetailStairs(false);
  await setAgeConfirmation(false, false);
  await setAutoCheckUpdate(true);
  await setLastDismissedVersion("");
  setHasUpdate(false);
  setLatestVersion("");
  setLatestReleaseUrl("");
  setLatestChangelog("");
  setIsCheckingUpdate(false);
  setCheckCompleted(false);
  setShowUpdateDialog(false);
}
