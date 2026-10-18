// @pictelio/net-diagnostics — 检查项计划（分层漏斗）
// 顺序契约：device -> dns -> tcp -> tls -> http -> edge。
// 依赖能力事实见 docs/research/network-selfcheck-java-capability-audit.md（#440）。
// 项级超时不在共享包声明：实际超时由 Java 执行层（NetDiagProbe）控制，避免声明与实现脱节。
import type { DiagLayer } from "./types";

export interface CheckDescriptor {
  id: string;
  layer: DiagLayer;
  title: string;
}

export const CHECK_PLAN: CheckDescriptor[] = [
  { id: "device", layer: "device", title: "本机网络" },
  { id: "dns", layer: "dns", title: "DNS 解析" },
  { id: "tcp", layer: "tcp", title: "TCP 连接 (443)" },
  { id: "tls", layer: "tls", title: "TLS 握手" },
  { id: "http", layer: "http", title: "API 往返（带鉴权）" },
  { id: "edge", layer: "edge", title: "图片边缘可达" },
];
