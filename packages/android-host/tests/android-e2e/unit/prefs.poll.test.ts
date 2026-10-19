/**
 * pollPrefs 纯函数单测（issue #523 T3，不碰 adb / 模拟器）。
 *
 * oracle 来源：工单 #523 验收语义——「第 N 次满足即返回快照；超时抛错带最后快照」，
 * 期望值来自独立构造的读取序列 + 真实 CapacitorStorage.xml 序列化形式①
 * （`<string name="key">value</string>`，见 prefs.ts readPrefs 注释），
 * 非被测实现反推。读取函数经 pollPrefs 第 5 参注入 fake（侵入最小方案）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { pollPrefs, type PrefsSnapshot } from "../prefs";

/** 构造真实序列化形式①的快照（marker/ready 是 rawXml 内容，也是断言取的通用字段） */
function snap(marker: string, ready: boolean): PrefsSnapshot {
  return {
    fileExists: true,
    rawXml:
      `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n` +
      `    <string name="marker">${marker}</string>\n` +
      `    <string name="ready">${ready ? "true" : "false"}</string>\n` +
      `</map>`,
  };
}

/** 谓词只看快照 rawXml（与各 spec 的真实用法同构），不依赖任何专用字段 */
function isReady(p: PrefsSnapshot): boolean {
  return p.rawXml.includes('name="ready">true</string>');
}

/** fake 掉 setTimeout 与 Date（轮询用 Date.now 算 deadline），其余保持真实 */
function usePollFakeTimers(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("pollPrefs", () => {
  it("第 3 次读取满足谓词 → 返回第 3 次快照", async () => {
    usePollFakeTimers();
    // 独立构造序列：前两次未就绪，第 3 次就绪
    const s1 = snap("attempt-1", false);
    const s2 = snap("attempt-2", false);
    const s3 = snap("attempt-3-final", true);
    const queue = [s1, s2, s3];
    const readFn = vi.fn((_serial: string) => (queue.length > 1 ? queue.shift()! : queue[0]!));

    const pending = pollPrefs("emulator-5554", isReady, 30_000, 1_000, readFn);
    // 读取时点 t=0/1000/2000：第 3 次（t=2000）满足，需推进 2 个间隔
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await pending;

    expect(result).toBe(s3);
    expect(result.rawXml).toContain('<string name="marker">attempt-3-final</string>');
    expect(readFn).toHaveBeenCalledTimes(3);
    // serial 原样透传给读取函数（E2E 里 readFn 用它拼 adb 命令）
    expect(readFn.mock.calls.map((c) => c[0])).toEqual([
      "emulator-5554",
      "emulator-5554",
      "emulator-5554",
    ]);
  });

  it("始终不满足 → 超时抛错，消息含「轮询超时」与最后快照特征串", async () => {
    usePollFakeTimers();
    const last = snap("still-pending", false);
    const readFn = vi.fn((_serial: string) => last);

    // 先挂 handler，避免 fake timer 推进期间出现 unhandled rejection
    const pending = pollPrefs("emulator-5554", isReady, 5_000, 1_000, readFn).catch(
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    const caught = await pending;

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain("轮询超时");
    // 最后一次 rawXml 快照进入诊断消息（真实序列化形式①）
    expect(message).toContain('<string name="marker">still-pending</string>');
    expect(message).toContain("still-pending");
    // 语义性质：5s 超时 / 1s 间隔 → 超时前至少轮询 5 次（证明非单次直读）
    expect(readFn.mock.calls.length).toBeGreaterThanOrEqual(5);
  });
});
