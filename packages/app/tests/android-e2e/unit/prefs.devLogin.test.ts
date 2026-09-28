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
 * 非被测实现反推。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { devLoginIntentArgs, loginViaDevIntent } from "../prefs";

const adbPath = vi.hoisted(() => vi.fn(() => "/fake/adb"));
const runOrThrow = vi.hoisted(() => vi.fn());

vi.mock("../env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../env")>();
  return { ...actual, adbPath, runOrThrow };
});

afterEach(() => {
  runOrThrow.mockClear();
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

describe("loginViaDevIntent", () => {
  it("token 来自环境变量时正常下发 adb 调用（成功路径）", () => {
    const prev = process.env.PIXIV_REFRESH_TOKEN;
    process.env.PIXIV_REFRESH_TOKEN = "ENV_TOKEN";
    try {
      loginViaDevIntent("emulator-5554");
      expect(runOrThrow).toHaveBeenCalledTimes(1);
      const [bin, args] = runOrThrow.mock.calls[0]!;
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

  it("显式参数优先于环境变量", () => {
    const prev = process.env.PIXIV_REFRESH_TOKEN;
    process.env.PIXIV_REFRESH_TOKEN = "ENV_TOKEN";
    try {
      loginViaDevIntent("emulator-5554", "EXPLICIT");
      expect(runOrThrow.mock.calls[0]![1].at(-1)).toBe("'EXPLICIT'");
    } finally {
      if (prev === undefined) delete process.env.PIXIV_REFRESH_TOKEN;
      else process.env.PIXIV_REFRESH_TOKEN = prev;
    }
  });

  it("token 缺失 → 抛可操作的错，且**不**下发任何 adb 调用（降级路径）", () => {
    const prev = process.env.PIXIV_REFRESH_TOKEN;
    delete process.env.PIXIV_REFRESH_TOKEN;
    try {
      expect(() => loginViaDevIntent("emulator-5554")).toThrow(/PIXIV_REFRESH_TOKEN/);
      // 关键：静默发一个空 token 的 am start 会让 hook 什么都不做，
      // 表现为「登录态莫名失效」而不是显式失败——必须断言没有下发
      expect(runOrThrow).not.toHaveBeenCalled();
    } finally {
      if (prev !== undefined) process.env.PIXIV_REFRESH_TOKEN = prev;
    }
  });
});
