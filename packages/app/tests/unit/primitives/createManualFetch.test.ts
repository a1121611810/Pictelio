import { describe, it, expect, vi } from "vitest";
// ADR-0144：2.0 微任务批处理下，setter 写需经 flush 同步生效后才能同步断言
import { flush } from "solid-js";
import { createManualFetch } from "@/primitives/createManualFetch";

describe("createManualFetch", () => {
  it("returns initial idle state", () => {
    const fetcher = createManualFetch(() => Promise.resolve("ok"));
    expect(fetcher.data()).toBeNull();
    expect(fetcher.loading()).toBe(false);
    expect(fetcher.error()).toBeNull();
  });

  it("sets loading during fetch", async () => {
    let resolvePromise!: (v: string) => void;
    const fetcher = createManualFetch(
      () =>
        new Promise<string>((resolve) => {
          resolvePromise = resolve;
        }),
    );
    const promise = fetcher.execute();
    flush(); // ADR-0144：批处理下 set 后同步读为旧值，先排空再断言
    expect(fetcher.loading()).toBe(true);
    resolvePromise("done");
    await promise;
    expect(fetcher.loading()).toBe(false);
  });

  it("sets data after successful fetch", async () => {
    const fetcher = createManualFetch(() => Promise.resolve(42));
    await fetcher.execute();
    expect(fetcher.data()).toBe(42);
    expect(fetcher.loading()).toBe(false);
    expect(fetcher.error()).toBeNull();
  });

  it("sets error on failed fetch", async () => {
    const fetcher = createManualFetch(() => Promise.reject(new Error("boom")));
    await fetcher.execute();
    expect(fetcher.error()).toBe("boom");
    expect(fetcher.data()).toBeNull();
    expect(fetcher.loading()).toBe(false);
  });

  it("cancels previous request and resets state on re-execute", async () => {
    const fetcher = createManualFetch(() => Promise.resolve("ok"));
    await fetcher.execute();
    expect(fetcher.data()).toBe("ok");

    const promise = fetcher.execute();
    flush(); // ADR-0144：批处理下 set 后同步读为旧值，先排空再断言
    // Data 会被重置为 null，因为 execute 清空了
    expect(fetcher.data()).toBeNull();
    expect(fetcher.loading()).toBe(true);
    await promise;
  });

  it("passes AbortSignal to fetcher and cancels on cancel()", async () => {
    const spy = vi.fn();
    const fetcher = createManualFetch((signal) => {
      signal.addEventListener("abort", spy);
      return new Promise<string>(() => {}); // Never resolves
    });
    fetcher.execute().catch(() => {});
    fetcher.cancel();
    expect(spy).toHaveBeenCalled();
  });
});
