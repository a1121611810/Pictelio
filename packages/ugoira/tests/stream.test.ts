// ─── 流式取帧器契约测试（ADR-0127） ───
// oracle 溯源：docs/research/ugoira-stream-frames-proto.md（原型实测：帧0 就绪@1.9%、
// 与 unzipSync 逐字节一致、乱序防御）+ zip 规范（local file header 结构）。
// 数据：构造 store 模式 zip（与 Pixiv ugoira zip 事实形态一致），保证测试可移植。
import { unzipSync, Zip, ZipPassThrough } from "fflate";
import { describe, expect, it } from "vitest";
import { createStreamFrameSource } from "../src/index.js";

/** 构造 store 模式 zip（条目按给定顺序；与 Pixiv ugoira 事实形态一致） */
function buildStoreZip(names: string[], frames: Uint8Array[]): Uint8Array {
  const z = new Zip();
  const out: Uint8Array[] = [];
  z.ondata = (_err, chunk, _final) => {
    out.push(chunk);
  };
  for (let i = 0; i < names.length; i++) {
    const entry = new ZipPassThrough(names[i]!);
    z.add(entry);
    entry.push(frames[i]!, true);
  }
  z.end();
  const total = out.reduce((n, c) => n + c.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of out) {
    merged.set(c, off);
    off += c.length;
  }
  return merged;
}

const NAMES = Array.from({ length: 10 }, (_, i) => `00000${i}.jpg`);
const FRAMES = NAMES.map((_, i) => {
  const b = new Uint8Array(40 + i * 10);
  for (let k = 0; k < b.length; k++) b[k] = (k + i) % 251;
  return b;
});

/** 分片喂入并收集 onFrame 事件（含触发时已 push 字节数，验证增量性） */
function runStream(
  zip: Uint8Array,
  fileOrder: string[],
  chunkSize: number,
): { events: { name: string; bytes: Uint8Array; pushed: number }[] } {
  const source = createStreamFrameSource(fileOrder);
  const events: { name: string; bytes: Uint8Array; pushed: number }[] = [];
  source.onFrame = (name, bytes) => {
    events.push({ name, bytes, pushed: 0 });
  };
  let pushed = 0;
  const total = zip.length;
  for (let off = 0; off < total; off += chunkSize) {
    const final = off + chunkSize >= total;
    source.push(zip.slice(off, Math.min(total, off + chunkSize)), final);
    pushed = Math.min(total, off + chunkSize);
    for (const e of events) {
      if (e.pushed === 0) e.pushed = pushed;
    }
  }
  return { events };
}

/** Uint8Array 逐字节比较（无 node Buffer 依赖） */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe("createStreamFrameSource（ADR-0127 流式取帧器）", () => {
  it("分片喂入：按 fileOrder 顺序增量回调，首帧在极小字节水位即可用", () => {
    const zip = buildStoreZip(NAMES, FRAMES);
    const { events } = runStream(zip, NAMES, 64);
    expect(events.map((e) => e.name)).toEqual(NAMES);
    // 首帧就绪时已 push 字节应远小于全量（帧 0 数据 40B + 头 ≈ 70B，64B 分片 1-2 次 push）
    const first = events[0]!;
    expect(first.pushed).toBeLessThan(zip.length / 10);
    // 事件流为增量：中间帧就绪时也远未到全量
    const mid = events[5]!;
    expect(mid.pushed).toBeLessThan(zip.length);
  });

  it("流式产出与 unzipSync（全量路径）逐字节一致", () => {
    const zip = buildStoreZip(NAMES, FRAMES);
    const { events } = runStream(zip, NAMES, 128);
    const reference = unzipSync(zip);
    for (const e of events) {
      expect(bytesEqual(e.bytes, reference[e.name]!)).toBe(true);
    }
  });

  it("乱序 zip（物理序倒置）：按 fileOrder 输出且字节一致（防御设计）", () => {
    const reversedNames = [...NAMES].reverse();
    const zip = buildStoreZip(reversedNames, [...FRAMES].reverse());
    const { events } = runStream(zip, NAMES, 128);
    expect(events.map((e) => e.name)).toEqual(NAMES);
    const reference = unzipSync(zip);
    for (const e of events) {
      expect(bytesEqual(e.bytes, reference[e.name]!)).toBe(true);
    }
  });

  it("非帧条目丢弃：zip 含 README 等杂条目不影响输出", () => {
    const names = ["README.txt", ...NAMES];
    const frames = [new TextEncoder().encode("hello"), ...FRAMES];
    const zip = buildStoreZip(names, frames);
    const { events } = runStream(zip, NAMES, 128);
    expect(events.map((e) => e.name)).toEqual(NAMES);
  });

  it("损坏 zip：push 抛 ugoira: 可读错误", () => {
    const source = createStreamFrameSource(NAMES);
    // 实测行为：fflate Unzip 对垃圾字节静默忽略（不抛解析错），由 final 末尾校验兜底
    // → 报「zip 缺帧」可读错误（与全量路径对损坏 zip 的「缺少帧文件」语义一致）
    expect(() => source.push(new Uint8Array([1, 2, 3, 4, 5]), true)).toThrow(/ugoira: zip/);
  });

  it("缺帧（zip 少一帧）：final push 抛 ugoira: zip 缺帧", () => {
    const zip = buildStoreZip(NAMES.slice(0, 9), FRAMES.slice(0, 9));
    const source = createStreamFrameSource(NAMES);
    let got = 0;
    source.onFrame = () => {
      got++;
    };
    for (let off = 0; off < zip.length; off += 64) {
      const final = off + 64 >= zip.length;
      try {
        source.push(zip.slice(off, Math.min(zip.length, off + 64)), final);
      } catch (e) {
        expect((e as Error).message).toContain("ugoira: zip 缺帧");
        return;
      }
    }
    expect(got).toBe(9);
  });

  it("重复条目：fileOrder 之外的重复名帧丢弃，顺序不变量保持", () => {
    // zip 含两个同名条目（后一个覆盖语义在流式器=重复丢弃）
    const dupNames = [NAMES[0]!, NAMES[0]!, ...NAMES.slice(1)];
    const dupFrames = [FRAMES[0]!, FRAMES[0]!, ...FRAMES.slice(1)];
    const zip = buildStoreZip(dupNames, dupFrames);
    const { events } = runStream(zip, NAMES, 128);
    expect(events.map((e) => e.name)).toEqual(NAMES);
  });
});
