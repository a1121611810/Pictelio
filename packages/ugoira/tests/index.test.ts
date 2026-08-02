// ─── @pictelio/ugoira 纯函数单测 ───
// 核心：手工构造 store zip（字节级可控，独立于实现），验证
// EOCD/中央目录解析、store 切片、fflate 一致性、签名/越界拒绝、deflate fallback。
import { describe, it, expect } from 'vitest'
import { zipSync, deflateSync } from 'fflate'
import {
  parseZipEocd,
  parseZipCentralDir,
  computeFrameOffset,
  sliceStoreFrame,
  sliceFrames,
  unzipFrames,
  type UgoiraZipEntry,
} from '../src/index'

// ─── 手工构造 store zip（未压缩条目） ───

function u16(v: number, out: number[]): void {
  out.push(v & 0xff, (v >> 8) & 0xff)
}
function u32(v: number, out: number[]): void {
  out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff)
}
function nameBytes(name: string, out: number[]): void {
  for (let i = 0; i < name.length; i++) out.push(name.charCodeAt(i))
}

interface FixtureFrame {
  name: string
  data: Uint8Array
}

/** 构造 store（未压缩）zip：本地头 + 数据 + 中央目录 + EOCD */
function buildStoreZip(frames: FixtureFrame[]): Uint8Array {
  const parts: number[] = []
  const localOffsets: number[] = []
  for (const f of frames) {
    localOffsets.push(parts.length)
    u32(0x04034b50, parts) // local file header sig
    u16(20, parts) // version needed
    u16(0, parts) // flags
    u16(0, parts) // compression method = store
    u16(0, parts) // mod time
    u16(0, parts) // mod date
    u32(0, parts) // crc32（不校验）
    u32(f.data.length, parts) // compSize
    u32(f.data.length, parts) // uncompSize
    u16(f.name.length, parts) // nameLen
    u16(0, parts) // extraLen
    nameBytes(f.name, parts)
    for (const b of f.data) parts.push(b)
  }
  const cdStart = parts.length
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!
    u32(0x02014b50, parts) // central dir sig
    u16(20, parts) // version made by
    u16(20, parts) // version needed
    u16(0, parts) // flags
    u16(0, parts) // compression method = store
    u16(0, parts) // mod time
    u16(0, parts) // mod date
    u32(0, parts) // crc32
    u32(f.data.length, parts) // compSize
    u32(f.data.length, parts) // uncompSize
    u16(f.name.length, parts) // nameLen
    u16(0, parts) // extraLen
    u16(0, parts) // commentLen
    u16(0, parts) // disk number
    u16(0, parts) // internal attrs
    u32(0, parts) // external attrs
    u32(localOffsets[i]!, parts) // local header offset
    nameBytes(f.name, parts)
  }
  const cdSize = parts.length - cdStart
  u32(0x06054b50, parts) // EOCD sig
  u16(0, parts) // disk
  u16(0, parts) // cd disk
  u16(frames.length, parts) // entries this disk
  u16(frames.length, parts) // entries total
  u32(cdSize, parts)
  u32(cdStart, parts)
  u16(0, parts) // comment len
  return new Uint8Array(parts)
}

// ─── fixtures ───

const THREE_FRAMES: FixtureFrame[] = [
  { name: 'frame_0.png', data: new Uint8Array([1, 2, 3, 4, 5]) },
  { name: 'frame_1.png', data: new Uint8Array([10, 20, 30, 40, 50, 60]) },
  { name: 'frame_2.png', data: new Uint8Array([255, 254, 253]) },
]

describe('parseZipEocd', () => {
  it('解析 3 帧 store zip 的中央目录偏移/大小/条目数', () => {
    const zip = buildStoreZip(THREE_FRAMES)
    const eocd = parseZipEocd(zip)
    expect(eocd.entryCount).toBe(3)
    // cdSize = 3 × 46 + nameLen(11×3) = 138 + 33 = 171（frame_N.png 各 11 字符）
    expect(eocd.cdSize).toBe(3 * 46 + 33)
    expect(eocd.cdOffset + eocd.cdSize).toBe(zip.length - 22)
  })

  it('尾部带注释（zip 常见）也能找到 EOCD', () => {
    const zip = buildStoreZip(THREE_FRAMES)
    const withComment = new Uint8Array(zip.length + 10)
    withComment.set(zip)
    // 在 EOCD 后追加注释（EOCD 的 commentLen 字段未设置——手工补：把注释长度写进 EOCD）
    const eocd = parseZipEocd(withComment) // 追加在尾部，签名仍可扫到
    expect(eocd.entryCount).toBe(3)
  })

  it('无 EOCD 签名 → 抛错', () => {
    const junk = new Uint8Array(100)
    expect(() => parseZipEocd(junk)).toThrow('EOCD')
  })
})

describe('parseZipCentralDir', () => {
  it('解析 3 条目：name/offset/compMethod/compSize 正确', () => {
    const zip = buildStoreZip(THREE_FRAMES)
    const eocd = parseZipEocd(zip)
    const entries = parseZipCentralDir(zip, eocd.cdOffset, eocd.cdSize)
    expect(entries).toHaveLength(3)
    entries.forEach((e, i) => {
      expect(e.name).toBe(`frame_${i}.png`)
      expect(e.compMethod).toBe(0) // store
      expect(e.compSize).toBe(THREE_FRAMES[i]!.data.length)
      expect(e.uncompSize).toBe(THREE_FRAMES[i]!.data.length)
    })
    // 本地头偏移递增
    expect(entries[0]!.offset).toBe(0)
    expect(entries[1]!.offset).toBeGreaterThan(entries[0]!.offset)
  })

  it('条目签名被篡改 → 抛错', () => {
    const zip = buildStoreZip(THREE_FRAMES)
    const eocd = parseZipEocd(zip)
    zip[eocd.cdOffset] = 0x00 // 破坏中央目录第一条签名
    expect(() => parseZipCentralDir(zip, eocd.cdOffset, eocd.cdSize)).toThrow('签名')
  })

  it('cdOffset 越界 → 抛错', () => {
    const zip = buildStoreZip(THREE_FRAMES)
    expect(() => parseZipCentralDir(zip, zip.length + 10, 100)).toThrow('越界')
  })
})

describe('computeFrameOffset / sliceStoreFrame', () => {
  it('store 条目按本地头偏移切片，帧字节与输入一致', () => {
    const zip = buildStoreZip(THREE_FRAMES)
    const eocd = parseZipEocd(zip)
    const entries = parseZipCentralDir(zip, eocd.cdOffset, eocd.cdSize)
    entries.forEach((e, i) => {
      const off = computeFrameOffset(zip, e)
      // 本地头 30 + nameLen + 数据
      const expectedOff = e.offset + 30 + e.name.length
      expect(off).toBe(expectedOff)
      const frame = sliceStoreFrame(zip, e)
      expect(Array.from(frame)).toEqual(Array.from(THREE_FRAMES[i]!.data))
    })
  })

  it('本地文件头签名错误 → 抛错', () => {
    const zip = buildStoreZip(THREE_FRAMES)
    const bad: UgoiraZipEntry = { name: 'x.png', offset: 5, compMethod: 0, compSize: 3, uncompSize: 3 }
    expect(() => computeFrameOffset(zip, bad)).toThrow('本地文件头')
  })

  it('帧数据越界 → 抛错', () => {
    const zip = buildStoreZip(THREE_FRAMES)
    const bad: UgoiraZipEntry = { name: 'x.png', offset: 0, compMethod: 0, compSize: 99999, uncompSize: 99999 }
    expect(() => computeFrameOffset(zip, bad)).toThrow('越界')
  })
})

describe('sliceFrames（store 按 fileOrder）', () => {
  it('按元数据顺序取帧，乱序 fileOrder 也正确', () => {
    const zip = buildStoreZip(THREE_FRAMES)
    const eocd = parseZipEocd(zip)
    const entries = parseZipCentralDir(zip, eocd.cdOffset, eocd.cdSize)
    const frames = sliceFrames(zip, entries, ['frame_2.png', 'frame_0.png', 'frame_1.png'])
    expect(Array.from(frames[0]!)).toEqual(Array.from(THREE_FRAMES[2]!.data))
    expect(Array.from(frames[1]!)).toEqual(Array.from(THREE_FRAMES[0]!.data))
    expect(Array.from(frames[2]!)).toEqual(Array.from(THREE_FRAMES[1]!.data))
  })

  it('缺文件 → 抛错（禁止静默降级）', () => {
    const zip = buildStoreZip(THREE_FRAMES)
    const eocd = parseZipEocd(zip)
    const entries = parseZipCentralDir(zip, eocd.cdOffset, eocd.cdSize)
    expect(() => sliceFrames(zip, entries, ['missing.png'])).toThrow('缺少帧文件')
  })
})

describe('unzipFrames（fflate 全量解压，方案 B）', () => {
  it('与 sliceFrames 结果字节级一致（store zip）', () => {
    const zip = buildStoreZip(THREE_FRAMES)
    const order = ['frame_0.png', 'frame_1.png', 'frame_2.png']
    const viaFflate = unzipFrames(zip, order)
    const eocd = parseZipEocd(zip)
    const entries = parseZipCentralDir(zip, eocd.cdOffset, eocd.cdSize)
    const viaSlice = sliceFrames(zip, entries, order)
    expect(viaFflate).toHaveLength(3)
    viaFflate.forEach((f, i) => {
      expect(Array.from(f)).toEqual(Array.from(viaSlice[i]!))
    })
  })

  it('缺文件 → 抛错', () => {
    const zip = buildStoreZip(THREE_FRAMES)
    expect(() => unzipFrames(zip, ['missing.png'])).toThrow('缺少帧文件')
  })
})

describe('deflate fallback', () => {
  it('deflate zip：unzipFrames 正常解压（fflate）', () => {
    // fflate zipSync 默认 deflate 条目
    const deflated = zipSync({
      'frame_0.png': new Uint8Array([1, 2, 3, 4]),
      'frame_1.png': new Uint8Array([9, 9, 9]),
    })
    const frames = unzipFrames(deflated, ['frame_0.png', 'frame_1.png'])
    expect(Array.from(frames[0]!)).toEqual([1, 2, 3, 4])
    expect(Array.from(frames[1]!)).toEqual([9, 9, 9])
  })

  it('sliceStoreFrame 遇 deflate 条目用 inflateSync fallback（raw deflate）', () => {
    // 构造单个 deflate 条目的手工 zip（ZIP 条目是 raw deflate——deflateSync 输出，非 zlibSync）
    const raw = new Uint8Array([7, 8, 9, 10])
    const compressed = deflateSync(raw)
    // 复用 buildStoreZip 结构但把条目压缩方法标记为 8、数据换为 compressed
    // 简化：直接构造最小 zip（本地头 + deflate 数据 + 中央目录 + EOCD）
    const parts: number[] = []
    const localOff = parts.length
    const frameName = 'frame_0.png' // 11 字符
    u32(0x04034b50, parts)
    u16(20, parts); u16(0, parts); u16(8, parts) // method=deflate
    u16(0, parts); u16(0, parts); u32(0, parts)
    u32(compressed.length, parts); u32(raw.length, parts)
    u16(frameName.length, parts); u16(0, parts) // nameLen / extraLen
    nameBytes(frameName, parts)
    for (const b of compressed) parts.push(b)
    const cdStart = parts.length
    u32(0x02014b50, parts)
    u16(20, parts); u16(20, parts); u16(0, parts); u16(8, parts)
    u16(0, parts); u16(0, parts); u32(0, parts)
    u32(compressed.length, parts); u32(raw.length, parts)
    u16(frameName.length, parts); u16(0, parts); u16(0, parts)
    u16(0, parts); u16(0, parts); u32(0, parts)
    u32(localOff, parts)
    nameBytes(frameName, parts)
    const cdSize = parts.length - cdStart
    u32(0x06054b50, parts)
    u16(0, parts); u16(0, parts); u16(1, parts); u16(1, parts)
    u32(cdSize, parts); u32(cdStart, parts); u16(0, parts)
    const zip = new Uint8Array(parts)

    const eocd = parseZipEocd(zip)
    const entries = parseZipCentralDir(zip, eocd.cdOffset, eocd.cdSize)
    expect(entries[0]!.compMethod).toBe(8) // deflate
    const frame = sliceStoreFrame(zip, entries[0]!)
    expect(Array.from(frame)).toEqual(Array.from(raw))
  })
})
