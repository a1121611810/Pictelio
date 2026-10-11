// 图片缓存的展示口径（#984）——「高级」页占用/命中率与清理反馈的**唯一换算点**。
//
// 【为什么独立成纯模块】三件事都不能散落在模板里，否则「口径」会分裂成多份实现：
//   1. 原生 JSON → 结构的解析（含缺字段/坏 JSON 的显式失败）；
//   2. 字节 → 可读体积；
//   3. 命中率 → 文案，**分母为 0 必须显示「暂无数据」而不是 0%**（与 usageMetrics 的
//      「从未观察到的段不得谎报 0%」同一纪律，参见 primitives/usageMetrics.ts）。
// 本模块不碰 NativeModules、不碰 Pinia，故可纯 node 单测（测试落在同目录 *.test.ts）。

/** 原生两层缓存统计快照（口径见 Java 侧 ImageCacheStats） */
export interface ImageCacheStats {
  /** 分母：显示链路的图片加载请求数 */
  requests: number
  /** 分子：显示链路的内存命中 + 磁盘命中 */
  hits: number
  /** 命中率（原生已算好，恒在 0–1） */
  hitRate: number
  /** 磁盘层占用字节数 */
  diskBytes: number
  /** 磁盘层条目数 */
  diskEntries: number
  /** 内存层占用字节数（本进程量表） */
  memoryBytes: number
  /** 内存层条目数（本进程量表） */
  memoryEntries: number
  /**
   * 读数是否真实可用。
   *
   * false = 图片服务未初始化，此时上面全是 0 —— 那是「读不到」，**不是「缓存是空的」**，
   * 渲染成 0% / 0 B 就是制造一个假指标。故必须据此显示「暂不可用」。
   */
  available: boolean
}

/** 一键清理的结果（Java 侧 ImageCacheClearResult） */
export interface ImageCacheClearResult {
  /** 实际释放的字节数 */
  freedBytes: number
  /** 成功删除的条目数 */
  deletedEntries: number
  /** 有条目没删掉 ⇒ 界面须把它显示出来，不得当作全成功 */
  failed: boolean
}

/** 字段缺失/类型不对时返回 null —— 调用方据此显示「暂不可用」，不静默捏造读数 */
export function parseStats(json: string): ImageCacheStats | null {
  const raw = safeParse(json)
  if (!raw) return null
  const { requests, hits, hitRate, diskBytes, diskEntries, memoryBytes, memoryEntries } = raw
  if (
    !isNumber(requests) ||
    !isNumber(hits) ||
    !isNumber(hitRate) ||
    !isNumber(diskBytes) ||
    !isNumber(diskEntries) ||
    !isNumber(memoryBytes) ||
    !isNumber(memoryEntries)
  ) {
    return null
  }
  return {
    requests,
    hits,
    hitRate,
    diskBytes,
    diskEntries,
    memoryBytes,
    memoryEntries,
    available: raw.available !== false,
  }
}

/** 清理结果解析；坏数据返回 null（调用方须显示失败，不得当作成功） */
export function parseClearResult(json: string): ImageCacheClearResult | null {
  const raw = safeParse(json)
  if (!raw) return null
  const { freedBytes, deletedEntries } = raw
  if (!isNumber(freedBytes) || !isNumber(deletedEntries)) return null
  return { freedBytes, deletedEntries, failed: raw.failed === true }
}

function safeParse(json: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(json)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** 字节 → 可读体积：<1KB 用 B，<1MB 用 KB，其余用 MB（各留一位小数） */
export function formatBytes(bytes: number): string {
  if (!isNumber(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 命中率 → 百分比数值；**分母为 0 返回 null**（调用方显示「暂无数据」）。
 *
 * <p>这不是防御性编程，而是口径要求：尚未发生过任何显示链路加载时，「0%」与「无样本」
 * 是两件不同的事，把前者显示成后者就是在造一个假指标（与 usageMetrics 同纪律）。
 */
export function hitRatePercent(hitRate: number, requests: number): number | null {
  if (!isNumber(hitRate) || !isNumber(requests) || requests <= 0) return null
  return hitRate * 100
}