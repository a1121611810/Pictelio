import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 引擎降级通知键一致性（防漂移）
 *
 * 背景（ADR-0153 决策 6）：native LynxActivity 在「WebView 不可用 → 降级进入 Lynx」时
 * 向 SharedPreferences("CapacitorStorage") 写一次性键，app-lynx 首帧消费。键是跨语言
 * 契约（Java 常量 ↔ TS 常量），任一方漂移则通知静默失效（用户看不到降级说明）。
 *
 * Oracle：Java 常量源码 EngineFallbackNotice.KEY（独立来源，非手写自洽 mock）；
 * 期望字面量来自 ADR-0153 / docs/specs/engine-availability-fallback.md。
 */
const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../../..");

const javaFile = resolve(
  repoRoot,
  "packages/app/android/app/src/main/java/io/pictelio/app/EngineFallbackNotice.java",
);
const tsFile = resolve(repoRoot, "packages/app-lynx/src/utils/engineFallbackNotice.ts");
const lynxActivityFile = resolve(
  repoRoot,
  "packages/app/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java",
);

function extractJavaConstant(name: string): string {
  const src = readFileSync(javaFile, "utf8");
  const m = src.match(new RegExp(`String\\s+${name}\\s*=\\s*"([^"]+)"`));
  if (!m) throw new Error(`未能从 Java 源码提取常量 ${name}: ${javaFile}`);
  return m[1];
}

function extractTsConstant(name: string): string {
  const src = readFileSync(tsFile, "utf8");
  const m = src.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`));
  if (!m) throw new Error(`未能从 TS 源码提取常量 ${name}: ${tsFile}`);
  return m[1];
}

describe("引擎降级通知键一致性（防漂移）", () => {
  const javaKey = extractJavaConstant("KEY");
  const tsKey = extractTsConstant("ENGINE_FALLBACK_NOTICE_KEY");

  it("Java 常量等于契约字面量（ADR-0153 决策 6）", () => {
    expect(javaKey).toBe("pictelio_engine_fallback_notice");
  });

  it("app-lynx TS 常量与 Java 常量一致", () => {
    expect(tsKey).toBe(javaKey);
  });

  it("Java VALUE_TRUE 为契约值 'true'", () => {
    expect(extractJavaConstant("VALUE_TRUE")).toBe("true");
  });

  it("LynxActivity 确实以该键写入（集成锚点，防只改常量不接线）", () => {
    const src = readFileSync(lynxActivityFile, "utf8");
    expect(src).toMatch(/putString\(EngineFallbackNotice\.KEY/);
  });
});
