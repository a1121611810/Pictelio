# 设计变体 1：极简接口（`defineSetting` / `bootSettings` / `hydrateSettings`）

> 来源：DESIGN-IT-TWICE 子代理 task-1（网络中断恢复后落盘）

## 核心决策

1. **Schema 即能力**：`defineSetting` 返回的 descriptor 自带 `load()`/`save()`/`read()`，调用方不需要 import service 函数。
2. **Backend 降为实现细节**：不暴露 `"preferences" | "localStorage" | "dual"` 枚举，只暴露语义化布尔 `firstPaint?: boolean`。
3. **批量加载消磁**：`bootSettings()` 一次调用替换 `__root.tsx` 里 14 行 `Promise.all`；新增设置项启动序列零改动。

## 接口定义（全部 3 个入口点）

```typescript
// packages/app/src/services/settings.ts
export interface SettingDef<T> {
  readonly key: string;
  readonly defaultValue: T;
  /** 同步读取当前生效值。首帧渲染前可用；永不抛异常，失败回退 defaultValue */
  read(): T;
  /** 异步读取（权威源，dual backend 时从 Preferences 读并回填同步缓存） */
  load(): Promise<T>;
  /** 持久化。boot 完成前调用 = no-op + warn（时序防护） */
  save(value: T): Promise<void>;
}

export interface SettingOptions<T> {
  /** 校验/迁移。返回 null 表示非法 → 回退 defaultValue */
  validate?: (raw: unknown) => T | null;
  /** 首屏防闪烁：该值必须在第一帧渲染前同步可读。默认 false */
  firstPaint?: boolean;
}

// 入口点 ①：声明
export function defineSetting<T>(
  key: string,
  options: SettingOptions<T> & { defaultValue: T },
): SettingDef<T>;

// 入口点 ②：启动（批量并行加载 + 时序闸门）
export function bootSettings(defs?: SettingDef<unknown>[]): Promise<void>;

// 入口点 ③：响应式绑定（可选，leverage 最高的一层）
export function hydrateSettings<S extends Record<string, SettingDef<unknown>>>(
  defs: S,
): { [K in keyof S]: S[K] extends SettingDef<infer T> ? T : never };
```

## 不变量

| # | 不变量 | 机制 |
|---|--------|------|
| I1 | import 阶段零写入 | `read()` 纯读；写入闸门由 boot 相位控制 |
| I2 | boot 完成前 `save()` 为 no-op | 内部 `phase: "cold" → "warm"` 状态机 |
| I3 | `read()` 永不抛、永不等 | 全路径 trySync 包裹 |
| I4 | key 全局唯一 | 注册表 Map，重复 define 即 throw |
| I5 | dual 一致性：`load()` 后 Preferences 覆盖 localStorage 镜像 | `load()` 内部回填镜像 |
| I6 | 序列化对称：`save(read(load()))` 恒等 | save 前过 validate |

## themeStore 重写示例

```typescript
const themeDef = defineSetting<Theme>("theme", {
  defaultValue: "system",
  firstPaint: true,
  validate: (v) => (v === "light" || v === "dark" || v === "system" ? v : null),
});

export function setTheme(t: Theme): void {
  currentTheme = t;
  currentResolved = resolve(t);
  applyDarkClass(currentResolved === "dark");
  void themeDef.save(t);   // boot 前调用是 no-op（I2），机制兜底
}

// 启动侧收敛为：
await bootSettings();  // 自动发现全部已注册 def，并行加载，翻转写入闸门
```

## Seam 后面隐藏了什么（`settingsBackends.ts`，内部不导出）

1. Backend 适配器（统一 `BackendAdapter { get/getSync/set }`）：preferencesAdapter / webAdapter / dualAdapter / 未来 secureAdapter
2. 时序状态机 `phase = cold | warm`
3. 内存 cache `Map<string, unknown>`
4. 序列化协议 + validate 管线
5. 并行调度（内部 `Promise.all`）
6. 注册表与 key 冲突检测
7. 错误归一化（warn + defaultValue）

## Trade-offs

**Leverage 高**：`defineSetting` 一行声明消灭 ~15 行样板；`bootSettings()` 14 行清单 → 1 行；`firstPaint` 语义标志；I2 时序闸门把 code-review 约定变成运行时机制。

**薄/代价**：
- 动态 key 不适配（`novel_progress_${id}`）——需要工厂变体或保留直调（刻意边界）
- 全局注册表是隐式耦合——依赖 import 顺序；缓解：`bootSettings(defs)` 显式传参 + barrel 文件
- 内存 cache 与外部写不一致——原生直写 Preferences 时 read() 拿旧值（当前无此路径）
- `save()` 不回传成败——UI 无法提示存储失败（对设置类数据是正确取舍）
- `hydrateSettings`（入口③）最薄——对带副作用场景仍需手写 hydrate
