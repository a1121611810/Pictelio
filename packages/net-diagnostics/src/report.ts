// @pictelio/net-diagnostics — 报告序列化（纯文本、字段白名单、强制脱敏）
// 原则：报告绝不含 access_token / refresh_token / Authorization / Cookie / SSID / 用户 IP。
import { evaluate } from "./judge";
import type { DiagInput } from "./types";

const SECRET_PATTERNS: RegExp[] = [
  /Bearer [A-Za-z0-9._~+-]+=*/g,
  /(access_token|refresh_token|token|authorization|cookie)=[^&\s]+/gi,
];

/** 抹掉任何疑似凭证；负例测试保证它真的生效 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}

const STATUS_LABEL: Record<string, string> = { ok: "OK", warn: "WARN", fail: "FAIL", skipped: "SKIP" };

export function formatReport(input: DiagInput): string {
  const report = evaluate(input);
  const lines: string[] = [];
  lines.push("Pictelio 网络自检报告");
  lines.push("时间: " + (input.capturedAt ?? "未知"));
  lines.push("客户端: " + input.engine + " / " + input.platform + " / v" + input.appVersion);
  const d = input.device;
  if (d) {
    lines.push(
      "网络能力: " +
        d.transports.join(",") +
        " validated=" +
        d.validated +
        " captive=" +
        d.captivePortal +
        " metered=" +
        d.metered,
    );
  } else {
    lines.push("网络能力: 不可用" + (input.degraded ? "（开发态）" : ""));
  }
  lines.push("结论: [" + STATUS_LABEL[report.overall] + "] " + report.headline);
  lines.push("");
  lines.push("检查项:");
  for (const c of report.checks) {
    const latency = c.latencyMs !== undefined ? " " + c.latencyMs + "ms" : "";
    lines.push("- [" + STATUS_LABEL[c.status] + "] " + c.title + latency + " — " + c.detail);
  }
  const raw = input.probes.map((p) => p.rawError).filter((x): x is string => typeof x === "string" && x.length > 0);
  if (raw.length > 0) {
    lines.push("");
    lines.push("技术详情:");
    for (const r of raw) lines.push("- " + redactSecrets(r));
  }
  return lines.join("\n");
}
