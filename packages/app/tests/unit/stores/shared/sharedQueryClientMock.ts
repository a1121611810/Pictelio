/**
 * createTQFeedStore 系 store 单测的共享 fixture：把全局单例 `@/api/queryClient`
 * 换成「每个用例可替换、可 spy 的**真** client」。
 *
 * 为什么必须是真 client：createTQFeedStore 只经 `queryClient.ensureInfiniteQueryData`
 * 触达缓存，要 spy 到 ensureLoaded/prefetchAllTabs 传下去的 options（#811 机器防线）
 * 就得注入真实例；而各测试文件对 `@tanstack/solid-query` 的整体 mock 只替换
 * useInfiniteQuery，QueryClient 类仍是展开出来的真类。
 *
 * 为什么用**普通导出对象**而不是 `vi.hoisted`：
 * `vi.mock` 会被提升到本文件顶部，但工厂是**惰性调用**的（真正请求
 * `@/api/queryClient` 时才执行，那时本模块早已求值完毕），getter 每次读取都走
 * 模块绑定 ⇒ 无需 hoist 即可拿到用例换好的 client；而 `vi.hoisted` 的结果不允许被
 * `export`（vitest 直接抛 `SyntaxError: Cannot export hoisted variable`），故只能如此。
 * 跨目录 import 本 fixture 时，mock 在本模块求值期即完成注册，早于测试文件对被测
 * store 的 import（bookmarkStore.test.ts 动态 import、prefetch.test.ts 静态 import
 * 底座，两种形态均已实测通过）。
 */
import { vi } from "vitest";
import type { QueryClient } from "@tanstack/solid-query";

/** 用例内换 client：`queryClientRef.client = new QueryClient(...)` */
export const queryClientRef: { client: QueryClient | undefined } = { client: undefined };

vi.mock("@/api/queryClient", () => ({
  get queryClient() {
    return queryClientRef.client!;
  },
}));

/**
 * ensureInfiniteQueryData 实收 options 的最小形状：只留用例要断言的字段。
 *
 * ⚠️ **别改成 `Parameters<QueryClient["ensureInfiniteQueryData"]>[0]`**（review 已提过一次，
 * 成本**不为零**）：TanStack 的真实 `QueryFunctionContext`
 * （`@tanstack/query-core` 的 `QueryFunctionContext`：`client` / `queryKey` /
 * `signal: AbortSignal` / `meta` 四项**必填**）会让用例为了通过类型检查而**伪造一个
 * 完整 context** 才能调 `queryFn`。而生产侧的 queryFn 正是按
 * `({ pageParam, signal }) => …` 这个**最小解构形状**写的（`createTQFeedStore.ts`），
 * 用真实类型反而会诱使我们把断言从「按生产形状调用」改成「按库的形状补齐」——
 * 那是在迎合类型系统，不是在验证契约。此处的窄类型是**承重**的，不是省事。
 */
export type EnsureOptions = {
  queryKey: readonly unknown[];
  queryFn?: (ctx: { pageParam: unknown; signal?: AbortSignal | undefined }) => Promise<unknown>;
};
