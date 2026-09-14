/**
 * @pictelio/ranking-core —— 双端排行榜共享核心（spec docs/specs/ranking.md §6.1）。
 * 零 IO 纯函数单点：维度目录 / 请求构建 / 缓存键 / 日期校验与格式化。
 * 平台 UI、网络调用、内容过滤一律不进此包（过滤沿用各端既有链）。
 */
export * from "./query";
export * from "./modes";
export * from "./buildRequest";
export * from "./cacheKey";
export * from "./date";
