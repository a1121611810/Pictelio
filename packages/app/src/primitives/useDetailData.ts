
import type { Accessor } from "solid-js";
import { toApiError } from "../api/client";
import type { ApiError } from "../api/types";
export interface DetailDataResult<T> {
  /** 加载完成的数据，初始为 null */
  data: Accessor<T | null>;
  /** 加载出错时的错误对象 */
  error: Accessor<ApiError | null>;
  /** 是否正在加载（初始为 true，直到 data 或 error 就绪） */
  loading: Accessor<boolean>;
  /** 手动重试：重新解析 routeData */
  retry: () => void;
}

/**
 * 详情页数据加载原语：从 TanStack Router 的 route data 中提取数据，
 * 同步处理 error/loading 状态。
 */
export function useDetailData<T, R extends { error?: ApiError | null }>(
  routeData: Accessor<R | undefined>,
  extractData: (data: R) => T | null,
): DetailDataResult<T> {
  const [data, setData] = createSignal<T | null>(null);
  const [error, setError] = createSignal<ApiError | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [retryKey, setRetryKey] = createSignal(0);

  createEffect(() => {
    const rd = routeData();
    retryKey();
    if (!rd) {
      setData(null);
      setError(null);
      setLoading(true);
      return;
    }

    if (rd.error) {
      setError(toApiError(rd.error));
      setData(null);
      setLoading(false);
      return;
    }

    const [err, extracted] = trySync(() => extractData(rd));
    if (err) {
      setError(toApiError(err));
      setData(null);
      setLoading(false);
    } else if (extracted !== null) {
      setData(extracted as any);
      setError(null);
      setLoading(false);
    }
  });

  function retry() {
    setRetryKey((k) => k + 1);
  }

  return { data, error, loading, retry };
}
