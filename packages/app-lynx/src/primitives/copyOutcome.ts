// 复制动作的结果归一（issue #568：失败**绝不冒充成功**）。
//
// 背景：NetworkCheck 原实现用 `navigator?.clipboard?.writeText?.()`（Lynx 运行时没有 navigator →
// 可选链静默跳过）却无条件置「已复制」= 假成功。这里把「写 → 结果」的映射固定成两种可见结局，
// 页面只做状态映射，不存在绕过失败的分支。
export type CopyOutcome = 'copied' | 'failed'

/** 执行复制并返回可见结果；失败先 warn（禁静默降级），调用方据结果渲染成功/失败态 */
export async function copyOutcome(
  write: (text: string) => Promise<void>,
  text: string,
): Promise<CopyOutcome> {
  try {
    await write(text)
    return 'copied'
  } catch (e) {
    console.warn('[copyOutcome] 复制失败:', e)
    return 'failed'
  }
}
