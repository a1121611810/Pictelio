// 网络自检 lynx 适配层：NativeModule 优先（Lynx 原生无 fetch 保证），web-core 显式降级。
// 判定/文案/报告一律委托 @pictelio/net-diagnostics（与 webview 同一份）。
import type { DeviceCapability, DiagInput, ProbeOutcome } from "@pictelio/net-diagnostics";
import { getNativeModules } from "../api/client";

type NetDiagNative = {
  diagnose?: (userId: string, cb: (json: string) => void) => void;
};

function nativeNetDiag(): NetDiagNative | undefined {
  // 必须走双通道访问器：Lynx runtime 的 NativeModules 是全局内置对象，真机不挂在 globalThis
  // （api/client.ts getNativeModules，ADR-0053 真机 99900 实证）。
  const nm = getNativeModules() as { NetDiag?: NetDiagNative } | undefined;
  return nm?.NetDiag;
}

function degradedInput(appVersion: string, reason: string): DiagInput {
  console.warn("[netDiagnostics] " + reason);
  return {
    platform: "web",
    engine: "lynx",
    appVersion,
    probes: [],
    degraded: true,
    capturedAt: new Date().toISOString(),
  };
}

export function collectNetDiagInput(appVersion: string, userId?: string): Promise<DiagInput> {
  const api = nativeNetDiag()?.diagnose;
  if (typeof api !== "function") {
    return Promise.resolve(degradedInput(appVersion, "NetDiag 原生模块不可用（web-core 预览属预期）"));
  }
  return new Promise<DiagInput>((resolve) => {
    api(userId ?? "", (json) => {
      try {
        const parsed = JSON.parse(json) as {
          device?: DeviceCapability;
          probes?: ProbeOutcome[];
          error?: string;
        };
        if (parsed.error) console.warn("[netDiagnostics] 原生返回错误:", parsed.error);
        resolve({
          platform: "android",
          engine: "lynx",
          appVersion,
          device: parsed.device,
          probes: parsed.probes ?? [],
          capturedAt: new Date().toISOString(),
        });
      } catch (e) {
        console.warn("[netDiagnostics] 原生返回解析失败:", e);
        resolve(degradedInput(appVersion, "原生返回解析失败，降级"));
      }
    });
  });
}
