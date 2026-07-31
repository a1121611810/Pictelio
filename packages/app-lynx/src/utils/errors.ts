// ─── 错误归一化工具 ───
import { ApiErrorType } from "../api/types"
import type { ApiError } from "../api/types"

export function toApiError(e: unknown, fallbackMsg = "加载失败"): ApiError {
  if (e && typeof e === "object" && "type" in e) {
    return e as ApiError
  }
  return {
    type: ApiErrorType.UNKNOWN,
    message: (e as { message?: string })?.message ?? fallbackMsg,
  }
}
