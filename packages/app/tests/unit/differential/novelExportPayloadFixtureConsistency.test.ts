// 跨语言 golden payload 双副本一致性（测试硬约束 #2：Java 侧 oracle 必须来自真实 TS 产出）。
// TS 侧：packages/novel-export/tests/fixtures/sample-payload.json（构建器生成，golden.test.ts 锁定）
// Java 侧：packages/app/android/app/src/test/resources/novel-export-sample-payload.json（NovelExportModel 测试读取）
// 本测试 readFileSync 逐字节比对两份，任何单侧改动而不同步即红灯（backupRulesConsistency 模式）。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const TS_FIXTURE = path.resolve(
  TEST_DIR,
  "../../../../novel-export/tests/fixtures/sample-payload.json",
);
const JAVA_FIXTURE = path.resolve(
  TEST_DIR,
  "../../../android/app/src/test/resources/novel-export-sample-payload.json",
);

describe("golden payload 双副本一致（防漂移）", () => {
  it("novel-export fixture 与 Java test resource 逐字节一致", () => {
    expect(readFileSync(TS_FIXTURE, "utf8")).toBe(readFileSync(JAVA_FIXTURE, "utf8"));
  });
});
