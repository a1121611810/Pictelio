import { createSignal, onCleanup } from "solid-js";

/**
 * 手动 fetch 封装，替代 createResource 用于路由级组件。
 *
 * 为什么不用 createResource：
 *   路由级异步数据统一由 @tanstack/solid-router 的 loader 提供；
 *   路由组件内部仍使用 createResource 会绕过 loader 的缓存/重试机制，
 *   并可能与 TanStack Router 的并发加载产生冲突。
 *
 * 用法：
 *   const fetcher = useManualFetch((signal) => loadSeries(seriesId));
 *   fetcher.execute();
 *   // fetcher.data() → T | null
 *   // fetcher.loading() → boolean
 *   // fetcher.error() → string | null
 */
export function createManualFetch<T extends {}>(fetcher: (signal: AbortSignal) => Promise<T>) {
  const [data, setData] = createSignal<T | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let abortController: AbortController | null = null;

  function cancel() {
    abortController?.abort();
    abortController = null;
  }

  async function execute(): Promise<void> {
    cancel();

    abortController = new AbortController();
    const signal = abortController.signal;

    setLoading(true);
    setError(null);
    setData(null);

    const [err, result] = await tryAsync(fetcher(signal));
    if (!signal.aborted) {
      setLoading(false);
      if (err) {
        setError((err as { message?: string }).message ?? String(err));
      } else {
        setData(() => result);
      }
    }
  }

  onCleanup(() => {
    cancel();
  });

  return { data, loading, error, execute, cancel } as const;
}
