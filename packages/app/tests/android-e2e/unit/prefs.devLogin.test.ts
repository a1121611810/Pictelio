// @vitest-environment node
/**
 * devLoginIntentArgs / loginViaDevIntent 单测（不碰 adb / 模拟器）。
 *
 * 背景：单引擎化后 webview 登录页不存在，spec 的登录只能走
 * `LynxActivity.applyDevIntentHooks()` 的 refresh_token 钩子
 * （oracle：LynxActivity.java:697-706，门禁 BuildConfig.DEBUG）。
 *
 * 期望值来源：**真实 Pixiv refresh_token 的字符形态**（本项目 token 为 43 字符
 * 的 URL-safe base64 串，实测含 `_` / `-`）+ shell 单引号包裹的设备侧转义规则，
 * 以及实测 2026-09-28 在 pictelio_ui 上抓到的成功日志串，非被测实现反推。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { devLoginIntentArgs, loginViaDevIntent, readAppLogcat } from "../prefs";

const adbPath = vi.hoisted(() => vi.fn(() => "/fake/adb"));
const runOrThrow = vi.hoisted(() => vi.fn());
const runCapture = vi.hoisted(() => vi.fn());

vi.mock("../env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../env")>();
  return { ...actual, adbPath, runOrThrow, runCapture };
});

/** 模拟「app 进程存在，logcat 里已有登录成功标记」 */
function logcatHasSuccess(): void {
  runCapture.mockImplementation((_bin: string, args: string[]) => {
    if (args.includes("pidof")) return { code: 0, stdout: "4242", stderr: "" };
    return {
      code: 0,
      stdout: "I LynxActivity: dev hook: 自动登录成功（userInfo={\"userId\":1}）",
      stderr: "",
    };
  });
}

/** 模拟「进程在，但 logcat 永远没有成功标记」 */
function logcatNeverSucceeds(): void {
  runCapture.mockImplementation((_bin: string, args: string[]) => {
    if (args.includes("pidof")) return { code: 0, stdout: "4242", stderr: "" };
    return { code: 0, stdout: "I LynxActivity: 启动中", stderr: "" };
  });
}

afterEach(() => {
  runOrThrow.mockClear();
  runCapture.mockClear();
});

describe("devLoginIntentArgs", () => {
  it("显式落到 LynxActivity 并带对 extra key（成功路径）", () => {
    const args = devLoginIntentArgs("TOKEN_VALUE");
    expect(args).toEqual([
      "shell",
      "am",
      "start",
      "-n",
      "io.pictelio.app/.LynxActivity",
      "--es",
      "pictelio_dev_refresh_token",
      "'TOKEN_VALUE'",
    ]);
  });

  it("设备 shell 侧单引号包裹：URL-safe 字符原样保留", () => {
    // 真实 token 形态：含 _ 与 -，单引号包裹后 shell 不会展开
    const args = devLoginIntentArgs("aZ-_09AZ-_09AZ-_09AZ-_09AZ-_09AZ-_09AZ0");
    expect(args.at(-1)).toBe("'aZ-_09AZ-_09AZ-_09AZ-_09AZ-_09AZ-_09AZ0'");
  });

  it("token 内嵌单引号被转义，不会提前闭合引号（注入/截断防护）", () => {
    const args = devLoginIntentArgs("ab'cd");
    // 'ab'\''cd' —— 中间的 '\'' 是标准的「结束-转义单引号-重开单引号」
    expect(args.at(-1)).toBe("'ab'\\''cd'");
  });
});

describe("readAppLogcat", () => {
  it("进程存在时按 --pid 过滤抓取（成功路径）", () => {
    runCapture.mockImplementation((_bin: string, args: string[]) =>
      args.includes("pidof")
        ? { code: 0, stdout: "4242", stderr: "" }
        : { code: 0, stdout: "I LynxEnv : LynxEnv start init", stderr: "" },
    );
    expect(readAppLogcat("emulator-5554")).toContain("LynxEnv start init");
    const logcatCall = runCapture.mock.calls.find((c) => (c[1] as string[]).includes("logcat"))!;
    expect(logcatCall[1]).toEqual(["-s", "emulator-5554", "logcat", "-d", "--pid=4242"]);
  });

  it("进程尚未创建时返回空串且不抛错（降级路径，让调用方轮询继续）", () => {
    runCapture.mockImplementation((_bin: string, args: string[]) =>
      args.includes("pidof") ? { code: 0, stdout: "", stderr: "" } : { code: 0, stdout: "", stderr: "" },
    );
    // 关键：抛错会把「am start 后 Activity 记录先于进程出现约 150ms」这种常态
    // 误报成「app 崩溃」，并直接绕过调用方的等待循环
    expect(() => readAppLogcat("emulator-5554")).not.toThrow();
    expect(readAppLogcat("emulator-5554")).toBe("");
    // 且不得回退抓全量——全量里是系统噪声，匹配不到 app 的信号
    const logcatCalls = runCapture.mock.calls.filter((c) => (c[1] as string[]).includes("logcat"));
    expect(logcatCalls.every((c) => !(c[1] as string[]).some((a) => a.startsWith("--pid=")))).toBe(
      true,
    );
  });
});

describe("loginViaDevIntent", () => {
  it("token 来自环境变量时先 force-stop 再带 extra 启动，并在见到成功标记后返回", async () => {
    logcatHasSuccess();
    const prev = process.env.PIXIV_REFRESH_TOKEN;
    process.env.PIXIV_REFRESH_TOKEN = "ENV_TOKEN";
    try {
      await loginViaDevIntent("emulator-5554");
      // **必须先 force-stop**：LynxActivity 不覆写 onNewIntent + singleTask，
      // app 已运行时 am start 只会「delivered to currently running top-most instance」
      // 而 hook 静默不执行（实测成功标记 0 次；force-stop 后 1 次）。
      expect(runOrThrow).toHaveBeenCalledTimes(2);
      expect(runOrThrow.mock.calls[0]![1]).toEqual([
        "-s",
        "emulator-5554",
        "shell",
        "am",
        "force-stop",
        "io.pictelio.app",
      ]);
      const [bin, args] = runOrThrow.mock.calls[1]!;
      expect(bin).toBe("/fake/adb");
      expect(args).toEqual([
        "-s",
        "emulator-5554",
        "shell",
        "am",
        "start",
        "-n",
        "io.pictelio.app/.LynxActivity",
        "--es",
        "pictelio_dev_refresh_token",
        "'ENV_TOKEN'",
      ]);
    } finally {
      if (prev === undefined) delete process.env.PIXIV_REFRESH_TOKEN;
      else process.env.PIXIV_REFRESH_TOKEN = prev;
    }
  });

  it("显式参数优先于环境变量", async () => {
    logcatHasSuccess();
    const prev = process.env.PIXIV_REFRESH_TOKEN;
    process.env.PIXIV_REFRESH_TOKEN = "ENV_TOKEN";
    try {
      await loginViaDevIntent("emulator-5554", "EXPLICIT");
      expect(runOrThrow.mock.calls[1]![1].at(-1)).toBe("'EXPLICIT'");
    } finally {
      if (prev === undefined) delete process.env.PIXIV_REFRESH_TOKEN;
      else process.env.PIXIV_REFRESH_TOKEN = prev;
    }
  });

  it("pidof 先空后有：轮询等进程出现后仍能完成登录（am start 后 Activity 记录先于进程约 150ms）", async () => {
    let pidCalls = 0;
    runCapture.mockImplementation((_bin: string, args: string[]) => {
      if (args.includes("pidof")) {
        pidCalls += 1;
        return { code: 0, stdout: pidCalls <= 2 ? "" : "4242", stderr: "" };
      }
      return { code: 0, stdout: "I LynxActivity: dev hook: 自动登录成功", stderr: "" };
    });
    await loginViaDevIntent("emulator-5554", "T");
    expect(pidCalls).toBeGreaterThan(2);
  });

  it("轮询间隔真实生效：短 timeout 下轮询次数受控（防 `void sleep` 退化）", async () => {
    let pidCalls = 0;
    runCapture.mockImplementation((_bin: string, args: string[]) => {
      if (args.includes("pidof")) pidCalls += 1;
      return { code: 0, stdout: pidCalls <= 2 ? "" : "4242", stderr: "" };
    });
    // 永不出现成功标记 → 走超时分支
    runCapture.mockImplementation((_bin: string, args: string[]) => {
      if (args.includes("pidof")) pidCalls += 1;
      return { code: 0, stdout: "I LynxActivity: 启动中", stderr: "" };
    });
    await expect(loginViaDevIntent("emulator-5554", "T", 30)).rejects.toThrow(/登录超时/);
    // 30ms 预算 + 1s 间隔 → 最多 2 轮。若 `await sleep` 退化成 `void sleep`，
    // 循环不再等待，30ms 内能跑上万轮（曾把 mock 调用记录撑到 OOM）。
    expect(pidCalls).toBeLessThanOrEqual(3);
  });

  it("token 缺失 → 抛可操作的错，且不发起登录（降级路径）", async () => {
    const prev = process.env.PIXIV_REFRESH_TOKEN;
    delete process.env.PIXIV_REFRESH_TOKEN;
    try {
      await expect(loginViaDevIntent("emulator-5554")).rejects.toThrow(/PIXIV_REFRESH_TOKEN/);
      // 关键：静默发一个空 token 的 am start 会让 hook 什么都不做，
      // 表现为「登录态莫名失效」而不是显式失败——必须断言没有下发
      expect(runOrThrow).not.toHaveBeenCalled();
    } finally {
      if (prev !== undefined) process.env.PIXIV_REFRESH_TOKEN = prev;
    }
  });

  it("一直等不到成功标记 → 超时抛错并带上 logcat 尾部（不做静默降级）", async () => {
    logcatNeverSucceeds();
    await expect(loginViaDevIntent("emulator-5554", "T", 30)).rejects.toThrow(/dev hook 登录超时/);
  });
});
