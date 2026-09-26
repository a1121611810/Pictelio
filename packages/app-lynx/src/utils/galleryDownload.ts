// ─── 作品图片保存编排（spec docs/specs/image-save-download.md §4）───
// 与 app 包 utils/galleryDownload.ts 同源复制（双端同语义惯例，对齐 resolvePageSrcs）；
// 纯函数 + 注入 saveOne（IO 边界在 utils/gallerySaver.ts），node 可测（测试硬约束 #1）。
import type { PixivIllust } from '../api/types'
import type { DownloadTaskDraft, UgoiraFrameTiming } from './downloadQueueCore'

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
 *
 * 实现委托默认模板展开（ADR-0192：`Pictelio_{id}` 走缺省追加路径，输出与上方
 * 字面规则逐字节一致——单一事实源不分叉，字节等价由测试钉住）。
 */
export function buildSaveFileName(illustId: number, page: number | undefined, url: string): string {
  return buildSaveFileNameFromTemplate(
    DEFAULT_DOWNLOAD_TEMPLATE,
    { id: illustId, title: "", page: page ?? 0, pageCount: page === undefined ? 1 : 2 },
    url,
  )
}

// ─── 下载命名模板（ADR-0192 / spec docs/specs/lynx-download-naming.md）───
// 占位符集合 {id} {title} {author} {p}；模板解析只在 JS（文件名单一事实源，ADR-0145），
// Java 侧 sanitizeFileName 保持第二道防御不动。

/** 默认命名模板（设备级设置键 download_file_template 缺省值；ADR-0192 D1） */
export const DEFAULT_DOWNLOAD_TEMPLATE = "Pictelio_{id}"

/** 模板串长度上限（settingsStore 读写校验用；ADR-0192 D1 值校验） */
export const DOWNLOAD_TEMPLATE_MAX_LENGTH = 200

/** title / author 单段截断上限（ADR-0192 D3） */
export const DOWNLOAD_SEGMENT_MAX_LENGTH = 64

/** 最终文件名（不含扩展名）截断上限（ADR-0192 D3；扩展名恒完整保留） */
export const DOWNLOAD_FILENAME_MAX_LENGTH = 120

/**
 * 非法字符净化（ADR-0192 D3）：路径分隔符（`/` `\`）与控制字符（`\x00-\x1f`）→ `_`，
 * 随后 trim。规则逐字镜像 Java `GallerySaver.sanitizeFileName`——双端对同一字符串
 * 得出同一结果（differential 用例钉住）；Java 侧为第二道防御，保持不动。
 */
export function sanitizeNameSegment(input: string): string {
  return input.replace(/[/\\\x00-\x1f]/g, "_").trim()
}

/**
 * 单段净化 + 截断（title / author ≤ 64 字符，ADR-0192 D3）；
 * 模板字面量段同用 sanitizeNameSegment（模板不可注入路径分隔符）。
 */
export function sanitizeLimitedSegment(input: string): string {
  return sanitizeNameSegment(input).slice(0, DOWNLOAD_SEGMENT_MAX_LENGTH)
}

/** 模板读取期净化结果：value 恒可直接落盘/展开；fallback=true 时 value 恒为默认模板 */
export interface TemplateNormalization {
  value: string
  /** true = 输入为空/全净化为空，已回落默认值（调用方必须 warn + 可见提示，禁静默回落） */
  fallback: boolean
}

/**
 * 模板串读取期净化（spec D3：模板字面量里的分隔符同样净化——模板永远不能注入目录
 * 结构，目录只由「按作者建目录」开关决定）：净化 → 空则回落默认模板（fallback 标记），
 * 超长截断到 DOWNLOAD_TEMPLATE_MAX_LENGTH。纯函数，settingsStore 读写校验共用。
 */
export function normalizeDownloadTemplate(raw: string): TemplateNormalization {
  const cleaned = sanitizeNameSegment(raw).slice(0, DOWNLOAD_TEMPLATE_MAX_LENGTH)
  if (cleaned === "") {
    return { value: DEFAULT_DOWNLOAD_TEMPLATE, fallback: true }
  }
  return { value: cleaned, fallback: false }
}

/** 命名模板展开上下文（PixivIllust / user.name 真实字段的最小形状） */
export interface SaveNamingContext {
  /** 作品 id（`{id}`） */
  id: number
  /** 作品标题（`{title}`；净化 + 截断后替换） */
  title: string
  /** 作者名（`{author}` 与作者目录段；净化 + 截断后替换；缺失按空串处理） */
  author?: string
  /** 0-based 页号（多页后缀 / `{p}` 展开） */
  page: number
  /** 总页数（>1 = 多页） */
  pageCount: number
}

/**
 * 未知占位符告警去重（spec D2：同一未知名仅首次命中 warn，模块级去重——
 * 禁静默吞，也不制造批量保存的告警噪音）。生产共用本集合；测试传入新鲜集合隔离。
 */
const unknownPlaceholderWarned = new Set<string>()

/**
 * 模板展开内核（不含扩展名拼装）：返回净化 trim 后的文件名基段。
 * - `{p}`：多页展开为 0-based 页号；单页展开为空串（spec D4）
 * - 单页含 `{p}` 的模板先在**模板层**剥离紧邻连接符残段（`_{p}` / `_p{p}` / `-{p}` 等
 *   → `{id}_{p}` 单页得 `<id>`、`{id}_p{p}` 单页得 `<id>`）；在模板层剥离避免误伤
 *   以 p 结尾的标题值
 * - 未知占位符原样保留 + 模块级去重 warn（spec D2）
 */
function expandTemplateBase(tpl: string, ctx: SaveNamingContext, warnSeen: Set<string>): string {
  const multiPage = ctx.pageCount > 1
  let t = tpl
  if (!multiPage && t.includes("{p}")) {
    t = t.replace(/[-_. ]?p?\{p\}/g, "")
  }
  const expanded = t.replace(/\{(\w+)\}/g, (raw, name: string) => {
    switch (name) {
      case "id":
        return String(ctx.id)
      case "title":
        return sanitizeLimitedSegment(ctx.title)
      case "author":
        return sanitizeLimitedSegment(ctx.author ?? "")
      case "p":
        return multiPage ? String(ctx.page) : ""
      default:
        if (!warnSeen.has(name)) {
          warnSeen.add(name)
          console.warn(`[galleryDownload] 命名模板含未知占位符 {${name}}，原样保留`)
        }
        return raw
    }
  })
  return expanded.trim()
}

/**
 * 模板 → 最终保存文件名（ADR-0192 D2/D3/D4，纯函数；下载队列/单存相册两条链共用）。
 *
 * @param template 命名模板（未净化原文——本函数内做读取期净化，空/非法回落默认并 warn）
 * @param ctx      作品上下文（id / title / author / 页号 / 页数）
 * @param url      原图 URL（仅用于扩展名推断，复用 extForUrl）
 * @param warnSeen 未知占位符告警去重集合（省缺 = 模块级集合；测试注入新鲜集合）
 * @returns `<展开名>[_p<N>].<ext>`；默认模板逐字节复现 buildSaveFileName 既有输出
 */
export function buildSaveFileNameFromTemplate(
  template: string,
  ctx: SaveNamingContext,
  url: string,
  warnSeen: Set<string> = unknownPlaceholderWarned,
): string {
  const ext = extForUrl(url)
  const norm = normalizeDownloadTemplate(template)
  if (norm.fallback) {
    console.warn("[galleryDownload] 命名模板为空/非法，回落默认模板")
  }
  let base = expandTemplateBase(norm.value, ctx, warnSeen)
  if (base === "") {
    // 全展开为空（如模板恰为 `{p}` 的单页作品）：可读告警 + 回落默认展开（禁静默产出空文件名）
    console.warn("[galleryDownload] 命名模板展开结果为空，回落默认模板")
    base = expandTemplateBase(DEFAULT_DOWNLOAD_TEMPLATE, ctx, warnSeen)
  }
  const multiPage = ctx.pageCount > 1
  // 模板不含 {p} 且多页 → 自动追加 _p<页号>（与既有 _p<N> 后缀逐字节同形，spec D4）；
  // 截断保留页号段（超长截断后仍保证逐页文件名互不碰撞）。
  if (multiPage && !norm.value.includes("{p}")) {
    const suffix = `_p${ctx.page}`
    base = base.slice(0, Math.max(0, DOWNLOAD_FILENAME_MAX_LENGTH - suffix.length)) + suffix
  } else {
    base = base.slice(0, DOWNLOAD_FILENAME_MAX_LENGTH)
  }
  return `${base}.${ext}`
}

/**
 * 作者目录段（ADR-0192 D5 / 术语表「按作者建目录」）：开关关闭 → 空串（现行为字节不变）；
 * 开启 → 净化 + 截断后的作者名段（与文件名段同一净化规则）。作者缺失或净化后为空 →
 * 空串（目录退化为基座）+ console.warn（禁静默）。只动目录段，不影响文件名。
 */
export function buildAuthorDirSegment(enabled: boolean, author: string | undefined): string {
  if (!enabled) return ""
  const seg = sanitizeLimitedSegment(author ?? "")
  if (seg === "") {
    console.warn("[galleryDownload] 按作者建目录开启但作者名缺失/净化后为空，目录退化为基座")
    return ""
  }
  return seg
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

/**
 * 任务构造命名选项（ADR-0192 D7 / spec D5）：设置经调用方注入（纯函数不偷读 store），
 * dir 由 buildAuthorDirSegment 统一产出——队列链与单存相册链共用同一命名纯函数（spec D6）。
 */
export interface TaskNamingOptions {
  /** 按作者建目录开关（设备级设置 download_by_author_dir 的入队时刻快照） */
  authorDir?: boolean
}

/**
 * 从作品 + 选中页构造下载队列任务（spec docs/specs/download-manager.md §3.1）：
 * 一页 = 一条输出文件任务；源恒原图（复用 originalPageUrls 语义），格式取 URL 扩展名；
 * 文件名沿用 buildSaveFileName（单一事实源在 JS，与旧保存链路逐字节一致）；
 * dir = 作者目录段（naming.authorDir 开启时为净化作者名段，缺省/关闭 = 空串字节不变）。
 * 页无可用原图 URL 时跳过并 console.warn（无静默降级）。
 */
export function buildImageTasks(
  illust: PixivIllust,
  pages: readonly number[],
  naming?: TaskNamingOptions,
): DownloadTaskDraft[] {
  const urls = originalPageUrls(illust)
  const total = pages.length
  const dir = buildAuthorDirSegment(naming?.authorDir === true, illust.user?.name)
  const drafts: DownloadTaskDraft[] = []
  for (const page of pages) {
    const url = urls[page]
    if (!url) {
      console.warn(`[galleryDownload] 第 ${page + 1} 页无可用原图 URL，跳过入队`)
      continue
    }
    drafts.push({
      id: `img_${illust.id}_p${page}`,
      illustId: illust.id,
      title: illust.title,
      thumbnailUrl: illust.image_urls.medium ?? illust.image_urls.large ?? '',
      kind: 'image',
      page,
      sourceUrl: url,
      targetFormat: extForUrl(url),
      fileName: buildSaveFileName(illust.id, total > 1 ? page : undefined, url),
      dir,
    })
  }
  return drafts
}

/**
 * ugoira 导出任务（spec §3.1/§5）：sourceUrl 恒**官方 ZIP URL**（非 /pixiv-img 代理路径——
 * 原生执行器按官方 URL 走图床/防盗链链路）；fileName = Pictelio_<id>.<fmt>；
 * dir = 作者目录段（Java 侧落 Downloads/Pictelio/<作者>，spec D5）。
 * 格式来自全局设置（T13），任务创建即快照。
 */
export function buildUgoiraTask(
  illust: PixivIllust,
  zipUrl: string,
  format: string,
  frames: readonly UgoiraFrameTiming[] = [],
  naming?: TaskNamingOptions,
): DownloadTaskDraft {
  const draft: DownloadTaskDraft = {
    id: `ugoira_${illust.id}_${format}`,
    illustId: illust.id,
    title: illust.title,
    thumbnailUrl: illust.image_urls.medium ?? illust.image_urls.large ?? '',
    kind: 'ugoira',
    sourceUrl: zipUrl,
    targetFormat: format,
    fileName: `Pictelio_${illust.id}.${format}`,
    dir: buildAuthorDirSegment(naming?.authorDir === true, illust.user?.name),
  }
  if (frames.length > 0) {
    draft.frames = frames.map((f) => ({ file: f.file, delay: f.delay }))
  }
  return draft
}


