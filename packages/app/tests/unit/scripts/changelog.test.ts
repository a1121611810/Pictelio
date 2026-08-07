import { describe, it, expect } from "vitest";
import { CHANGELOG_MAX_LENGTH, truncateChangelog } from "../../../scripts/lib/changelog.mjs";

describe("truncateChangelog", () => {
  it("CHANGELOG_MAX_LENGTH 为 5000（ADR-0068 定案上限）", () => {
    expect(CHANGELOG_MAX_LENGTH).toBe(5000);
  });

  it("长度 ≤5000 的文案原样返回", () => {
    const notes = "✨ 新功能\n".repeat(100); // 约 600 字符，远小于上限
    expect(truncateChangelog(notes)).toBe(notes);
  });

  it("长度 >5000 的文案截断到 5000 字符", () => {
    const notes = "a".repeat(6000);
    const out = truncateChangelog(notes);
    expect(out).toHaveLength(5000);
    expect(out).toBe(notes.slice(0, 5000));
  });

  it("截断边界：恰好 5000 字符原样返回", () => {
    const notes = "界".repeat(5000); // 恰好等于上限
    const out = truncateChangelog(notes);
    expect(out).toHaveLength(5000);
    expect(out).toBe(notes);
  });
});
