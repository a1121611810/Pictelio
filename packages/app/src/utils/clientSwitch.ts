// ─── Client 切换（webview ↔ lynx） ───
// 与 app-lynx 原生侧共用契约：SharedPreferences 文件 "CapacitorStorage"（@capacitor/preferences
// 默认 group）的 key "pictelio_client_kind" —— MainActivity 入口路由与
// PictelioAppModule（Lynx Native Module）读取同一 key 同一文件，两侧切换互通。
import { Preferences } from "@capacitor/preferences";

export type ClientKind = "webview" | "lynx";

export const CLIENT_KIND_KEY = "pictelio_client_kind";
/** 主应用（pictelio-app）自身是 webview client */
export const DEFAULT_CLIENT: ClientKind = "webview";

/** 读取当前 client（无记录/异常 → webview 默认） */
export async function readClientKind(): Promise<ClientKind> {
  try {
    const { value } = await Preferences.get({ key: CLIENT_KIND_KEY });
    return value === "lynx" || value === "webview" ? value : DEFAULT_CLIENT;
  } catch (e) {
    // 禁止静默降级：读取失败按默认处理并告警
    console.warn("[clientSwitch] 读取 client 开关失败（按 webview 处理）", e);
    return DEFAULT_CLIENT;
  }
}

/** 写入 client 开关（原生重启后 MainActivity 按此分发到 LynxActivity） */
export async function setClientKind(kind: ClientKind): Promise<void> {
  await Preferences.set({ key: CLIENT_KIND_KEY, value: kind });
}
