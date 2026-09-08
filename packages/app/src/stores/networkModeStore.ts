/**
 * 网络模式三档设置 store（pictelio-pure-client-direct-access T5）。
 *
 * 三档语义（ADR-0147 待写）：
 * - standard：海外 / 梯子环境；HTTPS 走系统 DNS（不钉 IP），最简。
 * - direct：墙内通用；client 直连（IP 钉死 + SNI 剥离 + 自定义 Dns），依靠内置/远端 IP 表。
 * - compat：兜底；走系统代理 + 系统 DNS（用户的个人梯子配置，不属于项目内的远程代理）。
 *
 * 持久化键：`network_mode`（CapacitorStorage stringCodec）。Java 侧未来读取此键
 * （暂未落地，等 ADR-0147 写入；Java 侧当前为单档 = 直连模式）。
 *
 * 默认值 = `"direct"`（国内用户占多数；海外用户可手动切换到 standard）。
 */
import { settings } from "@/settings";

/** 持久化键（CapacitorStorage 原始字符串） */
export const NETWORK_MODE_PREF_KEY = "network_mode";

/** 三档枚举（TS 字符串字面量；Java 侧未来用 int 常量映射） */
export type NetworkMode = "standard" | "direct" | "compat";

/** 默认值 */
export const DEFAULT_NETWORK_MODE: NetworkMode = "direct";

const networkModeSetting = settings.define<string>({
  key: NETWORK_MODE_PREF_KEY,
  default: DEFAULT_NETWORK_MODE,
});

/** 当前网络模式（响应式 signal） */
export const networkMode = networkModeSetting.value;

/** 是否为合法三档值（防御 SharedPreferences 损坏） */
export function isValidNetworkMode(value: unknown): value is NetworkMode {
  return value === "standard" || value === "direct" || value === "compat";
}

/**
 * 安全读取：把任意值规范成合法 NetworkMode。
 * 非法值 → DEFAULT_NETWORK_MODE（兜底），同时 console.warn 可见。
 */
export function coerceNetworkMode(value: unknown): NetworkMode {
  if (isValidNetworkMode(value)) {
    return value;
  }
  // 仅 dev 模式打 warn（release 通过 Rolldown import.meta.env.DEV 消除）
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn("[networkModeStore] 非法 networkMode 值，回退默认: " + JSON.stringify(value));
  }
  return DEFAULT_NETWORK_MODE;
}

/**
 * 设置入口：校验 + 写盘。返回 null = 成功，string = 错误文案。
 * 校验失败拒绝写盘（禁静默降级）。
 */
export function setNetworkMode(value: string): string | null {
  if (!isValidNetworkMode(value)) {
    return "网络模式必须是 standard / direct / compat 之一";
  }
  networkModeSetting.set(value);
  return null;
}

/** 文案辅助：用于设置页展示 */
export function networkModeLabel(mode: NetworkMode): string {
  switch (mode) {
    case "standard":
      return "海外模式（系统 DNS）";
    case "direct":
      return "客户端直连（推荐）";
    case "compat":
      return "系统代理兜底";
  }
}

/** 文案辅助：用于设置页副标题 */
export function networkModeDescription(mode: NetworkMode): string {
  switch (mode) {
    case "standard":
      return "海外环境或自带梯子时选择；不钉 IP，走系统 DNS 与 TLS 默认行为";
    case "direct":
      return "客户端直连 Pixiv 边缘：IP 钉死 + SNI 剥离；内置 IP 表兜底";
    case "compat":
      return "走系统代理（用户的个人梯子配置，不属于项目内置代理）";
  }
}
