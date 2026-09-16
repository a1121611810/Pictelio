import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 降级原因码一致性（防漂移，ADR-0164 / spec §3.1）
 *
 * 原因码是跨语言契约：Java EngineRoute.Reason 枚举写入快照与 extra（稳定 ASCII），
 * TS REASON_I18N_KEYS 把码映射为 i18n 键。任一侧新增/删除码而另一侧未跟时，
 * UI 对新码静默显示「引擎状态未知」、旧码残留死键——双向键集相等钉住。
 *
 * Oracle：Java 枚举源码 EngineRoute.Reason 的 code 字面量（独立来源）；契约码集
 * 来自 docs/specs/engine-default-lynx-bidirectional-fallback.md §3.1。
 * i18n 键存在性由 Dict satisfies 编译期强制 + 本测试对 zh 字典的运行时抽查兜底
 *（en 与 zh 的键集相等由 en/routes.ts 的 satisfies Record<ZhRoutesKey, string> 钉住）。
 * 模式先例：tests/unit/utils/engineKeysConsistency.test.ts。
 */

const mocks = vi.hoisted(() => ({
  preferencesGet: vi.fn(),
  preferencesSet: vi.fn(),
  exitApp: vi.fn(),
  restart: vi.fn(),
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: mocks.preferencesGet, set: mocks.preferencesSet },
}));
vi.mock("@capacitor/app", () => ({
  App: { exitApp: mocks.exitApp },
}));
vi.mock("@/native/ClientInfo", () => ({
  ClientInfo: { restart: mocks.restart, getClientKinds: vi.fn() },
}));

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../../..");

const javaFile = resolve(
  repoRoot,
  "packages/app/android/app/src/main/java/io/pictelio/app/engine/EngineRoute.java",
);

/** spec §3.1 契约码集（oracle 溯源：spec 正文逐字列举） */
const SPEC_REASON_CODES = [
  "preferred",
  "lynx_unavailable",
  "lynx_known_bad",
  "lynx_retry",
  "webview_unavailable",
  "a11y_webview",
  "a11y_lynx_last_resort",
  "no_engine",
  "forced_webview",
  "runtime_failure",
];

/** 从 EngineRoute.java 的 Reason 枚举体提取 code 字面量（构造调用 NAME("code")） */
function extractJavaReasonCodes(): string[] {
  const src = readFileSync(javaFile, "utf8");
  const start = src.indexOf("public enum Reason");
  const end = src.indexOf("Reason(String code)");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`未能定位 Reason 枚举体: ${javaFile}`);
  }
  const enumBody = src.slice(start, end);
  return [...enumBody.matchAll(/\(\s*"([a-z0-9_]+)"\s*\)/g)].map((m) => m[1]);
}

describe("降级原因码一致性（Java EngineRoute.Reason ↔ TS REASON_I18N_KEYS）", () => {
  it("Java 枚举 code 集等于 spec §3.1 契约码集（oracle）", () => {
    expect(extractJavaReasonCodes()).toEqual(SPEC_REASON_CODES);
  });

  it("TS REASON_I18N_KEYS 键集与 Java 枚举码集双向相等", async () => {
    const { REASON_I18N_KEYS } = await import("@/utils/clientSwitch");
    const tsCodes = Object.keys(REASON_I18N_KEYS);
    const javaCodes = extractJavaReasonCodes();
    // TS ⊆ Java：无死键（Java 删码而 TS 未跟）
    expect(tsCodes.filter((c) => !javaCodes.includes(c))).toEqual([]);
    // Java ⊆ TS：无漏键（Java 加码而 TS 未跟 → UI 只能显示 unknown）
    expect(javaCodes.filter((c) => !tsCodes.includes(c))).toEqual([]);
  });

  it("每个码映射到 engineFallback.reason.<code> 键", async () => {
    const { REASON_I18N_KEYS } = await import("@/utils/clientSwitch");
    for (const code of extractJavaReasonCodes()) {
      expect(REASON_I18N_KEYS[code as keyof typeof REASON_I18N_KEYS]).toBe(
        `engineFallback.reason.${code}`,
      );
    }
  });

  it("zh 字典含全部原因码键且文案非空（运行时兜底，编译期由 satisfies 保证）", async () => {
    const { REASON_I18N_KEYS } = await import("@/utils/clientSwitch");
    const zhRoutes = (await import("@/i18n/locales/zh-CN/routes")).default as unknown as Record<
      string,
      string
    >;
    for (const key of Object.values(REASON_I18N_KEYS)) {
      expect(zhRoutes[key]).toBeTruthy();
    }
  });
});
