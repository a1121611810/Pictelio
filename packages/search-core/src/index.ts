/**
 * @pictelio/search-core —— 双端搜索共享核心（spec docs/specs/search-advanced-filters.md）。
 * 零 IO 纯函数单点：筛选状态 / 参数构建 / URL 编解码 / 缓存键 / 收藏数兜底 / AI 覆盖。
 */
export * from "./filters";
export * from "./period";
export * from "./buildParams";
export * from "./urlCodec";
export * from "./cacheKey";
export * from "./fallback";
export * from "./ai";
