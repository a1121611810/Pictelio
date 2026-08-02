// ─── Ugoira（Pixiv 动图）zip 帧处理纯函数库 ───
// 依据 docs/research/ugoira-playback-alternatives.md §3/§7：
// Pixiv ugoira zip 条目为 store（未压缩）模式，帧字节位置可由
// 「本地文件头偏移 + 30 + nameLen + extraLen」直接算出——取帧无需解压。
// 本包为零网络/零框架依赖的纯函数层：双端（pictelio-app / app-lynx）
// 通过 pnpm workspace 引用同一份代码；下载与渲染由各端负责。
import { unzipSync, inflateSync } from "fflate";

// ─── 类型 ───

/** 中央目录条目（Range 模式取帧所需） */
export interface UgoiraZipEntry {
  name: string;
  /** 本地文件头偏移（中央目录的 localHeaderOffset） */
  offset: number;
  /** 压缩后大小 */
  compSize: number;
  /** 解压后大小 */
  uncompSize: number;
  /** 压缩方法：0=store（未压缩），8=deflate */
  compMethod: number;
}

/** EOCD（End Of Central Directory）解析结果 */
export interface ZipEocd {
  cdOffset: number;
  cdSize: number;
  entryCount: number;
}

// ─── ZIP 常量 ───

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
/** EOCD 固定部分 22 字节 + 注释最大 65535——尾部最多扫这么多 */
const EOCD_MAX_SCAN = 22 + 65535;

const COMP_STORE = 0;
const COMP_DEFLATE = 8;

// ─── 工具 ───

function readU16(bytes: Uint8Array, off: number): number {
  return (bytes[off]! | (bytes[off + 1]! << 8)) >>> 0;
}
function readU32(bytes: Uint8Array, off: number): number {
  return (bytes[off]! | (bytes[off + 1]! << 8) | (bytes[off + 2]! << 16) | (bytes[off + 3]! << 24)) >>> 0;
}
function assertRange(bytes: Uint8Array, off: number, len: number, what: string): void {
  if (off < 0 || off + len > bytes.length) {
    throw new Error(`ugoira: ${what} 越界 (off=${off} len=${len} bytes=${bytes.length})`);
  }
}

// ─── 1. EOCD 解析（Range 模式：读尾部后解析） ───

/**
 * 从尾部字节中定位并解析 EOCD。
 * 从后向前扫描 EOCD 签名（0x06054b50），校验中央目录范围在文件内。
 * @throws 未找到签名或字段非法
 */
export function parseZipEocd(bytes: Uint8Array): ZipEocd {
  const scanStart = Math.max(0, bytes.length - EOCD_MAX_SCAN);
  for (let i = bytes.length - 22; i >= scanStart; i--) {
    if (readU32(bytes, i) !== EOCD_SIG) continue;
    const cdSize = readU32(bytes, i + 12);
    const cdOffset = readU32(bytes, i + 16);
    const entryCount = readU16(bytes, i + 10);
    assertRange(bytes, cdOffset, cdSize, "EOCD 中央目录范围");
    return { cdOffset, cdSize, entryCount };
  }
  throw new Error("ugoira: 未找到 EOCD 签名（0x06054b50）");
}

// ─── 2. 中央目录解析 ───

/**
 * 解析中央目录，返回每帧条目（含本地文件头偏移与压缩方法）。
 * 逐条校验签名（0x02014b50）与边界，遇非法即抛错（防越界读）。
 */
export function parseZipCentralDir(bytes: Uint8Array, cdOffset: number, cdSize: number): UgoiraZipEntry[] {
  assertRange(bytes, cdOffset, cdSize, "中央目录");
  const entries: UgoiraZipEntry[] = [];
  let p = cdOffset;
  const end = cdOffset + cdSize;
  while (p < end) {
    assertRange(bytes, p, 46, "中央目录条目头");
    if (readU32(bytes, p) !== CENTRAL_SIG) {
      throw new Error(`ugoira: 中央目录条目签名错误 @${p}`);
    }
    const compMethod = readU16(bytes, p + 10);
    const compSize = readU32(bytes, p + 20);
    const uncompSize = readU32(bytes, p + 24);
    const nameLen = readU16(bytes, p + 28);
    const extraLen = readU16(bytes, p + 30);
    const commentLen = readU16(bytes, p + 32);
    const localOffset = readU32(bytes, p + 42);
    assertRange(bytes, p + 46, nameLen, "中央目录条目名");
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
    // 名称需为 ASCII/UTF-8 可解码；Pixiv 帧名为 frame_N.png
    const name = new TextDecoder("utf-8").decode(nameBytes);
    entries.push({ name, offset: localOffset, compMethod, compSize, uncompSize });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (entries.length === 0) {
    throw new Error("ugoira: 中央目录为空");
  }
  return entries;
}

// ─── 3. store 模式取帧（Range 模式：按偏移切片） ───

/**
 * 计算条目数据的字节偏移（本地文件头 30 字节 + nameLen + extraLen）。
 * 校验本地文件头签名与条目范围。
 */
export function computeFrameOffset(zipBytes: Uint8Array, entry: UgoiraZipEntry): number {
  assertRange(zipBytes, entry.offset, 30, "本地文件头");
  if (readU32(zipBytes, entry.offset) !== LOCAL_SIG) {
    throw new Error(`ugoira: 本地文件头签名错误 @${entry.offset}`);
  }
  const nameLen = readU16(zipBytes, entry.offset + 26);
  const extraLen = readU16(zipBytes, entry.offset + 28);
  const dataOff = entry.offset + 30 + nameLen + extraLen;
  assertRange(zipBytes, dataOff, entry.compSize, "帧数据");
  return dataOff;
}

/**
 * 取单个条目帧字节。
 * store（compMethod=0）直接切片；deflate（8）用 fflate inflateSync 解压
 * （ZIP 条目是 raw deflate 流，非 zlib 格式——unzlibSync 会解错）。
 * 其他压缩方法不支持。
 */
export function sliceStoreFrame(zipBytes: Uint8Array, entry: UgoiraZipEntry): Uint8Array {
  const dataOff = computeFrameOffset(zipBytes, entry);
  if (entry.compMethod === COMP_STORE) {
    return zipBytes.slice(dataOff, dataOff + entry.compSize);
  }
  if (entry.compMethod === COMP_DEFLATE) {
    const raw = zipBytes.subarray(dataOff, dataOff + entry.compSize);
    return inflateSync(raw);
  }
  throw new Error(`ugoira: 不支持的压缩方法 ${entry.compMethod}`);
}

/**
 * 按 fileOrder（元数据 frames[].file 顺序）从 zip 切片出帧字节数组。
 * 缺文件抛错（契约破坏，禁止静默降级）。
 */
export function sliceFrames(
  zipBytes: Uint8Array,
  entries: UgoiraZipEntry[],
  fileOrder: string[],
): Uint8Array[] {
  const byName = new Map<string, UgoiraZipEntry>();
  for (const e of entries) byName.set(e.name, e);
  const frames: Uint8Array[] = [];
  for (const name of fileOrder) {
    const entry = byName.get(name);
    if (!entry) throw new Error(`ugoira: zip 缺少帧文件 ${name}`);
    frames.push(sliceStoreFrame(zipBytes, entry));
  }
  return frames;
}

// ─── 4. fflate 全量解压（方案 B 默认路径） ───

/**
 * fflate 解压整个 zip，按 fileOrder 顺序返回帧字节。
 * 字节级一致性依据研究 §7.2（39/39 与 JSZip 一致，解压 15ms→0ms）。
 */
export function unzipFrames(zipBytes: Uint8Array, fileOrder: string[]): Uint8Array[] {
  const files = unzipSync(zipBytes) as Record<string, Uint8Array>;
  const frames: Uint8Array[] = [];
  for (const name of fileOrder) {
    const data = files[name];
    if (!data) throw new Error(`ugoira: zip 缺少帧文件 ${name}`);
    frames.push(data);
  }
  return frames;
}
