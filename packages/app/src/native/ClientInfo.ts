import { registerPlugin } from "@capacitor/core";

/**
 * Client 能力信息插件封装（ADR-0062）。
 *
 * getClientKinds() 返回当前包支持的 client 引擎列表：
 *   full → ["webview", "lynx"]；webview → ["webview"]；lynx 包无 Capacitor（本插件不可用）。
 *
 * webview 前端据此决定是否渲染"切换渲染引擎"入口。
 */
export interface ClientInfoPlugin {
  getClientKinds(): Promise<{ kinds: string[] }>;
}

export const ClientInfo = registerPlugin<ClientInfoPlugin>("ClientInfo");
