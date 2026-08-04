# 设计变体 4：最大灵活性（`Settings` registry + `KVStorage`/`Codec` 双 seam）

> 来源：DESIGN-IT-TWICE 补跑子代理 task-2（扩展点最丰富）

## 模块总览

```
业务 store（themeStore / settingsStore / novelDetail …）
        │  只认识 SettingHandle + Settings（小 interface）
        ▼
src/settings/registry.ts   ← 核心深模块（深 implementation）
        │  依赖 KVStorage / Codec 接口（seam，定义在 types.ts）
        ▼
src/settings/backends/*.ts ← adapters（每个都是薄 shell）
        │  Preferences / SecureStorage / localStorage / IndexedDB / mirrored
```

## 接口定义

### KVStorage（seam，所有 adapter 满足）

```typescript
interface KVStorage {
  readonly sync: boolean;                    // 是否支持同步读写
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  getSync?(key: string): string | null;      // sync: true 时必实现
  setSync?(key: string, value: string): void;
  keys?(): Promise<string[]>;                // 迁移扫描 / resetAll
  subscribe?(cb: (key: string) => void): () => void;  // 外部写入监听
}
```

不变量：**值域始终是 `string | null`**——后端不感知类型，序列化在 registry 层完成。

### Codec（序列化 seam）

```typescript
interface Codec<T> {
  encode(value: T): string;
  decode(raw: string): unknown;   // 失败 throw = 数据损坏
}
// 内置：stringCodec / boolCodec / numCodec / jsonCodec / inferCodec(按 default 类型推断)
```

### SettingDef / SettingHandle / Settings

```typescript
interface SettingDef<T> {
  key: string;                     // 唯一；重复定义抛错
  default: T;
  codec?: Codec<T>;                // 默认 inferCodec(default)
  storage?: string | KVStorage;    // 默认 "preferences"
  validate?: (v: unknown) => v is T;
  persist?: boolean;               // false = 纯内存项（如 listQuality）
  syncInit?: boolean;              // 首屏同步读防闪烁（要求 storage.sync === true）
  migrate?: (raw: unknown) => T;   // 旧格式 → 新格式
  legacyKeys?: readonly string[];  // 旧 key → 新 key（命中则迁移写新删旧）
  shouldPersist?: (next: T, prev: T) => boolean;   // 条件持久化
  debounceMs?: number;             // 合并连续写（如 novel_progress 500ms）
  apply?: (value: T) => void;      // 值变化副作用钩子（同步调用）
  onError?: (err: unknown, phase: "read" | "write" | "migrate") => void;
  onCorrupt?: (raw: string, err: unknown) => T;    // 默认返回 default，不回写
}

interface SettingHandle<T> {
  readonly key: string;
  value(): T;
  set(next: T): void;              // 内存 + apply + 按规则持久化
  subscribe(fn: (value: T) => void): () => void;
  hydrate(): Promise<void>;
  syncInit(): void;
  reset(): Promise<void>;
  remove(): Promise<void>;
}

interface Settings {
  define<T>(def: SettingDef<T>): SettingHandle<T>;
  defineFactory<T>(def: Omit<SettingDef<T>, "key"> & { keyPrefix: string }): DynamicSettingFactory<T>;
  hydrateAll(): Promise<void>;
  syncInitAll(): void;
  resetAll(): Promise<void>;
  get<T>(key: string): SettingHandle<T> | undefined;
  snapshot(): Record<string, unknown>;
  onChange(cb: (key: string, value: unknown) => void): () => void;
}

function createSettings(opts: {
  storages: Record<string, KVStorage>;  // 必含 "preferences"
  defaultStorage?: string;
}): Settings;
```

## 不变量

1. **T0 import 阶段零存储访问**：`define` 只注册 + 建 signal，零 IO 零副作用（结构性消除 themeStore bug）
2. **写存储只发生三处**：`set()`（且 shouldPersist 通过 + hydrate gate 已打开）/ `reset()`/`remove()` / 迁移管线内部
3. **时序**：`T0 define → T1 syncInitAll（同步）→ T1.5 hydrateAll（异步并行）→ T2 用户 set`。T1 之前任何 set 只更新内存不落盘（write gate）
4. hydrate 幂等、单 key 无并发写、跨 key 隔离（allSettled）
5. `syncInit` 只允许 `storage.sync === true` 的项声明，否则 define 抛错

## 错误模式

| 场景 | 默认 | 升级路径 |
|---|---|---|
| 读错误 | 内存保持当前值，onError("read") | onError 上报 |
| 无值 | 用 default，不写回 | — |
| decode/migrate/validate 失败 | 数据损坏：用 default，**不回写覆盖**，onError + onCorrupt | onCorrupt 修复后写回 |
| 写失败 | 内存已乐观更新，onError("write")，不抛 | strict 模式可抛 |
| 迁移失败 | 保留 raw 不写回 | — |

## 场景示例

**themeStore（syncInit + mirrored + apply，bug 修复）**：
```typescript
const theme = settings.define<Theme>({
  key: "theme",
  default: "system",
  storage: "mirrored",        // Preferences(primary) + localStorage(mirror)
  syncInit: true,             // 首屏从 mirror 同步读，防闪烁
  validate: (v): v is Theme => v === "light" || v === "dark" || v === "system",
  apply: applyDarkClass,      // 值变化即同步应用 class，无需 createEffect
});
// createRoot + createEffect 自动写回块删除 —— bug 根除
```

**动态 key（novel_progress_${id}）**：
```typescript
const novelProgress = settings.defineFactory<NovelProgress>({
  keyPrefix: "novel_progress",
  default: { paragraphIndex: 0, charIndex: 0, progress: 0 },
  storage: "local",
  debounceMs: 500,            // 替代 NovelDetail 手写防抖
});
const progress = novelProgress.forId(novelId());  // 同 id 缓存同 handle
progress.set({ paragraphIndex, charIndex, progress });
```

**迁移（旧 key → 新 key + 旧格式 → 新格式）**：
```typescript
const imageHost = settings.define<ImageHostState>({
  key: "image_host_settings",
  default: defaultState(),
  legacyKeys: ["image_host_config"],   // 读旧 → migrate → 写新 → 删旧
  migrate: migrateLegacyState,
});
```

## Seam 后面隐藏的内容（registry 内部 depth）

write gate、迁移管线（legacyKeys 探测）、默认 codec 推断、防抖写队列、条件持久化求值、apply 钩子调度、订阅 fanout、批量加载并发隔离（allSettled）、mirrored 写序（primary 成功 → mirror）、factory handle 缓存（LRU 防泄漏）、key 重复检测、syncInit 一致性校验。

## Trade-offs

**高 leverage**：define 的 ~6 个字段藏着 10 项存储语义（deletion test：删掉 registry，复杂度回到 8 个 store 重复样板 + 15 个 load + themeStore bug + NovelDetail 手写防抖）；hydrateAll/syncInitAll 收敛启动；resetAll 收敛 resetSettingsStore 的 20 行遍历；修 themeStore 类 bug 只需动 registry + defs。

**薄处（刻意）**：每个 backend adapter 都是 5 方法薄 shell——seam 只有一种变体（键值 string），depth 不该摊到 adapter；codec 也薄，推断/校验策略在 registry/def 层。

**过度设计风险（明确警惕）**：
1. syncInit/mirrored 被误推广到非首屏项 → 同步读拖慢启动（仅 sync backend 可声明，不变量 5）
2. 版本化 envelope 迁移不纳入 v1——函数式 migrate 已够用
3. 跨进程实时同步不承诺——Preferences 无 storage 事件，订阅为「内存 + backend 可选外部刷新」
4. factory 缓存泄漏：novel_progress 按 id 无界增长需 LRU 上限或 release(id)
5. write gate 心智负担——提供显式 bypass 而非去掉 gate
6. 订阅系统保持最小形态（回调节点 + 退订函数），不做事件总线
