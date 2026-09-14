import { describe, it, expect } from "vitest";
import { toggleBookmarkTag, commitBookmarkTagToken } from "@/utils/bookmarkTagSelection";

// ─── 收藏面板标签选择纯函数（T1，GitHub #530 / spec D5 / ADR-0160 D5） ───
// oracle 溯源（测试硬约束 #6）：
// - toggle/commit 语义：spec docs/specs/bookmark-tags.md D5「面板状态模型」——
//   勾选追加有序、取消移除、重复勾选幂等、上限 10 拒收第 11 个并反馈、
//   新建提交（trim、非空校验、重复拒绝、并入已选）。
// - 上限 10：docs/adr/glossary-bookmark-tags.md「标签上限」（官方帮助中心 + 官方公告双源）。
// - 错误以判别字符串返回（"empty"/"duplicate"/"limit"/"rejected"），翻译由 UI 层负责
//   （模块无 i18n 依赖，spec D5：纯函数便于 node 单测）。

describe("toggleBookmarkTag", () => {
  it("未选中 → 追加且保持勾选顺序", () => {
    expect(toggleBookmarkTag([], "風景")).toEqual({ selected: ["風景"] });
    expect(toggleBookmarkTag(["風景"], "watercolor")).toEqual({
      selected: ["風景", "watercolor"],
    });
  });

  it("已选中 → 移除（取消勾选），其余项保持原相对顺序", () => {
    expect(toggleBookmarkTag(["風景", "watercolor", "東方"], "watercolor")).toEqual({
      selected: ["風景", "東方"],
    });
  });

  it("重复勾选幂等：toggle 两次回到初始状态", () => {
    const once = toggleBookmarkTag([], "風景");
    expect(toggleBookmarkTag(once.selected, "風景")).toEqual({ selected: [] });
  });

  it("达到上限 10：第 11 个拒收，返回 rejected=limit 且已选集不变", () => {
    const full = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
    const result = toggleBookmarkTag(full, "11");
    expect(result.selected).toEqual(full);
    expect(result.rejected).toBe("limit");
  });

  it("上限边界内：第 10 个仍可加入（不拒收）", () => {
    const nine = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const result = toggleBookmarkTag(nine, "10");
    expect(result.selected).toHaveLength(10);
    expect(result.rejected).toBeUndefined();
  });

  it("limit 参数可覆盖默认值（上限满时取消勾选仍允许）", () => {
    expect(toggleBookmarkTag(["a"], "a", 1)).toEqual({ selected: [] });
    expect(toggleBookmarkTag(["a"], "b", 1)).toEqual({ selected: ["a"], rejected: "limit" });
  });

  it("纯函数不修改入参数组", () => {
    const input = ["a"];
    toggleBookmarkTag(input, "b");
    expect(input).toEqual(["a"]);
  });
});

describe("commitBookmarkTagToken", () => {
  it("正常提交：trim 后并入已选尾部", () => {
    expect(commitBookmarkTagToken(["風景"], "  watercolor  ")).toEqual({
      selected: ["風景", "watercolor"],
    });
  });

  it("空串拒绝：error=empty，已选集不变", () => {
    expect(commitBookmarkTagToken(["a"], "")).toEqual({ selected: ["a"], error: "empty" });
  });

  it("纯空格拒绝：trim 后为空 → error=empty", () => {
    expect(commitBookmarkTagToken(["a"], "   ")).toEqual({ selected: ["a"], error: "empty" });
  });

  it("重复拒绝：与已选项相同（trim 后比对）→ error=duplicate", () => {
    expect(commitBookmarkTagToken(["風景"], "風景")).toEqual({
      selected: ["風景"],
      error: "duplicate",
    });
    expect(commitBookmarkTagToken(["風景"], " 風景 ")).toEqual({
      selected: ["風景"],
      error: "duplicate",
    });
  });

  it("超限拒绝：已满 10 个 → error=limit，已选集不变", () => {
    const full = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
    const result = commitBookmarkTagToken(full, "11");
    expect(result.selected).toEqual(full);
    expect(result.error).toBe("limit");
  });

  it("校验顺序：满员时提交重复标签报 duplicate（spec 校验序：空串→重复→超限）", () => {
    const full = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
    expect(commitBookmarkTagToken(full, "1")).toEqual({ selected: full, error: "duplicate" });
  });

  it("校验顺序：满员时提交空串报 empty（空串优先于超限）", () => {
    const full = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
    expect(commitBookmarkTagToken(full, "  ")).toEqual({ selected: full, error: "empty" });
  });

  it("limit 参数可覆盖默认值", () => {
    expect(commitBookmarkTagToken(["a"], "b", 1)).toEqual({ selected: ["a"], error: "limit" });
    expect(commitBookmarkTagToken([], "a", 1)).toEqual({ selected: ["a"] });
  });

  it("纯函数不修改入参数组", () => {
    const input = ["a"];
    commitBookmarkTagToken(input, "b");
    expect(input).toEqual(["a"]);
  });
});
