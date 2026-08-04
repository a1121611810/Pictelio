# 设计变体 3：常见场景优化（registry + parse 兼容通道）

> 来源：DESIGN-IT-TWICE 补跑子代理 task-1（80/15/5 场景）

## 核心思想

一个设置项 = 一个声明 module。`defineSetting` 模块加载时只做「声明 + 注册」，**零 IO、零 effect**；所有读写收敛到注册表单例。

## 接口定义

```typescript
export type SettingBackend = "preferences" | "localStorage" | "dual";

export interface SettingOptions<T> {
  key: string;
  default: T;
  parse?: (raw: string) => T | undefined;      // 反序列化+校验；undefined → 默认值
  serialize?: (value: T) => string;             // 默认 JSON.stringify（对 string 透明）
  validate?: (value: T) => boolean;
  backend?: SettingBackend;                     // 默认 "preferences"
  sync?: boolean;                               // 默认 false；true 时 backend 须含 localStorage
  startup?: boolean;                            // 默认 true；false = 不参与 loadAll
  onApply?: (value: T) => void;                 // 副作用钩子（theme class 应用等）
  onError?: (e: unknown, phase: "load" | "save") => void;
}

export interface Setting<T> {
  get(): T;                       // 响应式读（Solid signal）
  set(value: T): void;            // 内存同步更新 + 异步持久化（乐观，默认不抛）
  setStrict(value: T): Promise<void>;  // 持久化失败向上抛
  setLocal(value: T): void;       // 仅内存写（迁移/初始化）
  load(): Promise<void>;
  hydrate(): void;                // 同步读 localStorage（仅 sync:true 可用）
  readonly def: SettingOptions<T>;
}

export interface SettingRegistry {
  define<T>(opts: SettingOptions<T>): Setting<T>;
  get<T = unknown>(key: string): Setting<T> | undefined;
  keys(): string[];
  loadAll(): Promise<void>;       // 并行加载全部 startup:true 项
  hydrateAll(): void;             // 同步 hydrate 全部 sync:true 项（首次渲染前）
  resetAll(): void;
  registerCustom(opts: { key: string; load(): Promise<void> }): void;  // 逃生舱口
}
```

## 关键：默认 parse 兼容通道

旧数据格式全兼容，无需逐键迁移：

```
parse(raw):
  raw == null          → undefined
  try JSON.parse(raw)  → 非 string 结果走 validate   // 兼容旧 bool="true"/number="300"
  失败                 → 把 raw 当字符串走 validate    // 兼容旧裸字符串 "medium"/"sans-serif"
  validate 不过        → undefined（回默认）
```

## 三种场景示例

**80%（一行声明）**：
```typescript
export const layoutMode = defineSetting({
  key: "layout_mode",
  default: "waterfall" as LayoutMode,
  validate: (v): v is LayoutMode => v === "waterfall" || v === "single" || v === "grid",
});
// 用法：layoutMode() 读 / layoutMode.set("grid") 写
```

**15%（显式 sync）**：
```typescript
export const theme = defineSetting({
  key: "theme",
  default: "system" as Theme,
  sync: true,
  backend: "dual",
  validate: (v): v is Theme => v === "light" || v === "dark" || v === "system",
  onApply: (v) => applyDarkClass(computeResolvedTheme(v) === "dark"),
});
// main.tsx: render 前 hydrateAll() → 首屏 class 同步生效
```

**5%（逃生舱口）**：
```typescript
// imageHostStore 迁移：parse 内做 migrateLegacyState
export const imageHostState = defineSetting({
  key: "image_host_settings",
  default: defaultState(),
  parse: (raw) => migrateLegacyState(JSON.parse(raw)),
  serialize: (v) => JSON.stringify(v),
});
// clientSwitch：startup: false 按需显式 load()
// createPersistedSet：特化 defineSetSetting
// 终极逃生：registerCustom({ key, load })
```

## 不变量

- **I0**：define 阶段禁止任何 IO 与 effect → 根治 themeStore bug
- **I1**：signal 初始值恒等于声明 default（或已被 hydrate/load 覆盖）
- **I2**：load/hydrate 仅在「有记录 && parse+validate 通过」时覆盖
- **I3**：set 先更新内存再异步持久化（乐观）；dual 写序 = Preferences → localStorage 镜像
- **T1**：hydrateAll() 必须在首次 render 前调用
- **T2**：loadAll() 在 render 后调用，Promise.all 并行、逐项失败互不影响

## Trade-offs

**高 leverage**：parse 兼容通道——不改旧存储数据即可迁移全部现有键，一次消除 30+ 处样板；防 write-on-import 根治整类 bug；批量并行启动 + 统一错误。

**代价**：声明式 API 类型体操集中在 registry 一个深模块；string raw fallback 是隐式魔法需文档化；乐观更新丢失 uiStore 的「写失败回滚」语义；单点故障（registry bug 影响全部项）；旧导出名需迁移期兼容别名。
