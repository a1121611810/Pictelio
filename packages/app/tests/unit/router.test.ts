/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it, vi } from "vitest";
import type { AnyRoute } from "@tanstack/solid-router";

// FollowListStore 和 userIllustsStore 在模块级别调用 createInfiniteQuery，
// 需要 QueryClientProvider。该测试只验证路由结构，mock TQ 即可。
vi.mock("@tanstack/solid-query", () => ({
  QueryClient: class {
    defaultQueryOptions = (opts: unknown) => opts;
  } as never,
  QueryClientProvider: (props: { children: unknown }) => props.children,
  createInfiniteQuery: () => ({
    data: undefined,
    isFetching: false,
    isFetchingNextPage: false,
    error: null,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
}));

const { router } = await import("@/router");

function collectRoutePaths(route: AnyRoute): { paths: string[]; fullPaths: string[] } {
  const paths: string[] = [];
  const fullPaths: string[] = [];

  if (route.path) {
    paths.push(route.path);
  }
  if (route.fullPath) {
    fullPaths.push(route.fullPath);
  }

  for (const child of route.children ?? []) {
    const childPaths = collectRoutePaths(child as AnyRoute);
    paths.push(...childPaths.paths);
    fullPaths.push(...childPaths.fullPaths);
  }

  return { paths, fullPaths };
}

describe("router", () => {
  it("can be imported without throwing", () => {
    expect(router).toBeDefined();
    expect(router.routeTree).toBeDefined();
  });

  it("contains expected routes", () => {
    const { fullPaths } = collectRoutePaths(router.routeTree);
    const pathsSet = new Set(fullPaths);

    const expected = [
      "/login",
      "/home",
      "/illust/$id",
      "/user/$id/illusts",
      "/age-confirmation",
    ];
    for (const path of expected) {
      expect(pathsSet).toContain(path);
    }
  });

  it("has a catch-all route", () => {
    const { fullPaths } = collectRoutePaths(router.routeTree);
    const pathsSet = new Set(fullPaths);
    expect(pathsSet).toContain("/$");
  });
});
