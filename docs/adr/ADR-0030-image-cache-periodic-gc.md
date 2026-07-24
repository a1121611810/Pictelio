# ADR 0030: imageLoader L1 缓存添加定时 GC 与低内存感知

## 状态

已批准 — 立即执行

## 分类

性能优化

## 日期

2026-07-17

## 背景

`imageLoader.ts` 的 L1 缓存（`loadedKeys` LRU Map）当前仅在缓存大小达到 10,000 条上限时淘汰最旧条目。这存在以下问题：

1. **无定时 GC**：用户在 Feed 中快速滚动加载了大量图片（如 8000 张），然后停止操作。缓存中保留 8000 条 key，直到新加入超过上限才会淘汰旧条目。在长时间会话中，这浪费了 1-2MB 的字符串内存（每条 Pixiv URL ~100 字符）。
2. **无低内存感知**：不响应 Android `ComponentCallbacks2.TRIM_MEMORY` 事件。当系统内存紧张时，应用不会主动释放 L1 缓存，增加被系统 kill 的概率。
3. **无上下文淘汰**：离开页面/详情页时不会清除该页面的缓存条目。用户浏览了大量作品后返回 Feed，L1 缓存仍保留所有详情页图片的 URL。
4. **inFlightRequests cleanup**：当前使用 `promise.finally()` 清理，但缺乏 `try/finally` 防御性包裹。

## 决策

### D1: 添加定时周期性 GC

- 每 **5 分钟** 检查 LRU 大小
- 超过阈值（8,000 条）时主动淘汰最旧 20%
- 使用 `setInterval` 实现，`onCleanup` 时 `clearInterval`

### D2: 添加上下文感知淘汰

- 导出 `clearPageCache(filter: (url: string) => boolean)` 函数
- 详情页 unmount 时调用，清除该作品相关图片 URL（通过 URL 中的作品 ID 匹配）

### D3: 添加 appStateChange 感知

- 监听 `@capacitor/app` 的 `appStateChange` 事件
- app 进入后台时执行一次全面 GC（淘汰全部条目的一半）
- app 回到前台时不操作（缓存立即可用）

### D4: 防御性 Promise 清理

- 将 `loadImageInner` 中的 promise 清理改为 `try {} finally {}` 包裹

## 后果

### 正面
- 长时间会话中回收 50%+ 的已缓存条目
- 系统内存紧张时主动降级
- 减少被 kill 概率

### 负面
- 增加 `setInterval` 定时器（仅运行时创建，页面关闭清除）
- 增加 `appStateChange` 监听器注册

### 风险
低。所有 GC 操作是幂等的，不影响加载正确性。
