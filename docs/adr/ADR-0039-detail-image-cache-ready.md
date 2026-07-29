# ADR 0039: 详情页多图缓存就绪后渲染

## 状态

已接受（2026-07-29）

## 背景

切换到 PixivApiPlugin 网关架构（ADR-0037）后，多图详情页（`page_count > 1`）向下滚动时后面图片无法白框/无法显示。

### 流程还原

```
LazyDetailImage 进入可见范围
  → PixivImage 渲染
    → <img src="/pixiv-img/...">
    → shouldInterceptRequest → interceptImage
      → 检查 Java 磁盘缓存 → 未命中 ❌
      → HttpURLConnection 回退（同步，无连接池）
        → 超时/异常 → return null
          → Capacitor 默认 WebViewClient 无法处理本地代理路径
          → 图片失败 → PixivImage.handleError → 永久白框
```

### 根因

时序竞争：`PixivImage` 渲染 `<img>` 触发 `shouldInterceptRequest` 时，`loadImage` 的 `PixivApi.prefetchImage()`（OkHttp）尚未完成下载。磁盘缓存未命中，被迫回退到无连接池的 `HttpURLConnection` 兜底。

`interceptImage` 的 `catch (Exception e) { return null; }` 导致所有网络异常静默丢失，且 `PixivImage` 无重试机制。

## 决策

在 `LazyDetailImage` 组件中，图片必须完成 `loadImage` 预下载（Java 磁盘缓存就绪）后才能切换到 PixivImage 渲染。

### 缓存就绪渲染

组件内部新增信号和逻辑：

1. **新增 `cacheReady: Accessor<boolean>` 信号**，初始值 `false`
2. **`createEffect` 在 `shouldLoad` 为 true 时调用 `loadImage(src)`**，并使用 `.finally(() => setCacheReady(true))`
3. **新增 `canDisplayImage = createMemo(() => cacheReady() && shouldLoad())` 信号**
4. **模板中用 `canDisplayImage()` 替代 `everVisible()`** 控制 PixivImage 渲染；骨架屏（aspect-ratio placeholder）在 `canDisplayImage()` 为 false 时保持

### 预加载窗口扩大

`preloaded` 信号从 `pageIndex <= visiblePage + 1` 改为 `pageIndex <= visiblePage + 3`。

| 项目 | 改前 | 改后 |
|------|------|------|
| 预加载范围 | visiblePage + 1 | visiblePage + 3 |
| 初始并发数 | 2（第 0、1 页） | 4（第 0~3 页） |
| OkHttp 连接安全 | ✅ | ✅（默认 5/主机） |
| 快速滚动覆盖率 | 低（连续滚两页就超出） | 高 |

### 不修改 Java 端

`MainActivity.interceptImage` 的 `HttpURLConnection` 回退保留为最终兜底。在前端确保磁盘缓存就绪后再渲染的前提下，该路径在实际使用中不会被触发。

## 影响

### 正面

- 消除多图详情页向下滚动时的白框问题
- 图片显示延迟降至磁盘 I/O 级别（~1ms）
- 不增加 JSBridge 调用频次（`loadImage` 已在之前的前置提交中引入）
- 不修改 Java 端，不影响其他功能路径

### 负面

- 进入页面后前两图需等待 `loadImage` 完成才显示（约 200-500ms），但用户等待总时长与之前一致（之前等 `HttpURLConnection` 回退）
- 多预加载 2 张图片的内存开销（仅 URL string，~200 bytes）

## 回退方案

```bash
git revert <本次提交的 hash>
```

或直接回退到上一个 commit。
