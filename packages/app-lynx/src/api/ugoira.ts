// ─── Ugoira 播放数据管线（T5） ───
// 元数据 + zip 下载（/pixiv-img 代理）+ 共享包 @pictelio/ugoira 取帧
// + 帧转 base64 data URL（原生 <image> 无 blob URL，base64 是官方支持格式）。
import { loadUgoiraMetadata } from "./illust"
import { unzipFrames, parseZipEocd, parseZipCentralDir, computeFrameOffsetFromLocal, deflateInflate, type UgoiraZipEntry } from "@pictelio/ugoira"
import { proxyImageUrl } from "../utils/imageUrl"
import { requestFetch } from "../utils/fetchWrapper"

export interface UgoiraFrameData {
  dataUrl: string
  delay: number
}

/** 动图取帧模式：fflate 全量解压（默认）/ range 流式取帧 */
export type UgoiraExtractMode = "fflate" | "range"

/** Uint8Array → base64 data URL（原生路径关键转换；与 prototype 同源） */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime};base64,${btoa(bin)}`
}

/** Range 请求（206 Partial Content），校验返回长度 */
async function fetchRangeLynx(url: string, start: number, end: number, signal?: AbortSignal): Promise<Uint8Array> {
  const resp = await requestFetch(url, {
    headers: { Range: `bytes=${start}-${end}` },
    signal,
  })
  if (resp.status !== 206) {
    throw new Error(`ugoira: Range 请求失败 HTTP ${resp.status}`)
  }
  const bytes = new Uint8Array(await resp.arrayBuffer())
  const expected = end - start + 1
  if (bytes.length !== expected) {
    throw new Error(`ugoira: Range 返回长度不符 (${bytes.length}/${expected})`)
  }
  return bytes
}

/**
 * 获取 zip 总长：原生 Lynx 拒绝 HEAD（§7.1 实测）——GET + bytes=0-0 试探
 * Content-Range 总长；非 206 或解析失败返回 0（调用方 fallback fflate）。
 */
async function getZipSizeLynx(url: string, signal?: AbortSignal): Promise<number> {
  const resp = await requestFetch(url, { headers: { Range: "bytes=0-0" }, signal })
  if (resp.status === 206) {
    const cr = resp.headers.get("content-range") ?? ""
    const m = /\/\s*(\d+)\s*$/.exec(cr)
    if (m) return parseInt(m[1]!, 10)
  }
  return 0
}

/** Range 流式取帧（T6）：GET+Range 试探长度 → 尾部目录 → 按偏移取帧 */
async function extractRangeLynx(
  zipUrl: string,
  meta: { frames: { file: string; delay: number }[] },
  signal?: AbortSignal,
): Promise<UgoiraFrameData[]> {
  const total = await getZipSizeLynx(zipUrl, signal)
  if (!total) {
    throw new Error("ugoira: 无法获取 zip 长度（Range 模式需要；原生 HEAD 拒绝）")
  }
  const tailStart = Math.max(0, total - 30_000)
  const tail = await fetchRangeLynx(zipUrl, tailStart, total - 1, signal)
  const eocd = parseZipEocd(tail, { fileSize: total })
  const cdBytes = await fetchRangeLynx(zipUrl, eocd.cdOffset, eocd.cdOffset + eocd.cdSize - 1, signal)
  const entries = parseZipCentralDir(cdBytes, 0, eocd.cdSize)
  const byName = new Map<string, UgoiraZipEntry>(entries.map((e) => [e.name, e]))
  const fileOrder = meta.frames.map((f) => f.file)
  const frames: UgoiraFrameData[] = []
  let nextLocal: Promise<Uint8Array> | null = null
  for (let i = 0; i < fileOrder.length; i++) {
    const entry = byName.get(fileOrder[i]!)
    if (!entry) throw new Error(`ugoira: zip 缺少帧文件 ${fileOrder[i]}`)
    const local = nextLocal
      ? await nextLocal
      : await fetchRangeLynx(zipUrl, entry.offset, entry.offset + 29, signal)
    const dataOff = computeFrameOffsetFromLocal(local)
    const dataPromise = fetchRangeLynx(zipUrl, entry.offset + dataOff, entry.offset + dataOff + entry.compSize - 1, signal)
    const nextEntry = i + 1 < fileOrder.length ? byName.get(fileOrder[i + 1]!) : undefined
    nextLocal = nextEntry
      ? fetchRangeLynx(zipUrl, nextEntry.offset, nextEntry.offset + 29, signal)
      : null
    const bytes = await dataPromise
    if (bytes.length !== entry.compSize) {
      throw new Error(`ugoira: Range 帧数据长度不符 (${bytes.length}/${entry.compSize})`)
    }
    const frameBytes = entry.compMethod === 0 ? bytes : deflateInflate(bytes)
    const file = meta.frames[i]!.file
    const mime = file.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg"
    frames.push({ dataUrl: bytesToDataUrl(frameBytes, mime), delay: meta.frames[i]!.delay })
  }
  if (frames.length === 0) {
    throw new Error("No frames found in ZIP")
  }
  return frames
}

/**
 * 下载 ugoira zip 并取帧。
 * @param illustId 作品 ID
 * @param mode 取帧模式：fflate（默认，共享包全量解压）/ range（Range 流式取帧）
 * @param signal 中止信号（组件卸载时中断下载）
 * @returns 帧 data URL + delay（调用方负责播放与释放）
 */
export async function downloadUgoiraFrames(
  illustId: number,
  mode: UgoiraExtractMode = "fflate",
  signal?: AbortSignal,
): Promise<UgoiraFrameData[]> {
  const meta = await loadUgoiraMetadata(illustId)
  const zipUrl = proxyImageUrl(meta.zip_urls.medium)
  if (mode === "range") {
    try {
      return await extractRangeLynx(zipUrl, meta, signal)
    } catch (err) {
      // 非 206 / 无 Range 支持：降级 fflate（禁止静默——输出 warn）
      console.warn("[ugoira] range 取帧失败，降级 fflate:", (err as Error).message)
    }
  }
  const resp = await requestFetch(zipUrl, { signal })
  if (!resp.ok) {
    throw new Error(`zip 下载失败 HTTP ${resp.status}`)
  }
  const zipBytes = new Uint8Array(await resp.arrayBuffer())
  const fileOrder = meta.frames.map((f) => f.file)
  const frameBytes = unzipFrames(zipBytes, fileOrder)
  return frameBytes.map((bytes, i) => {
    const file = meta.frames[i]!.file
    const mime = file.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg"
    return { dataUrl: bytesToDataUrl(bytes, mime), delay: meta.frames[i]!.delay }
  })
}
