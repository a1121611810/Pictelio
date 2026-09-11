// 跨端契约：app 与 app-lynx 的 AI 真值表 fixture 必须逐字节一致（防语义漂移）。
// 先例：restrictionTruthTableConsistency.test.ts（R18 12 例同款守护）。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("sharedAiFilterTruthTable 跨端一致性", () => {
  it("app 与 app-lynx 的 fixture 逐字节一致", () => {
    const app = read("./sharedAiFilterTruthTable.ts");
    const lynx = read("../../../../app-lynx/tests/differential/sharedAiFilterTruthTable.ts");
    expect(app).toBe(lynx);
  });

  it("fixture 不含框架依赖（纯数据，可被两端直接消费）", () => {
    const content = read("./sharedAiFilterTruthTable.ts");
    expect(content).not.toContain("vitest");
    expect(content).not.toContain("import ");
  });
});
