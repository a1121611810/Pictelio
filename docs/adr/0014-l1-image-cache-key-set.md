# ADR-0014: L1 图片缓存从 Blob LRU 退化为已加载标记集合

## 状态

已批准（修订 [ADR-0090](ADR-0090-image-cache-three-layer.md) 的层 C 实现）

## 日期

2026-07-22

## 背景

ADR-0090 定义了图片缓存三层分离架构，其中层 C（JS 预取）的 L1 内存缓存实现为
`Map<string, CacheEntry{blob, blobUrl, lastAccess, byteSize}>`，上限 200MB。

代码审计发现该实现存在四个问题：

1. **Blob 本体零消费**：所有调用方（`loadImage`、`loadImageWithProgress`、`checkImageCache`、
   `warmCacheFromDisk`）返回的都是 `/pixiv-img/` 代理 URL，由 L2（WebView HTTP 缓存）供图。
   全项目 grep 确认 `entry.blobUrl` 和 `entry.blob` 无任何消费方。
   200MB Blob 驻留内存实际只承担"这个 URL 加载过了"的标记功能。

2. **重复写入泄漏**：`cacheSet` 未处理同 key 覆盖，`warmCacheFromDisk` 预热 50 张 +
   随后正常加载同 50 张会导致 `totalBytes` 虚增 2 倍，且旧条目的
   `URL.createObjectURL` 产生的 blob URL 永不释放（`evictOldest` 找不到它）。

3. **LRU 退化为 FIFO**：`checkImageCache` 命中时不更新 `lastAccess`，
   热图与冷图同等淘汰优先级。

4. **淘汰算法 O(n)**：`evictOldest` 线性扫描整个 Map 找最小 `lastAccess`，
   1000 条目时每次淘汰扫 1000 项。

## 决策

L1 从"缓存图片数据"退化为"记录已加载 URL 的标记集合"：

```
改动前: Map<string, CacheEntry{blob, blobUrl, lastAccess, byteSize}>  上限 200MB
改动后: Map<string, number>（key → 插入序号）                        上限 10000 条
```

### 具体变更

- 数据结构：`loadedKeys: Map<string, number>`，value 为单调递增插入序号
- 淘汰：Map 插入序即 LRU 顺序，超上限时 O(1) 删除首 key（原 O(n) 线性扫描）
- 命中刷新：`checkImageCache` / `cacheSet` 通过 `delete` + `set` 将 key 挪到最新位（修复 FIFO 退化）
- `injectCacheEntry` 签名从 `(key, blob)` 改为 `(key)`（调用方仅 `warmCacheFromDisk`）
- `base64ToBlob` 删除：native 磁盘命中不再解码 base64 进内存，只登记 key
- `warmCacheFromDisk`：从"50 张图 base64 解码进内存"改为"50 个 key 同步登记"
- `createObjectURL` / `revokeObjectURL` / `evictOldest` / `totalBytes` / `CacheEntry`：全部移除
- `blobToBase64` 保留：native 写磁盘缓存仍需 base64 编码

### 三层缓存职责重新划分

| 层 | 职责 | 改动前 | 改动后 |
|----|------|--------|--------|
| L1 JS 内存 | "已加载"标记 + 请求去重 | 标记 + 200MB Blob 驻留 | 仅标记（~1-2MB 字符串 key） |
| L2 WebView HTTP 缓存 | 位图存储与渲染供数据 | 不变 | 不变 |
| L3 Android 磁盘 | 跨进程持久化 + 冷启动预热 key | 不变 | 不变 |

### 不做的选项

- 不保留 Blob 作为 L2 兜底：WebView HTTP 缓存由系统管理，被回收时
  `<img>` 重新走代理 URL 网络请求即可，无需 L1 冗余备份
- 不引入 Service Worker：同 ADR-0090 结论（与 Capacitor 本地服务器机制冲突）

## 影响

### 正向

- L1 内存驻留从最高 200MB 降至 ~1-2MB（1 万条 URL 字符串）
- 消除同 key 重复写入的 `totalBytes` 虚增与 blob URL 泄漏
- LRU 命中刷新修复，热图不再被 FIFO 误淘汰
- 淘汰从 O(n) 降为 O(1)
- native 磁盘命中路径省掉整张图的 base64 解码内存峰值
- `warmCacheFromDisk` 从异步 50 张图解码变为同步 50 个 key 登记，启动预热开销趋近于零

### 负向

- 无（纯删减 + 语义修正，所有消费方行为不变）

### 行为不变项（验证依据）

- `loadImage` / `loadImageWithProgress` / `checkImageCache` 返回的始终是代理 URL
- `inflightRequests` 请求去重逻辑不受影响
- `clearImageCache` 语义从"清空 Blob + revoke URL"变为"清空标记集合"，
  调用方（SettingsDrawer 清除本地数据）行为不变
- 18/18 单元测试通过（含 4 个新增：LRU 刷新、重复写入去重、淘汰上限、单参签名）
