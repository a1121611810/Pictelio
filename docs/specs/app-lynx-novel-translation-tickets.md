# Tickets: app-lynx 端小说翻译（spec: docs/specs/app-lynx-novel-translation.md）

> 拆分来源：wayfinder map #617 + spec #618 + 3 份 ADR（#619 ADR-0169 / #620 ADR-0170 / #621 ADR-0171）
> 约定：tracer-bullet 垂直切片，每个 ticket 可独立验证；blocker 未完成不开工。

## 依赖图

```
                     #629 (T1 P0 — Types)
                       │
        ┌──────────────┼──────────────┬──────────────────────┐
        ▼              ▼              ▼                      ▼
   #630 (T2)     #632 (T4)         #634 (T6)            #636 (T8 i18n)
   Java Native   OpenAIResponses   translationCache      50 键 zh-CN/en
   Module        Provider
        │              │              │
        ▼              ▼              │
     #631 (T3)    #633 (T5)            │
     Register +   chunked pipeline     │
     TS bridge    primitive           ─┼──→ #635 (T7 P1 — Pinia store + R18)
                  │                    │         │
                  └────────────────────┘         ▼
                                               #637 (T9 P2 — SettingsEndpoint)
                                               #638 (T10 P2 — NovelDetail 集成)
                                                     │
                                                     ▼
                           #639 (T11 P3 — Vitest 单测防线 12 测试组)
                                                     │
                                                     ▼
                           #640 (T12 P3 — Android 模拟器手动验证)
```

### 主链依赖（按 spec §10 / AGENTS.md 工作流硬约束）

```
T1 (types)
  ├→ T2 (Java) ─→ T3 (register + bridge)
  ├→ T4 (provider) ─→ T5 (chunked pipeline) ─┐
  ├→ T6 (cache) ─────────────────────────────┤
  └→ (none) ─────────────────────────────────────→ T7 (Pinia store + R18 闸门)
                                                    │
                                  T1+T2+T3+T8 ──────────→ T9 (Settings UI)
                                                    T7+T8 ─→ T10 (Detail integration)
                                                          ↓
                                                  所有 T1-T10 ─→ T11 (vitest)
                                                  所有 T1-T11 ─→ T12 (Android verify)
```

## 12 张 ticket 一览

| # | Ticket | Priority | 类型 | 关键交付物 | blocked by |
|---|--------|----------|------|-----------|------------|
| #629 | [T1 Types & interfaces](#t1-types--interfaces) | P0 | 类型契约 | `types/translation.ts` + `utils/translationHash.ts` | — |
| #630 | [T2 PictelioTranslate Java NativeModule](#t2-picteliotranslate-java-nativemodule) | P0 | 原生 | `PictelioTranslateModule.java` (OkHttp + Keystore) | T1 |
| #631 | [T3 NativeModule 注册 + TS bridge](#t3-nativemodule-注册--ts-bridge) | P0 | 原生 + TS | `LynxActivity.registerModule` + `native/pictelioTranslate.ts` | T1, T2 |
| #632 | [T4 OpenAIResponsesProvider](#t4-openairesponsesprovider) | P1 | LLM 适配 | `services/translation/openaiResponsesProvider.ts` | T1, T2, T3 |
| #633 | [T5 chunked pipeline primitive](#t5-chunked-pipeline-primitive) | P1 | 算法 | `services/translation/createNovelTranslator.ts` | T1, T4 |
| #634 | [T6 translationCache](#t6-translationcache) | P1 | 存储 | `services/translation/translationCache.ts` (IndexedDB 6 元组 + LRU 200) | T1 |
| #635 | [T7 novelTranslateStore + R18 闸门](#t7-noveltranslatestore--r18-闸门) | P1 | 状态机 | `stores/novelTranslateStore.ts` (8 状态 + generation-gate) | T1, T3, T4, T5, T6 |
| #636 | [T8 i18n novelTranslate.*](#t8-i18n-noveltranslate-50-键zh-cn--en) | P1 | 文案 | `i18n/locales/{zh-CN,en}.ts` 增 50 键 | — |
| #637 | [T9 SettingsEndpoint](#t9-settingsendpoint) | P2 | UI 设置页 | `pages/SettingsEndpoint.vue` + `Me.vue` 翻译分组 | T1, T2, T3, T8 |
| #638 | [T10 NovelDetail 集成](#t10-noveldetail-集成) | P2 | UI 集成 | `components/translation/*.vue` 4 个 + `pages/NovelDetail.vue` 挂载 | T7, T8 |
| #639 | [T11 Vitest 单测防线](#t11-vitest-单测防线12-测试组) | P3 | 测试 | `tests/{unit,integration}/*.test.ts` 12 测试组 | T1-T10 |
| #640 | [T12 Android 模拟器验证](#t12-android-模拟器手动验证) | P3 | 人工验收 | `tests/android-e2e/...` + `docs/verification/...` | T1-T11 |

## Ticket 详情

### T1 (#629): Types & interfaces

**目标**：实现 app-lynx 端小说翻译所需的 TypeScript 类型与接口契约——所有翻译层模块共享的领域模型。

**交付物**：`packages/app-lynx/src/types/translation.ts` + `packages/app-lynx/src/utils/translationHash.ts`

**关键点**：
- `LlmEndpointConfig` / `LlmEndpointPublic`（§4.1）：明文 config + 脱敏镜像
- `TranslationProvider` 接口（§4.2）：`id` / `translate(req, config, signal)` / `abort()`
- `TranslationStatus` 8 状态枚举（§4.3）
- `TranslationRequest` / `TranslationChunk`（§4.4）：5 种 chunk 形态
- `TranslationErrorCode` 11 项错误码
- `TranslationCacheKey` 6 元组（§4.5）
- 工具函数：`buildTranslationCacheKey` / `fnv1a32` / `computeSourceHash` / `hashBaseURL`

**验收**：`pnpm check -F pictelio-app-lynx` 绿；类型契约与 spec §4 一字对齐

[→ 跳转 GitHub #629](https://github.com/a1121611810/Pictelio/issues/629)

---

### T2 (#630): PictelioTranslate Java NativeModule

**目标**：实现独立 Java NativeModule `PictelioTranslateModule`，提供 API key 安全存取 + base URL/model 脱敏读取 + 流式 LLM HTTP 调用入口。

**交付物**：`packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioTranslateModule.java` + 单测

**关键点**：
- API key 走 Android Keystore（`pictelio_translate_llm_key` alias），JS heap 不可见（参考 ADR-0037）
- 暴露方法：`saveEndpoint` / `getEndpointPublic` / `clearEndpoint` / `testConnection` / `fetchStream` / `fetchOnce` / `abortFetch`
- 流式用 OkHttp + SSE（30+ Responses API 事件原样透传 JS）
- 错误码 → JS `TranslationErrorCode` 11 项映射在 Java 侧做

**验收**：Robolectric 单测全绿；HTTP 401/429/5xx 与 SSE error event 正确分发

[→ 跳转 GitHub #630](https://github.com/a1121611810/Pictelio/issues/630)

---

### T3 (#631): NativeModule 注册 + TS bridge

**目标**：把 T2 写完的 Java module 接到 Lynx 运行时（per-view 注册）；提供 TS 侧类型安全访问层 + 双通道探测。

**交付物**：`LynxActivity.java` 修改 + `packages/app-lynx/src/native/pictelioTranslate.ts` 新建

**关键点**：
- `LynxActivity.registerModule("PictelioTranslate", PictelioTranslateModule.class)`（必须在 `super.onCreate` 之前）
- TS bridge：强类型 wrapper + fetchStream 的 `AsyncIterable<SseEvent>` 包装
- web-core 环境 fetchStream / fetchOnce throw（防止误用）
- 双通道探测：`getNativeModules().PictelioTranslate ?? globalThis.PictelioTranslate`

**验收**：桥契约单测覆盖 native 模式 + web-core 模式

[→ 跳转 GitHub #631](https://github.com/a1121611810/Pictelio/issues/631)

---

### T4 (#632): OpenAIResponsesProvider

**目标**：实现 `OpenAIResponsesProvider`（`TranslationProvider` 当前唯一实现），统一走 OpenAI Responses API `/v1/responses`。

**交付物**：`packages/app-lynx/src/services/translation/openaiResponsesProvider.ts` + 单元测试

**关键点**：
- 请求体：`model` / `input` / `instructions`（默认 null）/ `stream: true` / `max_output_tokens: 4096` / `reasoning.effort`
- **不发送**：`previous_response_id` / `conversation` / `store` / `background` / `metadata` / `prompt_cache_key`（DeepSeek silently ignored）
- Azure URL 模板：探测 `*.openai.azure.com` 自动补 `/openai/v1` + `api-version: preview` header
- 流式响应解析：30+ 事件类型归一化到 5 种 chunk（delta / reasoning_delta / cached / done / error）
- DeepSeek 无 `[DONE]` 兼容（按 event 类型判定结束）
- 整批回退（Q6）：流中断 retryable → fetchOnce（stream=false）

**验收**：spec §9.1-9.4 边界单测全绿（Azure / DeepSeek / OpenRouter 硬拒绝 / 流中断回退）

[→ 跳转 GitHub #632](https://github.com/a1121611810/Pictelio/issues/632)

---

### T5 (#633): chunked pipeline primitive

**目标**：实现翻译流水线核心 primitive `createNovelTranslator`——按段落切块、并发翻译、对齐、AbortSignal 静默退出、整批回退入口。

**交付物**：`packages/app-lynx/src/services/translation/createNovelTranslator.ts` + 单元测试

**关键点**：
- 切块规则：段落边界优先，合并相邻段落直到 ≤2000 chars 或 ≤30 段
- 并发度 = 3（与 webview 端一致起步）
- 退避：指数 `2^n × 500ms`，最多 3 次
- 对齐：原段落数 = 输出段落数（失败块占位空串）
- 续翻语义（Q21）：`failedIndices` 非空 → 仅翻译这些段
- AbortSignal 静默终止（不抛错）
- `TranslationCacheLike` 注入式接口（mock 友好）

**验收**：切块 / 并发 / 对齐 / abort / 续翻 / 整批回退测试 6 类全绿

[→ 跳转 GitHub #633](https://github.com/a1121611810/Pictelio/issues/633)

---

### T6 (#634): translationCache

**目标**：实现翻译缓存层——IndexedDB 6 元组 schema、LRU 200 淘汰、并发去重、sourceHash 失效机制。

**交付物**：`packages/app-lynx/src/services/translation/translationCache.ts` + 单元测试

**关键点**：
- IndexedDB schema：DB `pictelio_lynx` + object store `translations` + 3 索引（cacheKey/modelId/cachedAt）
- 缓存键 hash：`buildTranslationCacheKey` 6 字段拼接 + FNV-1a 32-bit baseURL
- 写策略：仅 `done` 消费后才写；`partial`/`failed`/`aborted` 永不写
- 读策略：不二次校验 R18（体验优先）
- 并发去重（spec §9.8）：`getOrCompute(key, compute)` 复用 in-flight Promise
- LRU 200：每次 put 后 enforceLRU（按 `cachedAt` 升序删）

**验收**：6 字段缓存键 / sourceHash 失效 / baseURL 归一化 / LRU / 并发去重 / 写策略测试全绿

[→ 跳转 GitHub #634](https://github.com/a1121611810/Pictelio/issues/634)

---

### T7 (#635): novelTranslateStore + R18 闸门

**目标**：实现 Pinia store `novelTranslateStore`——8 状态机、generation-gate 守门、AbortController、并发去重、R18 应用层闸门、缓存 probe。

**交付物**：`packages/app-lynx/src/stores/novelTranslateStore.ts` + 单元测试

**关键点**：
- Setup store 闭包内私有 ref；公共 getters 显式 return
- 9 个核心 actions：`mount` / `startTranslate` / `abortTranslate` / `retranslate` / `clearTranslation` / `loadFromCache` / `setEndpoint` / `clearCache` / `clearCacheByModel` / `setR18Enabled` / `setR18GEnabled` / `resetOnChapterSwitch`
- 8 状态 + 18 转移路径（spec §7.2 表格一一对齐）
- generation-gate：`chunk.chapterId !== currentChapterId` → 丢弃
- R18 闸门：入口判断 `xRestrict` + `settings_translate_r18(_g)`，拒绝时**不发** provider 请求
- 并发去重：in-flight `Map<chapterId, Promise>`
- `displayBlocks` getter：UI 渲染用，按 mode 返回原文 / 译文

**验收**：18 转移路径全覆盖；generation-gate / R18 闸门 / abort / 并发去重单测绿

[→ 跳转 GitHub #635](https://github.com/a1121611810/Pictelio/issues/635)

---

### T8 (#636): i18n novelTranslate.* 50 键（zh-CN + en）

**目标**：补全 i18n 键 `novelTranslate.*`（spec §8 列出 50 键）到 zh-CN / en 双语字典。

**交付物**：`packages/app-lynx/src/i18n/locales/{zh-CN,en}.ts` 修改 + 键完整性测试

**关键点**：
- `endpoint.*` 25 键 + `action.*` 9 键 + `status.*` 6 键 + `error.*` 10 键
- 占位字符串按 spec §8 字面（zh-CN 源 + en 镜像；**不**新增键）
- 插值 placeholder：`{progress}` / `{n}` / `{provider}` / `{url}` 与 zh-CN/en 同名

**验收**：50 键全部存在；zh-CN/en 镜像均非空

[→ 跳转 GitHub #636](https://github.com/a1121611810/Pictelio/issues/636)

---

### T9 (#637): SettingsEndpoint

**目标**：实现设置页 LLM endpoint 表单 UI——M3 设计语言，4 字段表单 + inline probe + 测试连接 + Snackbar 反馈。

**交付物**：`pages/SettingsEndpoint.vue` + 4 子组件 + `Me.vue` 修改

**关键点**：
- 4 字段：Base URL / API Key / Model / Target Lang + Source Lang
- inline probe：debounce 600ms → bridge.testConnection → chip 显示兼容性（OpenAI/Azure/DeepSeek/vLLM/OpenRouter/无法探测）
- API Key show/hide toggle（5s 自动隐藏）+ clear 按钮
- 三字段校验（空 / URL 非法 → inline error）
- 「测试连接」按钮：1 token 最小翻译 + Snackbar 反馈
- 「保存」按钮：bridge.saveEndpoint → Keystore 持久化

**验收**：4 字段读写 / inline probe / show-hide / 校验 / 按钮反馈全测；a11y 通过

[→ 跳转 GitHub #637](https://github.com/a1121611810/Pictelio/issues/637)

---

### T10 (#638): NovelDetail 集成

**目标**：在 `pages/NovelDetail.vue` 完整集成翻译 UI——banner 翻译按钮 + sticky 整段切换 tab + cached ✓ 指示 + inline retry bar + 流式渲染段落。

**交付物**：4 个子组件 + NovelDetail.vue 修改

**关键点**：
- `TranslateButton.vue` 5 态：未译 / 配置 / 重译 / 翻译中 / 续译
- `TranslateModeSwitch.vue`：M3 segmented button + cached ✓ chip（长按弹重译）
- `TranslateRetryBar.vue`：M3 error-container + 「更换 endpoint」/「查看文档」按钮
- `TranslateProgressChip.vue`：流式进度显示
- 接线路由：`onMounted → store.mount(chapterId)`；`displayBlocks` getter 接管段落渲染

**验收**：5 态按钮 / < 50ms 切换 / cached 仅 completed 显式 / 长按弹重译 / 章节切换 abort 等组件测全绿

[→ 跳转 GitHub #638](https://github.com/a1121611810/Pictelio/issues/638)

---

### T11 (#639): Vitest 单测防线（12 测试组）

**目标**：编写跨模块集成测试 + spec 边界全覆盖测试，作为 CI 内的主要机器防线。

**交付物**：`tests/integration/*.test.ts` + `tests/unit/*.test.ts` 多文件

**关键点**：
- 12 测试组按 spec §10.1 表格一一覆盖：
  1. Provider 接口契约
  2. Chunk 规约
  3. SSE 帧解析（含 DeepSeek 无 [DONE]）
  4. 缓存键（6 字段）
  5. 缓存写策略（partial/failed/aborted 不写）
  6. 状态机（8 状态 + 18 转移）
  7. i18n 键完整性
  8. inline probe
  9. Azure URL 模板
  10. R18 闸门
  11. 续翻 (Q21)
  12. 并发去重
- mock 真实样例优先（OpenAI / DeepSeek 帧来自调研；Pixiv HTML 已有 fixture）
- **禁止**手写自洽字段（AGENTS.md 测试硬约束 #2）

**验收**：`pnpm test -F pictelio-app-lynx` 全绿；12 测试组逐一对应

[→ 跳转 GitHub #639](https://github.com/a1121611810/Pictelio/issues/639)

---

### T12 (#640): Android 模拟器手动验证

**目标**：在 Android 模拟器（或真机）手动跑翻译流程，记录截图 + 关键路径结果，作为发版前人工验收。

**交付物**：`packages/app-lynx/tests/android-e2e/specs/app-lynx-translation-flow.md` + 截图 + `docs/verification/...md`

**关键点**：
- 7 step 关键路径：endpoint Keystore / 流式翻译 / 切换原文-译文 / model namespace 隔离 / OpenRouter 错误 / R18 闸门 / 章节切换 generation-gate
- 验证报告模板（ALL PASS / 失败项转新 issue）

**验收**：7 step 全部 PASS + 截图存档 + 报告 commit

[→ 跳转 GitHub #640](https://github.com/a1121611810/Pictelio/issues/640)

---

## 备注

### 与 3 张 ADR 的契约边界

- **ADR-0169**（#619，已 IN REVIEW，由 sibling worker 写）→ T4（OpenAIResponsesProvider 请求构造 + Azure/DeepSeek 兼容）+ T5（pipeline 接口契约）
- **ADR-0170**（#620，已 IN REVIEW）→ T5（切块算法 + 并发数 + 退避 + 整批回退触发条件）
- **ADR-0171**（#621，已 IN REVIEW）→ T6（缓存键六元组 + LRU 200 + 旧 model 清理策略 + 续翻触发语义）

具体 ADR 文本若与本 ticket 内容冲突 → **以 ADR 为准**；ticket 必须按 ADR 收敛，必要时回灌 spec。

### 与 sibling worker 边界

- **prototype #624**：UI 视觉定型由 sibling worker 完成；T9 / T10 按 prototype 落地；如有偏差需在 PR 中标注
- **wayfinder map #617**：每个 ticket 完成后需在 map「Decisions so far」追加一条 `[Tn xxx](link): <一句话 gist>`（参见各 ticket 「Resolution 时」段）

### 与现有 codebase 的边界

- 完全限定在 `packages/app-lynx/` + `packages/app/android/app/src/lynx/java/`
- **不动** webview 端 `packages/app/src/services/translation/*`
- **不动** `@pictelio/novel-export`
- **不抽** 共享包（Q1）

### 命名冲突避坑

- `novelTranslateStore`（不用 `translationStore`）
- `PictelioTranslate`（不用 `PictelioApi.translate`）
- `createNovelTranslator`（与 webview 同名但独立实现）
- 各模块子组件用 `translation/` 子目录分组

### Code-review 闭环

每张 ticket 实现后必须执行：
1. `code-review` SKILL 双轴审计（Standards + Spec，含调用点完备性 + Oracle 溯源 + 平台契约）
2. 任何发现 → 走 `tdd` 修复
3. 全部清零 → close issue，触发下一张 ticket
