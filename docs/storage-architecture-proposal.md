# 统一存储抽象层设计方案（最终版）

> **决策记录**：2026-08 经 grill-with-docs + codebase-design（DESIGN-IT-TWICE）确定最终设计。
> 4 个设计变体对比见 `docs/design-variants/`：
> - `minimal-interface.md`（变体 1：极简 3 入口）
> - `ports-adapters-interface.md`（变体 2：端口与适配器）
> - `common-case-interface.md`（变体 3：常见场景优化 + parse 兼容通道）
> - `flexible-interface.md`（变体 4：最大灵活性）
>
> **结论**：变体 4（`Settings` registry + `KVStorage`/`Codec` 双 seam）为主干，
> 吸收变体 3 的 parse 兼容通道，吸收变体 2 的注入式测试。

## 1. 现状问题

### 1.1 存储机制分散（6 种）

| 机制 | 文件数 | 使用场景 | 问题 |
|------|--------|----------|------|
| `@capacitor/preferences` | 8 个 store | 普通设置 | 异步 API，首屏来不及读 |
| `capacitor-secure-storage` | 2 处 | 敏感凭证 | 合理，不动 |
| IndexedDB (`db.ts`) | 2 个消费方 | 大体积内容 | 合理，不动 |
| TanStack DB (`historyStore`) | 1 处 | 浏览历史 | 合理，不动 |
| `localStorage` 直调 | 3 处 | 同步读取场景 | 与 Preferences 双写不一致 |
| `sessionStorage` | 2 处 | 仅清理 | 合理，不动 |

### 1.2 核心痛点

**themeStore.ts 的 bug 只是表象，根本问题是：**

1. **同步/异步混用无规则**：`theme` 双写（Preferences + localStorage），`page_style_theme` 只写 Preferences，没有统一标准
2. **每个 store 重复实现持久化逻辑**：`tryAsync(Preferences.set(...))` + `console.warn` 模式在 8 个文件里重复了 30+ 次
3. **模块加载时序无防护**：`themeStore.ts` 的 `createEffect` 在模块加载时误写入，没有机制防止
4. **缺乏存储 Schema 定义**：key 名、默认值、校验逻辑分散在各处，没有单一事实来源

## 2. 设计目标

1. **单一入口**：所有普通设置通过 `Settings` registry 读写，不再直接操作 `Preferences`/`localStorage`
2. **声明式 Schema**：每个设置项用 `SettingDef` 声明 key、默认值、codec、校验、backend、扩展点
3. **时序安全（不变量 1/3）**：模块加载时零写入，启动加载完成后才允许持久化——结构性根治 themeStore bug
4. **渐进迁移**：不破坏现有功能（key 名不变），分阶段替换各 store 的持久化逻辑
5. **测试覆盖**：注入式 memory adapter 跨 seam 测全部语义，零 vi.mock
6. **parse 兼容通道**：旧存储数据（`String(bool)`/`String(number)`/裸字符串）无需迁移即可读取

## 3. 架构设计

### 3.1 分层

```
业务 store（themeStore / settingsStore / novelDetail …）
        │  只认识 SettingHandle + Settings（小 interface）
        ▼
src/settings/registry.ts   ← 核心深模块（深 implementation）
        │  依赖 KVStorage / Codec 接口（seam，定义在 types.ts）
        ▼
src/settings/backends/*.ts ← adapters（每个都是薄 shell）
        │  Preferences / localStorage / mirrored / memory
```

依赖方向单向：**消费方 store → registry(interface) → adapter → @capacitor/preferences**。
adapter 是唯一被允许 import Capacitor 的 module。

### 3.2 Seam 一：`KVStorage`（后端抽象）

```typescript
interface KVStorage {
  readonly sync: boolean;                    // 是否支持同步读写
  get(key: string): Promise<string | null>;  // null = 不存在
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  getSync?(key: string): string | null;      // sync: true 时必实现；首屏同步读 + 同步镜像
  setSync?(key: string, value: string): void;
  keys?(): Promise<string[]>;                // 迁移扫描 / resetAll（可选）
  subscribe?(cb: (key: string) => void): () => void;  // 外部写入监听（可选）
}
```

不变量：**值域始终是 `string | null`**——后端不感知类型，序列化在 registry 层完成。
`sync` 是事实（方法存在性支撑），不做泛型层级。

### 3.3 Seam 二：`Codec<T>`（序列化抽象）

```typescript
interface Codec<T> {
  encode(value: T): string;
  decode(raw: string): unknown;   // 失败 throw = 数据损坏
}
// 内置：stringCodec / boolCodec / numCodec / jsonCodec / inferCodec（按 default 类型推断）
```

校验（枚举白名单等）不放 codec 里——校验是「该项的业务规则」，放 def。

### 3.4 调用方 interface：`SettingDef` / `SettingHandle` / `Settings`

```typescript
interface SettingDef<T> {
  key: string;                     // 唯一；重复定义同 key 抛错
  default: T;                      // 内存初始值 + 校验/读失败的回退值
  codec?: Codec<T>;                // 默认 inferCodec(default)
  storage?: string | KVStorage;    // 默认 "preferences"
  validate?: (v: unknown) => v is T;
  persist?: boolean;               // false = 纯内存项（如 listQuality）
  syncInit?: boolean;              // 首屏同步读防闪烁（要求 storage.sync === true）
  migrate?: (raw: unknown) => T;   // 旧格式 → 新格式
  legacyKeys?: readonly string[];  // 旧 key → 新 key（命中则迁移写新删旧）
  shouldPersist?: (next: T, prev: T) => boolean;   // 条件持久化
  debounceMs?: number;             // 合并连续写（如 novel_progress 500ms）
  apply?: (value: T) => void;      // 值变化副作用钩子（同步调用，替代 createEffect）
  onError?: (err: unknown, phase: "read" | "write" | "migrate") => void;  // 默认 console.warn
  onCorrupt?: (raw: string, err: unknown) => T;    // 默认返回 default，不回写
}

interface SettingHandle<T> {
  readonly key: string;
  value(): T;                      // Solid accessor（signal）
  set(next: T): void;              // 内存 + apply + 按规则持久化
  subscribe(fn: (value: T) => void): () => void;   // 进程内变化监听
  hydrate(): Promise<void>;        // 读 → 迁移 → 校验 → 写内存
  syncInit(): void;                // 同步读（syncInit 项）
  reset(): Promise<void>;          // 写回 default 并持久化
  remove(): Promise<void>;         // 删除存储项
}

interface Settings {
  define<T>(def: SettingDef<T>): SettingHandle<T>;
  defineFactory<T>(def: Omit<SettingDef<T>, "key"> & { keyPrefix: string }): DynamicSettingFactory<T>;
  hydrateAll(): Promise<void>;     // 批量并行加载（替代 __root 的 15+ loadXxx）
  syncInitAll(): void;             // 所有 syncInit 项首屏同步读
  resetAll(): Promise<void>;       // 替代 resetSettingsStore 的手工遍历
  get<T>(key: string): SettingHandle<T> | undefined;
  snapshot(): Record<string, unknown>;
  onChange(cb: (key: string, value: unknown) => void): () => void;
}

interface DynamicSettingFactory<T> {
  readonly prefix: string;
  forId(id: string | number): SettingHandle<T>;  // 同一 id 缓存同 handle
}

function createSettings(opts: {
  storages: Record<string, KVStorage>;  // 必含 "preferences"
  defaultStorage?: string;
}): Settings;
```

模块级单例：`src/settings/index.ts` 导出 `settings = createSettings({...})`，业务 store 直接 import（与现有模块级 store 单例一致）。

### 3.5 不变量与时序约束

| # | 不变量 | 机制 |
|---|--------|------|
| 1 | **T0 import 阶段零存储访问、零副作用**。`define`/`defineFactory` 只注册 + 用 default 建 signal | 写存储只有显式 `set` 一条路，框架无「自动持久化 effect」路径 → themeStore bug 结构性消除 |
| 2 | 写存储只发生在：① `set()` 且 shouldPersist 通过且 write gate 已开；② `reset()`/`remove()`；③ 迁移管线内部（写新删旧） | registry 内部唯一写入口 |
| 3 | **时序**：`T0 define → T1 syncInitAll（同步）→ T1.5 hydrateAll（异步并行）→ T2 用户 set`。T1 之前任何 set 只更新内存不落盘（write gate） | write gate：hydrateAll 完成前拦截落盘 |
| 4 | hydrate 幂等、单 key 内无并发写（防抖合并）、跨 key 隔离（allSettled 语义） | 批量加载逐项失败互不影响 |
| 5 | `syncInit` 只允许 `storage.sync === true` 的项声明，否则 define 抛错 | 防闪烁机制不会静默失效 |
| 6 | 值域始终 `string \| null`；`save(read(load()))` 恒等；校验失败的值永不写回 | save 前过 codec + validate |

### 3.6 parse 兼容通道（吸收变体 3）

旧数据格式（30+ 个键全是 `String(bool)`、`String(number)`、裸字符串）全部吃下，无需逐键迁移：

```
decode 管线（顺序固定）：
  codec.decode(raw) → unknown
    ├─ JSON.parse 成功 → 非 string 结果走 validate      // 兼容旧 bool="true" → 需 boolCodec 二次处理
    └─ 失败 → 把 raw 当字符串走 validate                 // 兼容旧裸字符串 "medium"/"sans-serif"
  → migrate(raw) → T
  → validate(T)
  任一步失败 → onCorrupt 路径（默认返回 default，不回写覆盖用户数据）
```

> 实现注意：`inferCodec` 按 default 类型推断（如 `show_r18` default=false 推断 boolCodec），
> 但旧数据存的是字符串 `"true"` 而非 JSON `true`。因此 boolCodec/numCodec 必须同时接受
> `"true"` 与 `true` 两种形态，或走「JSON 失败 → 字符串 → validate」回退。这是变体 4 单独无法
> 覆盖、必须吸收变体 3 通道的原因。

### 3.7 错误模式（统一、可配置）

| 场景 | 默认行为 | 可升级路径 |
|---|---|---|
| 读错误（backend reject） | 内存保持当前值（default），`onError("read")` | onError 上报/降级 |
| 无值（null） | 用 default，**不写回** | — |
| decode/migrate/validate 失败 | 数据损坏：用 default，**不回写覆盖**；`onError("read")` + 可选 `onCorrupt` | onCorrupt 提供修复逻辑后写回 |
| 写失败 | 内存已乐观更新，`onError("write")`，不抛 | 未来可加 strict 模式（saveDsApiKey 类强保证场景） |
| 迁移失败 | 保留 raw 不写回，`onError("migrate")` | — |

## 4. 文件结构

```
src/settings/
├── types.ts          # KVStorage / Codec / SettingDef / SettingHandle / Settings 接口（seam）
├── registry.ts       # createSettings() 深模块（write gate、迁移、防抖、parse 兼容通道、apply 钩子、订阅、LRU）
├── backends/
│   ├── preferences.ts   # → @capacitor/preferences
│   ├── localStorage.ts  # 同步读 + SecurityError/QuotaExceededError 坑收拢
│   ├── mirrored.ts      # Preferences 主 + localStorage 镜像（theme/page_style_theme）
│   └── memory.ts        # 测试注入
└── index.ts          # 模块级单例 settings = createSettings({...})
```

## 5. Store 改造示例（themeStore，bug 修复实证）

**改造前：**
```typescript
// 模块级 createEffect 自动持久化（bug 本体：模块加载时首跑写回默认值覆盖用户选择）
let lastPersistedPageStyle: string | undefined;
createRoot(() => {
  createEffect(() => {
    const id = internalPageStyleTheme();
    if (id !== lastPersistedPageStyle) {
      lastPersistedPageStyle = id;
      tryAsync(Preferences.set({ key: PREF_KEY_PAGE_STYLE_THEME, value: id }));
    }
  });
});
```

**改造后：**
```typescript
import { settings } from "@/settings";
import { applyPageStyleClass, applyDarkClass } from "@/utils/themeApplier";

export type Theme = "light" | "dark" | "system";
export type PageStyleThemeId = "fluent" | "card";

const theme = settings.define<Theme>({
  key: "theme",
  default: "system",
  storage: "mirrored",           // Preferences(primary) + localStorage(mirror)
  syncInit: true,                // 首屏从 mirror 同步读，防闪烁
  validate: (v): v is Theme => v === "light" || v === "dark" || v === "system",
  apply: (v) => applyDarkClass(computeResolvedTheme(v) === "dark"),
});

const pageStyleTheme = settings.define<PageStyleThemeId>({
  key: "page_style_theme",
  default: "fluent",
  storage: "mirrored",
  syncInit: true,
  validate: (v): v is PageStyleThemeId => v === "fluent" || v === "card",
  apply: applyPageStyleClass,
});

// 对外 API 保持不变，兼容现有调用方
export const getTheme = () => theme.value();
export const setTheme = (t: Theme) => theme.set(t);
export const pageStyleThemeValue = () => pageStyleTheme.value();
export const setPageStyleTheme = (id: PageStyleThemeId) => pageStyleTheme.set(id);
// loadThemePreference / loadPageStyleThemePreference / setThemePersisted 全部删除
// createRoot + createEffect 自动写回块删除 —— bug 根除（显式 set 才持久化）
```

**启动序列**（main.tsx / __root.tsx）：
```typescript
settings.syncInitAll();        // 同步读出 theme/page_style_theme，防首屏闪烁（render 前）
await settings.hydrateAll();   // 其余 13+ 项异步并行加载（render 后）
```

## 6. 迁移计划

### Phase 1：修 bug + 建立基础设施（本次任务）

1. 新建 `src/settings/`（types / registry / backends / index）
2. 修复 `themeStore.ts` 的 bug：theme + page_style_theme 改为 `settings.define`，删除 `createRoot + createEffect` 自动写回块
3. 补充 `themeStore` 的单元测试（memory adapter 注入，覆盖 bug 回归：模块加载不写存储 + 预置值不被覆盖）

### Phase 2：迁移设置类 store（后续任务）

按优先级逐个迁移（每个 store 迁移后跑全量测试）：
1. `settingsStore.ts`（15 个设置项）
2. `uiStore.ts`（1 个设置项）
3. `translationStore.ts`（5 个设置项，SecureStorage 键保持独立路径）
4. `imageHostStore.ts`（`migrate: migrateLegacyState` + `legacyKeys`）

### Phase 3：迁移特殊场景（后续任务）

1. `readerSettingsStore.ts` → `storage: "local"` 同步后端
2. `NovelDetail.tsx` 进度 → `defineFactory({ keyPrefix: "novel_progress", debounceMs: 500 })`
3. `createPersistedSet.ts` → 特化 `defineSetSetting`（serialize 数组 / parse 数组 → Set）

### Phase 4：清理（后续任务）

1. 删除所有直接的 `Preferences.set/get` 调用（除 SecureStorage 相关）
2. 删除所有直接的 `localStorage.setItem/getItem` 调用
3. 统一 `console.warn` 前缀为 `[settings]`
4. 可选：ESLint `no-restricted-imports` 封死 stores → backends 反向依赖

## 7. 关键决策点（DESIGN-IT-TWICE 结论）

### Q1: 为什么选变体 4 为主干？

变体 4 覆盖了项目的**全部真实需求**：动态 key（NovelDetail 进度）、迁移（imageHostStore 已有 `migrateLegacyState`）、防抖（NovelDetail 手写 500ms）、条件持久化——这些不是投机设计，是代码里已存在的复杂度。变体 1/2 把其中一些「出局」，等于把复杂度留在调用方。

### Q2: 为什么必须吸收变体 3 的 parse 兼容通道？

项目现有 30+ 个键全是 `String(bool)`/`String(number)`/裸字符串。变体 4 的 `inferCodec` 按 default 类型推断会与旧数据格式冲突（如 `show_r18` 存 `"true"` 字符串 vs 推断 bool）。没有兼容通道，迁移时所有旧设置全丢。

### Q3: 为什么吸收变体 2 的注入式测试？

变体 4 的 `createSettings({storages})` 天然支持注入，测试传 memory adapter 即可——零 vi.mock，测试跨的 seam 与生产相同。变体 2 证明了这条路可行。

### Q4: 为什么 SecureStorage / IndexedDB / TanStack DB 不进这个端口？

- **SecureStorage**（refresh_token/ds_api_key）：有「持久化与 Native 同步」复合不变量和一次性迁移逻辑，本身就是深模块（`secureStorage.ts` 的 restore/save/clear），套 KV 端口只会削浅。ds_api_key 有「失败抛给 UI」特殊语义，也不符合默认不变量。
- **IndexedDB**（novelCache/translationCache）：结构化大体积缓存，`db.ts` 已有自己的 `IDBStore` seam + memory 实现，是良好范本，不重复。
- **TanStack DB**（historyStore）：响应式集合不是 KV，用 LiveQuery 语义。
- **本模块只统一「设置类 string KV」**——Preferences 8 store + localStorage 3 处，这正是痛点所在。

### Q5: `save()` 是否要支持 strict 模式？

v1 用乐观更新（写失败 warn 不抛），与现有 `tryAsync + console.warn` 一致。若未来出现「必须确认落盘」场景（如 ds_api_key），再加 `setStrict` 或保留独立路径，不污染默认语义。

## 8. 过度设计风险（明确警惕）

1. **syncInit/mirrored 误推广**：这是为 2~3 个主题项设计的防闪烁机制。非首屏项标 syncInit 会让启动串行变慢。缓解：仅 sync backend 可声明（不变量 5）。
2. **版本化 envelope 迁移**：不纳入 v1——项目实际只有「函数式 migrate」（imageHostStore 已证明够用）。
3. **跨进程实时同步**：Preferences 无 storage 事件，订阅设计为「内存订阅 + backend 可选外部刷新」，不承诺跨 tab 实时一致。
4. **factory 缓存泄漏**：`novel_progress_${id}` 按 id 无界增长，需 LRU 上限或 `release(id)`，否则长期使用内存膨胀。
5. **write gate 心智负担**：若真有业务要在 hydrate 前落盘（当前无此场景），gate 会拦——提供显式 bypass 选项而非去掉 gate。
6. **订阅系统规模**：保持「回调节点 + 返回退订函数」最小形态，不做 per-key 细粒度事件总线。

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 迁移过程中遗漏某个 store | 该设置丢失 | 分 Phase 迁移，每个 Phase 有 checklist |
| `mirrored` 模式数据不一致 | UI 显示错误 | 启动时以 Preferences（primary）为准，覆盖 localStorage 镜像 |
| 现有测试失败 | 回归 | 每个 Phase 迁移后跑全量测试 |
| 原生侧读取旧 key | 兼容性问题 | 保持 key 名不变，只改读写方式 |
| registry 单点故障 | 影响全部设置项 | 窄接口 + memory adapter 注入测试全覆盖 |

## 10. 验收标准

- [ ] `themeStore.ts` bug 修复：选择卡片风格 → 关闭 app → 重开 → 仍显示卡片风格，且首屏即正确
- [ ] 所有设置项的读写走 `Settings` registry，无直接 `Preferences.set/get`（SecureStorage 除外）
- [ ] 启动时不会误写入任何设置（模块加载零写入，write gate 生效）
- [ ] 旧存储数据（String(bool)/String(number)/裸字符串）无需迁移即可正确读取
- [ ] 每个设置项有对应的单元测试（memory adapter 注入，零 vi.mock）
- [ ] `console.warn` 带 `[settings]` 前缀，可追踪
