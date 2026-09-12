// ─── 错误归一化工具 ───
import { ApiErrorType } from "../api/types"
import type { ApiError } from "../api/types"

/**
 * 统一将任意错误值转换为 ApiError，已有 type 的保留原 type，否则创建 UNKNOWN。
 * fallbackMsg 未显式传入（走默认「加载失败」）时附带 messageKey 供展示层走 i18n；
 * 调用方传自定义 fallback 时不带 key（避免覆盖调用方语义）。
 * ?? 语义保持：e.message 为空串时透传，不落 fallback（errorPresentation 的 || 兜底负责空串）。
 */
export function toApiError(e: unknown, fallbackMsg?: string): ApiError {
  if (e && typeof e === "object" && "type" in e) {
    return e as ApiError
  }
  const raw = (e as { message?: string })?.message
  if (raw !== undefined) {
    return { type: ApiErrorType.UNKNOWN, message: raw }
  }
  if (fallbackMsg !== undefined) {
    return { type: ApiErrorType.UNKNOWN, message: fallbackMsg }
  }
  return {
    type: ApiErrorType.UNKNOWN,
    message: "加载失败",
    messageKey: "error.fallback.loadFailed",
  }
}
