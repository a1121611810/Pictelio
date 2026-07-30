/**
 * 错误元组模式工具函数
 *
 * 替代 try-catch，返回 [err, data] 元组。
 * tryAsync — 用于 async/await（Promise）；
 * trySync — 用于同步操作（JSON.parse、DOM API 等）。
 *
 * @see docs/adr/ADR-0036-error-tuple-pattern.md
 */

/**
 * 异步错误包装。替代 `try { await x } catch`。
 *
 * @example
 * const [err, illust] = await tryAsync(loadIllust(id));
 * if (err) return <ErrorDisplay error={err} />;
 */
export async function tryAsync<T, E extends {} = Error>(
  promise: Promise<T>,
  errorExt?: Record<string, unknown>,
): Promise<[null, T] | [E, undefined]> {
  return promise
    .then<[null, T]>((data) => [null, data])
    .catch<[E, undefined]>((err: E) => {
      if (errorExt) Object.assign(err, errorExt);
      return [err, undefined];
    });
}

/**
 * 同步错误包装。替代 `try { JSON.parse(...) } catch`。
 * 接收工厂函数 `() => T`，惰性执行。
 *
 * @example
 * const [err, parsed] = trySync(() => JSON.parse(str));
 * const result = err ? defaultValue : parsed;
 */
export function trySync<T, E = Error>(fn: () => T): [null, T] | [E, undefined] {
  try {
    return [null, fn()];
  } catch (err) {
    return [err as E, undefined];
  }
}
