import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createUploadPanel,
  formatEventLine,
  formatSummary,
} from "../../../scripts/lib/release-panel.mjs";

function captureOut() {
  const chunks = [];
  const out = {
    write: (s) => {
      chunks.push(s);
    },
  };
  return { out, text: () => chunks.join("") };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("formatEventLine", () => {
  it("started：含变体名、上传中、大小", () => {
    const line = formatEventLine({ type: "started", name: "full.apk", size: 2 * 1048576 });
    expect(line).toContain("full.apk");
    expect(line).toContain("上传中");
    expect(line).toContain("2.0 MB");
  });

  it("succeeded：含成功、耗时、速率", () => {
    const line = formatEventLine({
      type: "succeeded",
      name: "webview.apk",
      size: 1048576,
      elapsedMs: 5000,
      avgMBps: 0.2,
    });
    expect(line).toContain("✓ 成功");
    expect(line).toContain("5s");
    expect(line).toContain("0.20 MB/s");
  });

  it("failed：stderrTail 换行替换并截断到 120 字符", () => {
    const tail = `${"y".repeat(130)}\n第二行`;
    const line = formatEventLine({
      type: "failed",
      name: "lynx.apk",
      attempts: 3,
      stderrTail: tail,
    });
    expect(line).toContain("✗ 失败");
    expect(line).not.toContain("\n");
    expect(line.length).toBeLessThanOrEqual(120 + "[lynx.apk] ✗ 失败: ".length);
  });
});

describe("formatSummary", () => {
  it("成功/失败逐包分行", () => {
    const lines = formatSummary({
      succeeded: [{ name: "full.apk" }],
      failed: [{ name: "lynx.apk", attempts: 3 }],
      totalElapsedMs: 10000,
    });
    expect(lines.join("\n")).toContain("✓ full.apk");
    expect(lines.join("\n")).toContain("✗ lynx.apk");
    expect(lines.join("\n")).toContain("10s");
  });
});

describe("createUploadPanel", () => {
  it("非 TTY：每事件一行纯文本，无 ANSI 控制码", () => {
    const { out, text } = captureOut();
    const panel = createUploadPanel({ tty: false, out });
    panel.onEvent({ type: "started", name: "full.apk", size: 1048576 });
    panel.onEvent({
      type: "succeeded",
      name: "full.apk",
      size: 1048576,
      elapsedMs: 1000,
      avgMBps: 1,
    });
    panel.finish();
    expect(text()).not.toContain("\x1b");
    expect(text()).toContain("full.apk");
    expect(text()).toContain("✓ 成功");
  });

  it("TTY：输出 ANSI 控制码，finish 输出总结", () => {
    vi.useFakeTimers();
    const { out, text } = captureOut();
    const panel = createUploadPanel({ tty: true, out });
    panel.onEvent({ type: "started", name: "full.apk", size: 1048576 });
    panel.onEvent({
      type: "succeeded",
      name: "full.apk",
      size: 1048576,
      elapsedMs: 2000,
      avgMBps: 0.5,
    });
    panel.finish();
    expect(text()).toContain("\x1b");
    expect(text()).toContain("✓ 成功");
  });

  it("summary 事件后 finish 输出逐包总结", () => {
    const { out, text } = captureOut();
    const panel = createUploadPanel({ tty: false, out });
    panel.onEvent({ type: "started", name: "full.apk", size: 1048576 });
    panel.onEvent({
      type: "summary",
      report: { succeeded: [{ name: "full.apk" }], failed: [], totalElapsedMs: 3000 },
    });
    panel.finish();
    expect(text()).toContain("✓ full.apk");
    expect(text()).toContain("3s");
  });

  it("finish 后不再输出（interval 已清理）", () => {
    vi.useFakeTimers();
    const { out, text } = captureOut();
    const panel = createUploadPanel({ tty: true, out });
    panel.onEvent({ type: "started", name: "full.apk", size: 1048576 });
    panel.finish();
    const before = text();
    vi.advanceTimersByTime(3000);
    expect(text()).toBe(before);
  });
});
