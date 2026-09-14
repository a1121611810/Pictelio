// 网络自检 webview 适配层：原生 bridge 优先，dev/web 走显式降级执行器。
// 判定/文案/报告一律委托 @pictelio/net-diagnostics（单一事实源）。
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { DeviceCapability, DiagInput, ProbeOutcome } from "@pictelio/net-diagnostics";

interface NetDiagNativeResult {
  device?: DeviceCapability;
  probes?: ProbeOutcome[];
  error?: string;
}

interface NetDiagPlugin {
  run(options: { userId?: string }): Promise<NetDiagNativeResult>;
}

const NetDiag = registerPlugin<NetDiagPlugin>("NetDiag");

/** dev/web 降级执行器：只覆盖 HTTP 可达性子集，显式标记 degraded（不与原生结论混用）。 */
async function devCollect(appVersion: string): Promise<DiagInput> {
  const probes: ProbeOutcome[] = [];
  try {
    const t0 = performance.now();
    const res = await fetch("/pixiv-api/", { cache: "no-store" });
    probes.push({
      id: "http",
      ok: res.status < 500,
      latencyMs: Math.round(performance.now() - t0),
      httpStatus: res.status,
      ...(res.status >= 500 ? { errorClass: "http_status" as const } : {}),
    });
  } catch (e) {
    probes.push({
      id: "http",
      ok: false,
      errorClass: "connect",
      rawError: e instanceof Error ? e.message : String(e),
    });
  }
  return {
    platform: "web",
    engine: "webview",
    appVersion,
    probes,
    degraded: true,
    capturedAt: new Date().toISOString(),
  };
}

export async function collectNetDiagInput(appVersion: string, userId?: string): Promise<DiagInput> {
  if (Capacitor.isNativePlatform()) {
    const r = await NetDiag.run({ userId });
    if (r.error) console.warn("[NetDiag] 原生返回错误:", r.error);
    return {
      platform: "android",
      engine: "webview",
      appVersion,
      device: r.device,
      probes: r.probes ?? [],
      capturedAt: new Date().toISOString(),
    };
  }
  return devCollect(appVersion);
}
