// 期望值出处：zh 相对时间 = 原 CommentList formatDate 存量输出（逐字快照，B10）；
// en 期望值出自 docs/style-guides/ui-copy.md 产出的 time.* 字典字面量。
import { describe, expect, it, vi } from "vitest";
import { formatDate, formatRelativeTime } from "@/utils/dateFormat";
import { setLanguage } from "@/i18n";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const NOW = new Date("2026-09-12T12:00:00+08:00");

describe("utils/dateFormat（B10 日期层）", () => {
  it("zh 相对时间：与存量 CommentList 输出逐字一致", () => {
    setLanguage("zh-CN");
    expect(formatRelativeTime("2026-09-12T11:59:40+08:00", NOW)).toBe("刚刚");
    expect(formatRelativeTime("2026-09-12T11:55:00+08:00", NOW)).toBe("5分钟前");
    expect(formatRelativeTime("2026-09-12T09:00:00+08:00", NOW)).toBe("3小时前");
    expect(formatRelativeTime("2026-09-09T12:00:00+08:00", NOW)).toBe("3天前");
  });

  it("zh 绝对日期：与 toLocaleDateString('zh-CN') 对齐（YYYY/M/D）", () => {
    setLanguage("zh-CN");
    expect(formatDate("2026-09-12T12:00:00+08:00")).toBe("2026/9/12");
  });

  it("en：相对时间与绝对日期切英文（M/D/YYYY）", async () => {
    setLanguage("en");
    await vi.waitFor(() => {
      expect(formatRelativeTime("2026-09-12T11:55:00+08:00", NOW)).toBe("5 minutes ago");
    });
    expect(formatDate("2026-09-12T12:00:00+08:00")).toBe("9/12/2026");
    setLanguage("zh-CN");
    await flush();
  });
});
