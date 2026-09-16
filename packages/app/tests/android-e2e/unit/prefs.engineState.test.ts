/**
 * parseEngineState 纯函数单测（issue #557 T5，不碰 adb / 模拟器）。
 *
 * oracle 溯源（非被测实现反推，先例 prefs.poll.test.ts）：
 * - 快照行格式 = Java EngineRoute.snapshotLine()
 *   （`preferred=<kind|none> effective=<kind|none> reason=<code>`）；
 * - 期望值 = spec engine-default-lynx-bidirectional-fallback §4 决策矩阵
 *   （S1 preferred / S2 lynx_unavailable / S3 no_engine / S9 webview 首选 /
 *   S10 webview_unavailable）与 §3.1 原因码表；
 * - 解析规则 = 工单 #557 验收语义（effective=none → null；畸形 → null，E11 禁静默）。
 */
import { describe, expect, it } from "vitest";
import { parseEngineState } from "../prefs";

describe("parseEngineState", () => {
  it("S1 首选直启快照 → 三元组原样解析", () => {
    expect(parseEngineState("preferred=lynx effective=lynx reason=preferred")).toEqual({
      preferred: "lynx",
      effective: "lynx",
      reason: "preferred",
    });
  });

  it("S2 预检降级快照 → effective=webview / reason=lynx_unavailable", () => {
    expect(parseEngineState("preferred=lynx effective=webview reason=lynx_unavailable")).toEqual({
      preferred: "lynx",
      effective: "webview",
      reason: "lynx_unavailable",
    });
  });

  it("S3 双失败快照 → effective=none 解析为 null", () => {
    expect(parseEngineState("preferred=lynx effective=none reason=no_engine")).toEqual({
      preferred: "lynx",
      effective: null,
      reason: "no_engine",
    });
  });

  it("S9/S10 反向格快照 → preferred=webview 系原样解析", () => {
    expect(parseEngineState("preferred=webview effective=webview reason=preferred")).toEqual({
      preferred: "webview",
      effective: "webview",
      reason: "preferred",
    });
    expect(parseEngineState("preferred=webview effective=lynx reason=webview_unavailable")).toEqual(
      {
        preferred: "webview",
        effective: "lynx",
        reason: "webview_unavailable",
      },
    );
  });

  it("畸形行 → null（缺字段 / 无关文本 / 空串，E11 禁止静默构造部分合法数据）", () => {
    expect(parseEngineState("preferred=lynx effective=webview")).toBeNull(); // 缺 reason
    expect(parseEngineState("preferred=lynx reason=preferred")).toBeNull(); // 缺 effective
    expect(parseEngineState("effective=webview reason=preferred")).toBeNull(); // 缺 preferred
    expect(parseEngineState("not-a-snapshot-line")).toBeNull();
    expect(parseEngineState("")).toBeNull();
  });

  it("null（键不存在 / 文件缺失）→ null", () => {
    expect(parseEngineState(null)).toBeNull();
  });
});
