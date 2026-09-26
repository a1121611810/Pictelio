// 标签静音匹配语义真值表（ADR-0187 D2 / spec docs/specs/tag-mute.md 边界条件）。
// 双端 differential 共用 fixture：webview 与 lynx 各自实现的谓词必须对同一组
// 用例给出一致判定（r18FilterTruthTable 的 sharedRestrictionTruthTable 先例）。
// 语义：tags[].name 经 trim 后与静音集合精确相等；不匹配 translated_name；
// 空集合 / 空 tags / undefined tags 一律放行。
//
// 双端语义一致性（#732）：本文件为 webview packages/app/tests/unit/differential/
// sharedTagMuteTruthTable.ts 的**独立等价拷贝**（ADR-0187 D6 不做共享包； lynx 侧
// 禁止跨包 import）——用例集与判定语义逐条对齐，两侧实现（webview r18Filter.hasMutedTag
// / lynx settingsStore.isTagMuted）对同一用例必须给出相同 expectedMuted。

export interface TagMuteCase {
  /** 静音集合（存储态：元素均已 trim） */
  muted: string[];
  /** 作品标签（undefined 模拟运行时数据缺失） */
  tags?: { name: string; translated_name?: string }[] | null;
  /** true = 应被过滤剔除；false = 放行 */
  expectedMuted: boolean;
}

export const TAG_MUTE_TRUTH_TABLE: TagMuteCase[] = [
  // 命中：精确相等
  { muted: ["R-18G"], tags: [{ name: "R-18G" }], expectedMuted: true },
  // trim 命中：作品侧未 trim 的 name 与存储态 trim 后相等
  { muted: ["グロ"], tags: [{ name: "  グロ  " }], expectedMuted: true },
  // 多标签中任一命中即剔除
  {
    muted: ["R-18G"],
    tags: [{ name: "風景" }, { name: "R-18G" }, { name: "オリジナル" }],
    expectedMuted: true,
  },
  // 未命中：大小写敏感（无归一化）
  { muted: ["r-18g"], tags: [{ name: "R-18G" }], expectedMuted: false },
  // 未命中：部分匹配不放行（精确相等语义）
  { muted: ["R-18"], tags: [{ name: "R-18G" }], expectedMuted: false },
  // translated_name 不参与匹配
  { muted: ["グロ"], tags: [{ name: "guro", translated_name: "グロ" }], expectedMuted: false },
  // 空 tags 放行
  { muted: ["R-18G"], tags: [], expectedMuted: false },
  // undefined tags 放行（数据缺失）
  { muted: ["R-18G"], tags: undefined, expectedMuted: false },
  // 空静音集合放行（未登录 / 空 词表）
  { muted: [], tags: [{ name: "R-18G" }], expectedMuted: false },
];
