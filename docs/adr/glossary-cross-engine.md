# 跨引擎统一术语文档（glossary-cross-engine）

> 状态：已定稿（供差分测试 / 属性测试 / 测试加固 initiative 作为共享词汇基准）。
> 本文档**不改变任何代码**，只统一说话方式；涉及的行为分歧仅作记录与建议，是否修改由对应 ADR 拍板。
> 覆盖范围：`packages/app`（webview 客户端，SolidJS）与 `packages/app-lynx`（lynx 客户端，vue-lynx）之间的同语义双实现。
> 已阅读基线：`CONTEXT-MAP.md`、`packages/app/CONTEXT.md`、`packages/app-lynx/CONTEXT.md`、`docs/adr/glossary-auth-retry.md`、`docs/adr/glossary-update-check.md`、ADR-0051/0089/0037/0084/0085/0097。
> 相关一手来源：Pixiv OAuth 400 真实响应体（pixivpy#374、gallery-dl#9331，见证据节）。

## 范围与目的

Pictelio 是两个引擎（webview 客户端 / lynx 客户端）共享同一 Pixiv 数据源与 OAuth 凭证体系的 monorepo。许多**领域概念在两个引擎里语义相同、但术语、实现形态甚至行为有分歧**。这直接威胁差分测试（differential testing）与属性测试（property-based testing）：测试断言用什么词、以谁为 oracle、两引擎输出能否直接比较，都取决于一套先统一的词汇。

本文档：

1. 为每一处同语义双实现给出**建议统一术语**（定义 + 差异 + 统一理由），作为测试用例、测试文件名、PR 描述、issue 标题的共同语言。
2. 对**已知行为分歧**（R18 判定语义、URL 重写 web/native 分支、OAuth 400 错误形态）逐项记录差异、影响与建议。
3. 明确**待确认项 / 已在 ADR 拍板的项**：哪些统一需人拍板，哪些只做文档化不动代码。

术语选用惯例沿用 `CONTEXT.md`：中文定义 + 英文标识符；`_Avoid_` 标注禁用词。

## 术语对照表

| 领域概念 | app 用词 | lynx 用词 | 统一术语 | 差异/分歧 | 建议 |
|---|---|---|---|---|---|
| 受限判定谓词 | `isRestricted(item)`（私有，`src/utils/r18Filter.ts:9`） | `isRestricted(item)`（导出，`src/stores/settingsStore.ts:76`） | **`isRestricted(item)`** | 谓词逻辑逐行相同；app 私有经 filter* 组合暴露，lynx 独立导出 | 差分测试的纯函数基准；抽共享谓词见 ADR 决策 |
| R18/R18G 内容开关 | `showR18()`/`showR18G()`（settings 函数信号，默认 false） | `showR18`/`showR18G`（Vue ref，默认 false） | **`showR18`/`showR18G`（内容开关）** | 语义一致；读取形态与存储介质不同 | 概念统一为「开关」；差分测试分别注入两种开关值 |
| 内容分级契约 | `x_restrict: 0=全年龄,1=R-18,2=R-18G` | 同文注释 | **`x_restrict` 三值契约（0/1/2）** | 无分歧 | 差分测试输入空间定义；固化到测试 fixture |
| 受限条目 | 无此词（R18/R18G 被**过滤隐藏**） | **受限条目（Restricted item）** | **受限条目（restricted item）** | 语义实现不同：app 写入前移除，lynx 全量渲染后遮罩 | 全仓库统一「受限条目」指 lynx 语义；app 过滤语义称「被过滤条目」 |
| 内容遮罩 | 展示态徽标（R18/R18G badge、模糊/警告遮罩） | `RestrictOverlay`（M3 scrim + 徽章，遮罩 + 拦截点击） | **受限遮罩（RestrictOverlay / mask）** | app=展示态标记；lynx=受限态拦截 | 术语区分「展示态遮罩」「受限态遮罩」；等级统一 `level 1=R-18/2=R-18G` |
| 内容过滤函数 | `filterFeedIllusts`/`filterNovels`/`filterUserPreviews`（捆绑屏蔽用户） | 无（全量渲染 + 遮罩） | **内容过滤（filter，app 特有管线）** | 过滤管线仅 app 存在 | 差分测试只比较谓词，不比较管线；屏蔽用户（blockStore）属 app 独有维度，测试须隔离 |
| URL 重写 | `rewriteUrl`（web：剥域名→代理前缀；native：剥域名成相对路径） | `rewriteUrl`（native：保留/构造绝对 URL；web：精确主机匹配 + auth query 形态） | **`rewriteUrl`（URL 重写）** | native 分支输出形态相反（网关契约差异） | 按 (web/native)×输入拆分测试；「URL 规范化契约表」为 oracle |
| 令牌附加守卫 | 无。web dev 有 token 即附 Authorization；native 由 Java 附加 | `shouldAttachAuth(rewrittenUrl)` + `isTrustedPixivHost(url)` | **令牌附加守卫（shouldAttachAuth）** | lynx 有防 token 泄漏白名单，app web 分支无 | 安全建议：app web 分支对齐（待确认）；差分断言「非受信 URL 不带 Bearer」 |
| 代理前缀（契约源） | `vite.config.ts` 定义 **7 个**：`/pixiv-img /pixiv-re /pixiv-nl /pixiv-api /pixiv-oauth /github-api /pixiv-www` | `lynx.config.ts` 定义 **3 个**：`/pixiv-img /pixiv-api /pixiv-oauth` | **代理前缀（proxy prefix）** | lynx 缺 `/pixiv-re /pixiv-nl /github-api /pixiv-www` | 前缀清单文档化为契约表；差分不得假设两引擎前缀面相同 |
| 原生模式探测 | `Capacitor.isNativePlatform()`（模块级 `isNative`） | `isNativeMode()`：探测 `NativeModules.Pictelio*`（防 web-core 空壳误判） | **原生模式（native mode）** | 判定机制完全不同 | 测试分别 mock 两种机制；web/native 模式名统一 |
| OAuth Token 400 错误 | `isOAuthTokenErrorResponse`（只认 error.message 含 OAuth/invalid_request） | 同名（**额外**认 `{error:"invalid_grant"}` 字符串 + invalid_grant 子串） | **OAuth Token 400 错误**（CONTEXT.md 已定义） | **行为分歧，已由真实证据裁决**（app 漏识别字符串形态） | 以 lynx 识别面为准统一（ADR 已拍板）；oracle 用真实错误体快照 |
| 错误分类函数 | `classifyError(status, error, resBody?)`（PROXY→NETWORK→401/403/429→400-OAuth→5xx→其他） | `classifyError` 同构 | **`classifyError`（错误分类）** | 逻辑同构；PROXY 文案 app 含端口、lynx 不含；extract 分支顺序微差 | 差分逐 (status, body 形状) 断言 type + message 前缀；文案差异为已知低优先级 |
| 错误分类枚举 | `ApiErrorType` 大写值：`"NETWORK"`… | `ApiErrorType` 小写值：`"network"`… | **`ApiErrorType`（7 类）** | 成员名、7 类划分一致；运行时字符串值大小写不同 | 断言一律用枚举成员而非字面量；值方向待拍板 |
| 更新检查共享层 | `@/services/updateService`（薄 re-export）+ `APP_VERSION` | `updateStore` + `__APP_VERSION__` + `createUpdateFetchImpl()` | **`@pictelio/update-check`（单一事实源）** | **无术语分歧**：单实现双端引用（ADR-0089） | 作为后续统一其他模块的模板；差分无需比较该层 |
| 会话失效 | 无独立术语（文案「登录已过期」） | **会话失效（Session expiry）** | **会话失效（session expiry）** | app 有同义文案无独立词；lynx 概念化 | 统一术语「会话失效」；文案层差异不影响术语 |
| 引擎 / 客户端 | 「主 app」「webview 客户端」 | 「lynx 客户端」「app-lynx」 | **引擎（engine）** | — | 文档/测试中用「引擎」指实现族，包名保留 |
| 运行模式 | Web 模式 / 原生模式 | web-core 预览 / 原生 LynxView | **web 模式 / native 模式** | 同一对概念两组叫法 | 统一「web 模式/native 模式」；web-core、LynxView 作引擎内细节 |

## 重点分歧专项

### 专项 1：R18 判定 —— 谓词一致，语义相反

两引擎 `isRestricted` 谓词逻辑**逐行相同**（`!showR18 && x_restrict===1 || !showR18G && x_restrict===2`），`x_restrict` 0/1/2 契约一致，开关默认 false。但消费语义相反：

- **app**：store 写入前经 filterFn **过滤移除**受限条目（与 blockStore 捆绑）；到卡片的只有放行内容，卡片按 `x_restrict` 渲染展示态徽标。
- **lynx**：**全量渲染**，`isRestricted` 决定受限条目 → `RestrictOverlay`（scrim 遮罩 + 徽章）+ 点击无响应。ADR-0051 的过滤方案已被 issue #91 取代。

**对差分/属性测试**：

- 谓词层**可差分**：12 例 truth table 是现成 oracle，两引擎必须输出同一张表。
- 列表层**不可直接差分**：app「列表不含受限条目」vs lynx「列表长度不变但受限条目遮罩」是不同性质。
- 属性不同：app=过滤后无受限条目（+无屏蔽用户）；lynx=受限条目存在但不可交互。

**建议**：术语上「受限条目」专指 lynx 遮罩语义，app 称「被过滤条目」；谓词层建议抽共享纯函数 + 12 例 truth table 固化为共享 fixture（ADR 决策）。

### 专项 2：URL 重写 —— 契约相反

- **native 分支**（方向相反）：app 绝对 URL **剥域名成相对 path**（`PixivApiPlugin` 只收相对路径）；lynx 相对 path **拼成绝对 URL**（`PictelioApi` 契约）。
- **web 分支**（严格度不同）：app 前缀替换（理论可被伪后缀域误中）；lynx 精确主机匹配 + auth query 形态，注释明言防伪后缀域。
- **token 附加**：app web dev 有 token 即附 Bearer（对任何重写结果）；lynx 经 `shouldAttachAuth` 才附。

**影响**：rewriteUrl 输出形态不同，**不能直接函数级差分**，必须按 (web/native) 拆开。安全面不同：app web 对非 Pixiv 绝对 URL 也会附 token。

**建议**：差分的 oracle 是统一的「URL 规范化契约表」（输入 × web/native → 重写输出 + 是否附 token），非让两引擎输出相同。

### 专项 3：OAuth 400 错误形态 —— 识别面分歧，测试锁定相反期望

- **app**：只认对象形态 message 含 OAuth/invalid_request；测试 **锁定** `{error:"invalid_grant"}` → false（`client.test.ts:103-106`）→ UNKNOWN，不触发 onUnauthorized。
- **lynx**：额外认字符串 `invalid_grant` + invalid_grant 子串；测试锁定 `{has_error:true,error:"invalid_grant"}` → true（`unit.test.ts:76-88`）→ UNAUTHORIZED。

**真实证据裁决**（见证据节）：`{error:"invalid_grant"}` 字符串形态是 Pixiv 真实 refresh_token 失效响应（pixivpy#374、gallery-dl#9331 两独立来源一致）。**app 漏识别**，lynx 正确。爆炸半径有限（登出主链路不依赖 body 形态），但错误分类与用户提示错误。

**ADR 已拍板**：app 补字符串 `invalid_grant` 识别（对齐 lynx），并纳入真实体快照契约测试；修正 app 测试断言；更新 CONTEXT.md/glossary 契约描述并标注一手来源。

### 附 4：ApiErrorType 枚举值大小写分歧

- app：`"NETWORK"/"UNAUTHORIZED"/…`（大写）；lynx：`"network"/"unauthorized"/…`（小写）。成员名、7 类划分、`ApiError{type,message,status?}` 结构一致，仅运行时字符串值不同。

**影响**：跨引擎序列化、日志归并、E2E 断言时同语义不同值。差分断言 `type` 必须用枚举成员而非字面量。值方向待拍板（见「待确认项」）。

## 新增/提议术语（本 initiative 引入）

| 术语 | 定义 | 使用建议 |
|---|---|---|
| **差分测试（differential testing）** | 对两引擎同语义双实现喂同一输入，断言输出一致或差异符合已记录契约差异 | 测试命名建议 `*.differential.test.ts` |
| **属性测试（property-based testing）** | 断言不变量而非具体样例 | 属性即 oracle 的一种（ADR-0097） |
| **oracle 期望值来源（oracle provenance）** | 期望值必须指向独立来源：规格/真实数据/独立实现（差分）/性质；禁止从实现反推或自洽 mock | 差分中「另一引擎实现」即独立 oracle；12 例 truth table、真实错误体快照、代理前缀契约表都是合法 oracle 源 |
| **同语义双实现（same-semantics dual implementation）** | 两引擎中「同一领域概念、两套代码」的模块对 | 差分的扫描单位 |
| **12 例布尔矩阵（restriction truth table）** | `isRestricted` 在 `x_restrict×showR18×showR18G` 下的完整真值表 | 固化为共享 fixture |
| **受限条目 vs 被过滤条目** | 受限条目=lynx 遮罩语义；被过滤条目=app 过滤语义 | 禁止混用 |
| **令牌附加守卫（shouldAttachAuth）** | 决定 URL 是否携带 Bearer 的判定 | 安全断言统一词 |
| **代理前缀面（proxy surface）** | 某引擎 dev 代理暴露的前缀集合 | 契约表维度；差分不得假设两引擎前缀面相同 |
| **URL 规范化契约表** | 输入类别 × web/native → 重写输出 + 是否附 token 的期望表 | 作为 rewriteUrl/shouldAttachAuth 的 oracle |
| **引擎（engine）** | 客户端实现族：webview / lynx | 测试与文档「跨引擎」= 跨这两者 |
| **单一事实源（single source of truth）** | 某概念只有一份权威实现/契约，其余为引用 | 既有先例：update-check、credentials.json5、app 包 version |

## 证据节（oracle 一手来源）

### Pixiv OAuth 400 真实响应

**形态 A（refresh_token 失效，核心场景）**——两个独立真实来源（oauth.secure.pixiv.net/auth/token 实际响应）字节级一致：

```json
{"has_error":true,"errors":{"system":{"message":"Invalid refresh token","code":1508}},"error":"invalid_grant"}
```

来源：

- [upbit/pixivpy#374](https://github.com/upbit/pixivpy/issues/374)（2024-12，「特定账号 refresh_token 失效」，用户贴出 pixivpy 错误输出 HTTP 400）
- [mikf/gallery-dl#9331](https://github.com/mikf/gallery-dl/issues/9331)（2026-03，「[pixiv][error] AuthenticationError」，gallery-dl debug 日志直接打印该响应）

**形态 B（OAuth 过程错误）**——对象形态，另一场景：

- [mixmoe/HibiAPI#232](https://github.com/mixmoe/HibiAPI/issues/232)（2022-02，`{"error":{"message":"Error occurred at the OAuth process. ... Error Message: invalid_grant",...}}`，app 靠 "OAuth" 子串兜底恰好匹配）

## 待确认项 / ADR 已拍板项

1. **`isRestricted` 是否抽共享？**（选项 a/g 抽共享纯函数包, b/app 仅导出, c/保持双实现靠差分兜底）→ **见 ADR 专项决策**。
2. **`ApiErrorType` 枚举值统一方向？**（大写对齐 app vs 小写对齐 lynx vs 共享枚举）→ 倾向大写对齐 app，需拍板。
3. **OAuth 400 识别面**：**ADR 已拍板以 lynx 为准统一**（app 补 invalid_grant 识别），由真实证据支撑。
4. **rewriteUrl native 分支差异**：长期保留契约差异，差分按模式拆分 + 契约表兜底。
5. **app web 分支补令牌守卫？** 安全建议项，dev-only 面，可低优先级。
6. **12 例 truth table 固化为共享 fixture？** → 见 ADR 专项决策。
7. 本文档落盘 `docs/adr/glossary-cross-engine.md` ✓（本文件即落盘位置）。
8. 术语语言惯例沿用 CONTEXT.md（中文定义 + 英文标识符）✓。

## 相关文件索引

- R18：`packages/app/src/utils/r18Filter.ts`、`packages/app/src/stores/settingsStore.ts`、`packages/app-lynx/src/stores/settingsStore.ts`、`packages/app-lynx/src/components/RestrictOverlay.vue`、ADR-0051
- URL：`packages/app/src/api/client.ts`、`packages/app-lynx/src/api/client.ts`、`packages/app/vite.config.ts`、`packages/app-lynx/lynx.config.ts`、`packages/app/src/utils/imageLoader.ts`
- OAuth 错误：`packages/app/src/api/client.ts`、`packages/app-lynx/src/api/client.ts`、`packages/app/tests/unit/api/client.test.ts`、`packages/app-lynx/tests/unit.test.ts`、`glossary-auth-retry.md`
- 枚举：`packages/app/src/api/types.ts`、`packages/app-lynx/src/api/types.ts`
- 共享层：`packages/update-check/src/index.ts`、ADR-0089、glossary-update-check.md
