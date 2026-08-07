// ─── 更新检查（re-export 共享包） ───
// 实现已迁移至 monorepo 共享包 @pictelio/update-check（单一事实源）：
// 主 app 与 app-lynx 共用同一份 isNewer / checkForUpdate / CheckResult。
// 本文件保留为薄 re-export，避免既有 import 面（"@/services/updateService"）大改；
// 调用方需传入本地版本（主 app 的 APP_VERSION 编译期常量）。
export { isNewer, checkForUpdate, type CheckResult, type FetchLike } from "@pictelio/update-check";
