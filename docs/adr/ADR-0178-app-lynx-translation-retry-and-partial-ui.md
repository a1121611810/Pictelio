# ADR-0178: app-lynx 翻译失败重试与 partial 段落标记的形态参数

- **状态**: proposed（2026-09-20）
- **日期**: 2026-09-20
- **关联**: wayfinder map [#644](https://github.com/a1121611810/Pictelio/issues/644)（app-lynx 翻译收尾遗留项收敛）；issue [#651](https://github.com/a1121611810/Pictelio/issues/651)（决策：失败重试策略与 partial 段落标记语义）；issue [#643](https://github.com/a1121611810/Pictelio/issues/643)（root ticket：失败重试与 partial 段落标记）；spec [docs/specs/app-lynx-novel-translation.md](../specs/app-lynx-novel-translation.md) §6 Q6「流式优先 + 整批回退」/ §7.1–7.2 状态机 / §9.5「缓存写只在 done 之后」/ §11 A2「流式整批回退最多 1 次」；ADR-0169（TranslationProvider 接口）；ADR-0170（native bridge / chunked pipeline）；ADR-0171（缓存键与模型档位）；ADR-0173 D7（端点探测与凭据验证 + 错误码联合类型）

---

## 背景

map #644 收尾过程中需要把 spec §6「流式中断 → 自动整批回退」的**形态参数**与 **partial 段落标记**钉死。

**已被 spec / ADR 锁定的部分**（不可重新决策）：

| 维度 | 已约束 | 出处 |
|---|---|---|
| 整批回退最大次数 | 1 次 | spec §11 A2 |
| 整批回退形态 | `stream=false, max_output_tokens × 2` + 整章一次性提交 | spec §6 §347 / ADR-0169 D5.3 |
| partial 状态语义 | 「流中断后整批回退也失败；部分段落有译文」 | spec §7.1 |
| partial 段落标记文字 | `〔未翻译〕` / `〔Untranslated〕` | spec §8 i18n 键 `status.placeholder_untranslated` |
| 续翻语义 | 自动从头重翻（缓存命中秒完）；不弹按钮 | spec §9.5 / Q21 |
| 缓存写唯一时机 | `done` 之后；`partial`/`failed`/`aborted` 永不写 | spec §9.5 / §7.2 |
| 用户主动 retry 转移 | `partial` / `failed` → `retry()` → `pending`（重置 failedParagraphs + startTranslate） | spec §7.2 状态转移表 |

**仍待形态参数化的部分**（本 ADR 落地）：

1. 自动整批回退的**触发时机**与**UI 反馈**
2. 哪些**错误码**触发自动整批回退
3. 自动 retry 的**退避**与用户 retry 的**节流**
4. partial 段落的**UI 标记形态**

---

## 决策

### D1. 自动整批回退的触发时机与 UI 反馈 = 静默即时（0ms）

**采纳方案 A**（spec §720 原文「自动回退」一致）。

- **触发时机**：stream 中断瞬间（chunk `error(retryable=true)` 到达 store）→ 立即 0ms 触发整批回退；**不延迟**、**不弹窗**、**不切 status**。
- **UI 反馈**（retry 期间）：store 状态保持 `translating`；进度条沿用现有「翻译中 N%」形态，但 N% 在回退开始时重置为 0% 然后线性爬升；底部加一个微提示「重试中…」（≤3s 出现，自动消失）。
- **终态**：
  - 整批回退成功 → `completed` + 缓存写。
  - 整批回退失败 → `partial`（有 ≥1 段落译文）或 `failed`（零译文；与 #654 联动 → `content_filter` 错误码）。
- **为什么不用 B（显式 partial + 用户手动 retry）**：与 spec §720「自动」原文相悖；用户操作成本；UI 多一个永久状态。
- **为什么不用 D（依错误码分流 retry 提示）**：把 retry 语义分裂到两个 UI 形态，UI 复杂度 ×2 而无明显收益。

### D2. 自动整批回退的触发错误码子集 = `retryable=true` 全集

**采纳方案：按 Java 侧 `chunk.retryable` 标志过滤**（ADR-0170 §2 + ADR-0173 D7 错误码联合类型）。

| 错误码 | `retryable` | 是否触发整批回退 |
|---|---|---|
| `network` (TCP RST / 连接超时 / DNS) | true | **是** |
| `server` (HTTP 5xx) | true | **是** |
| `incomplete` (输出截断) | true | **是** |
| `unauthorized` (HTTP 401/403) | false | 否 → `failed` |
| `insufficient_balance` (HTTP 402) | false | 否 → `failed` |
| `rate_limit` (HTTP 429) | false | 否 → `failed`（由用户手动 retry；自动重试会触发 endpoint 限流放大，违反 spec §720「不雪崩」精神） |
| `invalid_request` (HTTP 400) | false | 否 → `failed`（请求无效，重试无意义） |
| `model_not_found` (HTTP 404/405) | false | 否 → `failed` |
| `content_filter` (内容策略拒答 / 空流) | false | 否 → `failed`（语义：内容被拒，非网络/服务端问题） |
| `aborted` (用户主动中断) | n/a | 否 → `aborted`（不计费归因） |
| `endpoint_not_responses` (endpoint 协议不兼容) | false | 否 → `failed` |

**实现位**：`packages/app-lynx/src/api/translate.ts` 的 `OpenAIResponsesProvider.translate()` 内 catch 错误 → emit `error(code, message, retryable)`；`novelTranslateStore` 在 `error(retryable=true)` 分支调用 `fallbackToWholeBatch()`（封装 `stream=false` 请求）。

**为什么 429 不自动 retry**：429 的「请求频率超限」是 endpoint 主动限流；自动重试即使加退避也会被 endpoint 视为攻击模式放大封禁；交由用户手动 retry（已由 `retry()` 动作承接）。

### D3. 自动退避 0ms + 用户 retry 按钮 1.5s debounce

- **自动整批回退**：**0ms 退避**（即时触发）。流已中断，UI 状态保持 `translating` + 微提示「重试中…」即可，用户感知延迟最小。
- **用户主动 retry**：按钮 1.5s debounce（防双击连点 + 误触）。
- **为什么不上指数退避**：流中断 = endpoint 临时不可用；自动整批回退本身已经把请求体从 SSE 改为单次 POST，载荷从「30+ SSE 帧」变成「一次 JSON」，endpoint 视角属于「同一用户的下一个请求」，不需要退避保护。

### D4. partial 段落标记 UI = 灰色斜体占位 + 段落高度保留

- 已译段：与正常译文一致（纯文字）。
- 未译段（partial 状态下）：段落**位置与索引保留**（不塌陷、不重排），内容用 `〔未翻译〕` 占位（spec §8 i18n 键），**视觉差异化** = 浅灰文字 + 斜体（与正文 M3 typography token 一致）。
- 段落间距、margin、字号与已译段完全相同 → 视觉一致性优先。
- 顶部不另加 banner；inline retry bar 已有；段落级别的「未译」靠段落自身视觉区分。
- **为什么不用 B（空段落 + 顶部 banner）**：用户难以定位「具体哪一段未译」；spec §7.1「段落标 〔未翻译〕」原文支持 A。
- **为什么不用 C（原文+译文混排）**：与「切回原文 tab」UX 重叠；语义模糊（用户看到的是「重译了一半」还是「混合显示」？）。
- **为什么不用 D（强制回原文 tab）**：放弃 partial 的设计意图（让用户看到哪些段已译）；用户切回原文 tab 已是可单独 UX。

---

## 决策溯源（与 #644 决策溯源 同源检查）

| 议题 | 我原本的开放度 | 实际 |
|---|---|---|
| 整批回退次数 | 「待决策」 | spec §11 A2 已锁死 = 1 次 |
| 整批回退形态 | 「待决策」 | spec §6 §347 已锁死 = `stream=false` |
| partial 语义 | 「待决策」 | spec §7.1 已锁死 = 「整批回退失败 + 部分段落有译文」 |
| partial 段落标记文字 | 「待决策」 | spec §8 已锁死 = `〔未翻译〕` |
| 错误码分类 | 「待决策」 | ADR-0173 D7 + spec §11 已锁死 |

⇒ 本 ADR 的 4 个决策是「把已锁死的语义落到**具体形态参数**」，不构成重新决策；仅 spec §7.2 状态表新增两行（retry 期间 UI 状态由 `translating` 保持 + 0ms 触发），其余为 §6 + §7.1 + §9.5 已有的细化。

---

## 落地动作

1. **spec 更新**：
   - §7.2 状态转移表新增两行：
     - `translating` | chunk `error (retryable=true)` | `translating` (重试中) | `stream=false, max_output_tokens × 2` 整批回退；UI 保持 `translating` + 微提示
     - `translating` | chunk `error (retryable=false)` | `partial`/`failed` | 不触发自动回退
   - §8 i18n 键新增 `status.retrying` = "重试中…" / "Retrying…"
   - §11 A2 注释追加「retry 触发子集 = `retryable=true` 全集；429 例外」。

2. **代码落点**（#643 实施）：
   - `packages/app-lynx/src/api/translate.ts` → `OpenAIResponsesProvider.translate()` catch 块：所有错误 emit `error(code, message, retryable)`；其中 5xx/network/incomplete 设 `retryable=true`；429 设 `retryable=false`（特判）。
   - `packages/app-lynx/src/stores/novelTranslateStore.ts` → 新增 `fallbackToWholeBatch()`：触发整批回退（`stream=false` 单次 POST），成功 → `completed`；失败 → `partial`/`failed`。
   - `packages/app-lynx/src/components/novel/TranslationStatusBar.vue`（或等价组件）→ 「重试中…」微提示；用户 retry 按钮 1.5s debounce。
   - `packages/app-lynx/src/components/novel/ParagraphView.vue` → partial 段落 `〔未翻译〕` 灰色斜体占位。

2b. **native（真机）路径实现**（code-review P1/P2 阻塞项修订；本 ADR 的 D1 原本只描述了形态，
    未明确要求 Java 侧实装 —— review 指出 web 与 native 两条 provider 路径必须同形）：

   - `packages/app-lynx/src/api/nativeTranslate.ts` → `translateStream` 载荷新增 `stream` 字段
     （此前未下发，Java 侧无从得知回退意图）。
   - `packages/app-android .../PictelioTranslateModule.java` →
     - `buildRequestBody(req, model, inputArr, wantStream)`：`stream` 由载荷驱动（默认 true）；
       `wantStream=false` 时 `max_output_tokens × 2`（clamp 16384）—— D1 的「× 2」字面要求。
     - 新增 `deliverWholeBatchJson(streamId, rawBody)`：非流式响应解析 → 帧契约与
       `TranslationSseParser.emitConsolidated` 同形（`{type:"delta_all", paragraphs:[…]}`）+
       终态判定（`failed`/`incomplete`/零 output_text 均报错 → 不得判 done，与 #654 同源）。
     - 新增 `drainQueueToStreamBuffer(streamId)`：抽出流式/非流式共用的缓冲搬运 + 盖章逻辑。
   - `packages/app-lynx/src/api/nativeTranslate.ts` → `RETRYABLE_NATIVE_CODES`
     （`server` / `network` / `incomplete`）+ `isRetryableNativeError()`：替换原先 4 处
     `retryable: true` 硬编码（D2 子集在 native 路径上的落地）。

3. **CI 防线**：
   - Vitest：retry 触发子集过滤测试（mock 6 类错误码，验证 4 类触发 + 2 类不触发）。
     **已实施**：`nativeTranslate.test.ts` 4 条矩阵（429 → `rate_limit`+false / 401 →
     `unauthorized`+false / 500 → `server`+true / 空流 → `content_filter`+false）。
   - Vitest：`stream=false` 分支截断判定 —— **已实施** 2 条（`status=incomplete` +
     `max_output_tokens` → `incomplete`+false；其他 reason → `invalid_request`+false）。
   - Vitest：native 载荷 `stream` 字段透传 —— **已实施** 2 条（默认 true / `stream:false`）。
   - Vitest：partial 段落 UI 渲染快照（未译段 = 灰色斜体 + 占位文字）— **待补**（当前只有
     store 层 `refreshDisplay` 行为覆盖）。
   - Vitest：用户 retry 按钮 debounce 测试（连续点 2 次只触发 1 次）— **待补**（见 D3 注）。
   - 变异实验：删 `fallbackToWholeBatch()` 调用 → 错误不被自动回退 → 测试红。

4. **设备取证**（#640 step 7）：
   - 模拟器 mock SSE 服务：制造 5xx 中断 → 整批回退 → 成功 → UI 显示「重试中…」3s 内消失 → 缓存命中。
   - 截图存档 `docs/verification/app-lynx-translation-emulator.md` 第 7 步。

## 已知未落地项（诚实的缺口清单）

以下三项在实施中被 review 指出，**当前未交付**，登记于此避免被误读为已完成：

| # | 要求 | 出处 | 现状 |
|---|---|---|---|
| 1 | 回退期间进度重置为 0% | D1 | 未实现：`fallbackToWholeBatch` 只在成功时写 progress |
| 2 | 用户 retry 按钮 1.5s debounce | D3 | 未实现：`TranslateButton.vue onTap` 无 debounce |
| 3 | partial 进度不虚报 100% | issue #651 范围补充 | 未实现：`novelTranslateStore` 的 `partial` 分支仍 `done = total` |

另：回退零译文 → `content_filter` 联动（D1 脚注）当前返回 `failed` 而非 `content_filter`。

---

## Out of scope

- **429 自动退避**（与本 ADR D2 相悖；如未来要加需另开 ADR）。
- **指数退避**（D3 已锁死 0ms；如未来要加需另开 ADR）。
- **翻译续翻按钮**（spec §9.5「不弹续翻按钮」已锁死）。
- **partial 段落的动画进入**（保持静态视觉，避免与整体翻译 UX 偏离）。

---

## References

- spec §6「流式优先 + 整批回退」+ §7.1–7.2 状态机 + §9.5「缓存写只在 done 之后」+ §11 A2
- ADR-0169 D5.3「chunked pipeline 失败块回退原文」+ D5.4「AbortSignal 静默退出」
- ADR-0170 §2 Java 错误标志 + §1.4 信封契约
- ADR-0171 §5「半成品不写」+ §1「缓存键六元组」
- ADR-0173 D7「错误码联合类型」
- issue #651（决策票）/ #640（root ticket step 7）/ #643（root ticket 实施）/ #654（已 closed，空流即 `content_filter`）
- ADR-0174（Java 终态测试契约，本 ADR 不变更）