// 原小说块解析实现已迁入共享包 @pictelio/novel-export（ADR-0154 D1）。
// 此处整体 re-export，保持既有 import 路径与公开符号不变，消费方零改动。
export * from "@pictelio/novel-export";
