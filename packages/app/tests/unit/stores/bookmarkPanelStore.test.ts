import { describe, it, expect } from "vitest";
// 期望值出处：#545 设计（seam 契约）——open 即 request+isOpen 同步置位；
// close 只关可见性、request 保留（关闭动画期间 illustId 不得闪空）；
// onSaved 无参由调用方闭包，store 仅存取不执行。
// ADR-0144：Solid 2.0 set-后-读批处理——断言前需 flush 排空微任务。
import {
  openBookmarkPanel,
  closeBookmarkPanel,
  bookmarkPanelRequest,
  bookmarkPanelOpen,
} from "@/stores/bookmarkPanelStore";

/** 排空微任务批处理，使 set 后的读可见（ADR-0144） */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

function makeReq(overrides: Partial<{ illustId: number; isBookmarked: boolean }> = {}) {
  return {
    illustId: 123,
    isBookmarked: false,
    workTags: ["風景"],
    onSaved: () => {},
    ...overrides,
  };
}

describe("bookmarkPanelStore", () => {
  it("initial state: no request, closed", async () => {
    closeBookmarkPanel();
    await flush();
    expect(bookmarkPanelOpen()).toBe(false);
    expect(bookmarkPanelRequest()).toBeNull();
  });

  it("openBookmarkPanel sets request and opens", async () => {
    openBookmarkPanel(makeReq({ illustId: 42 }));
    await flush();
    expect(bookmarkPanelOpen()).toBe(true);
    expect(bookmarkPanelRequest()?.illustId).toBe(42);
    expect(bookmarkPanelRequest()?.workTags).toEqual(["風景"]);
  });

  it("closeBookmarkPanel closes but retains request (close-animation contract)", async () => {
    openBookmarkPanel(makeReq({ illustId: 42 }));
    await flush();
    closeBookmarkPanel();
    await flush();
    expect(bookmarkPanelOpen()).toBe(false);
    expect(bookmarkPanelRequest()?.illustId).toBe(42);
  });

  it("re-opening replaces the request target", async () => {
    openBookmarkPanel(makeReq({ illustId: 1 }));
    await flush();
    openBookmarkPanel(makeReq({ illustId: 2, isBookmarked: true }));
    await flush();
    expect(bookmarkPanelRequest()?.illustId).toBe(2);
    expect(bookmarkPanelRequest()?.isBookmarked).toBe(true);
    expect(bookmarkPanelOpen()).toBe(true);
    closeBookmarkPanel();
    await flush();
  });

  it("onSaved is the caller's closure (store stores, host dispatches)", async () => {
    let saved = 0;
    openBookmarkPanel(makeReq({ illustId: 7, onSaved: () => (saved += 1) }));
    await flush();
    bookmarkPanelRequest()?.onSaved();
    expect(saved).toBe(1);
    closeBookmarkPanel();
    await flush();
  });
});
