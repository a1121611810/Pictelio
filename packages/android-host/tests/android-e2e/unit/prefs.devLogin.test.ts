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
import { devLoginIntentArgs, loginViaDevIntent, readAppLogcat, redactSecrets } from "../prefs";

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
      stdout: 'I LynxActivity: dev hook: 自动登录成功（userInfo={"userId":1}）',
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
      "--es",
      "pictelio_dev_force_r18",
      "true",
    ]);
  });

  it("默认带 force_r18 extra（否则受限作品渲染灰占位、像素判据恒等）", () => {
    // oracle = tools/verify-translation.sh:47 与 tools/README.md:42 的既有用法；
    // 消费侧 LynxActivity.java:103 → settingsStore.ts:797 读 dev_force_r18 键
    expect(devLoginIntentArgs("T")).toEqual(
      expect.arrayContaining(["--es", "pictelio_dev_force_r18", "true"]),
    );
  });

  it("forceR18=false 时不下发该 extra（关闭分支）", () => {
    expect(devLoginIntentArgs("T", false)).not.toContain("pictelio_dev_force_r18");
  });

  it("设备 shell 侧单引号包裹：URL-safe 字符原样保留", () => {
    // 真实 token 形态：含 _ 与 -，单引号包裹后 shell 不会展开
    const args = devLoginIntentArgs("aZ-_09AZ-_09AZ-_09AZ-_09AZ-_09AZ-_09AZ0");
    expect(args).toContain("'aZ-_09AZ-_09AZ-_09AZ-_09AZ-_09AZ-_09AZ0'");
  });

  it("token 内嵌单引号被转义，不会提前闭合引号（注入/截断防护）", () => {
    const args = devLoginIntentArgs("ab'cd");
    // 'ab'\''cd' —— 中间的 '\'' 是标准的「结束-转义单引号-重开单引号」
    expect(args).toContain("'ab'\\''cd'");
  });
});

describe("readAppLogcat", () => {
  it("进程存在时按 --pid 过滤抓取，且不得回退抓全量（成功路径）", () => {
    runCapture.mockImplementation((_bin: string, args: string[]) =>
      args.includes("pidof")
        ? { code: 0, stdout: "4242", stderr: "" }
        : { code: 0, stdout: "I LynxEnv : LynxEnv start init", stderr: "" },
    );
    expect(readAppLogcat("emulator-5554")).toContain("LynxEnv start init");
    const logcatCall = runCapture.mock.calls.find((c) => (c[1] as string[]).includes("logcat"))!;
    expect(logcatCall[1]).toEqual(["-s", "emulator-5554", "logcat", "-d", "--pid=4242"]);
    // 防「pid 抓不到就退化成 logcat -d 全量」——全量里是系统噪声，匹配不到 app 的信号，
    // 会让 waitForLynxRenderReady 之类的判定永远超时（实测环形 buffer 挤出 LynxEnv 行）。
    // 这条断言必须在 pid 非空时才成立；pid 为空时 logcat 一次都不该发生。
    const logcatCalls = runCapture.mock.calls.filter((c) => (c[1] as string[]).includes("logcat"));
    expect(logcatCalls).toHaveLength(1);
    expect(logcatCalls[0]![1]).toContain("--pid=4242");
  });

  it("进程尚未创建时返回空串且不抛错（降级路径，让调用方轮询继续）", () => {
    runCapture.mockImplementation((_bin: string, args: string[]) =>
      args.includes("pidof")
        ? { code: 0, stdout: "", stderr: "" }
        : { code: 0, stdout: "", stderr: "" },
    );
    // 关键：抛错会把「am start 后 Activity 记录先于进程出现约 150ms」这种常态
    // 误报成「app 崩溃」，并直接绕过调用方的等待循环
    expect(() => readAppLogcat("emulator-5554")).not.toThrow();
    expect(readAppLogcat("emulator-5554")).toBe("");
    // pid 为空 ⇒ 一次 logcat 都不能发（发了也只能拿到无 pid 的系统噪声）
    const logcatCalls = runCapture.mock.calls.filter((c) => (c[1] as string[]).includes("logcat"));
    expect(logcatCalls).toHaveLength(0);
  });

  it("lines 选项追加 -t 限尾（逐帧日志下全量 dump 会 ENOBUFS）", () => {
    runCapture.mockImplementation((_bin: string, args: string[]) =>
      args.includes("pidof")
        ? { code: 0, stdout: "4242", stderr: "" }
        : { code: 0, stdout: "I LynxEnv : LynxEnv start init", stderr: "" },
    );
    readAppLogcat("emulator-5554", { lines: 2000 });
    const logcatCall = runCapture.mock.calls.find((c) => (c[1] as string[]).includes("logcat"))!;
    expect(logcatCall[1]).toEqual([
      "-s",
      "emulator-5554",
      "logcat",
      "-d",
      "--pid=4242",
      "-t",
      "2000",
    ]);
  });
});

describe("redactSecrets", () => {
  // oracle = token 经 `am start --es pictelio_dev_refresh_token <token>` 下发，
  // 若日志回显则原样进错误消息 → 落盘 test-results/ 与 CI 输出。
  it("把环境变量里的 refresh_token 明文替换掉（多处全替）", () => {
    const prev = process.env.PIXIV_REFRESH_TOKEN;
    process.env.PIXIV_REFRESH_TOKEN = "SECRETTOKENVALUE0123456789";
    try {
      const log = "before SECRETTOKENVALUE0123456789 middle SECRETTOKENVALUE0123456789 after";
      const out = redactSecrets(log);
      expect(out).toBe("before [REDACTED] middle [REDACTED] after");
      expect(out).not.toContain("SECRETTOKENVALUE0123456789");
    } finally {
      if (prev === undefined) delete process.env.PIXIV_REFRESH_TOKEN;
      else process.env.PIXIV_REFRESH_TOKEN = prev;
    }
  });

  it("环境变量缺失时原样返回，不误伤（降级路径）", () => {
    const prev = process.env.PIXIV_REFRESH_TOKEN;
    delete process.env.PIXIV_REFRESH_TOKEN;
    try {
      expect(redactSecrets("任何内容都不含凭据")).toBe("任何内容都不含凭据");
    } finally {
      if (prev !== undefined) process.env.PIXIV_REFRESH_TOKEN = prev;
    }
  });

  it("token 过短时原样返回——避免把 'true' 这类常见子串整篇抹掉", () => {
    const prev = process.env.PIXIV_REFRESH_TOKEN;
    process.env.PIXIV_REFRESH_TOKEN = "abc";
    try {
      expect(redactSecrets("abc 就是普通文本")).toBe("abc 就是普通文本");
    } finally {
      if (prev === undefined) delete process.env.PIXIV_REFRESH_TOKEN;
      else process.env.PIXIV_REFRESH_TOKEN = prev;
    }
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
        "--es",
        "pictelio_dev_force_r18",
        "true",
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
      expect(runOrThrow.mock.calls[1]![1]).toContain("'EXPLICIT'");
      expect(runOrThrow.mock.calls[1]![1]).not.toContain("'ENV_TOKEN'");
    } finally {
      if (prev === undefined) delete process.env.PIXIV_REFRESH_TOKEN;
      else process.env.PIXIV_REFRESH_TOKEN = prev;
    }
  });

  it("forceR18=false 时登录不带该 extra（透传关闭分支）", async () => {
    logcatHasSuccess();
    await loginViaDevIntent("emulator-5554", "T", 5_000, false);
    expect(runOrThrow.mock.calls[1]![1]).not.toContain("pictelio_dev_force_r18");
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
    // 永不出现成功标记 → 走超时分支
    runCapture.mockImplementation((_bin: string, args: string[]) => {
      if (args.includes("pidof")) pidCalls += 1;
      return { code: 0, stdout: "I LynxActivity: 启动中", stderr: "" };
    });
    await expect(loginViaDevIntent("emulator-5554", "T", 30)).rejects.toThrow(/登录超时/);
    // 30ms 预算 + 1s 间隔 → 最多 2 轮。若 `await sleep` 退化成 `void sleep`，
    // 循环不再等待，30ms 内能跑上万轮（曾把 mock 调用记录撑到 OOM）。
    // 这条是**上界**断言，与机器负载无关：循环轮数受真实墙钟节流，
    // 负载再高只会更慢（更少轮），不会更多轮，故不违反 TESTING.md 约束 #6 的 flaky 禁令。
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
