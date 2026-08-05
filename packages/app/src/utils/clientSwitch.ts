// ─── Client 切换（webview ↔ lynx） ───
// 与 app-lynx 原生侧共用契约：SharedPreferences 文件 "CapacitorStorage"（@capacitor/preferences
// 默认 group）的 key "pictelio_client_kind" —— MainActivity 入口路由与
// PictelioAppModule（Lynx Native Module）读取同一 key 同一文件，两侧切换互通。
import { settings, type SettingHandle } from "@/settings";

export type ClientKind = "webview" | "lynx";

export const CLIENT_KIND_KEY = "pictelio_client_kind";
/** 主应用（pictelio-app）自身是 webview client */
export const DEFAULT_CLIENT: ClientKind = "webview";

const clientKindSetting: SettingHandle<ClientKind> = settings.define<ClientKind>({
  key: CLIENT_KIND_KEY,
  default: DEFAULT_CLIENT,
  validate: (v): v is ClientKind => v === "lynx" || v === "webview",
});

/** 读取当前 client（无记录/异常 → webview 默认） */
export async function readClientKind(): Promise<ClientKind> {
  // 显式 hydrate：从 Preferences 读权威值（此键不参与启动批量加载，按需读取）
  await clientKindSetting.hydrate();
  return clientKindSetting.value();
}

/** 写入 client 开关（原生重启后 MainActivity 按此分发到 LynxActivity） */
export async function setClientKind(kind: ClientKind): Promise<void> {
  // 确保 write gate 已打开（若启动 hydrateAll 尚未执行，先加载一次以允许落盘）
  await settings.hydrateAll();
  clientKindSetting.set(kind);
}

/**
 * ADR-0062：当前包是否支持引擎切换（同时含 webview 与 lynx）。
 * null/undefined（未知）保守视为支持——web 开发环境无原生插件，保持 full 行为。
 * 空数组/非法值 → 不支持（与 lynx 侧 normalizeKinds 契约一致）。
 */
export function supportsClientSwitch(kinds: unknown): boolean {
  if (kinds === null || kinds === undefined) return true;
  if (!Array.isArray(kinds)) return false;
  return kinds.includes("webview") && kinds.includes("lynx");
}
