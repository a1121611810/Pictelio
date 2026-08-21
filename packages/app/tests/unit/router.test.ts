/**
 * @vitest-environment happy-dom
 *
 * 验证 @solidjs/router 路由配置结构。
 * 不做框架内部测试，只验证：
 * 1. 路由定义数组可解析（不抛异常）
 * 2. 所有预期路径存在
 * 3. catch-all 路由存在
 */

import { describe, expect, it } from "vitest";

// 所有 sync 导入的路由组件不需 mock（无渲染，只验证配置结构）
const { routes } = await import("@/router");

/** 递归收集所有路由 path */
function collectPaths(defs: any[]): string[] {
  const paths: string[] = [];
  for (const def of defs) {
    if (def.path) paths.push(def.path);
    if (def.children)
      paths.push(...collectPaths(Array.isArray(def.children) ? def.children : [def.children]));
  }
  return paths;
}

describe("router configuration", () => {
  it("can be imported without throwing", () => {
    expect(routes).toBeDefined();
    expect(Array.isArray(routes)).toBe(true);
  });

  it("contains expected top-level hierarchy", () => {
    expect(routes.length).toBe(1);
    expect(routes[0].path).toBe("/");
    expect(routes[0].component).toBeDefined();
    expect(routes[0].children).toBeDefined();
    expect(Array.isArray(routes[0].children)).toBe(true);
  });

  it("contains expected application routes", () => {
    const paths = collectPaths(routes[0].children as any[]);

    const expected = [
      "/login",
      "/home",
      "/illust/:id",
      "/novel/:id",
      "/search",
      "/me",
      "/about",
      "/image-host",
      "/image-cache",
      "/settings",
      "/debug",
      "/user/:id",
      "/user/:id/illusts",
      "/user/:id/following",
      "/user/:id/followers",
      "/my/followers",
    ];

    for (const path of expected) {
      expect(paths).toContain(path);
    }
  });

  it("has a catch-all route", () => {
    const paths = collectPaths(routes[0].children as any[]);
    const catchAll = paths.find((p) => p.includes("*"));
    expect(catchAll).toBeDefined();
  });

  it("has no loaders (data loading moved to components)", () => {
    // 遍历所有路由，确认没有预加载函数
    function checkDefs(defs: any[]) {
      for (const def of defs) {
        expect(def.load).toBeUndefined();
        expect(def.preload).toBeUndefined();
        if (def.children) checkDefs(Array.isArray(def.children) ? def.children : [def.children]);
      }
    }
    checkDefs(routes);
  });

  it("uses @solidjs/router path syntax (colon params, not dollar)", () => {
    const paths = collectPaths(routes[0].children as any[]);
    const paramRoutes = paths.filter((p) => p.includes(":"));
    expect(paramRoutes.length).toBeGreaterThan(0);
    // 确认没有 $ 语法残留
    const dollarRoutes = paths.filter((p) => p.includes("$"));
    expect(dollarRoutes.length).toBe(0);
  });
});
