# Ticket Plan — app-lynx 原生翻译缓存通道（wayfinder #641）

**Part of:** wayfinder map #644（app-lynx 小说翻译收尾遗留项收敛）
**Source ticket:** issue #641（无标签 root ticket；被 #650 决策阻塞 → 现已解锁）
**ADR anchors:** [ADR-0175](https://github.com/a1121611810/Pictelio/blob/main/docs/adr/ADR-0175-app-lynx-native-translation-cache-channel.md)（filesystem cache 通道决策）+ [ADR-0171](../docs/adr/ADR-0171-translation-cache-strategy.md) §D（SharedPreferences 否决理由）+ [ADR-0172](../docs/adr/ADR-0172-lynx-primjs-runtime-api-surface.md) §2（PrimJS 无 indexedDB 实证）
**Spec sections:** §4.5（缓存键）/ §9.5（用户清除 endpoint 后缓存策略）/ §14 N4（持久化）
**Base line:** HEAD `03ed8610`（fix branch；含 5 张 ADR + spec 同步）

## Target end state

app-lynx 原生模式下，翻译缓存走 filesystem cacheDir（每章一个文件，LRU manifest 同 `ImageCachePlugin`），不再短路返回 null：
- 缓存命中秒出（不重发 LLM 请求）
- 跨重启保留（用户重启 App 后已译章节仍命中）
- `isNativeMode()` 双 adapter 模式下，lynx adapter 走 filesystem，dev adapter 走 IndexedDB（保持 dev 体验）

## 范围

**In:**
- `packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioTranslateCacheModule.java`（**新**）—— Lynx NativeModule 提供 `getTranslation(key)` / `setTranslation(key, paragraphs)` / `deleteTranslation(key)` / `clearAll()` / `getCacheStats()`
- `packages/app-lynx/src/utils/translationCache.ts` —— 改造为 filesystem-backed adapter（已有 IndexedDB fallback，加 `isNativeMode()` 分流）
- `packages/app-lynx/src/api/nativeTranslate.ts` —— `nativeTranslateModule()` 双通道探测扩展支持 cache module
- LRU manifest（`cache-manifest.json`）+ 容量管理（默认 200 章 / 10MB）
- Vitest：filesystem adapter 单测（mock fs）
- Robolectric：NativeModule 单测（CRC 校验、并发安全）

**Out:**
- webview 端 `translationCache.ts`（spec §2 out of scope #1）
- 抽 `@pictelio/novel-translate` 共享包（如需共享另开新 map）
- Provider preset UI / 多 endpoint 切换（spec §1 OOS）

## 前置依赖

- ✅ #650 决策已解锁（ADR-0175 已选 filesystem cacheDir）
- ⚠️ #647 决策**部分相关**（Java NativeModule 测试机制 = ADR-0174 路径，本 ticket 复用同一 `TestLynxContext` 模板）
- ⚠️ 等待 ADR-0175 用户 review → 拍板后开工

## Tickets

### T1 — Java NativeModule `PictelioTranslateCacheModule`

- **位置**：`packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioTranslateCacheModule.java`
- **公共面**：
  - `@LynxMethod public void getCacheDir(String cb)` —— 暴露 `cacheDir` 绝对路径（调试用）
  - `@LynxMethod public void getItem(String key, Callback cb)` —— `cb(paragraphsJson, "")` 或 `cb("", "ENOENT")`
  - `@LynxMethod public void setItem(String key, String paragraphsJson, Callback cb)` —— 写文件 + 更新 manifest
  - `@LynxMethod public void deleteItem(String key, Callback cb)`
  - `@LynxMethod public void clear(Callback cb)` —— 清空目录
  - `@LynxMethod public void stats(Callback cb)` —— `{entryCount, totalBytes, hitRate}`
- **存储布局**：
  - 根目录：`context.getCacheDir() + "/pictelio_translate_cache/"`
  - 每条记录：`<keySha256>.json`（key 已 sha256 化避免文件系统非法字符）
  - LRU manifest：`manifest.json`（数组，按 `lastAccessedAt` 排序）
- **LRU 策略**：写入时检查 totalBytes；超 10MB 时淘汰最旧（按 manifest 头部）
- **线程安全**：`ConcurrentHashMap<String, FileLock>` per-entry；写操作走单线程 Executor 串行化（避免 manifest 并发写坏）
- **errorCode 映射**：
  - 文件被并发删除 → `cb("", "ENOENT")`（与 `getItem` 未命中一致）
  - 磁盘满 → `cb("", "ENOSPC")` → JS 侧 → `cache_write_failed` UI
  - 其他 IOException → `cb("", e.getClass().getSimpleName())`

### T2 — JS adapter 改造

- **位置**：`packages/app-lynx/src/utils/translationCache.ts`
- **新增 `isNativeMode()` 探测**（与 ADR-0103 §3 双 adapter 模式一致）
- **filesystem adapter**（`filesystemTranslationCache.ts`，**新**）：
  - 暴露与现有 IndexedDB adapter 同接口（`getTranslation` / `setTranslation` / `clearCache` / `isTranslationCacheAvailable`）
  - 走 `nativeTranslateCacheModule()`（双通道探测）调用 NativeModule
  - JSON 序列化对齐 spec §4.5 缓存键六元组
- **降级策略**：
  - 真机无 NativeModule → 现有 IndexedDB 短路返回 null 路径
  - 真机有 NativeModule 但 Native 报错 → console.warn + fallback IndexedDB（如可用）
- **key 编码**：
  - JS 侧 `key = novelId:chapterId:targetLang:modelId:sourceHash:baseURLHash`
  - Java 侧 `keySha256 = sha256(key)` → 文件名 `<keySha256>.json`

### T3 — LRU manifest 容量管理

- 写入时 `totalBytes + newFileSize > 10MB` → 淘汰最旧
- manifest 写入走 Java 串行 Executor（与文件写串行化）
- manifest 损坏 → 重建（删除所有 entries，按 mtime 重建）
- 启动时 `cleanupOrphanFiles()`：manifest 没有但目录里有的文件 → 删除

### T4 — 单测

#### 4.1 Vitest（filesystem adapter JS 侧）
- mock `nativeTranslateCacheModule` 返回 fixture store
- 测：基本 get/set/delete/clear；容量超限淘汰；ENOSPC 降级；并发写竞态（race condition 用 Promise.all 触发）

#### 4.2 Robolectric（NativeModule Java 侧）
- `PictelioTranslateCacheModuleTest.java`（**新**）：
  - `setItem_thenGetItem_returnsSame`：写 → 读 → 等值
  - `deleteItem_thenGetItem_returnsEnoent`
  - `clear_emptiesDirectory`
  - `overCapacity_evictsLru`
  - `concurrentWrites_noCorruption`：50 个并发 setItem → manifest JSON 合法 + 文件数 = 50
  - `orphanFilesCleanedOnStartup`
  - `keySha256_usedAsFilename`：验证文件名格式（spec §4.5 缓存键六元组 hash 化）

#### 4.3 变异实验
- 删 LRU 淘汰 → overCapacity 测试变红
- 改 manifest 写并发为非串行 → concurrentWrites 测试变红

## CI 门禁（合并前置）

- `pnpm test:app-lynx --run`（含 4.1）
- `./gradlew :app:testFullDebugUnitTest --tests "*PictelioTranslateCacheModuleTest"`（含 4.2）
- `./gradlew :app:testFullDebugUnitTest` 全量绿
- pre-push hook：自动跑 app-lynx 单测（已配置）

## 验收（设备实测）

- 真机填 endpoint + 翻 5 章 → 重启 App → 切回第 1 章 → 缓存命中秒出
- 翻 250 章 → 第 250 章写时前 50 章被淘汰（manifest 头部）
- 模拟器断网 → 翻第 1 章 → 命中缓存（不报错）
- 截图存档 `docs/verification/app-lynx-translation-emulator.md`

## Out of scope

- webview 端 `translationCache.ts`（spec OOS）
- SQLite / Room 替代方案（ADR-0175 §决策已 REJECTED）
- 跨设备同步（无此需求）

## References

- ADR-0175 D1（filesystem cacheDir 选择）+ D2（key 编码）+ D3（LRU 形态同 ImageCachePlugin）+ D4（容量管理）
- ADR-0171 §D（SharedPreferences REJECTED 理由）
- ADR-0172 §2（PrimJS 无 indexedDB 实证）
- spec §4.5 + §9.5 + §14 N4
- 实施 ticket issue #641
- 姊妹 ticket：`2026-09-20-app-lynx-robolectric-coverage.md`（共享测试基础设施）