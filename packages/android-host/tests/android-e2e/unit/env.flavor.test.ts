// @vitest-environment node
/**
 * env.ts 的 flavor 解析与派生态单测。
 *
 * 背景：#610 去 Capacitor 化后 main 线**没有 productFlavors**，单引擎产物落在
 * `apk/debug/app-debug.apk`、入口 Activity 是 `LynxActivity`；而过渡分支
 * `release/transition-6.2.0` 仍是 full/lynx/webview 三维度。env.ts 原先只认
 * `full`/`webview`，在单引擎 main 上会指向一个本次构建根本没产出的 APK，
 * 且拉起不存在的 `io.pictelio.app.MainActivity` → 套件整体装不上/起不来。
 *
 * 这些是 IO 边界函数（读环境变量），按项目测试硬约束须覆盖成功与降级双路径。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APK_PATH,
  APP_NAMESPACE,
  APP_PACKAGE,
  E2E_FLAVOR,
  ENTRY_ACTIVITIES,
  LYNX_ACTIVITY,
  LYNX_ACTIVITY_COMPONENT,
  MAIN_ACTIVITY,
  apkRelativePath,
  resolveE2eFlavor,
  type E2eFlavor,
} from "../env";

describe("resolveE2eFlavor", () => {
  it("显式合法值原样返回（成功路径，三值全覆盖）", () => {
    expect(resolveE2eFlavor("single")).toBe("single");
    expect(resolveE2eFlavor("full")).toBe("full");
    expect(resolveE2eFlavor("webview")).toBe("webview");
  });

  it("未设置 / 空串 / 非法值一律降级为 single（降级路径）", () => {
    // 缺省必须是 single：main 线是主线，且「按产物存在性自动探测」已被证伪
    // （outputs/apk/ 下会残留其它分支的陈旧 flavor 目录）
    expect(resolveE2eFlavor(undefined)).toBe("single");
    expect(resolveE2eFlavor("")).toBe("single");
    expect(resolveE2eFlavor("lynx")).toBe("single");
    expect(resolveE2eFlavor("FULL")).toBe("single");
    expect(resolveE2eFlavor(" full")).toBe("single");
  });
});

describe("apkRelativePath", () => {
  it("single → 无 flavor 维度的调试产物路径", () => {
    expect(apkRelativePath("single")).toBe("android/app/build/outputs/apk/debug/app-debug.apk");
  });

  it("full / webview → 带 flavor 维度的产物路径", () => {
    expect(apkRelativePath("full")).toBe(
      "android/app/build/outputs/apk/full/debug/app-full-debug.apk",
    );
    expect(apkRelativePath("webview")).toBe(
      "android/app/build/outputs/apk/webview/debug/app-webview-debug.apk",
    );
  });

  it("三条路径两两不同（阳性对照：证明这是真映射而非返回常量）", () => {
    const paths = (["single", "full", "webview"] as E2eFlavor[]).map(apkRelativePath);
    expect(new Set(paths).size).toBe(3);
  });
});

describe("MAIN_ACTIVITY / ENTRY_ACTIVITIES（单引擎，无 flavor 维度）", () => {
  it("MAIN_ACTIVITY 恒为 LynxActivity，且绝不是已删除的 MainActivity", () => {
    // ⚠️ MAIN_ACTIVITY 是**类 FQN**，不是组件串：类 FQN 的根是 namespace，
    // **不随变体变化** ⇒ 加了 debug applicationId 后缀后这条断言**逐字不变**。
    expect(MAIN_ACTIVITY).toBe("io.pictelio.app.LynxActivity");
    expect(MAIN_ACTIVITY).toBe(LYNX_ACTIVITY);
    expect(MAIN_ACTIVITY.endsWith(".MainActivity")).toBe(false);
  });

  it("ENTRY_ACTIVITIES 只有唯一入口（不存在第二选项）", () => {
    expect(ENTRY_ACTIVITIES).toEqual([LYNX_ACTIVITY]);
  });
});

describe("包名坐标（ADR-0227：applicationId 与类 FQN 是**两个**坐标）", () => {
  it("E2E 跑在 debug 变体上 ⇒ applicationId 带 .debug 后缀", () => {
    expect(APP_PACKAGE).toBe("io.pictelio.app.debug");
  });

  it("类 FQN 的根是 namespace，不随变体变化（release 侧 applicationId 仍是 io.pictelio.app）", () => {
    expect(APP_NAMESPACE).toBe("io.pictelio.app");
    expect(LYNX_ACTIVITY).toBe(`${APP_NAMESPACE}.LynxActivity`);
  });

  it("组件串 = applicationId + 类 FQN（`am start -n` 的参数）", () => {
    expect(LYNX_ACTIVITY_COMPONENT).toBe("io.pictelio.app.debug/io.pictelio.app.LynxActivity");
  });

  it("反向对照：相对类名形态在 debug 下会解析成不存在的类（**不可**用它拼组件串）", () => {
    // `io.pictelio.app.debug/.LynxActivity` 会被 `ComponentName.unflattenFromString`
    // 展开成 `io.pictelio.app.debug.LynxActivity` —— 那个类不存在（类住在 namespace 包）。
    const relative = `${APP_PACKAGE}/.LynxActivity`;
    expect(relative).not.toBe(LYNX_ACTIVITY_COMPONENT);
    const expanded = APP_PACKAGE + relative.slice(relative.indexOf("/") + 1);
    expect(expanded).toBe("io.pictelio.app.debug.LynxActivity");
    expect(expanded).not.toBe(LYNX_ACTIVITY);
  });
});

describe("模块级派生态（本测试进程未设 ANDROID_E2E_FLAVOR ⇒ 走 single 缺省）", () => {
  it("E2E_FLAVOR 缺省为 single", () => {
    expect(process.env.ANDROID_E2E_FLAVOR).toBeUndefined();
    expect(E2E_FLAVOR).toBe("single");
  });

  it("APK_PATH 指向单引擎产物，且与 full 布局路径不同", () => {
    expect(APK_PATH.endsWith("/apk/debug/app-debug.apk")).toBe(true);
    expect(APK_PATH).not.toContain("/apk/full/");
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("非单引擎 flavor 的显式失败（#819）", () => {
  // 反事实检验：把 env.ts 的 throw 去掉，本用例转红——此前各 spec 用
  // `E2E_FLAVOR === "webview" ⇒ 整文件 skip` 兜着，配置写错只会静默跳过。
  it("ANDROID_E2E_FLAVOR=full 时 import env 直接抛错并指向正确指令", async () => {
    vi.resetModules();
    vi.stubEnv("ANDROID_E2E_FLAVOR", "full");
    await expect(import("../env")).rejects.toThrow(
      new RegExp(apkRelativePath("full").replace(/[/.]/gu, "\\$&")),
    );
  });

  it("ANDROID_E2E_FLAVOR=webview 时同样抛错", async () => {
    vi.resetModules();
    vi.stubEnv("ANDROID_E2E_FLAVOR", "webview");
    await expect(import("../env")).rejects.toThrow(/release\/transition-6\.2\.0/);
  });

  it("缺省（无环境变量）不抛错，走 single", async () => {
    vi.resetModules();
    vi.stubEnv("ANDROID_E2E_FLAVOR", undefined);
    const mod = await import("../env");
    expect(mod.E2E_FLAVOR).toBe("single");
  });
});
