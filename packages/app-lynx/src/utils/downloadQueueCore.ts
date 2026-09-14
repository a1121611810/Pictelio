// ─── 下载队列纯函数核心（spec docs/specs/download-manager.md §3/§4）───
// 与 app 包 src/utils/downloadQueueCore.ts 同源同语义（双端差分对齐，惯例同 galleryDownload）；
// 纯函数、零 IO / 零框架依赖，node 可单测（测试硬约束 #1 的纯函数侧）。
// 所有权：状态机在 JS（可测/可持久化）；字节与编解码在原生执行器（ADR-0146 D1）。

export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'stopped'
  | 'completed'
  | 'failed'

export type DownloadKind = 'image' | 'ugoira' | 'novel'

/** 删除二次确认的两条路径（spec §3.3）：删文件+记录 / 仅清记录 */
export type DeleteMode = 'files' | 'records'

/** ugoira 帧时序（与 Pixiv 元数据 frames[] / @pictelio/ugoira 同形）：动画编码用 */
export interface UgoiraFrameTiming {
  file: string
  delay: number
}

export interface DownloadTask {
  id: string
  illustId: number
  title: string
  thumbnailUrl: string
  kind: DownloadKind
  /** 静态多页的 0-based 页号；ugoira 为 undefined */
  page?: number
  /** ugoira 帧时序（kind=ugoira 且需动画编码时携带；容器类可缺省） */
  frames?: UgoiraFrameTiming[]
  /**
   * 小说导出载荷（kind="novel"；序列化的 NovelExportPayload，队列核心不解析其结构；
   * 见 docs/specs/novel-export.md §3.3/§4）。opaque 字段，入队即快照。
   */
  payloadJson?: string
  sourceUrl: string
  targetFormat: string
  fileName: string
  status: DownloadStatus
  /** 0–100 */
  progress: number
  bytesDone?: number
  bytesTotal?: number
  /** 完成后：content:// 或 file:// */
  outputUri?: string
  error?: string
  /** 运行代：每次 queued→downloading 递增，用于丢弃过期异步回调（竞态防护） */
  runId: number
  createdAt: number
  updatedAt: number
}

/** 入队草稿：状态/进度/时间/运行代由核心填写 */
export type DownloadTaskDraft = Omit<
  DownloadTask,
  'status' | 'progress' | 'createdAt' | 'updatedAt' | 'runId'
>

export interface QueueState {
  tasks: DownloadTask[]
}

export const QUEUE_SCHEMA_VERSION = 1
/** 并发上限（spec §4.2：固定 1，对 CDN 温和） */
export const MAX_CONCURRENT = 1
/** ugoira 导出格式白名单（spec §5） */
export const UGOIRA_FORMATS = ['gif', 'mp4', 'webp', 'apng', 'zip', 'tar'] as const
export type UgoiraFormat = (typeof UGOIRA_FORMATS)[number]

const STATUS_SET = new Set<string>([
  'queued',
  'downloading',
  'paused',
  'stopped',
  'completed',
  'failed',
])

export function emptyQueue(): QueueState {
  return { tasks: [] }
}

// ─── 迁移合法性（spec §3.2 表）───

export function canStart(t: DownloadTask): boolean {
  return (
    t.status === 'queued' ||
    t.status === 'paused' ||
    t.status === 'stopped' ||
    t.status === 'failed'
  )
}

export function canPause(t: DownloadTask): boolean {
  return t.status === 'downloading'
}

export function canStop(t: DownloadTask): boolean {
  return t.status === 'queued' || t.status === 'downloading' || t.status === 'paused'
}

// ─── 内部工具 ───

function newTask(draft: DownloadTaskDraft, now: number): DownloadTask {
  const t: DownloadTask = {
    id: draft.id,
    illustId: draft.illustId,
    title: draft.title,
    thumbnailUrl: draft.thumbnailUrl,
    kind: draft.kind,
    sourceUrl: draft.sourceUrl,
    targetFormat: draft.targetFormat,
    fileName: draft.fileName,
    status: 'queued',
    progress: 0,
    runId: 0,
    createdAt: now,
    updatedAt: now,
  }
  if (draft.page !== undefined) t.page = draft.page
  if (draft.frames !== undefined) t.frames = draft.frames.map((f) => ({ ...f }))
  if (draft.payloadJson !== undefined) t.payloadJson = draft.payloadJson
  return t
}

/**
 * 结构共享：无任何任务被改变时返回原 state（引用相等），
 * 避免 Solid/Vue 响应式系统因空操作产生多余更新。
 */
function mapTasks(
  state: QueueState,
  ids: readonly string[],
  fn: (t: DownloadTask) => DownloadTask,
): QueueState {
  const set = new Set(ids)
  let changed = false
  const tasks = state.tasks.map((t) => {
    if (!set.has(t.id)) return t
    const next = fn(t)
    if (next !== t) changed = true
    return next
  })
  return changed ? { tasks } : state
}

// ─── 入队 / 操作（纯迁移）───

/** 入队：按 id 去重（幂等——重复入队不产生重复条目），新条目状态恒为 queued。 */
export function enqueue(
  state: QueueState,
  drafts: readonly DownloadTaskDraft[],
  now: number,
): QueueState {
  const existing = new Set(state.tasks.map((t) => t.id))
  const added: DownloadTask[] = []
  for (const d of drafts) {
    if (existing.has(d.id)) continue
    existing.add(d.id)
    added.push(newTask(d, now))
  }
  return added.length === 0 ? state : { tasks: [...state.tasks, ...added] }
}

/** 开始/重试：queued|paused|stopped|failed → queued（由 schedule 提升为 downloading）。 */
export function start(state: QueueState, ids: readonly string[], now: number): QueueState {
  return mapTasks(state, ids, (t) =>
    canStart(t) ? { ...t, status: 'queued', error: undefined, updatedAt: now } : t,
  )
}

/** 暂停：downloading → paused（保留进度与字节）。 */
export function pause(state: QueueState, ids: readonly string[], now: number): QueueState {
  return mapTasks(state, ids, (t) =>
    t.status === 'downloading' ? { ...t, status: 'paused', updatedAt: now } : t,
  )
}

/** 停止：queued|downloading|paused → stopped（丢弃部分产物，进度归零）。 */
export function stop(state: QueueState, ids: readonly string[], now: number): QueueState {
  return mapTasks(state, ids, (t) =>
    canStop(t)
      ? {
          ...t,
          status: 'stopped',
          progress: 0,
          bytesDone: undefined,
          bytesTotal: undefined,
          outputUri: undefined,
          error: undefined,
          updatedAt: now,
        }
      : t,
  )
}

interface StartSignal {
  id: string
  runId: number
}

/**
 * 调度（spec §4.2）：在并发额度内按 createdAt 升序把 queued 提升为 downloading，
 * 并为本次运行分配新 runId（返回 started，供 store 交给执行器）。
 */
export function schedule(
  state: QueueState,
  limit: number = MAX_CONCURRENT,
  now: number = Date.now(),
): { state: QueueState; started: StartSignal[] } {
  const active = state.tasks.filter((t) => t.status === 'downloading').length
  let slots = Math.max(0, limit - active)
  if (slots === 0) return { state, started: [] }

  const ordered = state.tasks
    .map((t, index) => ({ t, index }))
    .filter((x) => x.t.status === 'queued')
    // 该数组是 map/filter 的新产物，就地排序无副作用；toSorted() 为 ES2023，超出 WebView 85 基线
    // oxlint-disable-next-line unicorn/no-array-sort
    .sort((a, b) => a.t.createdAt - b.t.createdAt || a.index - b.index)

  const started: StartSignal[] = []
  const assigned = new Map<string, number>()
  for (const { t } of ordered) {
    if (slots <= 0) break
    const runId = t.runId + 1
    assigned.set(t.id, runId)
    started.push({ id: t.id, runId })
    slots--
  }
  if (started.length === 0) return { state, started }

  return {
    state: {
      tasks: state.tasks.map((t) => {
        const runId = assigned.get(t.id)
        return runId === undefined ? t : { ...t, status: 'downloading', runId, updatedAt: now }
      }),
    },
    started,
  }
}

/** 进度上报：仅当仍是 downloading 且 runId 匹配才接受（丢弃 pause/stop 后的过期回调）。 */
export function reportProgress(
  state: QueueState,
  id: string,
  runId: number,
  progress: number,
  bytes?: { done?: number; total?: number },
  now: number = Date.now(),
): QueueState {
  return mapTasks(state, [id], (t) => {
    if (t.status !== 'downloading' || t.runId !== runId) return t
    const clamped = Math.max(0, Math.min(100, progress))
    return {
      ...t,
      progress: clamped,
      bytesDone: bytes?.done,
      bytesTotal: bytes?.total,
      updatedAt: now,
    }
  })
}

/** 完成：仅 downloading + runId 匹配——写入 outputUri 与 100%。 */
export function complete(
  state: QueueState,
  id: string,
  runId: number,
  outputUri: string,
  now: number = Date.now(),
): QueueState {
  return mapTasks(state, [id], (t) =>
    t.status === 'downloading' && t.runId === runId
      ? { ...t, status: 'completed', progress: 100, outputUri, error: undefined, updatedAt: now }
      : t,
  )
}

/** 失败：仅 downloading + runId 匹配——写入可读原因。 */
export function fail(
  state: QueueState,
  id: string,
  runId: number,
  error: string,
  now: number = Date.now(),
): QueueState {
  return mapTasks(state, [id], (t) =>
    t.status === 'downloading' && t.runId === runId
      ? { ...t, status: 'failed', error, updatedAt: now }
      : t,
  )
}

// ─── 删除 / 选择器 ───

/** 待删文件：仅 completed 且有 outputUri；mode='records' 一律不删文件（spec §3.3）。 */
export function selectDeleteFileUris(
  state: QueueState,
  ids: readonly string[],
  mode: DeleteMode,
): string[] {
  if (mode !== 'files') return []
  const set = new Set(ids)
  const uris: string[] = []
  for (const t of state.tasks) {
    if (set.has(t.id) && t.status === 'completed' && t.outputUri) uris.push(t.outputUri)
  }
  return uris
}

export function removeTasks(state: QueueState, ids: readonly string[]): QueueState {
  const set = new Set(ids)
  return { tasks: state.tasks.filter((t) => !set.has(t.id)) }
}

export function findTask(state: QueueState, id: string): DownloadTask | undefined {
  return state.tasks.find((t) => t.id === id)
}

export function countByStatus(state: QueueState, status: DownloadStatus): number {
  return state.tasks.filter((t) => t.status === status).length
}

// ─── 持久化（spec §4.4）───

export function serialize(state: QueueState): string {
  return JSON.stringify({
    version: QUEUE_SCHEMA_VERSION,
    tasks: state.tasks,
  } satisfies { version: number; tasks: DownloadTask[] })
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 校验并构造干净 task（丢弃未知字段/非法条目返回 null）。 */
function normalizeTask(v: unknown, warn: (msg: string, err?: unknown) => void): DownloadTask | null {
  if (!isRecord(v)) return null
  const {
    id,
    illustId,
    title,
    thumbnailUrl,
    kind,
    sourceUrl,
    targetFormat,
    fileName,
    status,
    progress,
    page,
    frames,
    payloadJson,
    bytesDone,
    bytesTotal,
    outputUri,
    error,
    createdAt,
    updatedAt,
    runId,
  } = v
  if (typeof id !== 'string' || id === '') return null
  if (typeof illustId !== 'number' || !Number.isFinite(illustId)) return null
  if (typeof title !== 'string' || typeof thumbnailUrl !== 'string') return null
  if (kind !== 'image' && kind !== 'ugoira' && kind !== 'novel') return null
  if (typeof sourceUrl !== 'string' || typeof targetFormat !== 'string') return null
  if (typeof fileName !== 'string') return null
  if (typeof status !== 'string' || !STATUS_SET.has(status)) return null
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return null
  if (typeof createdAt !== 'number' || typeof updatedAt !== 'number') return null

  const t: DownloadTask = {
    id,
    illustId,
    title,
    thumbnailUrl,
    kind,
    sourceUrl,
    targetFormat,
    fileName,
    status: status as DownloadStatus,
    progress,
    runId: typeof runId === 'number' ? runId : 0,
    createdAt,
    updatedAt,
  }
  if (typeof page === 'number') t.page = page
  if (Array.isArray(frames)) {
    const clean: UgoiraFrameTiming[] = []
    for (const f of frames) {
      if (isRecord(f) && typeof f.file === 'string' && typeof f.delay === 'number') {
        clean.push({ file: f.file, delay: f.delay })
      }
    }
    if (clean.length > 0) t.frames = clean
  }
  if (typeof payloadJson === 'string') {
    t.payloadJson = payloadJson
  } else if (payloadJson !== undefined) {
    // 测试硬约束 #3：非法载荷不得静默丢弃
    warn('[downloadQueueCore] 丢弃非法 payloadJson: ' + id)
  } else if (kind === 'novel') {
    warn('[downloadQueueCore] novel 任务缺少 payloadJson: ' + id)
  }
  if (typeof bytesDone === 'number') t.bytesDone = bytesDone
  if (typeof bytesTotal === 'number') t.bytesTotal = bytesTotal
  if (typeof outputUri === 'string') t.outputUri = outputUri
  if (typeof error === 'string') t.error = error
  return t
}

/**
 * 反序列化：schema 校验 + 逐条 normalize；损坏整体/条目丢弃并 warn（禁止静默降级）。
 * 启动恢复语义：downloading 一律降级 paused（进程重启中断）。
 */
export function restore(
  raw: string | null,
  warn: (msg: string, err?: unknown) => void = console.warn,
): QueueState {
  if (!raw) return emptyQueue()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    warn('[downloadQueueCore] 队列数据解析失败，按空队列恢复', e)
    return emptyQueue()
  }
  if (!isRecord(parsed) || parsed.version !== QUEUE_SCHEMA_VERSION) {
    warn('[downloadQueueCore] 队列 schema 版本不匹配，按空队列恢复')
    return emptyQueue()
  }
  if (!Array.isArray(parsed.tasks)) {
    warn('[downloadQueueCore] 队列 tasks 字段非法，按空队列恢复')
    return emptyQueue()
  }

  const tasks: DownloadTask[] = []
  let dropped = 0
  for (const entry of parsed.tasks) {
    const t = normalizeTask(entry, warn)
    if (!t) {
      dropped++
      continue
    }
    if (t.status === 'downloading') {
      tasks.push({ ...t, status: 'paused', updatedAt: Date.now() })
      warn('[downloadQueueCore] 任务 ' + t.id + ' 上次运行中断，恢复为 paused')
    } else {
      tasks.push(t)
    }
  }
  if (dropped > 0) {
    warn('[downloadQueueCore] 丢弃 ' + dropped + ' 条损坏任务记录')
  }
  return { tasks }
}
