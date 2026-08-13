// ─── Client 切换（webview ↔ lynx） ───
// 深模块：小接口（readClientKind / switchClient / supportsClientSwitch）+ 内部编排
//（in-flight 锁、5s 写入超时、单键直写、原生重启 fallback）。
// 契约：SharedPreferences 文件 "CapacitorStorage"（@capacitor/preferences 默认 group）
// 的 key "pictelio_client_kind" —— MainActivity 入口路由与 PictelioAppModule
//（Lynx Native Module）读取同一 key 同一文件，两侧切换互通。
// 读写均直对 @capacitor/preferences 单键，不依赖 settings 层（其 write gate 隐式契约
// 会迫使调用方全量 hydrateAll 29 个 key —— 切换卡顿根因，见 issue #120 Further Notes）。
import { Preferences } from "@capacitor/preferences";
import { App } from "@capacitor/app";
import { ClientInfo } from "@/native/ClientInfo";

export type ClientKind = "webview" | "lynx";

export const CLIENT_KIND_KEY = "pictelio_client_kind";
/** 主应用（pictelio-app）自身是 webview client */
export const DEFAULT_CLIENT: ClientKind = "webview";

/** 切换结果：error modes 显式声明（接口契约的一部分，UI 据此映射 toast） */
type SwitchOutcome =
  | { ok: true }
  | { ok: false; reason: "busy" | "write-failed" | "timeout" | "restart-failed" };

/** 开关写入超时（ms）：切换是用户主动一次性操作，5s 未完成视为失败并给出反馈 */
const WRITE_TIMEOUT_MS = 5_000;

/** 读取当前 client（无记录/异常 → webview 默认） */
export async function readClientKind(): Promise<ClientKind> {
  try {
    const { value } = await Preferences.get({ key: CLIENT_KIND_KEY });
    return value === "lynx" || value === "webview" ? value : DEFAULT_CLIENT;
  } catch (e) {
    console.warn("[clientSwitch] 读取 client kind 失败，默认 webview", e);
    return DEFAULT_CLIENT;
  }
}

/** 内部：写入开关（读/写同路径，直对 Preferences 单键；进程切换后内存态无需同步） */
async function writeClientKind(kind: ClientKind): Promise<void> {
  await Preferences.set({ key: CLIENT_KIND_KEY, value: kind });
}

/** 写入失败（区别于超时，供 SwitchOutcome 区分 reason） */
class WriteFailedError extends Error {}

/** in-flight 锁：连点/并发只允许一个切换在途（防连点重复触发） */
let switching = false;

/**
 * 切换渲染引擎（深模块唯一编排入口）。
 * 时序：写开关（5s 超时）→ 原生 restart（Activity 级切换，进程保留）。
 * Web 环境无原生插件 → fallback App.exitApp（仅提示）。
 * 返回 SwitchOutcome；本模块不触碰 UI，调用方据此映射 toast。
 */
export async function switchClient(kind: ClientKind): Promise<SwitchOutcome> {
  if (switching) return { ok: false, reason: "busy" };
  switching = true;
  try {
    // 写开关（5s 超时；超时分支 clear timer 防残留）
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        writeClientKind(kind).catch(() => {
          throw new WriteFailedError("write-failed");
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), WRITE_TIMEOUT_MS);
        }),
      ]);
    } catch (e) {
      return { ok: false, reason: e instanceof WriteFailedError ? "write-failed" : "timeout" };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    // 写入成功 → 原生重启（Activity 级切换）；锁保持到 restart 完成，防连点二次 restart。
    // restart（CLEAR_TASK）后旧 JS 上下文销毁重建，switching 归零，无残留。
    try {
      await ClientInfo.restart();
      return { ok: true };
    } catch {
      try {
        await App.exitApp();
        return { ok: true };
      } catch (e) {
        console.warn("[clientSwitch] 原生重启与 exitApp 均不可用（Web 环境）——请手动重启应用", e);
        return { ok: false, reason: "restart-failed" };
      }
    }
  } finally {
    switching = false;
  }
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
