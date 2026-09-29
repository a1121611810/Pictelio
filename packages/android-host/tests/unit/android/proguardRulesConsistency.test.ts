import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * R8 keep 规则一致性测试（防漂移，ADR-0124）
 *
 * 背景（docs/adr/ADR-0124-r8-keep-room-generated-constructor.md）：
 * v4.22.0 引入 work-runtime 2.10 后，androidx.startup 的 InitializationProvider 在
 * 进程启动时初始化 WorkManager，其 Room 数据库打开路径通过
 * Class.forName("<db>_Impl").getDeclaredConstructor().newInstance() 反射实例化生成类
 * WorkDatabase_Impl；R8 看不到字符串反射调用，剥离了该类的无参构造器
 * （NoSuchMethodException: <init> []）导致 Release 包启动闪退。
 *
 * 本测试从真实文件提取规则面（proguard-rules.pro）与依赖面（build.gradle），
 * 断言：① 带成员规格的 keep 规则存在（-keep class X 无规格只保类名不保成员，
 * ADR-0064 已固化该语义）；② 规则面与 work-runtime 依赖面保持一致（缺一即红灯）。
 *
 * 期望值来源（Oracle）：ADR-0124 决策文本（规则原文）+ R8 成员规格语义
 * （ADR-0064 教训，注释同步于 proguard-rules.pro）。
 */

// ── 路径（相对本测试文件：packages/app/tests/unit/android/） ──
const testDir = path.dirname(fileURLToPath(import.meta.url));
const proguardFile = path.resolve(testDir, "../../../android/app/proguard-rules.pro");
// 原 build.gradle 依赖面读取（buildGradleFile / buildGradle）随 work-runtime 断言
// 一并移除——依赖声明已随 #610 手术删除（详见下方注释）。#804 决定 OTA 存废时加回。

/** 提取 keep 规则行（去注释、归一化空白，便于逐条精确断言） */
function extractKeepRules(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.startsWith("-keep class") || trimmed.startsWith("-keepclasses");
    })
    .map((line) => line.trim().replace(/\s+/g, " "));
}

describe("R8 keep 规则（Room 反射实例化面，ADR-0124）", () => {
  const keepRules = extractKeepRules(readFileSync(proguardFile, "utf8"));

  it("声明 Room 数据库生成类无参构造器的 keep 规则（必须带成员规格）", () => {
    expect(keepRules).toContain("-keep class * extends androidx.room.RoomDatabase { <init>(); }");
    expect(keepRules).toContain("-keep class androidx.work.impl.WorkDatabase_Impl { <init>(); }");
  });

  it("Room 相关 keep 规则不得退化为无成员规格形式（只保类名不保成员，ADR-0064 教训）", () => {
    const degenerate = keepRules.filter((rule) =>
      /^-keep class \* extends androidx\.room\.RoomDatabase$/.test(rule),
    );
    expect(degenerate).toEqual([]);
  });

  // 原「work-runtime 依赖声明与 keep 规则同在（webview + full 两个 flavor）」断言
  // 已随 #610 手术移除：手术把 `webviewImplementation "androidx.work:work-runtime"`
  // **整条删除**（不是改成通用 implementation），因为 work-runtime 是 OTA 慢通道
  // （proguard-rules.pro 注释：ADR-0122），而 OTA 随 webview flavor 下线。
  // ⚠️ 该断言的存废实质归属 #804（更新通道处置）——若 OTA 以 Lynx 形态重建，
  // 依赖与本断言须一并加回，否则 R8 会再次剥离 WorkDatabase_Impl 的无参构造器
  // （ADR-0124 记录的 Release 启动闪退）。
  //
  // 下面两条 Room keep 规则断言**不受影响**（Room 仍随 app 使用），继续守护
  // ADR-0064 的成员规格语义。
});
