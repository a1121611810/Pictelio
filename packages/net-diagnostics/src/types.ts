// @pictelio/net-diagnostics — 共享契约类型（零平台依赖）
// 两个客户端（WebView / Lynx）与 Java 探测层都以此为准；UI 只渲染，不自行判定。

export type DiagPlatform = "android" | "ios" | "web";
export type DiagEngine = "webview" | "lynx";
export type DiagLayer = "device" | "route" | "dns" | "tcp" | "tls" | "http" | "edge";
export type DiagStatus = "ok" | "warn" | "fail" | "skipped";
export type DiagAttribution =
  | "none"
  | "device"
  | "network"
  | "proxy"
  | "auth"
  | "service"
  | "unknown";

export type TransportKind = "wifi" | "cellular" | "ethernet" | "vpn" | "none" | "other";

export type ProbeErrorClass =
  | "none"
  | "dns"
  | "connect"
  | "tls"
  | "timeout"
  | "http_status"
  | "auth"
  | "proxy"
  | "unknown";

/** 系统网络能力位（Android NetworkCapabilities 映射；不含 SSID / 用户 IP） */
export interface DeviceCapability {
  transports: TransportKind[];
  /** NET_CAPABILITY_VALIDATED */
  validated: boolean;
  /** NET_CAPABILITY_CAPTIVE_PORTAL */
  captivePortal: boolean;
  /** !NET_CAPABILITY_NOT_METERED */
  metered: boolean;
}

/** 单个探测项的原始结果（Java/JS 执行器产出，纯数据） */
export interface ProbeOutcome {
  /** 对应 CHECK_PLAN 的 checkId */
  id: string;
  ok: boolean;
  latencyMs?: number;
  errorClass?: ProbeErrorClass;
  httpStatus?: number;
  /** 原始错误消息：只进「技术详情」，报告序列化时必须脱敏 */
  rawError?: string;
}

/** 一次自检的完整输入 */
export interface DiagInput {
  platform: DiagPlatform;
  engine: DiagEngine;
  appVersion: string;
  /** 设备能力位；web/dev 降级执行器可能缺失 */
  device?: DeviceCapability;
  probes: ProbeOutcome[];
  /** true = web/dev 降级执行器（能力有损），UI 必须显式标注 */
  degraded?: boolean;
  capturedAt?: string;
}

/** 判定后的单项视图（UI 直接渲染） */
export interface DiagCheckView {
  id: string;
  layer: DiagLayer;
  title: string;
  status: DiagStatus;
  detail: string;
  hint?: string;
  latencyMs?: number;
  attribution: DiagAttribution;
}

/** 判定后的整体报告（纯数据，不含任何凭证） */
export interface DiagReport {
  overall: DiagStatus;
  headline: string;
  attribution: DiagAttribution;
  action?: string;
  actionTarget?: string;
  checks: DiagCheckView[];
  degraded: boolean;
}
