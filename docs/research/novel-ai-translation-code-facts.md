# 小说 AI 翻译功能 —— 代码位置核查事实清单

> 核查方式：本地只读代码核查（未联网、未运行构建/测试）
> 核查基线：`docs/research/novel-ai-translation-feasibility.md`（2025 年 11 月，v3）附录「关键代码事实索引」
> 结论摘要：**9 处位置全部存在，文档给出的关键行号（NovelDetail.tsx:360、novel.ts:205、createNovelVirtualLayout.ts:117、client.ts:156）均无漂移**。发现 2 个文档未充分强调的实现细节：① `novelTextLayoutCache` 的缓存 key **不含译文维度**，原文↔译文切换时 pretext 布局会被旧缓存误导（文档附录仅一句「需加译文标志」）；② 新增 IndexedDB `translations` store 必须把 `db.ts` 的 `DB_VERSION` 从 1 升到 2。

---

## 1) `packages/app/src/routes/NovelDetail.tsx` —— blocks createMemo（注入点）

- **存在**：✅ 是。`NovelDetail.tsx:360-362`。
- **当前行号**：line 360 `const blocks = createMemo<NovelBlock[]>(() => {`，line 361 `return parseNovelBlocks(novelHtml() ?? "", novelImages());`。
- **与源文档差异**：文档称 `NovelDetail.tsx:360` —— **无漂移**。依赖确认：blocks 是全文唯一把 `novelHtml` + `novelImages` 两个信号合成段落数组的 memo。
- **补充澄清**：`novelHtml` / `novelImages` 本身还被 3 个 `createEffect` 消费（line 315 图片映射变化清空尺寸、line 328 正文加载后恢复阅读进度、line 336 预加载内嵌图尺寸），另有 line 694 `<Show when={novelHtml()}>` 控制正文区显示。
- **复用注意点**：
  1. 注入点成立：替换 `TextBlock.text` 后 blocks 返回新数组，下游 `searchText`（line 364）、`virtualLayout`（line 366，接收 blocks Accessor）、`blocksWithHeights`（line 384，浅拷贝 block 注入 `ph` 高度）全部自动重算。
  2. **不要改写 `novelHtml` 本身**做译文注入——那会触发 line 315/328/336 的副作用（尺寸重载、进度恢复）。译文只应作用在 blocks 层（原文 hash 另存用于缓存失效比对）。
  3. 译文切换必须让 blocks() 返回**新数组引用**（parseNovelBlocks 天然每次新数组；`<For>` 渲染依赖引用变化，见 line 390 注释）。
  4. 文本渲染走 `renderParagraphWithHighlights`（line 399-435）：无搜索命中时直接 `<> {text} </>`（SolidJS 文本节点，**安全路径**，与文档 11.1 一致）；译文保持纯文本即无 XSS 面。
  5. `TextBlock.index` 是搜索/进度锚点，译文替换时不得改动 index（见第 6 项）。

---

## 2) `packages/app/src/api/novel.ts` —— CapacitorHttp 直连先例

- **存在**：✅ 是。`loadTextRaw` 在 `novel.ts:183-214`，`CapacitorHttp.request` 调用在 **line 205**。
- **与源文档差异**：文档称 `novel.ts:205` —— **无漂移**。实现未变：Web 模式走已有 `/pixiv-api` 代理 fetch（line 195-202），Native 模式走 CapacitorHttp 直连 `https://app-api.pixiv.net/webview/v2/novel`（line 204-213），`res.status >= 400` 抛错，返回 `res.data as string`。
- **复用注意点**：
  1. `CapacitorHttp` 从 `@capacitor/core` 导入（line 1，v8.4.2 内置），`isNative = Capacitor.isNativePlatform()`（line 14）——翻译客户端可复制这个「`isNative` 双分支」骨架：Web 直接 `fetch` 服务商（无 CORS 问题），Android Native 必须 `CapacitorHttp`（无 CORS 限制）。
  2. 本文件其余内容绑定 Pixiv 域（apiClient、getAccessToken、PIXIV_USER_AGENT）——翻译请求**不得**复用 apiClient（文档 9 章确认：client.ts 的 rewriteUrl/nativeExecuteRequest 绑定 Pixiv 域与 OAuth 401 刷新）。
  3. 可借鉴的健壮性模式：`res.status >= 400` 统一抛错；`createDedupedRequest`（line 168/216）用于并发去重——翻译分块并发不需要跨请求去重，可跳过。

---

## 3) `packages/app/src/utils/secureStorage.ts` —— key 加密存储模式

- **存在**：✅ 是。依赖 `@aparajita/capacitor-secure-storage` v8.0.0（`package.json:35`，文档措辞「capacitor-secure-storage-plugin」不准确，实际包名 `@aparajita/capacitor-secure-storage`），API 为 `SecureStorage.get/set/remove`。
- **当前结构**：对外三接口 `restoreRefreshToken`（line 39）/ `saveRefreshToken`（line 82）/ `clearRefreshToken`（line 88）；内部含：backup marker 完整性检查（line 41-48）、旧 `@capacitor/preferences` 明文一次性迁移（line 60-73）、Native `syncToken` 同步（line 24-29、76-77、84、90）；所有存储调用均用 `tryAsync` 包裹、异常统一清除 token 防泄露。
- **与源文档差异**：文档 11.2 描述「Keystore 加密（secureStorage.ts 成熟模式）」方向正确，但该模块是 **refresh_token 专用、非通用 key-value 封装**——key 名硬编码（`REFRESH_TOKEN_KEY`、`BACKUP_MARKER_KEY`），接口签名不接受外部 key。文档 13.1 假设 translationStore 直接复用「secure-storage」需要先做这一步扩展。
- **复用注意点**：
  1. 需新增通用接口（如 `getSecure/setSecure/removeSecure` 带 key 参数）或添加翻译专用方法（`saveApiKey/restoreApiKey/clearApiKey`），不要直接复用 restore/save/clear（语义是登录 token）。
  2. **与登出解耦**：`Settings.tsx` 的 `handleClearLocalData` 只清 `Preferences.clear()` 与 novelCache 等，**不会清 SecureStorage**——翻译 key 的清除需独立入口（文档 11.2「清除所有已存 Key」要求不变）。
  3. `tryAsync` + `console.warn` 静默降级模式可复制；但 marker 完整性检查、Preferences 迁移、syncToken 是 token 专属逻辑，翻译 key 不必复制。
  4. 注意 `@aparajita` 插件在 **Web/DEV 环境是纯 Web 实现（base64 存 localStorage，非加密）**，仅 Android 生产环境走 Keystore——如需 Web 兜底提示需自行处理。

---

## 4) `packages/app/src/stores/db.ts` —— createIDBStore / IndexedDB 抽象

- **存在**：✅ 是。`createIDBStore` 在 **line 91**；另有测试用 `createMemoryStore`（line 24）与 `IDBStore` 接口（line 13-20，方法 get/put/delete/count/getAll/clear）。
- **当前实现**：`DB_NAME = "pictelio"`、`DB_VERSION = 1`（line 58-59），`openDB` 的 `onupgradeneeded` 仅创建 `novels` 与 `series` 两个 object store（keyPath `"id"`，line 68-76）；单例 `dbPromise` 复用同一连接（line 82-89）。
- **与源文档差异**：文档称「复用 db.ts 的 createIDBStore，新增 translations store」（7.1、附录）——可行，但**文档未指出必须升级 DB_VERSION**：object store 只在 `onupgradeneeded` 创建，不升版本新增 store 会导致运行时 `db.transaction("translations")` 抛 NotFoundError。
- **复用注意点**：
  1. **必须 `DB_VERSION` 1 → 2**，并在 `onupgradeneeded` 追加 `if (!db.objectStoreNames.contains("translations")) db.createObjectStore("translations", { keyPath: "id" })`。
  2. `IDBStore` 的 key 类型为 `number`，`put` 约束 `T extends { id: number }`——文档 7.1 的 `TranslationCacheEntry.id`（hash）可满足；若复合维度（sourceHash+targetLang+modelId）需拆 key 需自行归一为 number。
  3. LRU 淘汰对齐既有模式：`stores/novelCache.ts` 的 `enforceLimits`（line 114-122，count→getAll→按 cachedAt 排序→delete）与懒加载单例 + `_useStore()` 测试注入（line 49-61）可直接参照。
  4. `getAll` 已存在，便于翻译缓存「清除全部」入口。

---

## 5) `packages/app/src/components/settings/SettingsContent.tsx` —— 设置分组结构

- **存在**：✅ 是。组件在 **line 17**。
- **当前结构**：这是「内容与过滤」分组：分组标题（line 35）+ 4 个设置行——显示 R18 内容开关（line 40-65，`fluent-switch`）、显示 R-18G 内容开关（line 67-93）、重新确认年龄（line 96-121，条件 `Show`）、管理屏蔽列表（line 124-169）。行样式：图标 SVG + 标题/说明两行文本 + 右侧控件，全部用 Fluent token（`fontSizeBase400/200`、`colorNeutralForeground1/2/3`）。
- **设置页容器**：`routes/Settings.tsx` 是组合入口，顺序为 `SettingsAppearance` → `fluent-divider` → `SettingsContent` → `fluent-divider` → `SettingsImage` → `fluent-divider` → 退出登录（内联）→ `SettingsAccount` + `SettingsDialogs`（line 126-176）。
- **与源文档差异**：文档附录「设置页分组位置 SettingsContent.tsx」准确；需补充的是分组由多个组件 + Settings.tsx 组合，翻译设置应作为**新增分组组件**插入，而非塞进 SettingsContent。
- **复用注意点**：
  1. 新建 `SettingsTranslation.tsx` 分组组件，插到任意 `fluent-divider` 之间；样式直接复制分组骨架（py-3 flex-col + 标题 + 行）。
  2. R18 翻译开关可借鉴 `requireAdult` 门控（line 20-26），但文档 8.4 要求更重的「二次告知弹窗（含封号警告）」，不能用单个 requireAdult 替代。
  3. UI 上需区分「显示 R18 内容」（内容过滤）与「翻译 R18 内容」（翻译策略），避免两个开关语义混淆。

---

## 6) `packages/app/src/utils/novelBlocks.ts` —— parseNovelBlocks 与块类型

- **存在**：✅ 是。`parseNovelBlocks` 在 **line 35-65**。
- **类型**：`TextBlock`（line 4-9，字段 `type/text/index`）、`ImageBlock`（line 12-16，`type/imageId/urls`）、**`PageBreakBlock`**（line 19-21）、联合类型 `NovelBlock`（line 23）。
- **与源文档差异**：文档附录写「PageBreak」，**实际类型名是 `PageBreakBlock`**（minor 命名差异，类型语义一致）。
- **解析规则**（line 40-62）：按 `\n+` 分片；`[uploadedimage:id]` / `[pixivimage:id]`（且 id 存在于 images 映射）→ ImageBlock；`[newpage]` → PageBreakBlock；其余非空行 → TextBlock，`index` 为纯文本段落序号（不含图片/分页）。
- **复用注意点**：
  1. `TextBlock.text` 是**原始行文本**，可能残留 HTML 实体/标签——文档 5 章管线第 1 步「解码实体、剥离标签」是必要的预处理，译文以**纯文本**回填。
  2. `TextBlock.index` 是搜索/进度/布局锚点（与 buildSearchText line 71 的段落序对齐）——**译文段落数必须等于原文段落数**，替换 text 时 index 不动（文档 4.3 步骤 5 已要求）。
  3. 图片/分页是独立块，不进入翻译流（文档已述）；注意图片占位符若 id 不在 images 映射会降级为 TextBlock（`[pixivimage:...]` 文本会进入翻译流，规划时留意）。
  4. `buildSearchText`（line 71-76）用 `\n\n` 拼接纯文本段落，翻译后搜索自然在译文上工作（锚点不变）。

---

## 7) `packages/app/src/primitives/createNovelVirtualLayout.ts` —— 是否直接消费 TextBlock.text

- **存在**：✅ 是。`createNovelVirtualLayout` 在 **line 100**；消费点在 **line 117-118**：
  ```ts
  const textBlocks = blocks.filter((b): b is TextBlock => b.type === "text");
  const paragraphs = textBlocks.map((b) => b.text);
  ```
  文档称 `createNovelVirtualLayout.ts:117` —— **无漂移**。
- **布局路径**：`textLayoutResult` memo（line 110-153）：width≤0 短路 → `isPretextSupported()` 为真走 `createNovelTextLayout`（pretext 测量，带缓存）；否则走 `buildFallbackLayout`（line 54-98，按 `text.length` 估算行高，无缓存）。
- **⚠️ 关键注意点 —— 布局缓存 key 不含译文维度**：
  1. `primitives/novelTextLayoutCache.ts`（`MAX_CACHE_ENTRIES = 3`）的缓存 key = `novelId + containerWidth + fontSize/fontWeight/fontFamily/lineHeight`（`buildCacheKey` line 55-68），**不含 text 内容或版本**。
  2. 后果：同一 novel 内原文 ↔ 译文切换（blocks.text 变化 → memo 重算 → 但 `cache.get(id, width, settings)` 命中旧布局直接返回，createNovelVirtualLayout.ts line 135-138）→ **pretext 路径段落高度/行数仍按原文计算，译文不会自动重排**。
  3. 解决二选一：① 给 `buildCacheKey`/缓存接口增加「译文 hash 或版本」参数（文档附录「布局缓存需加译文标志」的落地）；② 译文切换时调用已导出的 `clearNovelTextLayoutCache()`（line 117）。
  4. fallback 路径无缓存、实时按 text.length 计算，译文自动重排，无此问题——所以该 bug 只在支持 pretext 的原生设备暴露。
  5. `createNovelTextLayout` 输入是纯 `string[] paragraphs`，与文档 7.1「译文存纯文本段落」天然一致；布局按段落为单元，译文行数变化会反映到 `totalHeight`，虚拟滚动自适应（前提缓存问题解决）。

---

## 8) `packages/app/src/utils/html.ts` —— sanitizeHtml 白名单

- **存在**：✅ 是。`sanitizeHtml` 在 **line 112-131**。
- **白名单**：`ALLOWED_TAGS`（line 6）= `a / br / b / strong / i / em / span / p / div` —— 与文档 11.1 描述**完全一致**。
- **其余安全机制**：`FORBIDDEN_TAGS` 黑名单（line 8-25，script/style/iframe/object/embed/form/input/textarea/button/select/option/noscript/template/link/meta/base）；`a` 的 `href` 协议白名单 `http/https/pixiv://`（line 27-34）；所有 `on*` 事件属性剥离（line 41-45）；非白名单标签剥壳保留子内容（line 79-89）；非 `a` 标签不保留任何属性（line 55-58）。
- **与源文档差异**：无。
- **复用注意点**：
  1. 依赖 DOM（`DOMParser`/`document`），仅浏览器/WebView 环境可用（注释 line 3 已声明），非 SSR 环境。
  2. 当前正文渲染路径**不经过** sanitizeHtml——译文保持纯文本（`<>{text}</>`）即安全，sanitizeHtml 仅作为「未来译文富文本」兜底（文档 11.1）。规划测试时注意：构造含 `<script>` 的恶意译文，断言纯文本路径原样输出即可。
  3. 若启用译文富文本过白名单：非 `a` 标签属性全剥（class/style 不会保留），`a` 仅保留 `href/target/rel` 且 href 限白协议——设计译文富文本时不要依赖 class 样式。

---

## 9) `packages/app/src/api/client.ts` —— classifyError

- **存在**：✅ 是。`export function classifyError(status: number, error: unknown, responseBody?: unknown): ApiError` 在 **line 156**。文档称 `client.ts:156` —— **无漂移**（精确到行）。
- **分类逻辑**（line 156-220）：`proxy_error` → PROXY；无 status + `TypeError` → NETWORK；`extractPixivErrorMessage`（line 72）提取 Pixiv 错误消息；switch：401→UNAUTHORIZED、403→FORBIDDEN、429→RATE_LIMIT、default 中 400 OAuth 失效→UNAUTHORIZED、≥500→SERVER、>0→UNKNOWN、否则 UNKNOWN。
- **配套**：`ApiError` 接口（`api/types.ts:249`，字段 `type/message/status?`）、`ApiErrorType` 枚举（`api/types.ts:239`：NETWORK/UNAUTHORIZED/FORBIDDEN/RATE_LIMIT/SERVER/PROXY/UNKNOWN）、`toApiError`（line 123）、`pickBestErrorType`（line 147，按 PROXY>NETWORK>UNAUTHORIZED>RATE_LIMIT>SERVER>UNKNOWN 优先级合并）。
- **与源文档差异**：无。文档 14 章风险 6 写「错误分类复用 classifyError **思路**」——实际可以**直接 import 复用**：classifyError 是纯函数，Pixiv 域耦合在 `apiClient`/`rewriteUrl`/`nativeExecuteRequest`，classifyError 本身不依赖。
- **复用注意点**：
  1. 直接 `import { classifyError } from "./client"` 即可用于翻译请求归一化（429→RATE_LIMIT、网络失败→NETWORK 天然对应）。
  2. `extractPixivErrorMessage` 是 Pixiv 专用；服务商（OpenAI 兼容）错误体为 `{ error: { message } }`，需在 classifyError 外层加一个服务商错误归一化函数（或传 responseBody 前先映射为 `{ message }` 形式）。
  3. 翻译特有的「**政策拒绝**」（R18 内容被服务商拒）现有 `ApiErrorType` 无对应枚举——建议在 `ApiError` 基础上扩展（如增加 `rejected?: boolean` 或新 type），不要污染 Pixiv 枚举；对应文档 4.3 步骤 6「失败块回退原文 + 未翻译标记」。
  4. 多块并发翻译的错误合并可直接用 `pickBestErrorType` 或按块记录各自的 ApiError。

---

## 变更摘要表（与 `novel-ai-translation-feasibility.md` 对照）

| # | 文件 / 符号 | 文档标注 | 当前行号 | 位置 | 行号 | 关键差异 / 注意点 |
|---|------------|----------|---------|:---:|:---:|-------------------|
| 1 | `NovelDetail.tsx` blocks createMemo | `:360` | **360-362** | ✅ 存在 | 无漂移 | 依赖确认 novelHtml+novelImages；勿改写 novelHtml 本身；blocksWithHeights 浅拷贝重渲染 |
| 2 | `novel.ts` CapacitorHttp 直连 | `:205` | **205** | ✅ 存在 | 无漂移 | `loadTextRaw` 双模式（Web 代理 / Native 直连）；`isNative` 判据可复制 |
| 3 | `secureStorage.ts` 加密存储 | 文件级 | restore/save/clear（39/82/88） | ✅ 存在 | — | 包名实为 `@aparajita/capacitor-secure-storage`；**token 专用非通用 KV**，需扩展；登出不清 SecureStorage；Web 环境非加密 |
| 4 | `db.ts` createIDBStore | 文件级 | **91** | ✅ 存在 | — | **新增 translations store 必须 DB_VERSION 1→2**；IDBStore key 为 number；LRU 对齐 novelCache.enforceLimits |
| 5 | `SettingsContent.tsx` 设置分组 | 文件级 | 17 | ✅ 存在 | — | 仅为「内容与过滤」分组；组合容器在 `routes/Settings.tsx`；翻译设置应新建分组组件 |
| 6 | `novelBlocks.ts` parseNovelBlocks | 文件级 | **35-65** | ✅ 存在 | — | 类型名实为 **`PageBreakBlock`**（文档写 PageBreak）；TextBlock.text 为原始行文本需净化；index 为锚点 |
| 7 | `createNovelVirtualLayout.ts` 消费 text | `:117` | **117-118** | ✅ 存在 | 无漂移 | **布局缓存 key 不含译文维度**——原文↔译文切换 pretext 布局不重排（需加译文标志或 clearNovelTextLayoutCache） |
| 8 | `html.ts` sanitizeHtml 白名单 | 文件级 | **112-131**（白名单 line 6） | ✅ 存在 | — | 白名单与文档一致；需 DOM 环境；当前渲染路径纯文本不经 sanitize |
| 9 | `client.ts` classifyError | `:156` | **156** | ✅ 存在 | 无漂移 | 纯函数可直接 import 复用；服务商错误体需另写归一化；「政策拒绝」无现成枚举 |
