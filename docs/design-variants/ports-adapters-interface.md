# 设计变体 2：端口与适配器（Ports & Adapters，`@/storage`）

> 来源：DESIGN-IT-TWICE 子代理 task-4（网络中断恢复后落盘）

## 核心决策

| 决策 | 结论 | 理由 |
|---|---|---|
| Seam 位置 | 单个设置项（Setting）级别，而非裸 KV 级别 | KV seam 太浅——校验/迁移/序列化样板会散回 N 个 store |
| 接口形态 | 声明式 `SettingCodec` + 三个动词 `load / save / subscribe` | per-item 差异全部变成数据（def），不是代码 |
| import 副作用 | `defineSetting` 纯函数，零 IO | 根治 themeStore bug |
| 首屏防闪烁 | `syncSource` 声明 + `peek()` 同步读 | 同步性成为 backend 的显式能力声明 |
| 批量启动 | `warmup(defs)` 并行加载，单项失败不阻塞 | |
| 错误模式 | 方法**永不 reject**；错误路由到 `def.onError`；`save` 返回 `Promise<boolean>` | 与项目 `tryAsync` 哲学一致 |

## 端口定义（`src/storage/port.ts`）

```typescript
export type StorageResult<T> = { ok: true; value: T } | { ok: false; error: StorageError };

export interface StoragePort {
  /** 权威异步读。readSync 只通过 syncRead 暴露——把防闪烁同步读与权威读在类型上分开 */
  read(key: string): Promise<StorageResult<string | null>>;
  readBatch(keys: string[]): Promise<StorageResult<Map<string, string>>>;
  write(key: string, value: string): Promise<StorageResult<void>>;
  remove(key: string): Promise<StorageResult<void>>;
}

export interface SyncReadPort {
  /** 首屏同步读（防闪烁专用）。仅 localStorage 后端实现 */
  readSync(key: string): string | null;
}

export interface SettingCodec<T> {
  key: string;
  fallback: T;
  serialize(value: T): string;
  /** 返回 null = 非法 → 降级 fallback */
  parse(raw: string): T | null;
}

export interface SettingLoader {
  /** 批量加载：一次 readBatch + 逐项 parse + corrupt 降级。单项失败不阻塞整体 */
  loadAll(codecs: SettingCodec<unknown>[]): Promise<{ values: Map<string, unknown>; errors: StorageError[] }>;
}
```

## 适配器

- `createPreferencesAdapter()` → `@capacitor/preferences`
- `createLocalStorageAdapter()` → localStorage（含 SecurityError / QuotaExceededError 收拢）
- `createDualAdapter(primary, mirror)` → Preferences 主 + localStorage 镜像；`read()` 永远从 primary 读，mirror 只通过 `readSync` 暴露——杜绝"从镜像读到的旧值被当权威值写回"的环路（独有不变量：`read()` 结果必然 ≥ `readSync()` 新鲜度）
- `createMemoryAdapter(seed)` → 测试注入用（一个 Map，`dump()` 是测试后门）

## 组合根（`src/storage/container.ts`）

```typescript
// 全应用【唯一】允许 import 具体 adapter 的地方
export function initStorage(override?: StorageContainer): StorageContainer {
  if (override) { container = override; return container; }
  const prefs = createPreferencesAdapter();
  const local = createLocalStorageAdapter();
  const dual = createDualAdapter(prefs, local, (key, e) => console.warn("[storage] mirror write failed", key, e));
  container = { port: dual, syncRead: dual, loader: createSettingLoader(dual) };
  return container;
}

/** store 层的唯一入口。未 init 时抛错——让"忘了 bootstrap"在开发期立即爆炸 */
export function storage(): StorageContainer {
  if (!container) throw new Error("[storage] initStorage() 未调用");
  return container;
}
```

main.tsx: `initStorage()` → `await loadStartupSettings()` → render。

## themeStore 改造实证

```typescript
// 修复点：import 阶段只 readSync（窄能力）；持久化只在用户显式 set 时；fallback 永不写回
const initialTheme = storage().syncRead.readSync(themeCodec.key);
let currentTheme = initialTheme !== null ? (themeCodec.parse(initialTheme) ?? themeCodec.fallback) : themeCodec.fallback;

export async function setThemePersisted(newTheme: Theme): Promise<void> {
  currentTheme = newTheme;
  applyDarkClass(/* … */);
  const r = await storage().port.write(themeCodec.key, themeCodec.serialize(newTheme));
  if (!r.ok) console.warn("[themeStore] persist theme failed", r.error);
}
// createRoot/createEffect 持久化逻辑整个删除——它就是这个 bug 的本体
```

## 测试（MemoryAdapter 注入，零 vi.mock）

```typescript
beforeEach(() => {
  const mem = createMemoryAdapter({ theme: "dark" });
  initStorage({ port: mem, syncRead: mem, loader: createSettingLoader(mem) });
});

it("模块加载时不写存储（bug 回归）", async () => {
  const mem = storage().port as ReturnType<typeof createMemoryAdapter>;
  expect(mem.dump().has("page_style_theme")).toBe(false);
  expect(mem.dump().get("theme")).toBe("dark"); // 预置值未被覆盖
});
```

## Trade-offs

**Leverage 高**：SettingLoader 是**最深模块**——一个 `loadAll` 消灭 settingsStore 13 处 "tryAsync + warn" 三件套 + __root 15 个手写 load；LocalStorageAdapter 把三个坑（SecurityError/Quota/SSR）收拢到一处；SyncReadPort 用类型系统隔离"只有 localStorage 能同步读"；时序不变量写成显式契约，bug 可测试。

**薄/代价**：
- StoragePort 本身 4 方法纯 string KV，接近透传——**刻意的**（端口价值在 seam 位置不在深度）
- MemoryAdapter ~20 行——测试 leverage 来自行为一致性
- **SecureStorage / IndexedDB / TanStack DB 不进这个端口**——token 有 Native 同步复合不变量、IDB 是结构化缓存、TanStack 是响应式集合，套 KV 端口只会削浅。只统一"设置类 string KV"（Preferences 8 store + localStorage 3 处）
- 全局可变单例 `container`——组合根用模块级单例而非 Solid Context（store 也是模块级，Context 要求全部改签名）
- `readBatch` 部分失败语义保守：任一失败即整体 unavailable（15 项场景下后端整体挂掉才是现实失败模式）

## 落地顺序

① port.ts + 4 adapter + container（纯新增无破坏）→ ② themeStore 改造 + bug 回归测试 → ③ settingsStore codec 化 + startupSettings → ④ createPersistedSet/imageHostStore 迁移 → ⑤ ESLint `no-restricted-imports` 封死 stores→adapters 反向依赖
