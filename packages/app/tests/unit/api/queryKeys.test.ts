import { describe, it, expect } from "vitest";
import { queryKeys } from "@/api/queryKeys";

describe("queryKeys search", () => {
  it("searchIllust returns correct key structure", () => {
    const key = queryKeys.searchIllust("星空");
    expect(key).toEqual(["search", "illust", "星空", "date_desc", "partial_match_for_tags"]);
  });

  it("searchIllust with custom sort and target", () => {
    const key = queryKeys.searchIllust("Fate", "popular_desc", "title_and_caption");
    expect(key).toEqual(["search", "illust", "Fate", "popular_desc", "title_and_caption"]);
  });

  it("searchNovel returns correct key structure", () => {
    const key = queryKeys.searchNovel("小説");
    expect(key).toEqual(["search", "novel", "小説", "date_desc", "partial_match_for_tags"]);
  });

  it("searchNovel with custom params", () => {
    const key = queryKeys.searchNovel("test", "date_asc", "exact_match_for_tags");
    expect(key).toEqual(["search", "novel", "test", "date_asc", "exact_match_for_tags"]);
  });

  it("searchAutocomplete returns correct key", () => {
    const key = queryKeys.searchAutocomplete("star");
    expect(key).toEqual(["search", "autocomplete", "star"]);
  });

  it("related returns correct key structure", () => {
    const key = queryKeys.related(42);
    expect(key).toEqual(["related", 42]);
  });
});
