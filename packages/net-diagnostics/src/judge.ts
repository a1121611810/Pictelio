// @pictelio/net-diagnostics — 判定核心（纯函数）
// 输入 = 设备能力位 + 各探测项原始结果；输出 = 逐项视图 + 总体结论 + 归因 + 建议动作。
// 设计依据：docs/research/network-self-check-patterns.md（分层漏斗 + 互相证伪 + 你的问题/我们的问题）。
import { CHECK_PLAN } from "./plan";
import { HEADLINES } from "./copy";
import type {
  DiagAttribution,
  DiagCheckView,
  DiagInput,
  DiagReport,
  DiagStatus,
  ProbeOutcome,
  TransportKind,
} from "./types";

const STATUS_RANK: Record<DiagStatus, number> = { skipped: 0, ok: 1, warn: 2, fail: 3 };
const ATTR_RANK: Record<DiagAttribution, number> = {
  none: 0,
  unknown: 1,
  service: 2,
  network: 3,
  proxy: 4,
  auth: 5,
  device: 6,
};

function worstStatus(a: DiagStatus, b: DiagStatus): DiagStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

function transportText(transports: TransportKind[]): string {
  const named = transports.filter((t) => t !== "none");
  return named.length === 0 ? "无" : named.join(" / ");
}

function probeById(input: DiagInput, id: string): ProbeOutcome | undefined {
  return input.probes.find((p) => p.id === id);
}

function failAttribution(id: string, p: ProbeOutcome): DiagAttribution {
  if (p.errorClass === "auth" || p.httpStatus === 401 || p.httpStatus === 403) return "auth";
  if (p.errorClass === "proxy") return "proxy";
  if (p.httpStatus !== undefined && p.httpStatus >= 500) return "service";
  if (id === "dns" || id === "tcp" || id === "tls" || id === "edge") return "network";
  if (id === "http") return "network";
  return "unknown";
}

function deviceView(input: DiagInput): DiagCheckView {
  const desc = CHECK_PLAN.find((c) => c.id === "device")!;
  const base = { id: desc.id, layer: desc.layer, title: desc.title };
  const d = input.device;
  if (!d) {
    return {
      ...base,
      status: "skipped",
      detail: input.degraded ? "开发态不提供系统网络能力位" : "无法读取系统网络能力位",
      attribution: "unknown",
    };
  }
  const named = d.transports.filter((t) => t !== "none");
  if (named.length === 0) {
    return {
      ...base,
      status: "fail",
      detail: "没有检测到可用网络",
      hint: "请打开 Wi-Fi 或蜂窝数据",
      attribution: "device",
    };
  }
  if (d.captivePortal) {
    return {
      ...base,
      status: "fail",
      detail: "网络需要先登录（强制门户）：" + transportText(named),
      hint: "在系统浏览器完成登录后再自检",
      attribution: "device",
    };
  }
  if (!d.validated) {
    return {
      ...base,
      status: "warn",
      detail: "网络类型：" + transportText(named) + "，但系统未确认可上网",
      attribution: "device",
    };
  }
  return {
    ...base,
    status: "ok",
    detail: "网络类型：" + transportText(named) + (d.metered ? "（计费网络）" : ""),
    attribution: "none",
  };
}

function probeView(input: DiagInput, id: string): DiagCheckView {
  const desc = CHECK_PLAN.find((c) => c.id === id)!;
  const base = { id: desc.id, layer: desc.layer, title: desc.title };
  if (desc.disabledReason) {
    return { ...base, status: "skipped", detail: "已跳过：" + desc.disabledReason, attribution: "unknown" };
  }
  const p = probeById(input, id);
  if (!p) {
    return {
      ...base,
      status: "skipped",
      detail: input.degraded ? "开发态无法执行此项探测" : "未执行",
      attribution: "unknown",
    };
  }
  const latency = p.latencyMs;
  if (p.ok) {
    return {
      ...base,
      status: "ok",
      detail: latency !== undefined ? "耗时 " + latency + " ms" : "通过",
      latencyMs: latency,
      attribution: "none",
    };
  }
  const attribution = failAttribution(id, p);
  const http = p.httpStatus !== undefined ? "（HTTP " + p.httpStatus + "）" : "";
  if (id === "dns") {
    return { ...base, status: "fail", detail: "域名解析失败", hint: "请检查 DNS 或切换网络", attribution };
  }
  if (id === "tcp") {
    return {
      ...base,
      status: "fail",
      detail: "443 端口连接失败" + (p.errorClass === "timeout" ? "（超时）" : "（可能被重置）"),
      hint: "若使用代理，请检查代理软件是否运行",
      attribution,
    };
  }
  if (id === "tls") {
    return { ...base, status: "fail", detail: "TLS 握手失败", hint: "可能是 SNI 阻断或证书问题", attribution };
  }
  if (id === "edge") {
    return {
      ...base,
      status: "fail",
      detail: "图片边缘不可达" + (latency !== undefined ? "（" + latency + " ms）" : ""),
      attribution,
    };
  }
  if (attribution === "auth") {
    return { ...base, status: "fail", detail: "登录已失效" + http, hint: "请重新登录", attribution };
  }
  if (p.httpStatus === 429) {
    return { ...base, status: "warn", detail: "请求被限流（HTTP 429）", hint: "请稍后重试", attribution: "service" };
  }
  if (attribution === "service") {
    return { ...base, status: "fail", detail: "Pixiv 服务端错误" + http, attribution };
  }
  return { ...base, status: "fail", detail: "API 请求失败" + http, attribution };
}

function summarize(checks: DiagCheckView[], input: DiagInput): DiagReport {
  const considered = checks.filter((c) => c.status !== "skipped");
  const overall: DiagStatus =
    considered.length === 0 ? "skipped" : considered.map((c) => c.status).reduce(worstStatus, "ok");

  let attribution: DiagAttribution = "none";
  for (const c of checks) {
    if (c.status === "fail" || c.status === "warn") {
      if (ATTR_RANK[c.attribution] > ATTR_RANK[attribution]) attribution = c.attribution;
    }
  }

  let headline: string;
  if (overall === "ok") headline = HEADLINES.ok;
  else if (overall === "skipped") headline = HEADLINES.skipped;
  else if (attribution === "device" && input.device?.captivePortal) headline = HEADLINES.captive;
  else headline = HEADLINES[attribution] ?? HEADLINES.unknown;

  let action: string | undefined;
  let actionTarget: string | undefined;
  if (overall === "fail" || overall === "warn") {
    if (attribution === "device") {
      action = "打开系统网络设置";
      actionTarget = "system://network";
    } else if (attribution === "auth") {
      action = "重新登录";
      actionTarget = "/login";
    } else if (attribution === "proxy") {
      action = "检查代理设置";
      actionTarget = "/settings";
    } else if (attribution === "network" || attribution === "service") {
      action = "重试";
      actionTarget = "retry";
    }
  }

  return {
    overall,
    headline,
    attribution,
    action,
    actionTarget,
    checks,
    degraded: input.degraded === true,
  };
}

export function evaluate(input: DiagInput): DiagReport {
  const checks: DiagCheckView[] = [
    deviceView(input),
    probeView(input, "route"),
    probeView(input, "dns"),
    probeView(input, "tcp"),
    probeView(input, "tls"),
    probeView(input, "http"),
    probeView(input, "edge"),
  ];
  return summarize(checks, input);
}
