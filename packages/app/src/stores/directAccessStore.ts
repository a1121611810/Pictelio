/**
 * 网络直连设置 store（ticket #391 T6）——webview 设置卡「网络直连」状态源。
 *
 * <b>跨端存储契约</b>（TS 侧写、Java 侧读；oracle = ticket #391 + Java
 * DirectAccessConfig 存储契约 javadoc）：webview 端经 settings registry 的
 * preferences 后端（@capacitor/preferences 默认 group = CapacitorStorage）写键
 * {@link DIRECT_ACCESS_PREF_KEY}，JSON 形态<b>恒</b>为
 * `{\"enabled\": boolean, \"manual\": [{\"host\": string, \"ip\": string}]}`，
 * 与 lynx 引擎 / Java DirectAccessConfig.parse 同读一份——字段形态不得增删
 * （多余字段 Java 侧虽忽略，但契约纯净性靠 migrate 剔除未知字段保证）。
 *
 * 开关语义对齐 Java 三态（DirectAccessPolicy.SwitchState）：键缺失 = UNSET（未配置）、
 * enabled=true = ON、false = OFF；下一次 Java 请求经 raw equals 解析热路径即时感知。
 *
 * 运行时状态（熔断相位/IP 表快照）来自 PixivApi.directAccessStatus 桥，会话内
 * signal、不持久化；设置回写（手动 IP 表）成功后由调用方触发状态刷新。
 */
import { createSignal } from "solid-js";
import { jsonCodec, settings } from "@/settings";
import {
  DIRECT_ACCESS_DEFAULT_STATUS,
  directAccessStatus,
  type DirectAccessStatus,
} from "@/native/DirectAccess";

/** CapacitorStorage 存储键（Java PREF_KEY 同名，契约硬约束） */
export const DIRECT_ACCESS_PREF_KEY = "direct_access_settings";

/** 手动 IP 表条目（host 规范形小写；ip 为严格 IPv4 字面量） */
export interface DirectAccessManualEntry {
  host: string;
  ip: string;
}

/** 持久化设置形态——必须与 Java 解析契约逐字段一致（恰好两个字段） */
export interface DirectAccessSettings {
  enabled: boolean;
  manual: DirectAccessManualEntry[];
}

const DEFAULT_SETTINGS: DirectAccessSettings = { enabled: false, manual: [] };

// ── 校验（正则语义从 Java IpTableMerger.isValidIpv4Literal 同语义移植） ──

/**
 * 严格 IPv4 点分十进制字面量：恰 4 段、每段 1–3 位十进制数字、值 0–255、
 * <b>拒绝前导零</b>（`01.2.3.4` 等歧义形态——部分解析器按八进制解释，钉定表
 * 不接受歧义，与 Java 侧同语义拒收）。
 */
const IPV4_LITERAL_RE =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/u;

/** 严格 IPv4 字面量校验（对齐 Java IpTableMerger.isValidIpv4Literal；不做 trim） */
export function isValidIpv4Literal(ip: string): boolean {
  return IPV4_LITERAL_RE.test(ip);
}

/**
 * 手动条目校验（对齐图床 validateHostInput 先例：返回错误文案，null = 合法）。
 * 结构校验（对象/host 非空白/IP 非空白）+ IP 字面量校验。
 */
export function validateManualEntry(entry: unknown): string | null {
  if (typeof entry !== "object" || entry === null) {
    return "条目必须是对象";
  }
  const host = (entry as Partial<DirectAccessManualEntry>).host;
  const ip = (entry as Partial<DirectAccessManualEntry>).ip;
  if (typeof host !== "string" || host.trim() === "") {
    return "host 不能为空";
  }
  if (typeof ip !== "string" || ip.trim() === "") {
    return "IP 不能为空";
  }
  if (!isValidIpv4Literal(ip.trim())) {
    return "IP 必须是合法 IPv4 字面量（4 段 0-255，无前导零）";
  }
  return null;
}

// ── settings registry 接入（hydrate 由 __root.tsx 的 settings.hydrateAll 统一承担） ──

/** 形状级校验（hydrate 读入用）：仅锁字段类型，不拦非法 IP——Java 侧对非法条目
 * 跳过 + 告警地容忍，TS 侧读入若丢弃会在下次写盘时静默销毁用户数据（禁静默降级） */
function isDirectAccessSettings(v: unknown): v is DirectAccessSettings {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Partial<DirectAccessSettings>;
  return (
    typeof s.enabled === "boolean" &&
    Array.isArray(s.manual) &&
    s.manual.every(
      (e) =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as DirectAccessManualEntry).host === "string" &&
        typeof (e as DirectAccessManualEntry).ip === "string",
    )
  );
}

/** 规整为 Java 契约形：恰好 enabled/manual 两字段；host 小写去空白、ip 去空白
 *（先例 Java Entry 构造即规范化；未知字段剔除保持契约纯净） */
function migrateContractShape(v: unknown): DirectAccessSettings {
  const raw = (typeof v === "object" && v !== null ? v : {}) as Partial<DirectAccessSettings>;
  const manual = Array.isArray(raw.manual) ? raw.manual : [];
  return {
    enabled: Boolean(raw.enabled),
    manual: manual.map((e) => ({
      host: String((e as DirectAccessManualEntry)?.host ?? "")
        .trim()
        .toLowerCase(),
      ip: String((e as DirectAccessManualEntry)?.ip ?? "").trim(),
    })),
  };
}

const directAccessSetting = settings.define<DirectAccessSettings>({
  key: DIRECT_ACCESS_PREF_KEY,
  default: DEFAULT_SETTINGS,
  codec: jsonCodec,
  migrate: migrateContractShape,
  validate: isDirectAccessSettings,
  onError: (err, phase) => console.warn(`[directAccessStore] ${phase} failed`, err),
});

/** 持久化设置（Solid signal；写 CapacitorStorage 键 direct_access_settings） */
export const directAccessState = directAccessSetting.value;

// ── 运行时状态（桥查询，不持久化） ─────────────────────────

/** 运行时状态 signal（初始 = 安全默认，hydrate 不覆盖——它只属于持久化设置） */
export const [directAccessRuntime, setDirectAccessRuntime] = createSignal<DirectAccessStatus>(
  DIRECT_ACCESS_DEFAULT_STATUS,
);

/**
 * 从桥刷新运行时状态（native 返回 Java 快照；web/dev 返回安全默认）。
 * 查询失败保留上次状态并 warn（禁静默降级）。
 */
export async function refreshDirectAccessRuntime(): Promise<void> {
  try {
    setDirectAccessRuntime(await directAccessStatus());
  } catch (err) {
    console.warn("[directAccessStore] directAccessStatus 查询失败，保留上次状态", err);
  }
}

// ── 设置写入口 ─────────────────────────────────────────────

/** 切换直连开关（下一次 Java 请求经 raw equals 解析热路径即时感知） */
export function setDirectAccessEnabled(enabled: boolean): void {
  directAccessSetting.set({ ...directAccessState(), enabled });
}

/**
 * 全量替换手动 IP 表（调用方通常已用 {@link validateManualEntry} 逐条校验过；
 * 本入口兜底再验，非法即拒写盘）。
 *
 * @return null = 保存成功；string = 首个非法条目的错误文案（拒绝写盘）
 */
export function setManualEntries(entries: DirectAccessManualEntry[]): string | null {
  for (const entry of entries) {
    const err = validateManualEntry(entry);
    if (err) {
      return err;
    }
  }
  directAccessSetting.set({
    enabled: directAccessState().enabled,
    // 规范形落盘（host 小写去空白、ip 去空白），与 Java Entry 构造规范化同语义
    manual: entries.map((e) => ({ host: e.host.trim().toLowerCase(), ip: e.ip.trim() })),
  });
  return null;
}
