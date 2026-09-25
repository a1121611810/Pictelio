/**
 * createTQFeedStore placeholderData 契约（#722 / ADR-0186 P1 修复）。
 *
 * 说明（review P2）：本文件第 1 个用例是**行为断言**（机制可观察面）；第 2/3 个用例是
 * **characterization（实现字面量契约）**——钉住「查询注册 placeholderData 且返回空页占位」
 * 以防后人删改（删除即 #722 复发）。tdd 红态证据见 commit message / spec §4.1。
 *
 * oracle 溯源（#722 现场取证，见 docs/specs/webview-boot-freeze-722.md §2）：
 * - 现象：webview 已登录启动 navigate(/home) 后 isLoading 门槛永不释放（Splash 永挂）。
 * - 机制：Solid 2.0-rc.9 + solid-query v6 下，pending 查询的 data 是异步访问器；
 *   渲染期读取抛 NotReadyError 并 park 所在路由 transition。当该 fetch 因弱网悬挂/
 *   失败（代理抖动、重试耗尽）时，rc.9 的 park 唤醒路径不覆盖此形态 → transition
 *   永久 park → 同事务内全局信号写入（含 isLoading）永不提交（探针实证：
 *   latest=false / isPending=true / committed 恒 true；NotReadyError 全部来自
 *   solid-query 调用栈）。
 * - 修复：查询注册 placeholderData（立即求值的空页占位），使 data 在首读即定义、
 *   不进入异步 pending 读；配合 loading 粘滞改用 isPlaceholderData 保持 #366 语义。
 *
 * 本测试钉住「每个 feed 查询必须携带 placeholderData 且返回空页占位」的契约，
 * 防后人删改（删除即 #722 复发，设备端 6/6 冷启动冻结复现）。
 */
import { describe, it, expect, vi } from "vitest";
import { QueryClient } from "@tanstack/solid-query";

const qc = vi.hoisted(() => ({ client: undefined as QueryClient | undefined }));
const captured = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));

vi.mock("@/api/queryClient", () => ({
  get queryClient() {
    return qc.client!;
  },
}));

// 包一层捕获传入 useInfiniteQuery 的 options 工厂，其余仍走真实实现
vi.mock("@tanstack/solid-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/solid-query")>();
  return {
    ...actual,
    useInfiniteQuery: (optionsFn: unknown, client: unknown) => {
      const opts = typeof optionsFn === "function" ? (optionsFn as () => unknown)() : optionsFn;
      captured.options.push(opts as Record<string, unknown>);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (actual.useInfiniteQuery as any)(optionsFn, client);
    },
  };
});

import { createTQFeedStore } from "@/stores/shared/createTQFeedStore";

interface Item {
  id: number;
  create_date: string;
}

/** 参照 loading 契约测试装配：真实 QueryClient + 受控 queryFn */
function makeStore() {
  return createTQFeedStore<Item, "tab", undefined>({
    name: "test_placeholder_feed",
    currentTab: () => "tab" as const,
    enabled: () => true,
    lazy: true,
    getDeps: () => undefined,
    staleTime: 30_000,
    errorStrategy: "priority",
    filterFn: (items) => items,
    tabs: {
      tab: {
        allMode: { type: "single", subTabs: ["main"] },
        queries: {
          main: {
            queryKey: () => ["test_placeholder_feed_main"],
            queryFn: () => new Promise(() => {}),
          },
        },
      },
    },
  });
}

describe("createTQFeedStore placeholderData 契约（#722：防渲染期 pending 异步读 park 路由 transition）", () => {
  it("行为：activate 后（fetch 未 resolve）items() 同步返回 [] 且 loading 粘滞 true", async () => {
    qc.client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    captured.options.length = 0;
    const store = makeStore();
    store.activate();
    // Solid 2.0 批处理语义：activate 写入经 flush 同步应用（与 #366 契约测试同口径）
    const { flush } = await import("solid-js");
    flush();

    // 行为断言（#722 机制的可观察面）：pending 期读 items() 必须同步拿到 []（不再抛
    // NotReadyError / 不 park）；loading 保持首载粘滞（#366）。
    expect(() => store.items()).not.toThrow();
    expect(store.items()).toEqual([]);
    expect(store.loading()).toBe(true);
  });

  it("每个查询注册 placeholderData 且返回空页占位（pages 空数组）", () => {
    qc.client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    captured.options.length = 0;

    makeStore();

    expect(captured.options.length).toBeGreaterThan(0);
    for (const opts of captured.options) {
      const ph = opts.placeholderData as unknown;
      expect(ph, "查询必须携带 placeholderData（#722 修复契约）").toBeDefined();
      // 值或工厂形态均可（适配层二者皆支持）；解出后必须是空页占位
      const value = typeof ph === "function" ? (ph as () => unknown)() : ph;
      expect(value).toEqual({ pages: [], pageParams: [] });
    }
  });

  it("enabled=false 契约保持（ADR-0042 按需查询：不自动 fetch）", () => {
    qc.client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    captured.options.length = 0;

    makeStore();

    for (const opts of captured.options) {
      expect(opts.enabled).toBe(false);
    }
  });
});
