// ────────────────────────────────────────────────────────────
// PROTOTYPE — throwaway（方案 A：流式 fflate 渐进播放可行性验证）
// 验证问题（原型技能 LOGIC 分支）：
//   1. fflate Unzip 分片喂入时，onfile 是否在「不读完全量字节」时按序增量触发
//   2. 流式产出帧字节与现有 unzipSync 路径是否逐字节一致（正确性）
//   3. 乱序 zip（条目物理序 ≠ 帧序）下按名映射 + 缓冲是否仍能按帧序输出（防御设计）
//   4. 首帧收益量化：第 0 帧可用时已下载字节占比
// 真实样本：148861562（52 帧，~2.5MB，2026-08-31 host 下载 /tmp/ugoira_148861562.zip）
// 运行：pnpm --dir packages/ugoira test -- tests/streamFramesProto.test.ts
// ────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { Unzip, unzipSync, Zip, ZipPassThrough } from "fflate";
import { describe, it, expect } from "vitest";

const ZIP_PATH = "/tmp/ugoira_148861562.zip";

/** 从真实 zip 解析条目名（复用共享包 parseZipEocd/parseZipCentralDir，与生产同源） */
import { parseZipEocd, parseZipCentralDir } from "../src/index.js";

function realZipBytes(): Uint8Array {
  return new Uint8Array(readFileSync(ZIP_PATH));
}

function entryNames(zip: Uint8Array): string[] {
  const tail = zip.slice(Math.max(0, zip.length - 30_000));
  const eocd = parseZipEocd(tail, { fileSize: zip.length });
  const cd = zip.slice(eocd.cdOffset, eocd.cdOffset + eocd.cdSize);
  return parseZipCentralDir(cd, 0, eocd.cdSize).map((e) => e.name);
}

/** 分片喂入驱动：按 chunkSize 切块，返回逐帧事件（frame 名 + 触发时已 push 字节数） */
function streamFrames(zip: Uint8Array, chunkSize: number) {
  const events: { name: string; pushedBytes: number; pushedPct: number; final: boolean }[] = [];
  const byName = new Map<string, Uint8Array>();
  const unzipper = new Unzip((file) => {
    const chunks: Uint8Array[] = [];
    file.ondata = (_err, chunk, final) => {
      chunks.push(chunk);
      if (final) {
        const merged = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let off = 0;
        for (const c of chunks) {
          merged.set(c, off);
          off += c.length;
        }
        byName.set(file.name, merged);
      }
    };
    file.start();
    events.push({ name: file.name, pushedBytes: 0, pushedPct: 0, final: false });
  });
  unzipper.register(UnzipInflateCompat);
  let pushed = 0;
  const total = zip.length;
  let lastEvent = -1;
  for (let off = 0; off < total; off += chunkSize) {
    const final = off + chunkSize >= total;
    unzipper.push(zip.slice(off, Math.min(total, off + chunkSize)), final);
    pushed = Math.min(total, off + chunkSize);
    // onfile 事件在 push 内部同步触发；给事件补上「触发时已 push」水位
    for (let i = lastEvent + 1; i < events.length; i++) {
      events[i]!.pushedBytes = pushed;
      events[i]!.pushedPct = Math.round((pushed / total) * 1000) / 10;
    }
    lastEvent = events.length - 1;
  }
  return { events, byName };
}

/** fflate 流式解码器注册（deflate 兜底；store 条目不需要） */
import { UnzipInflate } from "fflate";
const UnzipInflateCompat = UnzipInflate;

/** 构造乱序 zip（store 模式，条目物理序与帧序相反） */
function buildReversedZip(names: string[], frameBytes: Uint8Array[]): Uint8Array {
  const z = new Zip();
  const out: Uint8Array[] = [];
  z.ondata = (_err, chunk, final) => {
    void final;
    out.push(chunk);
  };
  for (let i = names.length - 1; i >= 0; i--) {
    const entry = new ZipPassThrough(names[i]!);
    z.add(entry);
    entry.push(frameBytes[i]!, true);
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

/** 分片喂入驱动：按 chunkSize 切块；帧「数据完整可用」水位以 ondata(final) 为准 */
function streamFramesReadyAt(zip: Uint8Array, chunkSize: number) {
  const readyAt = new Map<string, { pushedBytes: number; pushedPct: number }>();
  const byName = new Map<string, Uint8Array>();
  const unzipper = new Unzip((file) => {
    const chunks: Uint8Array[] = [];
    file.ondata = (_err, chunk, final) => {
      chunks.push(chunk);
      if (final) {
        const merged = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let off = 0;
        for (const c of chunks) {
          merged.set(c, off);
          off += c.length;
        }
        byName.set(file.name, merged);
        readyAt.set(file.name, { pushedBytes: 0, pushedPct: 0 });
      }
    };
    file.start();
  });
  unzipper.register(UnzipInflateCompat);
  let pushed = 0;
  const total = zip.length;
  for (let off = 0; off < total; off += chunkSize) {
    const final = off + chunkSize >= total;
    unzipper.push(zip.slice(off, Math.min(total, off + chunkSize)), final);
    pushed = Math.min(total, off + chunkSize);
    for (const [name, v] of readyAt) {
      if (v.pushedBytes === 0) {
        v.pushedBytes = pushed;
        v.pushedPct = Math.round((pushed / total) * 1000) / 10;
      }
    }
  }
  return { byName, readyAt };
}

describe("PROTO 流式 fflate 增量出帧（方案 A 可行性）", () => {
  it("真实 zip 元数据（52 帧，条目序==数值序）", () => {
    const names = entryNames(realZipBytes());
    expect(names).toHaveLength(52);
    expect(names[0]).toBe("000000.jpg");
    expect(names[51]).toBe("000051.jpg");
  });

  it("分片喂入：帧数据就绪水位（ondata final 时刻）", () => {
    const zip = realZipBytes();
    const cases = [
      { chunk: 8 * 1024, firstPct: 5 },
      { chunk: 64 * 1024, firstPct: 5 },
      { chunk: 256 * 1024, firstPct: 20 },
    ] as const;
    for (const { chunk: chunkSize, firstPct } of cases) {
      const { readyAt } = streamFramesReadyAt(zip, chunkSize);
      expect(readyAt.size).toBe(52);
      const first = readyAt.get("000000.jpg")!;
      const tenth = readyAt.get("000009.jpg")!;
      const last = readyAt.get("000051.jpg")!;
      // 诊断输出（原型取证用）
      console.log(
        `[PROTO] chunk=${chunkSize / 1024}KB 帧0 就绪@${first.pushedPct}% (${first.pushedBytes}B) ` +
          `帧9 就绪@${tenth.pushedPct}% 帧51 就绪@${last.pushedPct}%`,
      );
      expect(first.pushedPct).toBeLessThan(firstPct);
    }
  });

  it("流式产出与 unzipSync（现有路径）逐字节一致", () => {
    const zip = realZipBytes();
    const names = entryNames(zip);
    const reference = unzipSync(zip);
    const { byName } = streamFrames(zip, 256 * 1024);
    for (const name of names) {
      const a = byName.get(name);
      const b = reference[name];
      expect(a).toBeDefined();
      expect(Buffer.from(a!).equals(Buffer.from(b!))).toBe(true);
    }
  });

  it("乱序 zip：按名映射 + 缓冲后仍按帧序输出（防御设计）", () => {
    // 构造物理序相反的 zip
    const zip = realZipBytes();
    const names = entryNames(zip);
    const reference = unzipSync(zip);
    const frameBytes = names.map((n) => reference[n]!);
    const reversed = buildReversedZip(names, frameBytes);
    // 用新 zip 重跑流式：onfile 按 wire 序（倒序）触发
    const { byName } = streamFrames(reversed, 256 * 1024);
    // 按帧序（正序）取，全部可得 → 防御成立
    for (const name of names) {
      const a = byName.get(name);
      expect(a).toBeDefined();
      expect(Buffer.from(a!).equals(Buffer.from(reference[name]!))).toBe(true);
    }
  });
});
