# ADR-0171: app-lynx 翻译缓存策略

- **状态**：accepted（2026-09-19）
- **日期**：2026-09-19
- **关联**：wayfinder map #617（app-lynx 端小说翻译）/ spec #618 §4.5 §9.5 §9.6 §9.8 §9.9 §9.10 / ADR-0050（lynx 持久化 + IndexedDB）/ ADR-0051（lynx 双通道）/ ADR-0103（跨引擎设置键）/ ADR-0167（lynx novel intro 三段式——ADR 模板）/ ADR-0169（待办：Responses API 请求构造）/ ADR-0170（待办：chunked pipeline 与重试）

---

## 背景

app-lynx 客户端目前没有小说翻译功能（spec #618 §1）；wayfinder map #617 Q7 决定缓存粒度 = `novel id + chapter id`、Q17 决定 LLM endpoint 完全用户自填；spec §4.5 已给出 `TranslationCacheKey` 6 元组契约（`novelId | chapterId | targetLang | modelId | sourceHash | baseURLHash`）。本 ADR 在不与 webview 端 `translationCache.ts` 共享代码（map Q3 完全从零）的前提下，把缓存层落到 app-lynx 现有 IndexedDB KV 封装（`packages/app-lynx/src/utils/idbKV.ts`，ADR-0050/0051）的 object store 上，并定义**键构造、淘汰、并发、失效、metadata、用户清除 endpoint 后的策略**六个边界。

### 为什么不复用 webview 端 `translationCache.ts`

map #617 Q3 已收敛：**完全从零**——连 prompt 模板、chunked pipeline 算法、缓存策略、store、UI 全部新建。`packages/app/src/translationCache.ts`（webview 端）形态是 in-memory LRU + localStorage 双层（容量 200 章），与 app-lynx 端的持久化介质（IndexedDB Worker 环境 + Native bridge KV）**不兼容**——硬搬运会强制在两条无关架构上嫁接抽象。具体拒绝理由（与 map Q3 一致）：

1. **介质不同**：webview 端走 localStorage + in-memory LRU；app-lynx 端 lynx-bg Worker 无 localStorage，全部 IndexedDB。
2. **键构造边界不同**：webview 端的 key 不含 `sourceHash`（依赖用户在原章节进入时缓存整章，不防作者改文）；app-lynx 端 spec §4.5 显式要求 `sourceHash`（作者改文自动 miss，避免脏数据）。
3. **元数据字段不同**：webview 端不持久化 `provider` / `model`；app-lynx 端 model 可自由切换（Q17 用户自填 model），需可追溯「此条目是哪个 model 产物」，否则用户切回旧 model 时无法判断缓存可不可信。
4. **抽象边界不重叠**：webview 端 cache 与 `createNovelTranslator` 强耦合（DeepSeek prompt、batch pipeline 等），搬运会连 prompt 一起搬——违反 Q3。

可参考的抽象边界（搬运思路，但**不搬运实现**）：webview 端是「键 → 段落译文数组」单层 + in-memory LRU 200；app-lynx 端改造成「键 → {paragraphs, metadata} + IndexedDB LRU 200」。

---

## 决策

### 1. 缓存键（继承 spec §4.5）

`TranslationCacheKey` 6 元组：

```ts
interface TranslationCacheKey {
  novelId: number;          // Pixiv novel ID
  chapterId: string;        // 系列内章节 ID；单本 = novelId
  targetLang: string;       // BCP-47（默认 "zh-CN"）
  modelId: string;          // 用户自填 model（gpt-5 / deepseek-v4-pro 等）
  sourceHash: string;       // FNV-1a 32-bit hex（join(paragraphs) 后的内容指纹）
  baseURLHash: string;      // FNV-1a 32-bit hex（baseURL 指纹；切 endpoint 自动 miss）
}
```

**键 → 字符串**：`buildTranslationCacheKey(k)` 拼接为 `<novelId>:<chapterId>:<targetLang>:<modelId>:<sourceHash>:<baseURLHash>`（冒号分隔，collision 风险为零——每字段在各自空间内稳定唯一）。**不**再做一次哈希压缩 key，因为 key 已是可读字符串；object store 的 key 直接用此字符串，**object store `keyPath` 不设置**（外部显式传 key）。

### 2. IndexedDB schema：复用 `pictelio_lynx` DB + 新增 `translations` object store

复用现有 `pictelio_lynx` 数据库（避免在设备上新建多个 DB、避免升级跨 DB 的复杂性——ADR-0050 已用此 DB 存 `tokens` / `kv` store），新增 object store `translations`：

```ts
// 升级到 DB_VERSION = 3（当前 idbKV.ts 是 2）
const DB_NAME = "pictelio_lynx";
const DB_VERSION = 3;
const STORE_TRANSLATIONS = "translations";
const STORE_KV = "kv";   // 现有

interface TranslationCacheEntry {
  key: string;                // buildTranslationCacheKey() 输出
  novelId: number;
  chapterId: string;
  targetLang: string;
  modelId: string;
  baseURLHash: string;
  sourceHash: string;
  paragraphs: string[];       // 长度必须 = request.paragraphs.length
  createdAt: number;          // 写入毫秒时间戳
  providerId: string;         // 'openai-responses'
}
```

**version 升级路径**（在 `idbKV.ts` 的 `openDb()` 内统一管理）：
- v2（现有）→ v3：`onupgradeneeded` 中 if (!req.result.objectStoreNames.contains('translations')) createObjectStore('translations')
- 不为 `translations` store 建任何 index——键已是 buildTranslationCacheKey 输出、唯一；查询入口只有「按完整 key 查」（hit/miss）和「LRU 遍历淘汰」（cursor）。`sourceHash` / `modelId` / `novelId` **不**建 index（避免升级复杂度爆炸；遍历 + 内存过滤即可，200 章量级内存成本 < 1ms）。
- v1 → v2（tokenStorage 一次性重新登录的历史迁移）保持原状（idbKV.ts line 6-8 注释说明），**与本 ADR 无关**。

### 3. LRU 淘汰策略：容量上限 200 章（与 webview 端同基线起步）

**容量上限 = 200 个 chapter 级条目**（与 webview 端 `translationCache.ts` 同值起步；spec §12 N11 已写「webview 端是 200 章，lynx 端复用同值起步」）。

**淘汰实现**：每次 `cache.write()` 后立即检查 store count，超过 200 → 用 `IDBObjectStore.openCursor()` 按 `createdAt` 升序遍历淘汰至 199。**淘汰粒度 = 条目级**（不区分 model / novel）——200 = 总 chapter 翻译条目数；用户切 model 后旧条目占用计数（spec §9.10 决策）。

**配额监控**：保留 `navigator.storage.estimate()`（web-core）+ `Capacitor Storage` Android quota 接口（native）的接口位（**不立即实现**——200 条 × ~50KB/章 ≈ 10MB，远低于 Android IndexedDB 默认配额 50MB；如未来发现 quota 紧张，加 quota probe + 降级到磁盘清理 UI）。

**保留与淘汰边界**：
- `partial` / `failed` / `aborted` 状态的章节**永不写入** object store（spec §5 不变量 #3、§7.2 转移表、§9.6 关键守门）——避免半成品污染。
- `completed` 状态的章节**唯一写入时机**：消费完 `done` chunk 后、`status = 'completed'` 同步触发。
- 用户手动「清除翻译缓存」入口（spec §6.1 / §9.5）调 `cache.clear()` 清空整个 `translations` store。

### 4. sourceHash 失效机制：FNV-1a 32-bit

**算法选型**：FNV-1a 32-bit（无加密需求、不追求抗碰撞，仅需快速指纹）。

**输入**：`join(paragraphs, '\n')`（LF 分隔；HTML 已剥、注音已剥，ADR-0170 阶段定预处理）。

**计算**（`packages/app-lynx/src/utils/translationCache.ts` 内 `fnv1a32(s: string): string`，返回 8-char zero-padded hex）：
```
hash = 0x811c9dc5
for each byte b in UTF-8(s):
  hash = (hash XOR b) * 0x01000193 mod 2^32
return hash.toString(16).padStart(8, '0')
```

**算法选型理由**：
- **拒绝 SHA-256 / MD5 / xxhash**：web / native 都需要 byte-equal 一致；SHA-256 原生 API 不可用（web crypto 需要 secure context，Worker 环境受限）；MD5 npm 依赖膨胀。FNV-1a 是标准 4 行实现，无依赖、与 web/native 双侧一致。
- **拒绝 CRC32**：实现更复杂，Lynx native 侧没有 CRC32 内置。
- **拒绝 spark-md5**（spec §4.5 原备注用 spark-md5）：spec 阶段笔误，implement 阶段收敛为 FNV-1a（避免引入 spark-md5 依赖；零依赖即可）。
- **碰撞风险**：32-bit = 2^32 ≈ 4×10^9；200 章 hash space 内 birthday collision 概率 ≈ 200²/2^33 ≈ 4.7×10^-6；**可接受**——碰撞仅意味 miss（重翻），无安全/正确性后果。

**baseURLHash 同样算法**（同 `fnv1a32` 函数，传入 baseURL 字符串）。baseURL 切到不同 endpoint → baseURLHash 变 → 旧缓存全部 miss（spec §9.5）。

### 5. 半成品缓存策略：`done` 之前永不写

**核心规则**（spec §5 不变量 #3、§7.2 转移表、`translating → done → completed → cache.write()`）：

| 状态 | 写缓存？ | 理由 |
|---|---|---|
| `idle` / `pending` / `translating` / `translating_queued` | ❌ 永不写 | 流未结束 |
| `partial` | ❌ 永不写 | 流中断后整批回退也失败；段落不完整会展示错位 |
| `failed` | ❌ 永不写 | 与 `partial` 同；用户 retry 即可从头重翻 |
| `aborted` | ❌ 永不写 | 用户主动中断；不计费归因 |
| `completed` | ✅ **唯一写时机** | `done` chunk 已消费、provider 报告 success |

**续翻触发**（spec §9.6 + Q21）：用户回到未译章节 → `startTranslate()` 重发请求 → 缓存命中 → 直接 `cached` chunk → `completed`（秒完）；缓存 miss → 从头翻译。**不**弹「续翻」按钮、**不**弹「上次的部分译文是否保留」对话框——自动从头重翻、缓存命中秒完是首选 UX（spec §6.2 按钮 5 态表第 5 行）。

**UI 复杂度权衡**：spec §6.2 翻译按钮 5 态（含「续译」）保留状态显示、移除弹窗——续翻是自动的、用户无需决策。

### 6. 缓存读写并发：同章节复用 in-flight

**去重**（spec §9.8 + store action 设计）：
- store 维护 in-flight `Map<chapterId, Promise<TranslationChunk[]>>`
- 同 chapterId 二次进入：`startTranslate()` 检测 in-flight → 复用同一 Promise（不创建新 provider、不创建新 AbortController、不发新请求）
- 不同 chapterId 完全并行（每个 chapter 独立 in-flight key）
- `chapter switch` 触发 `abortController.abort()` 时，**只 abort 旧 chapter 的 in-flight**；新 chapter 独立启动

**并发安全**：
- `cache.read(key)`：单条 `IDBObjectStore.get(key)`；IDB 自身事务隔离，**无并发问题**。
- `cache.write(entry)`：单条 `IDBObjectStore.put(entry, key)`；写之前先 read 当前 count，超过 200 启动 cursor 淘汰。**淘汰与写入不同事务**——淘汰完成后另起 `readwrite` 事务写新条目。
- LRU 淘汰与写入并发：淘汰事务先 commit、写入事务后 commit；如淘汰过程中用户又触发新 write，新 write 在旧淘汰事务之后排队（IDB 单条 store 自动序列化），不出现「淘汰掉刚写的条目」竞态。

### 7. 缓存条目 metadata：`createdAt` + `provider` + `model`

`TranslationCacheEntry` 持久化字段（见 §2 schema）：
- `createdAt: number` —— 毫秒时间戳，用于 LRU 淘汰排序 + UI 「已缓存 ✓」tooltip 可选展示「N 天前缓存」。
- `providerId: 'openai-responses'` —— 当前唯一 provider；为未来 chat/completions fallback / 其他 provider 预留字段（map Out of scope，但 schema 不写死字符串 union）。
- `modelId: string` —— 用户自填 model；改 model 触发不同缓存 namespace（spec §9.10）。

**`createdAt` 不暴露 UI 优先**：spec §6.2 翻译按钮 5 态表未列「缓存时间」展示；本 ADR 不在 §6.3 segmented button 右侧「已缓存 ✓」加 tooltip（避免 M3 视觉密度过载）。**预留** schema 字段即可。

**`providerId` verify 一致性**：写条目时强制 `providerId === 'openai-responses'`；读条目时 verify 一致、不一致 → 视为 miss + warn（防止未来 schema 演进时误用）。

### 8. 用户清除 endpoint 后缓存策略（spec §9.5 + 决策固化）

**场景**：用户在设置页清空 API Key（不删缓存）、或切到全新 endpoint。

**决策**：
- **保留**所有 `translations` store 条目（不自动清空）；缓存键含 `baseURLHash`，切回原 endpoint 时旧条目 baseURLHash 一致 → **仍能命中**。
- **endpoint `hasKey === false` 时**：
  - 「已缓存 ✓」标识**仍显示**（章节确实在缓存里、段落数据可信）——用户体验优先；
  - 任何**新翻译请求**被拒（spec §9.5 inline error `endpoint_unconfigured`，按钮 disabled / 跳设置页）；
  - 「重译」按钮变灰 + tooltip「请先配置 endpoint」。
- 用户手动「清除翻译缓存」入口（spec §6.1）可一次性清空整个 `translations` store。

**理由**：缓存条目不依赖 API key 可用性；endpoint 配置与缓存内容是两个独立维度。自动清空会让用户重新填 endpoint 后**丢失全部已有译文**（重翻成本远大于一行 baseURL 哈希）。

---

## 后果

### 正面

- **跨章节命中率与重翻成本平衡**：200 章 LRU + sourceHash 失效 → 用户长篇连载只翻 200 章后会淘汰早期条目（重翻成本可接受）；改 model / 改 endpoint / 改 source 自动 miss 不污染。
- **端点切换自动失效**：baseURLHash 字段 → 用户切 DeepSeek → OpenAI 旧缓存完全 miss（不会拿 DeepSeek 译文显示成 OpenAI 译文），但旧条目**不丢失**（切回 DeepSeek 仍命中）。
- **离线可用**：IndexedDB 持久化 → 用户在地铁里打开已译章节，缓存命中秒出、零网络。
- **半成品零污染**：`done` 之前不写 → 用户中断 / 网络断 / endpoint 504 都不会污染缓存。
- **跨端一致性**：与 webview 端缓存策略对齐（200 章上限、键构造去重 fingerprint、metadata 字段），将来如需抽 `@pictelio/translation-cache` 共享包可零成本迁移（schema 已是结构化 entry，不是 LRU-only in-memory）。

### 负面 / 成本

- **IndexedDB v2 → v3 迁移路径**：升级用户首次启动触发 `onupgradeneeded` → 自动创建 `translations` store；空 store 无迁移成本。如未来 v4 加 index（按 novelId / modelId）需再升级一次——届时再写迁移 ADR（**本 ADR 不预留**，避免提前优化）。
- **半成品策略增加 UI 复杂度**：spec §6.2 翻译按钮 5 态表含「续译」disabled 态（仅状态展示、不弹窗）——但 UX 上需要让用户明白「为什么续翻自动发生」。**缓解**：spec §8.3 `status.first_screen_ready` i18n 键已给出「首屏内容已出，其余后台续翻中…」文案（implement 阶段补全）。
- **200 章上限是经验值**：长篇 Pixiv 小说（如 1000+ 章节）超出后会淘汰早期——用户切回需重翻。**缓解**：用户主动「清除翻译缓存」前可选择保留旧 model 缓存（spec §9.10 `clearCacheByModel()`）；后续如发现用户痛点再上调容量或加按 novel 配额（**本 ADR 不预留**，避免提前优化）。
- **32-bit hash 碰撞概率**：见 §4，~4.7×10^-6（200 章 hash space）；碰撞仅意味着一次不必要重翻，无正确性后果。

---

## Alternatives Considered

### A) novel id 整本缓存（不细分章节）

**拒**：
- 命中率低：用户常看单章节，整本缓存会因任一章节 sourceHash 变化（小说作者常修订首章/末章）→ 整本 miss → 重翻 100 章；
- 容量爆炸：100 章小说 × 50KB/章 = 5MB/本，10 本小说就超 200 章 LRU 上限；
- 与 Q7 决策冲突（map #617 Q7 已收敛「缓存粒度 = novel id + chapter id」）。

### B) novel id + 段落 hash（段落级缓存）

**拒**：
- 缓存爆炸：100 章 × 100 段 = 10,000 条/本，远超 LRU 容量；
- 段落 hash 不防顺序调整（用户/作者调整段落顺序会全部 miss）；
- 与 spec §4.5 已收敛的「章节级 + 整章 paragraphs 数组」契约冲突；
- 段落译文需对齐规则（ADR-0170 阶段处理），缓存键再加段落 hash 会让对齐问题翻倍。

### C) 复用 webview 端 `translationCache.ts`（双端共享抽象）

**拒**（理由同 §背景「为什么不复用 webview 端 `translationCache.ts`」）：
- map Q3 完全从零；
- 介质不同（localStorage + in-memory LRU vs IndexedDB Worker）；
- 键构造边界不同（webview 不含 sourceHash / modelId）；
- 元数据字段不同（webview 无 provider / model）；
- 与 webview 端 createNovelTranslator（DeepSeek prompt / chunked pipeline）强耦合——搬运会连 prompt 一起搬。
- 与 wayfinder map #617「不抽 `@pictelio/novel-translate` 共享包」决策一致（Out of scope）。

### D) 存到 Capacitor Preferences（@capacitor/preferences）

**拒**：
- 配额小：SharedPreferences 默认 ~1MB（虽然可调大，但弱保证）；200 章 × 50KB = 10MB 远超默认；
- API 形态是同步 KV（`get`/`set`）——不适配 LRU 遍历淘汰（cursor 没有）；
- web-core dev 预览环境无 Capacitor NativeModules（已确认 ADR-0103 §决策 3：双 adapter 模式）；
- webview 端项目也不存 Preferences（webview 端 translationCache 走 localStorage + in-memory LRU），保持 **两端都不走 Preferences** 的一致性；
- 与现有 `idbKV.ts` 封装（已在用、已稳定）不冲突。

---

## References

- **wayfinder map #617**（app-lynx 端小说翻译父 map；Q7 缓存粒度 / Q17 用户自填 endpoint）
- **spec #618**（`docs/specs/app-lynx-novel-translation.md`；§4.5 TranslationCacheKey / §9.5 用户清除 endpoint / §9.6 流中断 / §9.8 并发去重 / §9.9 R18 缓存边界 / §9.10 模型切换旧缓存）
- **ADR-0050**（lynx 持久化 + IndexedDB）
- **ADR-0051**（lynx 双通道 / Native bridge）
- **ADR-0103**（跨引擎设置键；`PictelioPrefsModule` / IdbKVAdapter 双 adapter 先例——本 ADR 复用 idbKV 形态而非 PictelioPrefs，因 cache 数据量大、不适合 SharedPreferences 配额）
- **ADR-0167**（lynx novel intro 三段式——本 ADR 模板风格 / 章节结构继承）
- **ADR-0169**（待办：Responses API 请求构造；缓存键不依赖此 ADR，但 `instructions` 字段是否带 prompt 缓存 prefix 影响 sourceHash 计算边界——implement 阶段两 ADR 协作）
- **ADR-0170**（待办：chunked pipeline 与重试；sourceHash 输入在 chunked pipeline 完成后 join）
- **`packages/app-lynx/src/utils/idbKV.ts`**（现有 IndexedDB 封装——参考现有 `kv` store 形态；本 ADR 在同一 DB 加 `translations` store）
- **`packages/app/src/translationCache.ts`**（webview 端参考；**不复用**，仅参考抽象边界；map #617 Q3 已收敛）
- **`packages/app/src/openwiki/domain/novel-reader.md` §AI Translation**（webview 端翻译栈描述；参考非复用）
- **`docs/specs/novel-ai-translation.md`**（webview 端 spec；参考非复用）
- **`packages/app-lynx/CONTEXT.md`**（词条：翻译缓存 / LRU 淘汰 / sourceHash 失效——implement 阶段补）
- **`docs/agents/triage-labels.md`** / **`docs/agents/issue-tracker.md`**（map #617 ticket #621 = ADR-0171）