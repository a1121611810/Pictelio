// ─── 流式取帧器（ADR-0127） ───
// zip 字节分片喂入即按 fileOrder 顺序增量产出帧字节，不依赖 zip 全量。
// 依据 docs/research/ugoira-stream-frames-proto.md（原型取证）：
// fflate Unzip 只扫 local file header、按 wire 序吐条目；帧数据在 ondata(final) 完整交付。
import { Unzip, UnzipInflate } from "fflate";

/** 流式取帧器接口（调用方只 push 字节 + 挂 onFrame，其余全部内聚） */
export interface StreamFrameSource {
  /** 喂入 zip 字节块；final=true 表示最后一块（与 fflate Unzip.push 同契约） */
  push(chunk: Uint8Array, final?: boolean): void;
  /** 帧就绪回调：按 fileOrder 顺序逐个触发（乱序帧内部缓冲）；bytes 为帧完整字节 */
  onFrame: ((name: string, bytes: Uint8Array) => void) | null;
}

/**
 * 创建流式取帧器。
 *
 * <p>接口事实（调用方必须知道）：
 * <ul>
 *   <li><b>顺序不变量</b>：onFrame 按 fileOrder 顺序回调；不在 fileOrder 的条目丢弃
 *       （防御非帧条目）；重复条目丢弃</li>
 *   <li><b>时序不变量</b>：onFrame 在 push 调用栈内同步触发；bytes 为帧完整字节
 *       （ondata(final) 语义——帧数据完整可渲染的时刻，即「帧就绪」）</li>
 *   <li><b>错误模式</b>：zip 损坏/解析失败 → push 抛 {@code ugoira:} 可读错误；
 *       解析到末尾仍有未交付帧（缺帧）→ final push 抛可读错误——调用方捕获后回退全量路径</li>
 *   <li><b>性能</b>：push O(chunk)；store 条目零解压直通；乱序缓冲内存 ≤ 全帧
 *       （最坏与全量路径等价，无劣化）</li>
 * </ul>
 */
export function createStreamFrameSource(fileOrder: string[]): StreamFrameSource {
  const wantedIndex = new Map<string, number>();
  fileOrder.forEach((name, i) => wantedIndex.set(name, i));

  let readyNext = 0;
  const buffered = new Map<number, Uint8Array>();
  let onFrameCb: ((name: string, bytes: Uint8Array) => void) | null = null;

  const unzipper = new Unzip((file) => {
    const chunks: Uint8Array[] = [];
    file.ondata = (_err, chunk, final) => {
      if (!final) {
        chunks.push(chunk);
        return;
      }
      // 合并：先积攒的片段 + 最后一块
      const merged = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0) + chunk.length);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.length;
      }
      merged.set(chunk, off);

      const idx = wantedIndex.get(file.name);
      if (idx === undefined) {
        return; // 非帧条目（防御）
      }
      if (idx === readyNext) {
        deliverNext(file.name, merged);
      } else if (idx > readyNext) {
        buffered.set(idx, merged);
      }
      // idx < readyNext：重复条目（zip 含重名文件）→ 丢弃
    };
    file.start();
  });
  unzipper.register(UnzipInflate);

  /** 交付当前帧并冲刷缓冲中连续序号的帧 */
  function deliverNext(name: string, bytes: Uint8Array): void {
    onFrameCb?.(name, bytes);
    readyNext++;
    while (buffered.has(readyNext)) {
      const b = buffered.get(readyNext)!;
      buffered.delete(readyNext);
      onFrameCb?.(fileOrder[readyNext]!, b);
      readyNext++;
    }
  }

  return {
    push(chunk, final) {
      try {
        unzipper.push(chunk, final ?? false);
      } catch (e) {
        // fflate 解析错误（损坏 zip / 非法签名）→ 统一可读错误
        throw new Error(
          `ugoira: zip 流式解析失败（损坏或格式不支持）: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      if (final && (buffered.size > 0 || readyNext < fileOrder.length)) {
        // 末尾校验：仍有帧未交付（缺帧/乱序未补齐）
        throw new Error(
          `ugoira: zip 缺帧（流式解析到末尾仍有 ${fileOrder.length - readyNext} 帧未到）`,
        );
      }
    },
    get onFrame() {
      return onFrameCb;
    },
    set onFrame(cb) {
      onFrameCb = cb;
    },
  };
}
