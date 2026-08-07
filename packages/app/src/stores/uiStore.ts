import { settings } from "@/settings";
import { scrollToTop } from "@/utils/scrollToTop";

type Tab = "recommended" | "follow" | "bookmarks" | "me" | "history";
export type { Tab };
export type ContentType = "illust" | "novel";

/** 布局模式 → 列数映射 */
export const MODE_COLUMNS: Record<string, number> = {
  waterfall: 2,
  single: 1,
  grid: 3,
};

const PREF_KEY_CONTENT_TYPE = "content_type";

// ── Store ──

const initialState = () => ({
  // 导航
  currentTab: "recommended" as Tab,
});

const [state, setState] = createStore(initialState());

// ── 内容类型（统一 settings registry 管理）──
// 旧存储 key 与格式（枚举存裸字符串）兼容。contentType 状态由 registry 管理，
// 不再走独立 Preferences 读写；set 为乐观更新（registry v1 决定：set 不返回失败，
// 持久化失败由 registry 内部 onError 兜底 warn，不再回滚 state）。

const contentTypeHandle = settings.define<ContentType>({
  key: PREF_KEY_CONTENT_TYPE,
  default: "illust",
  validate: (v): v is ContentType => v === "illust" || v === "novel",
});

// ── 向后兼容的导出包装函数 ──

export const currentTab = () => state.currentTab;
export const setCurrentTab = (tab: Tab) => setState("currentTab", tab);

export const contentType = () => contentTypeHandle.value();

/**
 * 设置内容类型。
 *
 * 乐观更新语义（registry v1 决定）：handle.set 同步更新内存并异步持久化；
 * 原实现「Preferences.set 失败回滚 state」不再保留——set 不返回失败，
 * 持久化失败由 registry 内部 warn 兜底，state 保持新值。
 */
export async function setContentType(type: ContentType): Promise<void> {
  if (type === contentTypeHandle.value()) {
    return;
  }
  contentTypeHandle.set(type);
  window.dispatchEvent(new CustomEvent("contentTypeChanged"));
  // contentType 是页内状态切换（非路由导航），@solidjs/router 的 scrollRestoration
  // 不介入；切换瞬间旧 feed 卸载 → 文档高度骤减 → 浏览器把 scrollY clamp 到中间值，
  // 新 feed 数据到达后停在非顶部位置（模拟器实测，bug 1）。
  // 注意必须等 Solid 响应式 DOM 切换完成后再回顶：setContentType 的同步代码在
  // Solid 批处理更新（microtask）之前执行，立即 scrollToTop 只作用于旧文档，
  // 切换后 scrollY 仍会被 clamp 到中间值。
  if (typeof window !== "undefined") {
    setTimeout(() => scrollToTop(), 0);
  }
}

/** 兼容存根：registry hydrateAll 已加载，Phase 4 移除 */
/** 重置所有 UI 设置为默认值。委托给 settingsStore 重置。 */
export async function resetUiStore(): Promise<void> {
  const { setThemePersisted } = await import("./themeStore");
  await setThemePersisted("system");
  const { resetSettingsStore } = await import("./settingsStore");
  await resetSettingsStore();
}
