# ADR-0175: app-lynx 原生翻译缓存通道（真机文件系统路径）

- **状态**：accepted（2026-09-20，用户 review 通过）
- **日期**：2026-09-20
- **关联**：wayfinder map [#644](https://github.com/a1121611810/Pictelio/issues/644)（app-lynx 翻译收尾）/ issue [#650](https://github.com/a1121611810/Pictelio/issues/650)（决策：原生翻译缓存的存储通道与语义对齐）/ issue [#641](https://github.com/a1121611810/Pictelio/issues/641)（实现票：native 翻译缓存通道）/ ADR-0171 §D（SharedPreferences 显式 REJECTED，本 ADR 不再讨论）/ ADR-0172 §2（Lynx PrimJS 无 indexedDB，本 ADR 填 ADR-0171 留下的空缺）/ ADR-0103 §3（lynx 双 adapter 模式 = `isNativeMode() ? nativeAdapter : devAdapter`）/ ADR-0170（NativeModule 范式：单职责 + LynxMethod + 回调去 null）/ ADR-0090（三层图片缓存 = 同源码同形态先例）

---

## 背景

ADR-0171 §决策 2 把 app-lynx 翻译缓存落到 `pictelio_lynx` IndexedDB 的 `translations` object store（web Worker 标准 API）。但 app-lynx 真机的 JS 运行在 **Lynx PrimJS**，与 web-core Worker 不是同一套 API 面：

| API | web-core Worker | Lynx PrimJS（真机） |
|---|---|---|
| `indexedDB` | 有 | **undefined**（ADR-0172 §决策 2，2026-09-19 真机取证） |

后果（ADR-0172 §后果 + `translationCache.ts:139` `isTranslationCacheAvailable()` 路径）：native 模式下缓存层整体短路、warn 一次后永远 null → **每章都重新请求 LLM（重复计费）**、「已缓存」永远 false、跨重启零留存。

issue #650 复述 ADR-0171 §D 已给出的 SharedPreferences 否决理由（~1MB 配额 vs 200 章 × 50KB = 10MB 载荷；无 cursor 不适配 LRU 淘汰；两端都不走 Preferences 的一致性），明确「**SharedPreferences 不用再讨论**」并把真问题收敛为：**ADR-0171 没有为「无 IndexedDB」设计过替代路径**。本 ADR 填补该空缺。

### 真机可用通道清单（基于现有 Android 代码基线）

调研范围 = `packages/app/android/app/src/lynx/java/io/pictelio/app/*.java`（21 个 NativeModule）+ `packages/app-lynx/src/utils/*`（约 60 个 util），以及所有 `app/src/{main,webview,test,testFull}/java/io/pictelio/app/*.java`：

| 通道 | 现有先例 | 配额 / 形态 | 与本 ADR 适配度 |
|---|---|---|---|
| **Filesystem `cacheDir`/`filesDir`** | `ImageCachePlugin` (webview, line 51-56) / `PixivImageLoader` (main, line 123-124) / `UgoiraStreamEngine` / `PictelioApiModule:149,206` (lynx) / `PictelioImageService.UGOIRA_CACHE_DIR` (lynx) / `NovelExporter` / `GallerySaver` | 内部存储配额宽松（≥ 数十 MB），每项独立文件、LRU 由 manifest/list 排序 | **✅ 强匹配**（已 5+ 模块在用；LRU manifest 形态已被 ImageCachePlugin 验证） |
| SharedPreferences / Capacitor Preferences | `PictelioPrefsModule` (lynx) / `PictelioAppModule` / `PictelioTranslateModule` 探测段 | ~1MB 默认配额（弱保证），同步 KV API | ❌ ADR-0171 §D 已 REJECTED（10MB 载荷超配额 + 无 cursor） |
| Keystore-stored SharedPreferences | `PictelioSecureStorageModule` / `SecureStorageCompat` | 同上 + 加密层 | ❌ ADR-0171 §D 已 REJECTED（介质仍 SharedPreferences，配额同样受限） |
| SQLite (`SQLiteOpenHelper` / Room) | **零先例**（grep `SQLiteOpenHelper` / `android.database.sqlite` / `extends SQLite` 在整个 `packages/app/android` 范围内零命中） | ~3-4 文件新增 + Room 依赖 = ~1MB APK | ❌ 新增依赖 + 零先例 + 迁移负担 |

**结论**：文件系统是唯一既符合 ADR-0171 六边界（键构造、淘汰、并发、失效、metadata、清除 endpoint 后的策略）、又与现有代码基线一致的通道；不引入新依赖、不开新模式。

### webview 端 `translationCache.ts` 的角色

`packages/app/src/translationCache.ts` 是 in-memory LRU + localStorage 双层（容量 200 章），与本 ADR 无关（ADR-0171 §背景已说明「完全从零、不复用 webview」）；本 ADR 只决定 app-lynx 原生侧的物理介质，不动 webview 端任何代码。

---

## 决策

### D1. 通道选型 = **Java 侧文件系统**

**D1.1 选 = A（plain filesystem：每条目独立文件 + 独立 manifest 索引）**，不选 B（单 JSON 文件）、不选 C（SQLite）。

**对照（按 ADR-0171 §决策的六边界 + ADR-0172 §后果的硬约束）**：

| 维度 | A 独立文件 + manifest | B 单 JSON 文件 | C SQLite |
|---|---|---|---|
| 10MB 容量（200 章 × ~50KB） | ✅ 文件系统配额宽松 | ⚠ 单文件 10MB 全量写 | ✅ SQLite 默认上限 ≥ 数 GB |
| LRU 遍历（cursor 或等效） | ✅ manifest sort（~20KB / 200 条目，O(N log N)） | ❌ 全文件加载 + 重写 | ✅ cursor / index |
| 写原子性 | ✅ 单文件 = 单 write（POSIX rename 原子） | ❌ 全文件重写 + temp+rename 兜底 | ✅ transaction |
| 启动空读 | ✅ manifest 单读（~20KB） | ⚠ 启动即读全 10MB 反序列化 | ✅ schema probing |
| APK 增量 | **0 KB**（仅 `java.io.File` 标准库） | 0 KB | **+ ~1 MB**（androidx.room / sqlite-android） |
| 新增文件数 | ~3 个 Java（`PictelioTranslationCacheModule` + manifest helper + entry codec）+ ~2 个 TS（adapter 包装 + bridge 暴露） | 同左（codec 略简） | ~5-7 个 Java（Helper / DAO / Entity / Migration）+ adapter |
| 测试表面 | File IO + manifest sort（JVM 单测 + 真机 E2E 双向） | 同左（额外 10MB 整文件 IO 路径） | DB lifecycle / migration / cursor 协议 |
| 与 ADR-0171 baseline 偏离 | 仅介质变（schema、键、LRU 200、半成品策略全部沿用） | 同左 | 同左 + 引入新范式 |

**为什么 A 优于 B**：B 每次写入都是「加载 10MB JSON → 修改 → 序列化全量 → temp + rename」，单章 put 的代价 O(全文大小)；A 每次写入仅一个 50KB 文件 + 一份 ~20KB manifest 的局部重写。A 把"改一处"局限在"写两个文件"，B 把"改一处"放大成"重写全集"。

**为什么 A 优于 C**：C 是新依赖（~1MB APK）+ 零先例（grep 全 `packages/app/android` 范围零 `SQLiteOpenHelper` 使用）+ 迁移负担（version 管理）+ 实现期 template 码量翻倍。10MB 容量 + 200 章 LRU 这种轻量场景**完全不需要关系型能力**（无 cross-table query、无 join、无 index-heavy 过滤——ADR-0171 §2 schema 明确不建 secondary index）。

### D2. 存储路径 / 文件名 / manifest 格式

**D2.1 路径**：`context.getCacheDir() + "/translations/"`。

- 与现有命名习惯对齐：`PictelioImageService.UGOIRA_CACHE_DIR = "ugoira"`（line 336）、`PixivImageLoader.CACHE_DIR_NAME`（main 目录）、`NovelExporter.EXPORT_DIR`。子目录命名用复数功能名 = ADR-0090 同形态。
- 选 `cacheDir` 而非 `filesDir`：翻译缓存可由系统回收（与 ugoira 帧、image cache 同等级别——`cacheDir` 即"可重建"语义；用户主动「清除翻译缓存」入口另用 `filesDir` 不可，破坏幂等 = `cacheDir` 即可）。

**D2.2 条目文件命名**：`Base64URL-safe no-padding(key)`（参考 `ImageCachePlugin.keyToFilename` line 60-62 同款算法）：

- `translationCacheKey` 含 6 个 `:` 分隔字段（`12345:1:zh-CN:gpt-5:a1b2c3d4:e5f6g7h8`），文件名不允许 `:` 等不安全字符；
- Base64URL-safe + no-padding + no-wrap 与 webview 端 image cache 完全同形态，未来如抽公用工具可零成本迁移。

**D2.3 条目文件格式**：JSON 序列化 `TranslationCacheEntry`（schema 沿用 ADR-0171 §2，零字段变动）：

```json
{
  "key": "12345:1:zh-CN:gpt-5:a1b2c3d4:e5f6g7h8",
  "novelId": 12345,
  "chapterId": "1",
  "targetLang": "zh-CN",
  "modelId": "gpt-5",
  "baseURLHash": "e5f6g7h8",
  "sourceHash": "a1b2c3d4",
  "paragraphs": ["译 1", "译 2", "..."],
  "createdAt": 1726812345678,
  "providerId": "openai-responses"
}
```

**D2.4 manifest 格式**（独立文件 `manifest.json`，与条目文件同目录）：

```json
{
  "version": 1,
  "lruCapacity": 200,
  "entries": [
    { "key": "...", "createdAt": 1726812345678, "size": 51200 },
    ...
  ]
}
```

- `entries` 按 `createdAt` 升序排列（写入时强制重排，简单可靠，200 条目 sort < 1ms）；
- `size` = 文件字节数（用于将来按容量配额回收；本 ADR 不实现容量回收，仅按条目数 LRU）；
- manifest 损坏 / 缺失时 `loadManifest()` 视为空集 → 启动后首次 `cache.write()` 重写整个 manifest（自愈）；不依赖外部 schema migration。

**D2.5 写入原子性**：单文件 write 用 temp + rename 模式（POSIX 保证 atomic）：

1. 写 `<key>.json.tmp`；
2. `fsync` 落盘；
3. `rename(tmp, final)`；
4. manifest 更新另起独立事务（先重排 entries 数组、序列化、写 tmp + rename）。

### D3. LRU 遍历机制（manifest sort + 文件删除）

**D3.1 算法**：

- **读命中**：先 read `manifest.json` → 找 `key` → 命中则 `readFile(<key>.json)`；未命中直接返回 null。
- **写条目 + 淘汰（每次 `cache.write` 后）**：
  1. 写新条目文件（temp + rename）；
  2. 读 manifest（缺失/损坏视为空）；
  3. upsert `entries` 中 `key`（同 key 重写：替换 `createdAt` 为 now）；
  5. 按 `createdAt` 升序重排；
  6. 若 `entries.length > 200`，裁剪头部（最早的）→ 对应文件 `delete()`（失败 warn、不抛错）；
  7. 写 manifest（temp + rename）。
- **LRU 命中后更新 `createdAt`**（真 LRU 语义）：读命中时把 manifest 中对应条目 `createdAt` 置为 `now` 并触发一次 manifest 写——但**仅当**该 key 在「即将淘汰区」（rank ≤ 205）才同步写；否则延迟到下一次 `cache.write` 一并重排（避免频繁 manifest IO）。

**D3.2 与 ADR-0171 §3 的 parity**：容量 200（与 webview 端同基线起步）、淘汰粒度 = 条目级（不区分 model/novel）、淘汰触发 = 每次 write 后——完全沿用 ADR-0171 §3。

**D3.3 与 `translationCache.ts:311-342` `evictOldestEntries` 的语义对齐**：本 ADR 淘汰机制本质是同一算法的 filesystem 适配——cursor 在 IndexedDB 等价于 manifest.sort() + files.listFiles()，后续 implement 阶段直接照抄 ADR-0171 §3 的语义边界。

### D4. 跨引擎 seam：`isNativeMode() ? nativeFsAdapter : idbKVAdapter`

**D4.1 seam 形态**：沿用 ADR-0103 §3 双 adapter 模式（`settingsStore.ts:212` 已落地同形态）：

```ts
// packages/app-lynx/src/utils/translationCache.ts（ADR-0171 已实现）
// 新增 nativeFsAdapter 替代当前的 isIdbAvailable() === false 短路：

function getCacheAdapter(): TranslationCacheAdapter {
  return isNativeMode() ? nativeFsAdapter() : idbKVAdapter()
}
```

- `nativeFsAdapter()`：`NativeModules.PictelioTranslationCache` 的薄包装（callbacks → Promise，去 null 同 ADR-0170 §D4 契约）；
- `idbKVAdapter()`：现有 `idbKV.ts` + `STORE_TRANSLATIONS`（ADR-0171 §2 已实现）。
- **公开 API 不变**：`getTranslation(key)` / `setTranslation(key, value, metadata)` / `removeTranslation(key)` / `clearTranslationCache()` / `isTranslationCacheAvailable()` ——调用方零改动。

**D4.2 双 adapter 测试契约**（ADR-0103 §6 模式）：

- 字面量契约：键格式 `buildTranslationCacheKey(k)`（6 元组冒号拼接，ADR-0171 §1）+ manifest `version: 1` + LRU 200 + 半成品不写；
- 单测：`nativeFsAdapter` JVM 单测（Robolectric + mock `Context.getCacheDir()` → 注入 tmp 目录）+ `idbKVAdapter` 已有 happy-dom 单测；
- 契约 E2E：参考 `client-kind-contract` 模式，扩展「web 命中 → 切引擎 → lynx 命中」（真机 / 模拟器双向）。

**D4.3 graceful degradation**（ADR-0172 §2 原则：禁静默挂起，禁静默降级）：

- `nativeFsAdapter` 不可用（`NativeModules.PictelioTranslationCache === undefined` 或 `prefsGet` 返回 null → 通道未注册）→ warn 一次 + 缓存层整体返回 null（每章重译，与 ADR-0172 现状一致）；
- `idbKVAdapter` 不可用（web-core IndexedDB 未注入）→ 同上 warn；
- 两个 adapter 都不可用（仅理论场景：`isNativeMode() === true` 但 native 通道未注册且 web-core fallback 关闭）→ `isTranslationCacheAvailable()` 返回 false + warn（禁静默）。

### D5. 缓存写读 parity（半成品不写 + LRU 200）

**D5.1 半成品策略沿用 ADR-0171 §5**：`translating` / `translating_queued` / `partial` / `failed` / `aborted` 永不调用 `setTranslation()`；`completed` 是唯一写时机。caller 守门（spec §5 不变量 #3 + §7.2 转移表）——本 ADR 不改 caller 约束。

**D5.2 容量 200 沿用 ADR-0171 §3**：manifest `lruCapacity: 200` 字段是契约字面量，implement 期不允许悄悄改。

**D5.3 LRU 触发时机 parity**：每次 `setTranslation()` 后立即触发淘汰（不是读命中后触发），与 ADR-0171 `setTranslation:270-272` 的 `if (count >= LRU_CAPACITY) evictOldestEntries(...)` 路径一致。

**D5.4 元数据沿用 ADR-0171 §7**：`createdAt` / `providerId` / `modelId` 字段全部保留；`providerId` 不一致视为 miss + warn（与 `translationCache.ts:186-193` 同形态）。

**D5.5 用户清除 endpoint 后缓存策略沿用 ADR-0171 §8**：缓存条目不依赖 API key 可用性；切回旧 endpoint → baseURLHash 一致 → 仍命中；用户主动「清除翻译缓存」入口调 `clearTranslationCache()` 清整个目录 + manifest。

---

## 后果

### 正面

- **真机缓存命中恢复**：`isNativeMode() === true` 路径下，nativeFsAdapter 接管 → 缓存命中 → 用户切回旧章节秒出译文、零 LLM 调用、零计费、跨重启留存；
- **零 APK 增量**：纯 `java.io.File` 标准库实现，不引入 androidx.room / sqlite-android / 新依赖；
- **代码体量最小**：约 3 个新 Java 文件（`PictelioTranslationCacheModule.java` + `TranslationCacheEntryCodec.java` + `TranslationManifestCodec.java`）+ 2 个 TS 包装（约 250 行新 Java + 80 行新 TS），与 ADR-0170 单 NativeModule 范式同规模；
- **测试表面最小**：File IO + manifest sort（JVM 单测覆盖 happy-path + 损坏恢复 + LRU 边界），不涉及 SQLite transaction / migration；
- **跨端字面量对齐**：缓存键、LRU 200、半成品策略、providerId 校验全部沿用 ADR-0171 §1/§3/§5/§7，与 web-core 路径**字段级一致**（区别仅 ops diff：filesystem write vs IndexedDB put）；
- **优雅降级**：native / idb 两 adapter 都不可用时 warn 一次 + 缓存层返回 null（与 ADR-0172 §2 现状一致），不静默挂起、不静默用旧值。

### 负面 / 成本

- **新增 NativeModule**：`PictelioTranslationCache` 必须在 `LynxActivity.java:199-204` 注册（位置紧跟 `PictelioTranslateModule` / `PictelioPrefsModule` 后）。**新增约 5 个 Java 文件**（含 Codec / Manifest / 单测）。
- **adapter 替换 change**：现有 `translationCache.ts:139-154` `isIdbAvailable()` 短路逻辑必须删除、改为 `getCacheAdapter()` 三态判断（native / idb / unavailable）——这是**先于原文件的实质修改**，影响 ADR-0172 §2 已 warn 的路径，需在 implement 阶段同步修 ADR-0172 §后果段（ADR-0172 §2 原文：「native 通道待后续 ticket」即指本 ADR）。
- **manifest 损坏自愈代价**：manifest 缺失/损坏时 `loadManifest()` 视为空集 → 用户首次写入会触发整目录扫描 + manifest 重写（200 文件 listFiles ≈ 10ms，可接受）；但用户感知是「跨重启后命中率临时变低」，首章 put 后即恢复。
- **非加密存储**：译文段落明文落 `cacheDir`（含 R18 / R18G 章节译文）；`cacheDir` 是应用私有目录（其它 app 无权读取），但 root 设备 / ADB backup 可读。**与 ADR-0171 IndexedDB 形态同风险等级**——原文明文持久化已是 ADR-0171 默认行为，本 ADR 不引入新风险面。如未来需加固可迁移到 `EncryptedFile`（androidx.security），**本 ADR 不预留**。
- **LRU 读命中后更新 `createdAt` 的延迟写**（D3.1 末段）会引入 ~5 条目窗口的非严格 LRU（旧条目可能多存活到下次写）——可接受（webview 端 in-memory LRU 同样非严格）。

### 跨端 parity 陈述

| 边界 | web-core（ADR-0171 IndexedDB） | app-lynx 原生（本 ADR filesystem） |
|---|---|---|
| 缓存键 | `buildTranslationCacheKey(k)` 6 元组冒号拼接 | **同左** |
| LRU 容量 | 200 | **同左** |
| 半成品策略 | `done` 之前永不写 | **同左** |
| providerId 校验 | 不一致视为 miss + warn | **同左** |
| 用户清 endpoint | 不自动清缓存（baseURLHash 自洽） | **同左** |
| 用户主动清缓存 | `clearTranslationCache()` 清整个 store | `clearTranslationCache()` 清整个目录 + manifest |
| 介质 | IndexedDB `translations` store | filesystem `cacheDir/translations/` |
| adapter | `idbKVAdapter()`（ADR-0103 §3 devPrefs 等位） | `nativeFsAdapter()`（本 ADR 新增，与 ADR-0103 §3 nativePrefs 等位） |
| 退化 | `idbKVAdapter` 不可用 → warn + 短路 | `nativeFsAdapter` 不可用 → warn + 短路 |

**结论**：跨端字面量契约**完全一致**，物理介质与 adapter 实现不同——符合 ADR-0103 §3「双端实现 + 契约测试」先例。

---

## Alternatives Considered

### A) IndexedDB（ADR-0171 §决策 2 原方案，真机不可用）

**拒**：Lynx PrimJS 真机 `typeof indexedDB === 'undefined'`（ADR-0172 §决策 2 + `translationCache.ts:144` 实证）。仅 web-core 预览可用——native 通道依然零命中。

### B) SharedPreferences / Capacitor Preferences（ADR-0171 §D 已 REJECTED，本 ADR 不重开）

**拒**（理由原文照搬）：
- 配额 ~1MB vs 200 章 × 50KB = 10MB 载荷；
- API 形态同步 KV，无 cursor → 不适配 LRU 遍历淘汰；
- webview 端项目也不存 Preferences（走 localStorage + in-memory LRU），保持**两端都不走 Preferences**的一致性；
- 与现有 `idbKV.ts` 封装不冲突，但反过来也不必要。

issue #650 已明确「**SharedPreferences 不用再讨论**」——除非显式推翻 ADR-0171，那是新 ADR 不是新选项。

### C) SecureStorageCompat / Keystore 复用（ADR-0171 §D 已 REJECTED）

**拒**：介质仍是 SharedPreferences，配额同样受限；Keystore 加密层对 200 章 × 50KB 明文（小说译文）的边际价值 < 写放大代价（每次写入都要走 Keystore crypto engine）。`PictelioSecureStorageModule` 当前只承载 tokens / API key 等凭据类小数据。

### D) SQLite via `SQLiteOpenHelper` / Room

**拒**：
- 整个 `packages/app/android` 范围零先例（grep `SQLiteOpenHelper` / `android.database.sqlite` / `extends SQLite` 零命中）——引入新模式需承担教学 + 维护成本；
- APK 增量 ~1MB（androidx.room / sqlite-android），与「零新增依赖」目标不符；
- 迁移负担：DB version 管理 + onUpgrade 路径 + 多 flavor（lynx / webview）共享源集考量；
- 10MB 容量 + 200 章 LRU + 无 cross-table query 的场景**完全不需要关系型能力**——ADR-0171 §2 schema 明确不建 secondary index（仅 `key` 主键 + 全表遍历 LRU）。

### E) 单 JSON 文件（cacheDir/translations.json 单文件全量）

**拒**：
- 每次写入 = 加载 10MB JSON → 修改 → 序列化全量 → temp + rename（O(全文大小)），单章 put 代价放大到全文；
- 启动空读 = 全文件反序列化 10MB，UI 首屏延迟；
- 写失败原子性难保证（用户切章节时 100ms 内并发写入 → temp 文件名冲突需 UUID）；
- 与 ImageCachePlugin / PixivImageLoader 已验证的「独立文件 + 排序 list」先例背离。

### F) Room / SQLite with WAL 模式 + 索引（超规格）

**拒**：过度工程。当前场景 200 条目 LRU 是 O(N) 算法可接受范围（manifest sort 1ms 内），无高频读单条 / 无 range query / 无 join；Room WAL 的优势对 200 条目规模不可观测。**避免提前优化**——若将来扩到 5000+ 条目再考虑（本 ADR 不预留）。

---

## References

### 上游决策与实现

- **ADR-0171 §决策 2**（IndexedDB schema + `translations` object store；本 ADR 沿用其 schema 与 key 构造）
- **ADR-0171 §决策 3**（LRU 200 + cursor 淘汰；本 ADR 沿用容量 + 把 cursor 适配为 manifest sort）
- **ADR-0171 §决策 5**（半成品策略 = `done` 之前永不写；本 ADR 沿用）
- **ADR-0171 §决策 7**（metadata 字段 = `createdAt` / `providerId` / `modelId`；本 ADR 沿用）
- **ADR-0171 §决策 8**（用户清除 endpoint 不自动清缓存；本 ADR 沿用）
- **ADR-0171 §D Alternatives**（SharedPreferences 否决理由原文；本 ADR §Alternatives B 直接照搬）
- **ADR-0172 §决策 2**（PrimJS 无 indexedDB + native 模式下缓存层整体短路 + warn 一次；本 ADR 替换其「native 通道待后续 ticket」挂账）
- **ADR-0172 §后果**（native 模式下翻译缓存不生效 → 每章重译；本 ADR 实施后该段需修订）
- **ADR-0103 §3**（lynx 双 adapter 模式 = `isNativeMode() ? nativePrefs() : devPrefs()`；本 ADR `getCacheAdapter()` 沿用同形态）
- **ADR-0103 §6**（契约测试兜底：双端字面量契约 + JVM 单测 + 真实样例 oracle；本 ADR §D4.2 沿用）
- **ADR-0170 §D1**（NativeModule 范式 = 单职责 + `LynxModule` + `LynxMethod` + 回调去 null；本 ADR `PictelioTranslationCacheModule` 沿用同款）

### 既有代码先例（直接对标的现有实现）

- **`packages/app/android/app/src/webview/java/io/pictelio/app/ImageCachePlugin.java:51-56`**（`getCacheDir()` + 子目录创建模式；本 ADR §D2.1 沿用）
- **`packages/app/android/app/src/webview/java/io/pictelio/app/ImageCachePlugin.java:60-67`**（`keyToFilename` = Base64URL-safe no-padding；本 ADR §D2.2 沿用同算法）
- **`packages/app/android/app/src/webview/java/io/pictelio/app/ImageCachePlugin.java:135-190`**（总大小配额 + 按 lastModified 排序淘汰；本 ADR §D3 的 manifest sort 是其 filesystem 化适配）
- **`packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioImageService.java:336`**（`UGOIRA_CACHE_DIR = "ugoira"` 子目录命名；本 ADR §D2.1 `translations/` 同形态）
- **`packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioApiModule.java:149,206`**（lynx 侧 `cacheDir` 子目录写盘先例）
- **`packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioPrefsModule.java:33-98`**（LynxModule 范式 + 回调去 null + 静态核心可 JVM 测；本 ADR NativeModule 沿用同形态）
- **`packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioTranslateModule.java`**（流式 NativeModule 范式参考；本 ADR 一次性回调，无流式部分）
- **`packages/app-lynx/src/utils/translationCache.ts:139-154`**（现有 `isTranslationCacheAvailable()` 短路 + warn；本 ADR §D4 替换为 `getCacheAdapter()`）
- **`packages/app-lynx/src/utils/translationCache.ts:311-342`**（现有 `evictOldestEntries` cursor 算法；本 ADR §D3 是其 filesystem 适配）
- **`packages/app-lynx/src/stores/settingsStore.ts:139-212`**（`nativePrefs()` + `devPrefs()` + `isNativeMode() ? nativePrefs() : devPrefs()` seam 范式；本 ADR §D4 沿用）
- **`packages/app-lynx/src/utils/idbKV.ts:22-39`**（web-core IndexedDB `openDb()` + `onblocked` 显式 reject；本 ADR §D4 `idbKVAdapter` 包装沿用）

### Issue tracker

- **issue #650**（决策：原生翻译缓存的存储通道与语义对齐；2026-09-20 重新收口，明确「SharedPreferences 不用再讨论」并把真问题收敛为「ADR-0171 没为『无 IndexedDB』设计替代路径」）
- **issue #641**（实现票：native 翻译缓存通道；本 ADR 决策定案后该票改可开工）
- **wayfinder map #644**（app-lynx 翻译收尾；本 ADR 填 #650/#641 决策空缺，#644 Not yet specified 段「ADR-0171/0172 是否修订」同步收敛）