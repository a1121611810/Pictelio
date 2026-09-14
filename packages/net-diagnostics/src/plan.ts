// @pictelio/net-diagnostics — 检查项计划（分层漏斗）
// 顺序契约：device -> route -> dns -> tcp -> tls -> http -> edge。
// 依赖能力事实见 docs/research/network-selfcheck-java-capability-audit.md（#440）。
import type { DiagLayer } from "./types";

export interface CheckDescriptor {
  id: string;
  layer: DiagLayer;
  title: string;
  /** 项级超时（ms）；device / route 为 0（零网络或本地读） */
  timeoutMs: number;
  /** 是否必须由 Java/原生执行（web/dev 降级执行器无法覆盖） */
  nativeOnly: boolean;
  /** 非空 = 当前版本恒跳过（特性不存在），判定层据此渲染 skipped */
  disabledReason?: string;
}

/** 诊断自身总预算：弱网下不得放大流量（业界做法调研 §3.6） */
export const TOTAL_BUDGET_MS = 10000;

export const CHECK_PLAN: CheckDescriptor[] = [
  { id: "device", layer: "device", title: "本机网络", timeoutMs: 0, nativeOnly: true },
  {
    id: "route",
    layer: "route",
    title: "网络直连路由",
    timeoutMs: 0,
    nativeOnly: true,
    disabledReason: "网络直连功能已于 bf32620e 移除",
  },
  // 项级超时之和 == TOTAL_BUDGET_MS：分层串行（每层一项）的最坏路径即总预算，
  // 由 checkPlan 单测钉住这个不变量，避免「单项都合理、合起来爆预算」。
  { id: "dns", layer: "dns", title: "DNS 解析", timeoutMs: 1500, nativeOnly: true },
  { id: "tcp", layer: "tcp", title: "TCP 连接 (443)", timeoutMs: 2000, nativeOnly: true },
  { id: "tls", layer: "tls", title: "TLS 握手", timeoutMs: 2000, nativeOnly: true },
  { id: "http", layer: "http", title: "API 往返（带鉴权）", timeoutMs: 2500, nativeOnly: true },
  { id: "edge", layer: "edge", title: "图片边缘可达", timeoutMs: 2000, nativeOnly: true },
];

export function getCheck(id: string): CheckDescriptor | undefined {
  return CHECK_PLAN.find((c) => c.id === id);
}
