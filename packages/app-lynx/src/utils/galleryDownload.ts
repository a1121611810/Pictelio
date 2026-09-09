// ─── 作品图片保存编排（spec docs/specs/image-save-download.md §4）───
// 与 app 包 utils/galleryDownload.ts 同源复制（双端同语义惯例，对齐 resolvePageSrcs）；
// 纯函数 + 注入 saveOne（IO 边界在 utils/gallerySaver.ts），node 可测（测试硬约束 #1）。
import type { PixivIllust } from '../api/types'

/** 扩展名推断：URL 路径尾段（剥离 query），白名单外一律 jpg（与 Java 侧 GallerySaver.extFor 同规则） */
export function extForUrl(url: string): string {
  let path = url
  const q = path.indexOf('?')
  if (q >= 0) {
    path = path.slice(0, q)
  }
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  if (dot < 0 || dot < slash) {
    return 'jpg'
  }
  const ext = path.slice(dot + 1).toLowerCase()
  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) ? ext : 'jpg'
}

/**
 * 保存文件名（spec §3 D3，单一事实源在 JS；Java 侧仅防御性清洗）：
 * 单页 `Pictelio_<illustId>.<ext>`；多页 `Pictelio_<illustId>_p<page>.<ext>`
 * （page 为 0-based 页号，与 Pixiv 原始文件 `_p0` 命名一致）。
 */
export function buildSaveFileName(illustId: number, page: number | undefined, url: string): string {
  const ext = extForUrl(url)
  return page === undefined ? `Pictelio_${illustId}.${ext}` : `Pictelio_${illustId}_p${page}.${ext}`
}

/**
 * 原图 URL 列表（spec §2 A4 保存恒原图）：多页 meta_pages[].image_urls.original ?? large；
 * 单页 meta_single_page.original_image_url ?? large。
 */
export function originalPageUrls(illust: PixivIllust): string[] {
  if (illust.page_count > 1) {
    return illust.meta_pages.map((p) => p.image_urls.original ?? p.image_urls.large)
  }
  return [illust.meta_single_page.original_image_url ?? illust.image_urls.large]
}

export interface SaveOutcome {
  saved: number
  failures: Array<{ page: number; message: string }>
}

/**
 * 顺序批量保存选中页（spec §4）：单张失败不中断批次，逐张完成后回调进度，
 * 失败明细 console.warn（无静默降级）并由调用方以状态文本汇报聚合结果。
 */
export async function saveIllustPages(opts: {
  /** 选中的 0-based 页号 */
  pages: number[]
  /** 页号 → 官方原图 URL（缺失视为该页失败，计入 failures） */
  urlForPage: (page: number) => string | undefined
  illustId: number
  /** IO 边界（原生桥），测试注入 */
  saveOne: (url: string, fileName: string) => Promise<void>
  onProgress?: (done: number, total: number, page: number) => void
}): Promise<SaveOutcome> {
  const outcome: SaveOutcome = { saved: 0, failures: [] }
  const total = opts.pages.length
  let done = 0
  for (const page of opts.pages) {
    const url = opts.urlForPage(page)
    if (!url) {
      outcome.failures.push({ page, message: '无可用原图 URL' })
      console.warn(`[galleryDownload] 第 ${page + 1} 页保存失败: 无可用原图 URL`)
    } else {
      try {
        await opts.saveOne(url, buildSaveFileName(opts.illustId, total > 1 ? page : undefined, url))
        outcome.saved++
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        outcome.failures.push({ page, message })
        console.warn(`[galleryDownload] 第 ${page + 1} 页保存失败:`, e)
      }
    }
    done++
    opts.onProgress?.(done, total, page)
  }
  return outcome
}
