# ADR-0036: 错误元组模式统一替换 try-catch

## 状态

提案

## 日期

2026-07-26

## 背景

Pictelio 项目现有约 110 个 try-catch / try-finally 块分布在 45 个源文件中，
覆盖 API 层、stores、routes、components、primitives、services、utils 等所有层级。
错误处理风格不统一：有带变量名的 catch（`catch e` / `catch err` / `catch error`），
有裸 catch（`catch { }`），有带 finally 的，有不处理的。

现有问题：

1. **V8 优化影响**：函数的 try-catch 区域即使不抛出异常，也会在 TurboFan 中生成额外
   控制流边和 deopt 元数据，导致 happy path 约 5-15% 的优化损失（虽不如 Crankshaft
   时代的 20-100x 严重，但仍可度量）。
2. **可维护性差**：`catch` 分支抛出或不抛出、返回默认值、设 loading false、记日志等
   行为混杂，没有统一模式。
3. **try-finally 重复**：19 个 finally 块中的清理逻辑（`loading.set(false)` 等）本质
   是重复样板。

## 决策

引入 **错误元组模式（Error Tuple Pattern）**：用 `[err, data]` 两元素元组统一替代
所有 `try-catch` 块和 `try-finally` 块。

### 核心函数

创建 `src/utils/tryAsync.ts`，导出两个函数：

```typescript
/** 异步版：替代 try { await ... } catch */
export async function tryAsync<T, E = Error>(
  promise: Promise<T>,
  errorExt?: Record<string, unknown>,
): Promise<[null, T] | [E, undefined]> {
  return promise
    .then<[null, T]>((data) => [null, data])
    .catch<[E, undefined]>((err: E) => {
      if (errorExt) Object.assign(err, errorExt);
      return [err, undefined];
    });
}

/** 同步版：替代 try { JSON.parse(...) } catch 等同步操作 */
export function trySync<T, E = Error>(
  fn: () => T,
): [null, T] | [E, undefined] {
  try {
    return [null, fn()];
  } catch (err) {
    return [err as E, undefined];
  }
}
```

### 替换模式

| 原模式 | 新模式 |
|--------|--------|
| `try { await x } catch(e) { handle(e) }` | `const [err] = await tryAsync(x); if (err) handle(err)` |
| `try { JSON.parse(s) } catch { return fallback }` | `const [err, data] = trySync(() => JSON.parse(s)); const result = err ? fallback : data` |
| `try { await x } catch(e) { h(e) } finally { c() }` | `const [err] = await tryAsync(x); c(); if (err) { h(err); return }` |
| `const r = await x.catch(e => h(e))` | `const [err, data] = await tryAsync(x)` |

### 配套工具

- **unplugin-auto-import**（devDependencies）：在构建时将 `tryAsync`、`trySync`
  自动注入所有源文件，消除 45 个文件的 import 语句。
- `auto-imports.d.ts` 自动生成，加入 `.gitignore`。

### 不替换范围

无。所有之前认为「同步 try-catch 应保留」的判断已被推翻——使用 `trySync` 代替，
将 try-catch 封装到工具函数内部，调用函数可被 V8 正常优化。

## 替代方案

### 方案 A：保持现状

维持现有 110 个 try-catch/try-finally 块不变。
- 优点：零变更
- 缺点：V8 优化损失累积；代码风格不统一；finally 重复模板

### 方案 B：使用 npm 包 await-to-js

引入 `await-to-js`（scopsy/await-to-js）npm 依赖。
- 优点：社区维护，3.4k stars
- 缺点：需外部依赖；仅有 `to`（异步版），无同步版；`to` 命名不自文档化；
  版本冻结于 v3.0.0，长期未更新

### 方案 C：self-host to + toSync

自托管工具函数，命名为 `to` / `toSync`，无 auto-import。
- 优点：零外部依赖
- 缺点：45 个文件需要加 import；`to` 不自文档化，新开发者需先查定义

### 方案 D（选定）：self-host tryAsync + trySync + auto-import

自托管 `tryAsync` / `trySync`，配合 `unplugin-auto-import` 自动注入。
- 优点：命名自文档化、零外部运行时依赖、try-catch 缩小到工具函数内部
- 缺点：需新增一个构建时依赖；auto-imports.d.ts 需 gitignore；代码可搜索性需
  用 `tryAsync(` 替代 `from '...'` 搜索

## 影响

### 正面

- 函数级 V8 优化不再被 try-catch 阻碍
- 错误处理模式统一，所有代码按 `[err, data]` 元组风格书写
- finally 中的清理逻辑统一为后置清理，消除重复模板
- try-catch 封装到工具函数内部（tryAsync 用 `.catch()` 链，trySync 用极小函数）
- 命名自文档化，无需注释说明

### 负面

- 约 110 个 try-catch 块的手动迁移，需 3 批完成
- 每个 `tryAsync()` 成功路径分配 64 字节 `[null, data]` 数组
- 每个 `trySync()` 成功路径分配 64 字节 `[null, data]` 数组
- auto-imports.d.ts 被 gitignore，首次 clone 后需先跑 `pnpm dev` 生成

### 性能对比

| 模式 | 成功路径分配 | V8 优化 | 微任务延迟 |
|------|:-----------:|:-------:|:----------:|
| try-catch | 0 字节 | 有 ~5-15% 优化损失 | 无 |
| tryAsync | 64 字节 `[null, data]` | 调用函数完全可优化 | 无 |
| trySync | 64 字节 `[null, data]` | 调用函数完全可优化 | 无 |

### 迁移成本估算

- 第 1 批（基础设施）：~15 分钟
- 第 2 批（纯异步 ~95 个块）：~2-4 小时
- 第 3 批（try-finally ~19 个 + 同步 ~7 个）：~1-2 小时
- 合计：~3.5-6.5 小时

## 自动导入配置（vite.config.ts）

```typescript
import AutoImport from 'unplugin-auto-import/vite'

// 在 plugins 数组中
plugins: [
  AutoImport({
    imports: [
      {
        '@/utils/tryAsync': ['tryAsync', 'trySync'],
      },
    ],
    dts: './src/auto-imports.d.ts',
  }),
  solid(),
  UnoCSS(),
]
```

## 引用

- CONTEXT.md — 错误处理模式术语表（已更新）
- V8 博客 "Leaving the Sea of Nodes" (2025-03) — try-catch 的控制流边仍有成本
- V8 blog "Launching Ignition and TurboFan" (2017-05) — Crankshaft 移除，TurboFan
  支持 try-catch
- V8 commit 9aac80f (2016) — try-catch 不再禁用函数优化
