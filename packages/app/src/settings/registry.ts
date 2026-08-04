/**
 * Settings registry —— 核心深模块。
 *
 * 一个 define 的 6 个常见字段背后藏着：write gate、迁移管线、默认 codec 推断、
 * 防抖写队列、条件持久化、apply 钩子调度、订阅 fanout、key 重复检测、
 * syncInit 一致性校验、factory handle 缓存（LRU）。
 *
 * 时序（不变量 1/3）：
 *   T0 define（零 IO）→ T1 syncInitAll（同步，render 前）→ T1.5 hydrateAll
 *   （异步并行）→ T2 用户 set（write gate 已开）
 */

import { createSignal } from "solid-js";
import type {
  Codec,
  DynamicSettingFactory,
  KVStorage,
  SettingDef,
  SettingHandle,
  Settings,
} from "./types";
import { inferCodec } from "./codecs";

const DEFAULT_PHASE: "cold" | "warm" = "cold";

type ErrorPhase = "read" | "write" | "apply" | "migrate";

function codecFor(def: SettingDef<unknown>): Codec<unknown> {
  return (def.codec ?? inferCodec(def.default)) as Codec<unknown>;
}

function report(def: SettingDef<unknown>, phaseName: ErrorPhase, err: unknown): void {
  if (def.onError) {
    def.onError(err, phaseName);
  } else {
    console.warn(`[settings] ${phaseName} ${def.key}`, err);
  }
}

export interface SettingsOptions {
  /** 后端注册表：name → adapter。必含 "preferences"（或 defaultStorage 指向的键） */
  storages: Record<string, KVStorage>;
  /** 默认后端名，默认 "preferences" */
  defaultStorage?: string;
}

export function createSettings(opts: SettingsOptions): Settings {
  const { storages } = opts;
  const defaultStorage = opts.defaultStorage ?? "preferences";

  // ── 内部状态 ──
  let phase: "cold" | "warm" = DEFAULT_PHASE;
  const defs = new Map<string, SettingDef<unknown>>();
  const handles = new Map<string, SettingHandle<unknown>>();
  const onChangeSubscribers = new Set<(key: string, value: unknown) => void>();
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // ── 工具 ──

  function resolveStorage(def: SettingDef<unknown>): KVStorage {
    if (typeof def.storage === "object" && def.storage !== null) {
      return def.storage;
    }
    const name = typeof def.storage === "string" ? def.storage : defaultStorage;
    const s = storages[name];
    if (!s) {
      throw new Error(`[settings] unknown storage: ${name}`);
    }
    return s;
  }

  /** decode 管线：codec.decode → migrate → validate。任一步失败返回 undefined（损坏） */
  function decodeSetting(def: SettingDef<unknown>, raw: string): unknown {
    const codec = codecFor(def);
    let decoded: unknown;
    try {
      decoded = codec.decode(raw);
    } catch {
      // 字符串 fallback：仅当该项 default 是 string（字符串枚举项）时安全
      if (typeof def.default !== "string") {
        return undefined;
      }
      decoded = raw;
    }
    if (def.migrate) {
      try {
        decoded = def.migrate(decoded);
      } catch (e) {
        report(def, "migrate", e);
        return undefined;
      }
    }
    if (def.validate && !def.validate(decoded)) {
      return undefined;
    }
    return decoded;
  }

  /** 持久化（绕过 write gate 与防抖，直接落盘）。mirrored 的双写由 adapter 内部完成 */
  async function persistNow(def: SettingDef<unknown>, value: unknown): Promise<boolean> {
    const s = resolveStorage(def);
    const codec = codecFor(def);
    let serialized: string;
    try {
      serialized = codec.encode(value as never);
    } catch (e) {
      report(def, "write", e);
      return false;
    }
    try {
      await s.set(def.key, serialized);
      return true;
    } catch (e) {
      report(def, "write", e);
      return false;
    }
  }

  /** 完整加载（权威源）：get（含 legacyKeys 探测）→ decode → 写内存 + apply */
  async function loadInto(def: SettingDef<unknown>, setter: (v: unknown) => void): Promise<void> {
    const s = resolveStorage(def);

    async function safeGet(key: string): Promise<string | null> {
      try {
        return await s.get(key);
      } catch (e) {
        report(def, "read", e);
        return null;
      }
    }

    let raw: string | null = await safeGet(def.key);
    let legacyKey: string | null = null;
    if (raw === null && def.legacyKeys && def.legacyKeys.length > 0) {
      for (const k of def.legacyKeys) {
        const legacyRaw = await safeGet(k);
        if (legacyRaw !== null) {
          raw = legacyRaw;
          legacyKey = k;
          break;
        }
      }
    }
    if (raw === null) {
      // 无记录：保持默认，不写回
      return;
    }
    const decoded = decodeSetting(def, raw);
    if (decoded === undefined) {
      // 数据损坏：默认回退 default，且不回写覆盖用户数据
      report(def, "read", new Error(`corrupt value for ${def.key}: ${raw}`));
      if (def.onCorrupt) {
        let fixed: unknown;
        try {
          fixed = def.onCorrupt(raw, new Error("corrupt"));
        } catch {
          return;
        }
        if (fixed !== undefined) {
          setter(fixed);
          if (def.apply) def.apply(fixed as never);
          // 修复类写操作绕过 write gate（不变量 2：迁移/修复管线可写）
          void persistNow(def, fixed);
        }
      }
      return;
    }
    setter(decoded);
    if (def.apply) {
      try {
        def.apply(decoded as never);
      } catch (e) {
        report(def, "apply", e);
      }
    }
    // legacyKeys 命中：迁移写新删旧（迁移类写操作绕过 write gate）
    // 先写新 key（确认落盘成功）再删旧 key，避免旧数据丢失
    if (legacyKey !== null) {
      const s2 = resolveStorage(def);
      try {
        const written = await persistNow(def, decoded);
        if (written) {
          await s2.remove(legacyKey);
        }
      } catch (e) {
        report(def, "write", e);
      }
    }
  }

  function applyValue(def: SettingDef<unknown>, value: unknown): void {
    if (def.apply) {
      try {
        def.apply(value as never);
      } catch (e) {
        report(def, "apply", e);
      }
    }
  }

  // ── 核心入口 ──

  function define<T>(def: SettingDef<T>): SettingHandle<T> {
    if (defs.has(def.key)) {
      throw new Error(`[settings] duplicate key: ${def.key}`);
    }
    const storage = resolveStorage(def as SettingDef<unknown>);
    if (def.syncInit && (!storage.sync || !storage.getSync)) {
      throw new Error(`[settings] syncInit requires sync storage: ${def.key}`);
    }

    defs.set(def.key, def as SettingDef<unknown>);
    const [value, setValueRaw] = createSignal<T>(def.default);
    // Solid setter 对泛型 T 有 Exclude<T, Function> 约束，包一层断言以便泛型项使用
    const setValue = (v: T) => setValueRaw(v as never);
    const localSubscribers = new Set<(v: T) => void>();

    const handle: SettingHandle<T> = {
      key: def.key,
      value,
      set(next: T): void {
        const prev = value();
        setValue(next);
        applyValue(def as SettingDef<unknown>, next);
        for (const fn of localSubscribers) fn(next);
        for (const cb of onChangeSubscribers) cb(def.key, next);

        if (def.persist === false) return;
        if (def.shouldPersist && !def.shouldPersist(next, prev)) return;
        // write gate：hydrateAll 完成前的 set 只更新内存，不落盘
        if (phase !== "warm") return;

        if (def.debounceMs && def.debounceMs > 0) {
          const existing = debounceTimers.get(def.key);
          if (existing) clearTimeout(existing);
          debounceTimers.set(
            def.key,
            setTimeout(() => {
              debounceTimers.delete(def.key);
              void persistNow(def as SettingDef<unknown>, next);
            }, def.debounceMs),
          );
        } else {
          void persistNow(def as SettingDef<unknown>, next);
        }
      },
      subscribe(fn: (v: T) => void): () => void {
        localSubscribers.add(fn);
        return () => localSubscribers.delete(fn);
      },
      async hydrate() {
        await loadInto(def as SettingDef<unknown>, (v) => setValue(v as T));
      },
      syncInit() {
        const s = resolveStorage(def as SettingDef<unknown>);
        if (!s.sync || !s.getSync) return;
        const raw = s.getSync(def.key);
        if (raw === null) return;
        const decoded = decodeSetting(def as SettingDef<unknown>, raw);
        if (decoded === undefined) {
          // 同步路径损坏：静默回退默认（首屏不阻塞），下一轮 hydrate 会走 onCorrupt
          return;
        }
        setValue(decoded as T);
        applyValue(def as SettingDef<unknown>, decoded);
      },
      async reset() {
        setValue(def.default);
        applyValue(def as SettingDef<unknown>, def.default);
        if (phase === "warm" && def.persist !== false) {
          await persistNow(def as SettingDef<unknown>, def.default);
        }
      },
      async remove() {
        const s = resolveStorage(def as SettingDef<unknown>);
        try {
          await s.remove(def.key);
        } catch (e) {
          report(def as SettingDef<unknown>, "write", e);
        }
      },
    };

    handles.set(def.key, handle as SettingHandle<unknown>);
    return handle;
  }

  function defineFactory<T>(
    def: Omit<SettingDef<T>, "key"> & { keyPrefix: string },
  ): DynamicSettingFactory<T> {
    const { keyPrefix } = def;
    const cache = new Map<string, SettingHandle<T>>();
    const MAX_CACHE = 200;

    function forId(id: string | number): SettingHandle<T> {
      const key = `${keyPrefix}_${id}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const handle = define<T>({ ...def, key });
      cache.set(key, handle);
      if (cache.size > MAX_CACHE) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) {
          // 完整注销：仅删 cache 会让重访问同 key 时 define 抛 duplicate key
          cache.delete(oldest);
          defs.delete(oldest);
          handles.delete(oldest);
        }
      }
      return handle;
    }

    return { prefix: keyPrefix, forId };
  }

  async function hydrateAll(): Promise<void> {
    await Promise.allSettled([...defs.keys()].map((key) => handles.get(key)?.hydrate()));
    phase = "warm";
  }

  function syncInitAll(): void {
    for (const def of defs.values()) {
      if (def.syncInit) {
        const h = handles.get(def.key);
        h?.syncInit();
      }
    }
  }

  async function resetAll(): Promise<void> {
    await Promise.allSettled([...handles.values()].map((h) => h.reset()));
  }

  function onChange(cb: (key: string, value: unknown) => void): () => void {
    onChangeSubscribers.add(cb);
    return () => onChangeSubscribers.delete(cb);
  }

  function get<T = unknown>(key: string): SettingHandle<T> | undefined {
    return handles.get(key) as SettingHandle<T> | undefined;
  }

  return {
    define,
    defineFactory,
    hydrateAll,
    syncInitAll,
    resetAll,
    get,
    snapshot() {
      const out: Record<string, unknown> = {};
      for (const [k, h] of handles) out[k] = h.value();
      return out;
    },
    onChange,
  };
}
