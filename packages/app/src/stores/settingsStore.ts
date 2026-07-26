import { createStore, produce } from "solid-js/store";
import { Preferences } from "@capacitor/preferences";

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
const PREF_KEY_USE_DNS_OVERRIDE = "use_dns_override";
const PREF_KEY_NOVEL_LAYOUT_MODE = "novel_layout_mode";
const PREF_KEY_IMAGE_CACHE_DISK = "image_cache_disk";
const PREF_KEY_IMAGE_CACHE_BROWSER = "image_cache_browser";
const PREF_KEY_IMAGE_CACHE_PREFETCH = "image_cache_prefetch";
const PREF_KEY_IMAGE_CACHE_DISK_SIZE = "image_cache_disk_size";
const PREF_KEY_DISMISSED_UPDATE_VERSION = "dismissed_update_version";

// ── Store ──

const initialState = () => ({
  // 布局
  layoutMode: "waterfall" as LayoutMode,
  novelLayoutMode: "list" as NovelLayoutMode,
  autoHideNavBar: true,

  // 内容过滤
  showR18: false,
  showR18G: false,
  showDetailStairs: false,

  // 年龄确认
  ageConfirmed: false,
  isAdult: false,

  // 图片质量
  listQuality: "medium" as ImageQuality,
  detailQuality: "medium" as ImageQuality,

  // 图片缓存三层开关（ADR-0003）
  // A: Java 磁盘缓存
  imageCacheDisk: true,
  // B: 浏览器缓存头
  imageCacheBrowser: true,
  // C: JS 预取
  imageCachePrefetch: true,
  // 单位 MB，范围 50～1000
  imageCacheDiskSize: 300,

  // 更新检测
  autoCheckUpdate: true,
  hasUpdate: false,
  latestVersion: "",
  latestReleaseUrl: "",
  latestChangelog: "",
  isCheckingUpdate: false,
  checkCompleted: false,
  lastDismissedVersion: "",
  showUpdateDialog: false,

  // 自定义 DNS 解析（实验性，仅 Android）
  useDnsOverride: false,
});

const [state, setState] = createStore(initialState());

// ── 向后兼容的导出包装函数 ──

// ── 布局 ──

export const layoutMode = () => state.layoutMode;
export const setLayoutMode = async (mode: LayoutMode): Promise<void> => {
  setState("layoutMode", mode);
  try {
    await Preferences.set({ key: PREF_KEY_LAYOUT_MODE, value: mode });
  } catch (error) {
    console.warn("[settingsStore] Failed to persist layoutMode", error);
  }
  window.dispatchEvent(new CustomEvent("layoutModeChanged"));
};

export async function loadLayoutModePreference(): Promise<void> {
  try {
    const { value } = await Preferences.get({ key: PREF_KEY_LAYOUT_MODE });
    if (value !== null && (value === "waterfall" || value === "single" || value === "grid")) {
      setState("layoutMode", value as LayoutMode);
    }
  } catch (error) {
    console.warn("[settingsStore] Failed to load layoutMode preference", error);
  }
}

export const novelLayoutMode = () => state.novelLayoutMode;
export const setNovelLayoutMode = async (mode: NovelLayoutMode): Promise<void> => {
  setState("novelLayoutMode", mode);
  try {
    await Preferences.set({ key: PREF_KEY_NOVEL_LAYOUT_MODE, value: mode });
  } catch (error) {
    console.warn("[settingsStore] Failed to persist novelLayoutMode", error);
  }
  window.dispatchEvent(new CustomEvent("novelLayoutModeChanged"));
};

export async function loadNovelLayoutModePreference(): Promise<void> {
  try {
    const { value } = await Preferences.get({ key: PREF_KEY_NOVEL_LAYOUT_MODE });
    if (value !== null && (value === "list" || value === "coverWall" || value === "textList")) {
      setState("novelLayoutMode", value as NovelLayoutMode);
    }
  } catch (error) {
    console.warn("[settingsStore] Failed to load novelLayoutMode preference", error);
  }
}

export const autoHideNavBar = () => state.autoHideNavBar;
export async function setAutoHideNavBar(enabled: boolean): Promise<void> {
  setState("autoHideNavBar", enabled);
  try {
    await Preferences.set({ key: PREF_KEY_AUTO_HIDE_NAV_BAR, value: String(enabled) });
  } catch (error) {
    console.warn("[settingsStore] Failed to persist autoHideNavBar", error);
  }
}

export async function loadAutoHideNavBarPreference(): Promise<void> {
  try {
    const { value } = await Preferences.get({ key: PREF_KEY_AUTO_HIDE_NAV_BAR });
    if (value !== null) {
      setState("autoHideNavBar", value === "true");
    }
  } catch (error) {
    console.warn("[settingsStore] Failed to load autoHideNavBar preference", error);
  }
}

// ── 内容过滤 ──

export const showR18 = () => state.showR18;
export async function setShowR18(enabled: boolean): Promise<void> {
  setState("showR18", enabled);
  try {
    await Preferences.set({ key: PREF_KEY_SHOW_R18, value: String(enabled) });
  } catch (error) {
    console.warn("[settingsStore] Failed to persist showR18", error);
  }
  window.dispatchEvent(new CustomEvent("r18Changed"));
}

export async function loadShowR18Preference(): Promise<void> {
  try {
    const { value } = await Preferences.get({ key: PREF_KEY_SHOW_R18 });
    if (value !== null) {
      setState("showR18", value === "true");
    }
  } catch (error) {
    console.warn("[settingsStore] Failed to load showR18 preference", error);
  }
}

export const showR18G = () => state.showR18G;
export async function setShowR18G(enabled: boolean): Promise<void> {
  setState("showR18G", enabled);
  try {
    await Preferences.set({ key: PREF_KEY_SHOW_R18G, value: String(enabled) });
  } catch (error) {
    console.warn("[settingsStore] Failed to persist showR18G", error);
  }
  window.dispatchEvent(new CustomEvent("r18gChanged"));
}

export async function loadShowR18GPreference(): Promise<void> {
  try {
    const { value } = await Preferences.get({ key: PREF_KEY_SHOW_R18G });
    if (value !== null) {
      setState("showR18G", value === "true");
    }
  } catch (error) {
    console.warn("[settingsStore] Failed to load showR18G preference", error);
  }
}

export const showDetailStairs = () => state.showDetailStairs;
export async function setShowDetailStairs(enabled: boolean): Promise<void> {
  setState("showDetailStairs", enabled);
  try {
    await Preferences.set({ key: PREF_KEY_SHOW_DETAIL_STAIRS, value: String(enabled) });
  } catch (error) {
    console.warn("[settingsStore] Failed to persist showDetailStairs", error);
  }
}

export async function loadShowDetailStairsPreference(): Promise<void> {
  try {
    const { value } = await Preferences.get({ key: PREF_KEY_SHOW_DETAIL_STAIRS });
    if (value !== null) {
      setState("showDetailStairs", value === "true");
    }
  } catch (error) {
    console.warn("[settingsStore] Failed to load showDetailStairs preference", error);
  }
}

// ── 年龄确认 ──

export const ageConfirmed = () => state.ageConfirmed;
export const isAdult = () => state.isAdult;

export async function loadAgePreference(): Promise<void> {
  try {
    const [{ value: confirmed }, { value: adult }] = await Promise.all([
      Preferences.get({ key: PREF_KEY_AGE_CONFIRMED }),
      Preferences.get({ key: PREF_KEY_IS_ADULT }),
    ]);
    setState(
      produce((s) => {
        if (confirmed !== null) {
          s.ageConfirmed = confirmed === "true";
        }
        if (adult !== null) {
          s.isAdult = adult === "true";
        }
      }),
    );
  } catch (error) {
    console.warn("[settingsStore] Failed to load age preference", error);
  }

  // 如果用户不是成年人，强制关闭 R-18/R-18G 并持久化
  if (!state.isAdult) {
    await setShowR18(false);
    await setShowR18G(false);
  }
}

export async function setAgeConfirmation(confirmed: boolean, adult: boolean): Promise<void> {
  setState(
    produce((s) => {
      s.ageConfirmed = confirmed;
      s.isAdult = adult;
    }),
  );
  try {
    await Preferences.set({ key: PREF_KEY_AGE_CONFIRMED, value: String(confirmed) });
    await Preferences.set({ key: PREF_KEY_IS_ADULT, value: String(adult) });
  } catch (error) {
    console.warn("[settingsStore] Failed to persist age confirmation", error);
  }
  if (!adult) {
    await setShowR18(false);
    await setShowR18G(false);
  }
}

// ── 图片质量 ──

export const listQuality = () => state.listQuality;
export const setListQuality = (q: ImageQuality) => setState("listQuality", q);

export const detailQuality = () => state.detailQuality;
export const setDetailQuality = (q: ImageQuality) => setState("detailQuality", q);

// ── 图片缓存三层开关（ADR-0003）──

export const imageCacheDisk = () => state.imageCacheDisk;
export const setImageCacheDisk = async (v: boolean): Promise<void> => {
  setState("imageCacheDisk", v);
  try {
    await Preferences.set({ key: PREF_KEY_IMAGE_CACHE_DISK, value: String(v) });
  } catch (error) {
    console.warn("[settingsStore] Failed to persist imageCacheDisk", error);
  }
};

export const imageCacheBrowser = () => state.imageCacheBrowser;
export const setImageCacheBrowser = async (v: boolean): Promise<void> => {
  setState("imageCacheBrowser", v);
  try {
    await Preferences.set({ key: PREF_KEY_IMAGE_CACHE_BROWSER, value: String(v) });
  } catch (error) {
    console.warn("[settingsStore] Failed to persist imageCacheBrowser", error);
  }
};

export const imageCachePrefetch = () => state.imageCachePrefetch;
export const setImageCachePrefetch = async (v: boolean): Promise<void> => {
  setState("imageCachePrefetch", v);
  try {
    await Preferences.set({ key: PREF_KEY_IMAGE_CACHE_PREFETCH, value: String(v) });
  } catch (error) {
    console.warn("[settingsStore] Failed to persist imageCachePrefetch", error);
  }
};

export const imageCacheDiskSize = () => state.imageCacheDiskSize;
export const setImageCacheDiskSize = async (v: number): Promise<void> => {
  const clamped = Math.max(50, Math.min(1000, Math.round(v / 50) * 50));
  setState("imageCacheDiskSize", clamped);
  try {
    await Preferences.set({ key: PREF_KEY_IMAGE_CACHE_DISK_SIZE, value: String(clamped) });
  } catch (error) {
    console.warn("[settingsStore] Failed to persist imageCacheDiskSize", error);
  }
};

export async function loadImageCachePrefs(): Promise<void> {
  try {
    const disk = await Preferences.get({ key: PREF_KEY_IMAGE_CACHE_DISK });
    if (disk.value !== null) {
      setState("imageCacheDisk", disk.value === "true");
    }
    const browser = await Preferences.get({ key: PREF_KEY_IMAGE_CACHE_BROWSER });
    if (browser.value !== null) {
      setState("imageCacheBrowser", browser.value === "true");
    }
    const prefetch = await Preferences.get({ key: PREF_KEY_IMAGE_CACHE_PREFETCH });
    if (prefetch.value !== null) {
      setState("imageCachePrefetch", prefetch.value === "true");
    }
    const size = await Preferences.get({ key: PREF_KEY_IMAGE_CACHE_DISK_SIZE });
    if (size.value !== null) {
      setState("imageCacheDiskSize", parseInt(size.value, 10));
    }
  } catch (error) {
    console.warn("[settingsStore] Failed to load image cache prefs", error);
  }
}

// ── 更新检测 ──

export const autoCheckUpdate = () => state.autoCheckUpdate;
export async function setAutoCheckUpdate(enabled: boolean): Promise<void> {
  setState("autoCheckUpdate", enabled);
  try {
    await Preferences.set({ key: PREF_KEY_AUTO_CHECK_UPDATE, value: String(enabled) });
  } catch (error) {
    console.warn("[settingsStore] Failed to persist autoCheckUpdate", error);
  }
}

export async function loadAutoCheckUpdatePreference(): Promise<void> {
  try {
    const { value } = await Preferences.get({ key: PREF_KEY_AUTO_CHECK_UPDATE });
    if (value !== null) {
      setState("autoCheckUpdate", value === "true");
    }
  } catch (error) {
    console.warn("[settingsStore] Failed to load autoCheckUpdate preference", error);
  }
}

export const hasUpdate = () => state.hasUpdate;
export const setHasUpdate = (v: boolean) => setState("hasUpdate", v);

export const latestVersion = () => state.latestVersion;
export const setLatestVersion = (v: string) => setState("latestVersion", v);

export const latestReleaseUrl = () => state.latestReleaseUrl;
export const setLatestReleaseUrl = (v: string) => setState("latestReleaseUrl", v);

export const latestChangelog = () => state.latestChangelog;
export const setLatestChangelog = (v: string) => setState("latestChangelog", v);

export const isCheckingUpdate = () => state.isCheckingUpdate;
export const setIsCheckingUpdate = (v: boolean) => setState("isCheckingUpdate", v);

export const checkCompleted = () => state.checkCompleted;
export const setCheckCompleted = (v: boolean) => setState("checkCompleted", v);

export const lastDismissedVersion = () => state.lastDismissedVersion;
export async function setLastDismissedVersion(v: string): Promise<void> {
  setState("lastDismissedVersion", v);
  try {
    await Preferences.set({ key: PREF_KEY_DISMISSED_UPDATE_VERSION, value: v });
  } catch (error) {
    console.warn("[settingsStore] Failed to persist dismissed update version", error);
  }
}

export async function loadLastDismissedVersionPreference(): Promise<void> {
  try {
    const { value } = await Preferences.get({ key: PREF_KEY_DISMISSED_UPDATE_VERSION });
    if (value !== null) {
      setState("lastDismissedVersion", value);
    }
  } catch (error) {
    console.warn("[settingsStore] Failed to load dismissed update version preference", error);
  }
}

export const showUpdateDialog = () => state.showUpdateDialog;
export const setShowUpdateDialog = (v: boolean) => setState("showUpdateDialog", v);

// ── 自定义 DNS 解析 ──

export const useDnsOverride = () => state.useDnsOverride;
export async function setUseDnsOverride(enabled: boolean): Promise<void> {
  setState("useDnsOverride", enabled);
  try {
    await Preferences.set({ key: PREF_KEY_USE_DNS_OVERRIDE, value: String(enabled) });
  } catch (error) {
    console.warn("[settingsStore] Failed to persist useDnsOverride", error);
  }
}

export async function loadUseDnsOverridePreference(): Promise<void> {
  try {
    const { value } = await Preferences.get({ key: PREF_KEY_USE_DNS_OVERRIDE });
    if (value !== null) {
      setState("useDnsOverride", value === "true");
    }
  } catch (error) {
    console.warn("[settingsStore] Failed to load useDnsOverride preference", error);
  }
}

// ── 重置所有设置到默认值 ──

/** 重置所有设置项为默认值，并尽可能持久化。 */
export async function resetSettingsStore(): Promise<void> {
  setState("listQuality", "medium");
  setState("detailQuality", "medium");
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
  await setUseDnsOverride(false);
}
