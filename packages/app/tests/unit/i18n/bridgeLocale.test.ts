// P1-1 竞态回归测试（code-review）：桥往返（await）期间 hydrateAll 落地手动覆盖时，
// refreshSystemLocaleFromBridge 不得把手动语言打回系统语言（手动 > 系统优先级）。
// mock ClientInfo + 手控 promise 时序；期望值出处 = spec docs/specs/i18n.md §4.1 语言判定链。
import { beforeEach, describe, expect, it, vi } from "vitest";

function makeDeferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

// 每用例重建 deferred（vi.mock 工厂闭包读可变引用；共享 deferred 会被首个用例 resolve 掉）
let bridgeDeferred = makeDeferred<{ languageTag: string }>();

vi.mock("@/native/ClientInfo", () => ({
  ClientInfo: {
    getLocale: () => bridgeDeferred.promise,
    // catch 降级路径用例（review nit 5）：插件 reject 时不崩、locale 维持
    ...({} as Record<string, never>),
  },
}));

const bridgeReject = makeDeferred<never>();

beforeEach(() => {
  bridgeDeferred = makeDeferred<{ languageTag: string }>();
});

import { currentLocale, refreshSystemLocaleFromBridge, setLanguage } from "@/i18n";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("refreshSystemLocaleFromBridge（P1-1 启动竞态）", () => {
  it("桥往返期间落地手动覆盖时，桥结果不得覆盖手动语言", async () => {
    const pending = refreshSystemLocaleFromBridge(); // 入口 guard：handle=""（默认）通过
    setLanguage("en"); // 模拟 hydrateAll 在桥往返期间落地手动覆盖
    await flush();
    bridgeDeferred.resolve({ languageTag: "zh-CN" }); // 系统语言 zh
    await pending;
    await flush();
    expect(currentLocale()).toBe("en"); // 双重 guard 生效：手动 en 保持
    setLanguage(""); // 还原跟随系统（handle 归 ""）
    await flush();
  });

  it("插件不可用（getLocale reject）时降级不崩、维持当前 locale（#511 catch 路径）", async () => {
    const mod = await import("@/native/ClientInfo");
    const original = mod.ClientInfo.getLocale;
    mod.ClientInfo.getLocale = () => Promise.reject(new Error("plugin unavailable")) as never;
    try {
      setLanguage("");
      await flush();
      await expect(refreshSystemLocaleFromBridge()).resolves.toBeUndefined();
      expect(currentLocale()).toBe("zh-CN"); // 维持 navigator 兜底
    } finally {
      mod.ClientInfo.getLocale = original; // 恢复 mock，防污染后续用例
    }
  });

  it("无手动覆盖时桥结果正常生效（跟随系统路径不回归）", async () => {
    // 前置：handle 必须为 ""（跟随系统态），否则入口 guard 直接返回
    setLanguage("");
    await flush();
    const pending = refreshSystemLocaleFromBridge();
    await flush();
    bridgeDeferred.resolve({ languageTag: "en-US" });
    await pending;
    await flush();
    expect(currentLocale()).toBe("en"); // 跟随系统：桥注入 en
    setLanguage(""); // 还原跟随系统
    await flush();
  });
});
