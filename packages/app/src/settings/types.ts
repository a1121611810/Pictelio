/**
 * 统一设置存储抽象层 —— seam 接口定义。
 *
 * 设计文档：docs/storage-architecture-proposal.md（最终版，变体 4 主干）
 * 词汇遵循 codebase-design：本模块是「Settings registry」深模块，
 * KVStorage / Codec 是两个 seam，backends/* 是满足 seam 的 adapter。
 *
 * 依赖方向（单向）：
 *   业务 store → registry(interface) → adapter → @capacitor/preferences
 * adapter 是唯一被允许 import Capacitor 的模块。
 */

// ─── Seam 1: KVStorage（后端抽象）───

export interface KVStorage {
  /** 是否支持同步读写（localStorage / mirrored 为 true） */
  readonly sync: boolean;

  /** 异步读。null = 不存在 */
  get(key: string): Promise<string | null>;
  /** 异步写。值域永远是 string（序列化在其上层完成） */
  set(key: string, value: string): Promise<void>;
  /** 异步删除 */
  remove(key: string): Promise<void>;

  /** 同步读（sync: true 时必实现）；用于首屏同步读 + 同步镜像 */
  getSync?(key: string): string | null;
  /** 同步写（sync: true 时必实现） */
  setSync?(key: string, value: string): void;

  /** 枚举全部 key（迁移扫描 / resetAll 用，可选） */
  keys?(): Promise<string[]>;
  /** 外部写入监听（localStorage storage 事件等，可选；不实现时订阅退化为纯内存） */
  subscribe?(cb: (key: string) => void): () => void;
}

// ─── Seam 2: Codec（序列化抽象）───

export interface Codec<T> {
  encode(value: T): string;
  /** 解码失败 throw（视为数据损坏，走 onCorrupt 路径） */
  decode(raw: string): unknown;
}

// ─── 调用方 interface ───

export interface SettingDef<T> {
  /** 存储 key。全局唯一，重复定义同 key 抛错 */
  key: string;
  /** 默认值：内存初始值 + 校验/读失败的回退值 */
  default: T;
  /** 序列化 codec，默认按 default 类型推断（inferCodec） */
  codec?: Codec<T>;
  /** 后端名（对应 createSettings 的 storages 键）或直接传 adapter。默认 "preferences" */
  storage?: string | KVStorage;
  /** 校验（枚举白名单等）。解码后二次把关，不过则视为损坏回退 default */
  validate?: (v: unknown) => v is T;
  /** false = 纯内存项（如 listQuality），永不持久化 */
  persist?: boolean;
  /** 首屏同步读防闪烁（要求 storage.sync === true，否则 define 抛错） */
  syncInit?: boolean;
  /** 旧格式 → 新格式（如 migrateLegacyState） */
  migrate?: (raw: unknown) => T;
  /** 旧 key → 新 key（命中则迁移写新删旧） */
  legacyKeys?: readonly string[];
  /** 条件持久化：返回 false 时 set 不落盘 */
  shouldPersist?: (next: T, prev: T) => boolean;
  /** 合并连续写（如 novel_progress 的 500ms 防抖） */
  debounceMs?: number;
  /** 值变化副作用钩子（applyDarkClass 等），set/hydrate/syncInit 后同步调用 */
  apply?: (value: T) => void;
  /** 错误钩子，默认 console.warn */
  onError?: (err: unknown, phase: "read" | "write" | "apply" | "migrate") => void;
  /** 数据损坏时的修复回调。默认返回 default 且不回写覆盖用户数据 */
  onCorrupt?: (raw: string, err: unknown) => T;
}

export interface SettingHandle<T> {
  readonly key: string;
  /** Solid accessor：响应式读取当前值 */
  value(): T;
  /** 内存 + apply + 按规则（shouldPersist/debounce/write gate）持久化 */
  set(next: T): void;
  /** 进程内变化监听，返回退订函数 */
  subscribe(fn: (value: T) => void): () => void;
  /** 异步读（权威源）→ 迁移 → 校验 → 写内存 */
  hydrate(): Promise<void>;
  /** 同步读（仅 syncInit 项） */
  syncInit(): void;
  /** 写回 default 并持久化 */
  reset(): Promise<void>;
  /** 删除存储项 */
  remove(): Promise<void>;
}

export interface DynamicSettingFactory<T> {
  readonly prefix: string;
  /** 同一 id 缓存同 handle（带 LRU 上限防泄漏） */
  forId(id: string | number): SettingHandle<T>;
}

export interface Settings {
  /** 定义静态设置项。T0 import 阶段零 IO、零副作用 */
  define<T>(def: SettingDef<T>): SettingHandle<T>;
  /** 定义动态 key 设置项（如 novel_progress_${id}） */
  defineFactory<T>(
    def: Omit<SettingDef<T>, "key"> & { keyPrefix: string },
  ): DynamicSettingFactory<T>;
  /** 批量并行加载全部已注册项，完成后翻转 write gate（phase → warm） */
  hydrateAll(): Promise<void>;
  /** 所有 syncInit 项首屏同步读（render 前调用） */
  syncInitAll(): void;
  /** 全部项写回 default 并持久化 */
  resetAll(): Promise<void>;
  /** 删除指定键的持久化值（孤儿键清理，ADR-0103；无 handle 亦可用，走默认后端） */
  remove(key: string): Promise<void>;
  get<T = unknown>(key: string): SettingHandle<T> | undefined;
  snapshot(): Record<string, unknown>;
  onChange(cb: (key: string, value: unknown) => void): () => void;
}
