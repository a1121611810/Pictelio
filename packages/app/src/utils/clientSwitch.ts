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
import type { I18nKey } from "@/i18n";

export type ClientKind = "webview" | "lynx";

export const CLIENT_KIND_KEY = "pictelio_client_kind";
/**
 * 缺省引擎（无记录/异常时的回退值）。ADR-0164：缺省语义翻转为 "lynx"
 * （键缺省 = 从未显式选择 → Java 侧归一化为 CLIENT_KINDS[0]，翻转后即 lynx）。
 * 注意：本应用自身是 webview client 与缺省值是两个概念——后者随 ADR-0164 翻转，
 * 前者（NetDiag/backupWiring 的 engine: "webview" 字面量）不变。
 */
export const DEFAULT_CLIENT: ClientKind = "lynx";

/** 切换结果：error modes 显式声明（接口契约的一部分，UI 据此映射 toast） */
export type SwitchOutcome =
  | { ok: true }
  | { ok: false; reason: "busy" | "write-failed" | "timeout" | "restart-failed" };

/** 开关写入超时（ms）：切换是用户主动一次性操作，5s 未完成视为失败并给出反馈 */
const WRITE_TIMEOUT_MS = 5_000;

/** 读取当前 client（无记录/异常 → 缺省引擎 DEFAULT_CLIENT，翻转后为 lynx） */
export async function readClientKind(): Promise<ClientKind> {
  try {
    const { value } = await Preferences.get({ key: CLIENT_KIND_KEY });
    return value === "lynx" || value === "webview" ? value : DEFAULT_CLIENT;
  } catch (e) {
    console.warn("[clientSwitch] 读取 client kind 失败，按缺省引擎处理", e);
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

// ─── 引擎降级（ADR-0164 / spec docs/specs/engine-default-lynx-bidirectional-fallback.md §3）───
// 以下键的字面量唯一所有者是 Java 侧 EnginePrefs
//（packages/app/android/app/src/main/java/io/pictelio/app/engine/EnginePrefs.java），
// TS 侧为镜像常量——由 tests/unit/utils/engineKeysConsistency.test.ts 从两侧源码
// 提取字面量比对钉住，任一方漂移即红灯；禁止在别处内联这些字符串。

/** Lynx 失败记忆（失败时 versionCode 十进制字符串；Java 名 KEY_FAILURE_MEMORY）。 */
export const KEY_FAILURE_MEMORY = "pictelio_engine_lynx_failure_version";

/** 运行时自动回退 WebView 开关（"true" | "false"；缺省开；Java 名 KEY_AUTO_FALLBACK）。 */
export const KEY_AUTO_FALLBACK = "pictelio_engine_auto_fallback";

/** 生效状态快照（每次 EngineRouting.resolve 覆写一行；Java 名 KEY_STATE）。 */
export const KEY_ENGINE_STATE = "pictelio_engine_state";

/**
 * 读取自动回退开关。口径与 Java `EnginePrefs.autoFallbackEnabled` 逐字一致：
 * absent/"" → true（缺省开）、"false" → false、其余畸形值 → warn + true（fail-open
 * 到产品缺省）。永不抛（桥故障按缺省开处理 + warn，禁静默）。
 */
export async function readAutoFallbackSwitch(): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key: KEY_AUTO_FALLBACK });
    if (value === null || value === undefined || value === "") return true;
    if (value === "false") return false;
    if (value === "true") return true;
    console.warn("[clientSwitch] 自动回退开关值畸形，按缺省开处理:", value);
    return true;
  } catch (e) {
    console.warn("[clientSwitch] 读取自动回退开关失败，按缺省开处理", e);
    return true;
  }
}

/**
 * 写自动回退开关（"true" / "false"）。调用方（设置 UI）已乐观更新，本函数
 * 永不抛——持久化失败只 warn（带模块前缀，测试硬约束 3），重启后回落实际值。
 */
export async function writeAutoFallbackSwitch(enabled: boolean): Promise<void> {
  try {
    await Preferences.set({ key: KEY_AUTO_FALLBACK, value: enabled ? "true" : "false" });
  } catch (e) {
    console.warn("[clientSwitch] 自动回退开关写入失败（UI 已乐观更新，重启后回滚）", e);
  }
}

/** 生效状态快照（键 `pictelio_engine_state`，行格式见 Java `EngineRoute.snapshotLine`）。 */
export interface EngineSnapshot {
  /** 用户首选引擎（恒合法）。 */
  preferred: ClientKind;
  /** 本次生效引擎；null = 无引擎可用（双失败）或 effective=none。 */
  effective: ClientKind | null;
  /** 降级原因码（稳定 ASCII，见 REASON_I18N_KEYS）。 */
  reason: string;
}

/** 快照行 `preferred=<kind> effective=<kind|none> reason=<code>`（字段顺序即契约）。 */
const ENGINE_STATE_LINE_RE = /^preferred=(\S+) effective=(\S+) reason=(\S+)$/;

/** 内部：解析快照行；畸形 → warn（禁静默，spec E11）+ null。 */
function parseEngineSnapshotLine(raw: string): EngineSnapshot | null {
  const m = ENGINE_STATE_LINE_RE.exec(raw.trim());
  const malformed = (): EngineSnapshot | null => {
    console.warn("[clientSwitch] 引擎状态快照畸形", raw);
    return null;
  };
  if (!m) return malformed();
  if (m[1] !== "webview" && m[1] !== "lynx") return malformed();
  let effective: ClientKind | null;
  if (m[2] === "none") {
    effective = null;
  } else if (m[2] === "webview" || m[2] === "lynx") {
    effective = m[2];
  } else {
    return malformed();
  }
  return { preferred: m[1], effective, reason: m[3] };
}

/**
 * 读取生效状态快照；无记录/畸形 → null（畸形路径 warn，禁静默）。永不抛。
 * 返回 null = 按无降级渲染（UI 侧降级双态行不显示）。
 */
export async function readEngineState(): Promise<EngineSnapshot | null> {
  try {
    const { value } = await Preferences.get({ key: KEY_ENGINE_STATE });
    if (value === null || value === undefined || value === "") return null;
    return parseEngineSnapshotLine(value);
  } catch (e) {
    console.warn("[clientSwitch] 读取引擎状态快照失败，按无降级处理", e);
    return null;
  }
}

/**
 * 降级原因码 → i18n 键（spec §3.1：持久层只存稳定 ASCII 码，UI 侧映射文案）。
 * code 集合与 Java `EngineRoute.Reason` 枚举由
 * tests/unit/utils/engineReasonCodesConsistency.test.ts 双向钉住。
 */
export const REASON_I18N_KEYS = {
  preferred: "engineFallback.reason.preferred",
  lynx_unavailable: "engineFallback.reason.lynx_unavailable",
  lynx_known_bad: "engineFallback.reason.lynx_known_bad",
  lynx_retry: "engineFallback.reason.lynx_retry",
  webview_unavailable: "engineFallback.reason.webview_unavailable",
  a11y_webview: "engineFallback.reason.a11y_webview",
  a11y_lynx_last_resort: "engineFallback.reason.a11y_lynx_last_resort",
  no_engine: "engineFallback.reason.no_engine",
  forced_webview: "engineFallback.reason.forced_webview",
  runtime_failure: "engineFallback.reason.runtime_failure",
} as const satisfies Record<string, I18nKey>;

/** 原因码 → i18n 键；未知码回退 unknown 键（UI 显式显示「引擎状态未知」，即暴露错误态）。 */
export function reasonKey(code: string): I18nKey {
  return (REASON_I18N_KEYS as Record<string, I18nKey>)[code] ?? "engineFallback.reason.unknown";
}
