// @vitest-environment happy-dom
// UgoiraViewer 渐进模式契约测试（ADR-0127，T3）。
// oracle：ADR-0127 播放器接口事实（首帧即播、尾部等待不停止、done 后循环）+ spec #276 验收。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import UgoiraViewer from "@/components/UgoiraViewer";

function mountStreaming(frames: () => { url: string; delay: number }[], done: () => boolean) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  render(
    () => (
      <UgoiraViewer
        illustId={1}
        coverUrl=""
        onClose={() => {}}
        inline
        streaming={{ frames, done }}
      />
    ),
    container,
  );
  return {
    container,
    imgSrc: () => container.querySelector("img")?.getAttribute("src") ?? null,
    cleanup: () => document.body.removeChild(container),
  };
}

describe("UgoiraViewer 渐进模式（ADR-0127）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("首帧就绪即播放：挂载即显示首帧", async () => {
    const [frames] = createSignal([{ url: "blob:f0", delay: 100 }]);
    const m = mountStreaming(frames, () => true);
    expect(m.imgSrc()).toBe("blob:f0");
    m.cleanup();
  });

  it("尾部等待：列表未完成时不循环不停止，追加帧后无缝续播", async () => {
    const [frames, setFrames] = createSignal([{ url: "blob:f0", delay: 100 }]);
    const done = createSignal(false);
    const m = mountStreaming(frames, () => done[0]());
    // 播放到尾部（仅 1 帧）→ 等待：当前帧保持显示，不循环到 f0 重播
    await vi.advanceTimersByTimeAsync(500);
    expect(m.imgSrc()).toBe("blob:f0");
    // 追加第 2 帧 → 续播到 f1
    setFrames([...frames(), { url: "blob:f1", delay: 100 }]);
    await vi.advanceTimersByTimeAsync(200);
    expect(m.imgSrc()).toBe("blob:f1");
    m.cleanup();
  });

  it("流式结束（done）后从 0 循环", async () => {
    const [frames] = createSignal([
      { url: "blob:f0", delay: 100 },
      { url: "blob:f1", delay: 100 },
    ]);
    const done = createSignal(true);
    const m = mountStreaming(frames, () => done[0]());
    // 播 f0 → f1 → 回 f0 循环（帧 delay 100ms：t=100 播 f1，t=200 循环回 f0；
    // 步长避开 fake-timers 微任务边界，诊断已证 t120=f1 / t240=f0）
    await vi.advanceTimersByTimeAsync(120);
    expect(m.imgSrc()).toBe("blob:f1");
    await vi.advanceTimersByTimeAsync(120);
    expect(m.imgSrc()).toBe("blob:f0");
    m.cleanup();
  });

  it("流式结束且列表为空：不播放不报错（防御）", async () => {
    const [frames] = createSignal<{ url: string; delay: number }[]>([]);
    const m = mountStreaming(frames, () => true);
    await vi.advanceTimersByTimeAsync(300);
    expect(m.imgSrc()).toBeNull();
    m.cleanup();
  });

  it("暂停/恢复与渐进模式共存：暂停停在当前帧，恢复继续", async () => {
    const [frames, setFrames] = createSignal([{ url: "blob:f0", delay: 100 }]);
    const done = createSignal(false);
    const m = mountStreaming(frames, () => done[0]());
    // 点击暂停
    m.container.querySelector("div")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    setFrames([...frames(), { url: "blob:f1", delay: 100 }]);
    await vi.advanceTimersByTimeAsync(300);
    expect(m.imgSrc()).toBe("blob:f0"); // 暂停后不推进
    // 点击恢复 → 从当前帧继续
    m.container.querySelector("div")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(200);
    expect(m.imgSrc()).toBe("blob:f1");
    m.cleanup();
  });
});
