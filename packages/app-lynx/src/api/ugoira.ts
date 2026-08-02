// ─── Ugoira 播放数据管线（T5） ───
// 元数据 + zip 下载（/pixiv-img 代理）+ 共享包 @pictelio/ugoira 取帧
// + 帧转 base64 data URL（原生 <image> 无 blob URL，base64 是官方支持格式）。
import { loadUgoiraMetadata } from "./illust"
import { unzipFrames } from "@pictelio/ugoira"
import { proxyImageUrl } from "../utils/imageUrl"
import { requestFetch } from "../utils/fetchWrapper"

export interface UgoiraFrameData {
  dataUrl: string
  delay: number
}

/** Uint8Array → base64 data URL（原生路径关键转换；与 prototype 同源） */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime};base64,${btoa(bin)}`
}

/**
 * 下载 ugoira zip 并取帧（共享包 fflate，默认方案 B）。
 * @param illustId 作品 ID
 * @param signal 中止信号（组件卸载时中断下载）
 * @returns 帧 data URL + delay（调用方负责播放与释放）
 */
export async function downloadUgoiraFrames(
  illustId: number,
  signal?: AbortSignal,
): Promise<UgoiraFrameData[]> {
  const meta = await loadUgoiraMetadata(illustId)
  const zipUrl = proxyImageUrl(meta.zip_urls.medium)
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
