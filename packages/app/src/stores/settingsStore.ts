import { createSignal } from "solid-js";
import { settings } from "@/settings";
import { user } from "@/stores/authStore";
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
const PREF_KEY_AUTO_CHECK_UPDATE = "auto_check_update";
const PREF_KEY_NOVEL_LAYOUT_MODE = "novel_layout_mode";
const PREF_KEY_IMAGE_CACHE_DISK = "image_cache_disk";
const PREF_KEY_IMAGE_CACHE_BROWSER = "image_cache_browser";
const PREF_KEY_IMAGE_CACHE_PREFETCH = "image_cache_prefetch";
const PREF_KEY_IMAGE_CACHE_DISK_SIZE = "image_cache_disk_size";
const PREF_KEY_DISMISSED_UPDATE_VERSION = "dismissed_update_version";
const PREF_KEY_OTA_LAST_KNOWN_FLOOR = "ota_last_known_floor";
const PREF_KEY_OTA_AUTO_DOWNLOAD = "ota_auto_download";
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

// ── 内容过滤（ADR-0103：账号级设置，键 show_r18_${uid}，跨 client 共享存储）──
// 键随登录账号：换号各自独立；登出后 uid 为 null → accessor 返回默认 false（不落盘）。
// 迁移：老设备级键（PREF_KEY_SHOW_R18）经 registry legacyKeys 播种当前账号并删老键。

/** 当前登录账号 ID（未登录 null） */
const uid = () => user()?.id ?? null;

const r18Factory = settings.defineFactory<boolean>({
  keyPrefix: PREF_KEY_SHOW_R18,
  default: false,
  legacyKeys: [PREF_KEY_SHOW_R18],
});

export const showR18 = () => {
  const id = uid();
  return id !== null ? r18Factory.forId(id).value() : false;
};
export async function setShowR18(enabled: boolean): Promise<void> {
  const id = uid();
  if (id === null) return; // 未登录：不落盘（账号级语义）
  r18Factory.forId(id).set(enabled);
  window.dispatchEvent(new CustomEvent("r18Changed"));
}

const r18gFactory = settings.defineFactory<boolean>({
  keyPrefix: PREF_KEY_SHOW_R18G,
  default: false,
  legacyKeys: [PREF_KEY_SHOW_R18G],
});

export const showR18G = () => {
  const id = uid();
  return id !== null ? r18gFactory.forId(id).value() : false;
};
export async function setShowR18G(enabled: boolean): Promise<void> {
  const id = uid();
  if (id === null) return;
  r18gFactory.forId(id).set(enabled);
  window.dispatchEvent(new CustomEvent("r18gChanged"));
}

/**
 * 登录后加载当前账号的 R18/R18G（__root 在 initializeAuth 后 + 各登录成功分支调用）。
 * 顺带一次性清理已移除年龄功能的孤儿键（幂等：键不存在 remove 为 no-op）。
 */
export async function loadAccountR18(): Promise<void> {
  const id = uid();
  if (id === null) return;
  await Promise.all([r18Factory.forId(id).hydrate(), r18gFactory.forId(id).hydrate()]);
  await Promise.all([settings.remove("age_confirmed"), settings.remove("is_adult")]).catch((e) =>
    console.warn("[settingsStore] 孤儿键清理失败", e),
  );
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
// ── 图片缓存三层开关（ADR-0090）──
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

/** OTA floor 缓存（#251）：最近一次成功检查到的 minWebVersion，供检查失败/离线时零延迟判定 */
const otaLastKnownFloorHandle = settings.define<string>({
  key: PREF_KEY_OTA_LAST_KNOWN_FLOOR,
  default: "",
});

export const otaLastKnownFloor = () => otaLastKnownFloorHandle.value();
export async function setOtaLastKnownFloor(v: string): Promise<void> {
  otaLastKnownFloorHandle.set(v);
}

/** OTA 自动下载开关（#254，默认开）：关闭后 T0 静默预热不下载（启动仍报告可用版本）；
 * 强制门槛的自愈与阻断不受此开关抑制（完整性机制，规格「检查与调度：开关边界」） */
const otaAutoDownloadHandle = settings.define<boolean>({
  key: PREF_KEY_OTA_AUTO_DOWNLOAD,
  default: true,
});

export const otaAutoDownload = () => otaAutoDownloadHandle.value();
export async function setOtaAutoDownload(enabled: boolean): Promise<void> {
  otaAutoDownloadHandle.set(enabled);
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
