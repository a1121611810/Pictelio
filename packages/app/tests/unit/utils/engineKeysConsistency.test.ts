import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 引擎持久化键一致性（防漂移，ADR-0164 决策 3 / spec §3 键契约表）
 *
 * 键字面量的唯一所有者是 Java 侧 EnginePrefs；TS 侧 clientSwitch.ts 只持镜像常量。
 * 键是跨语言契约（Java 常量 ↔ TS 常量），任一方漂移则引擎开关/快照读写静默失效
 * （webview 设置 UI 写 A 键、Java 决策读 B 键）。本测试从两侧源码提取字面量比对。
 *
 * Oracle：Java 常量源码 EnginePrefs.KEY_*（独立来源，非手写自洽 mock）；契约字面量
 * 来自 docs/specs/engine-default-lynx-bidirectional-fallback.md §3 键契约表。
 * 模式先例：tests/unit/utils/engineFallbackNoticeConsistency.test.ts。
 */
const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../../..");

const javaFile = resolve(
  repoRoot,
  "packages/app/android/app/src/main/java/io/pictelio/app/engine/EnginePrefs.java",
);
const tsFile = resolve(repoRoot, "packages/app/src/utils/clientSwitch.ts");

function extractJavaConstant(name: string): string {
  const src = readFileSync(javaFile, "utf8");
  const m = src.match(new RegExp(`String\\s+${name}\\s*=\\s*"([^"]+)"`));
  if (!m) throw new Error(`未能从 Java 源码提取常量 ${name}: ${javaFile}`);
  return m[1];
}

function extractTsConstant(name: string): string {
  const src = readFileSync(tsFile, "utf8");
  const m = src.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]+)"`));
  if (!m) throw new Error(`未能从 TS 源码提取常量 ${name}: ${tsFile}`);
  return m[1];
}

/** Java 常量名 ↔ TS 镜像常量名 ↔ spec §3 契约字面量 */
const KEY_PAIRS = [
  {
    java: "KEY_PREFERRED_KIND",
    ts: "CLIENT_KIND_KEY",
    contract: "pictelio_client_kind",
  },
  {
    java: "KEY_AUTO_FALLBACK",
    ts: "KEY_AUTO_FALLBACK",
    contract: "pictelio_engine_auto_fallback",
  },
  {
    java: "KEY_STATE",
    ts: "KEY_ENGINE_STATE",
    contract: "pictelio_engine_state",
  },
  {
    java: "KEY_FAILURE_MEMORY",
    ts: "KEY_FAILURE_MEMORY",
    contract: "pictelio_engine_lynx_failure_version",
  },
  {
    java: "KEY_FALLBACK_OPTOUT",
    ts: "KEY_FALLBACK_OPTOUT",
    contract: "pictelio_engine_fallback_optout",
  },
] as const;

describe("引擎持久化键一致性（Java EnginePrefs ↔ TS clientSwitch，防漂移）", () => {
  it.each(KEY_PAIRS)("Java $java 等于契约字面量（spec §3）", ({ java, contract }) => {
    expect(extractJavaConstant(java)).toBe(contract);
  });

  it.each(KEY_PAIRS)("TS 镜像常量 $ts 与 Java $java 一致", ({ java, ts }) => {
    expect(extractTsConstant(ts)).toBe(extractJavaConstant(java));
  });

  it("clientSwitch.ts 确实引用开关/快照/降级提示 optout 镜像常量（集成锚点，防只声明不接线）", () => {
    const src = readFileSync(tsFile, "utf8");
    expect(src).toMatch(/key:\s*KEY_AUTO_FALLBACK\s*}/);
    expect(src).toMatch(/key:\s*KEY_ENGINE_STATE\s*}/);
    expect(src).toMatch(/key:\s*KEY_FALLBACK_OPTOUT\s*}/);
  });

  it("EnginePrefs 确实以 KEY_STATE 发布快照、读 KEY_AUTO_FALLBACK（集成锚点）", () => {
    const src = readFileSync(javaFile, "utf8");
    expect(src).toMatch(/putString\(KEY_STATE/);
    expect(src).toMatch(/getString\(KEY_AUTO_FALLBACK/);
  });
});
