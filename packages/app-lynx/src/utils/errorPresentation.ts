// ─── 错误呈现（候选 #2：ApiErrorType 分类消费） ───
// 把 classifyError / toApiError 产出的结构化 ApiError 映射为「页面可直接展示的文案」。
// presentError 是纯函数，无副作用——会话级错误（UNAUTHORIZED）的全屏跳转副作用
// 由下方 reportSessionError 触发链处理（与 authStore 的 setAuthPermanentFailure 并列调用）。
import { ref } from "vue"
import { toApiError } from "./errors"
import { ApiErrorType, type ApiError } from "../api/types"

// 分档操作提示（hint）：主文案（classifyError 产出，含 HTTP 状态码）后拼接。
// 无 hint 的类型（RATE_LIMIT / FORBIDDEN / UNKNOWN）只显示主文案——
// RATE_LIMIT 的 classifyError 主文案已含「请稍后重试」，再拼会重复。
const HINTS: Partial<Record<ApiErrorType, string>> = {
  [ApiErrorType.UNAUTHORIZED]: "请重新登录",
  [ApiErrorType.NETWORK]: "请检查网络连接是否正常",
  [ApiErrorType.PROXY]: "请检查本地代理是否已运行",
  [ApiErrorType.SERVER]: "Pixiv 服务器暂时不可用，请稍后重试",
}

/**
 * 错误 → 展示文案（纯函数）。
 * 任意 unknown 输入恒返回非空串：ApiError（classifyError 产出）按类型分档；
 * 普通 Error 取 message；其余（null/非对象/无 message）回退 fallbackMsg。
 * @param err 任意抛出的值（ApiError / Error / 未知）
 * @param fallbackMsg 无法提取信息时的兜底文案（保留各页面「加载失败/加载更多失败」语义）
 */
export function presentError(err: unknown, fallbackMsg = "加载失败"): string {
  const apiErr = toApiError(err, fallbackMsg)
  // toApiError 对已带 type 的对象直接透传，不校验 message 空 → 此处兜底保证恒非空串
  const msg = apiErr.message || fallbackMsg
  const hint = HINTS[apiErr.type]
  return hint ? `${msg}。${hint}` : msg
}

// ─── 会话级错误（UNAUTHORIZED）全屏错误页触发链 ───
// 链路：authStore.performRefresh 失败(unauthorized) → reportSessionError(err)
//   → 写 fatalError（/error 页读取，错误信息不塞 URL——message 含特殊字符）
//   + 触发注入的导航回调（router 装配：resetHistory + navigate('/error', { replace }))
// 注入回调打破 router↔authStore 循环依赖，与 client.setOnUnauthorized 模式同构。

/** /error 页读取的会话错误详情（模块级 ref，跨路由传递） */
export const fatalError = ref<ApiError | null>(null)

let sessionErrorHandler: (() => void) | null = null

/** 注入会话错误导航回调（router.initRouter 装配；未注册时降级 warn 不崩） */
export function registerSessionErrorHandler(handler: () => void): void {
  sessionErrorHandler = handler
}

/** 报告会话级错误：写 fatalError + 触发导航回调。handler 未注册时 console.warn（禁止静默降级） */
export function reportSessionError(err: unknown): void {
  fatalError.value = toApiError(err, "登录已过期")
  if (sessionErrorHandler) {
    sessionErrorHandler()
  } else {
    console.warn("[errorPresentation] 会话错误导航 handler 未注册（web-core 预览属预期），错误页跳转被跳过")
  }
}
