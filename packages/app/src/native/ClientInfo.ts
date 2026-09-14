import { registerPlugin } from "@capacitor/core";

/**
 * Client 能力信息插件封装（ADR-0062）。
 *
 * getClientKinds() 返回当前包支持的 client 引擎列表：
 *   full → ["webview", "lynx"]；webview → ["webview"]；lynx 包无 Capacitor（本插件不可用）。
 *
 * webview 前端据此决定是否渲染"切换渲染引擎"入口。
 */
interface ClientInfoPlugin {
  getClientKinds(): Promise<{ kinds: string[] }>;
  /** 当前应用生效 locale（B10 i18n）：Android 13+ per-app language，跟随系统态经此桥校正 */
  getLocale(): Promise<{ languageTag: string }>;
  /** Activity 级重启（进程保留）：切换引擎后新 Activity 由入口路由按开关分发 */
  restart(): Promise<void>;
}

export const ClientInfo = registerPlugin<ClientInfoPlugin>("ClientInfo");
