# Ticket Plan — app-lynx 失败重试 + partial 段落 UI（wayfinder #643）

**Part of:** wayfinder map #644（app-lynx 小说翻译收尾遗留项收敛）
**Source ticket:** issue #643（无标签 root ticket；被 #651 决策阻塞 → 现已解锁）
**ADR anchors:** [ADR-0178](https://github.com/a1121611810/Pictelio/blob/main/docs/adr/ADR-0178-app-lynx-translation-retry-and-partial-ui.md)（重试 + partial UI 形态参数决策）+ [ADR-0169](../docs/adr/ADR-0169-translation-provider-interface.md) D5.3（chunked pipeline 失败块回退原文）+ [ADR-0170](../docs/adr/ADR-0170-lynx-translate-nativemodule-bridge.md) §2（Java 错误标志 retryable）
**Spec sections:** §7.2（状态机）/ §8（i18n 键 status.retrying）/ §9.6（流式中断路径）/ §10.1 oracle 表
**Base line:** HEAD `03ed8610`（fix branch；含 5 张 ADR + spec 同步）

## Target end state

app-lynx 端翻译流中断时：
- **自动**整批回退（0ms 退避；stream=false, max_output_tokens × 2；不走 chunked pipeline）
- UI 保持 `translating` + 微提示「重试中…」（≤3s 自动消失）
- 仅 `retryable=true` 的错误触发（network / server 5xx / incomplete）；429 等不触发
- 整批回退成功 → `completed`；失败 → `partial`（有 ≥1 译文段）或 `failed`（零译文 → `content_filter`）
- partial 段落 = 位置/索引保留 + 浅灰斜体 `〔未翻译〕` 占位
- 用户 retry 按钮 1.5s debounce 防双击

## 范围

**In:**
- `packages/app-lynx/src/api/translate.ts` —— `OpenAIResponsesProvider.translate()` catch 块：所有错误 emit `error(code, message, retryable)`；429 设 `retryable=false`（特判）
- `packages/app-lynx/src/stores/novelTranslateStore.ts` —— 新增 `fallbackToWholeBatch()` + 触发逻辑 + 终态分类
- `packages/app-lynx/src/components/novel/TranslationStatusBar.vue`（或等价组件）—— 「重试中…」微提示 + 用户 retry 按钮 debounce
- `packages/app-lynx/src/components/novel/ParagraphView.vue`（或等价组件）—— partial 段落 `〔未翻译〕` 灰色斜体占位
- `packages/app-lynx/src/locales/{zh-CN,en}.json` —— 新增 `status.retrying` 键
- Vitest：retry 触发子集过滤 + partial UI 渲染 + 用户 retry debounce

**Out:**
- 429 自动退避（与 ADR-0178 D2 锁死的"不自动 retry"相悖）
- 指数退避（ADR-0178 D3 已锁死 0ms）
- 翻译续翻按钮（spec §9.5 OOS）
- partial 段落动画进入（保持静态视觉，避免与整体 UX 偏离）

## 前置依赖

- ✅ #651 决策已解锁（ADR-0178 已写）
- ✅ #654 已落地（空流 = `content_filter` → partial / failed 终态联动）
- ✅ spec §7.2 + §9.6 + §8 + §10.1 已同步（commit 03ed8610）
- ⚠️ 等待 ADR-0178 用户 review → 拍板后开工

## Tickets

### T1 — Provider 错误分类（retryable 标志）

**位置**：`packages/app-lynx/src/api/translate.ts`

修改 `OpenAIResponsesProvider.translate()`：

```typescript
catch (err) {
  const { code, message } = classifyHttpError(err)  // 已有函数
  let retryable = false
  switch (code) {
    case 'network':
    case 'server':     // 5xx
    case 'incomplete': // 输出截断
      retryable = true
      break
    case 'rate_limit': // 429 特判：不自动 retry
    case 'unauthorized':
    case 'insufficient_balance':
    case 'invalid_request':
    case 'model_not_found':
    case 'content_filter':
    case 'endpoint_not_responses':
      retryable = false
      break
    default:
      retryable = false  // 保守
  }
  yield { type: 'error', code, message, retryable } as TranslationChunk
}
```

### T2 — Store 自动整批回退

**位置**：`packages/app-lynx/src/stores/novelTranslateStore.ts`

新增：

```typescript
async function fallbackToWholeBatch(request: TranslationRequest): Promise<void> {
  // 不走 chunked pipeline
  const wholeReq = { ...request, stream: false, max_output_tokens: request.max_output_tokens * 2 }
  try {
    const result = await provider.translate(wholeReq)  // 单次 POST 拿到完整 JSON
    if (result.paragraphs.length > 0) {
      // 成功
      this.status = 'completed'
      this.translatedParagraphs = result.paragraphs
      cache.write(request.cacheKey, result.paragraphs)
    } else {
      // 整批回退零译文 → 走 #654 空流路径
      this.status = 'failed'
      this.lastError = { code: 'content_filter', message: 'LLM 未返回任何译文' }
    }
  } catch (err) {
    // 整批回退失败
    if (this.translatedParagraphs.some(p => p.text)) {
      this.status = 'partial'
    } else {
      this.status = 'failed'
    }
    this.lastError = classifyProviderError(err)
  }
}
```

状态机入口（`onErrorChunk`）：

```typescript
if (chunk.type === 'error') {
  if (chunk.retryable && !this.retriedViaWholeBatch) {
    this.retriedViaWholeBatch = true
    this.status = 'translating'  // 保持，不切 partial
    this.retryingHint = true       // 显示「重试中…」微提示
    fallbackToWholeBatch(this.currentRequest).then(() => {
      this.retryingHint = false
    })
  } else {
    // 不 retry → 走原有 failed/partial 路径
    if (chunk.retryable) this.lastError = chunk  // 整批回退也失败
    this.status = this.translatedParagraphs.some(p => p.text) ? 'partial' : 'failed'
  }
}
```

### T3 — UI 组件：「重试中…」微提示 + 用户 retry debounce

**位置**：`packages/app-lynx/src/components/novel/TranslationStatusBar.vue`

- 「翻译中 N%」进度条：复用现有 translating 状态
- retryingHint = true 时：进度条下方加「重试中…」小字提示，浅色字（M3 color token），≤3s 自动消失
- 用户 retry 按钮：1.5s debounce（lodash `debounce` 或自实现）

```vue
<template>
  <div class="translation-status-bar">
    <progress-bar v-if="status === 'translating'" :progress="progress" />
    <span v-if="retryingHint" class="retrying-hint">{{ t('status.retrying') }}</span>
    <retry-button v-if="status === 'partial' || status === 'failed'"
                  @click="onUserRetry"
                  :debounce="1500" />
  </div>
</template>
```

### T4 — UI 组件：partial 段落灰色斜体占位

**位置**：`packages/app-lynx/src/components/novel/ParagraphView.vue`

partial 状态下：
- 已译段：正常渲染译文
- 未译段：段落位置保留（不塌陷），内容用 `〔未翻译〕` 占位，样式 = `color: var(--md-sys-color-on-surface-variant); font-style: italic;`

```vue
<template>
  <p v-for="(para, idx) in paragraphs" :key="idx" class="paragraph"
     :class="{ 'paragraph--untranslated': !para.text }">
    {{ para.text || t('status.placeholder_untranslated') }}
  </p>
</template>

<style scoped>
.paragraph--untranslated {
  color: var(--md-sys-color-on-surface-variant);
  font-style: italic;
}
</style>
```

### T5 — i18n 新增键

`packages/app-lynx/src/locales/zh-CN.json` + `en.json`：

```json
{
  "novelTranslate": {
    "status": {
      "retrying": "重试中…"  // en: "Retrying…"
    }
  }
}
```

### T6 — Vitest 单测

#### 6.1 重试触发子集
- mock 6 类错误码，验证 4 类触发 + 2 类不触发（429 / 401）
- mock `translate` 返回 `error(code, retryable=true)` → store 自动调 `fallbackToWholeBatch`
- mock `translate` 返回 `error(code, retryable=false)` → store 不调用 `fallbackToWholeBatch`，直接走 failed/partial

#### 6.2 Partial UI 渲染
- mount `ParagraphView`，传入 mixed array（有译文 + `text: ''`）
- 断言未译段渲染为 `〔未翻译〕` 文字 + `paragraph--untranslated` class

#### 6.3 用户 retry 按钮 debounce
- mount `TranslationStatusBar`
- 模拟连续点击 retry 按钮 3 次（间隔 100ms）
- 断言 `onUserRetry` 只被调用 1 次

#### 6.4 变异实验
- 删 `retryable` 检查 → 重试触发子集测试变红
- 删 `debounce` → debounce 测试变红
- 改 `〔未翻译〕` 为空字符串 → partial UI 渲染测试变红

## CI 门禁（合并前置）

- `pnpm test:app-lynx --run`（含 6.1-6.4）
- pre-push hook：自动跑 app-lynx 单测
- `./gradlew testFullDebugUnitTest` 全量绿（无 Java 改动，但保险起见）

## 验收（设备实测，#640 step 7）

- 模拟器 mock SSE 服务制造 5xx 中断 → 整批回退 → 成功 → UI 显示「重试中…」3s 内消失
- 制造 429 中断 → 不自动 retry → UI 显示「请求频率超限」+ 手动 retry 按钮
- 制造整批回退也失败 → partial 状态 → 段落 `〔未翻译〕` 灰色斜体显示
- 截图存档 `docs/verification/app-lynx-translation-emulator.md`

## Out of scope

- 429 自动退避（ADR-0178 D2 锁死不自动 retry）
- 指数退避（ADR-0178 D3 锁死 0ms）
- 翻译续翻按钮（spec §9.5 OOS）
- partial 段落动画

## References

- ADR-0178 D1（静默即时 0ms）/ D2（retryable=true 过滤；429 例外）/ D3（0ms 退避；用户 retry 1.5s debounce）/ D4（灰色斜体占位）
- ADR-0169 D5.3（chunked pipeline 失败块回退原文；不走 chunked pipeline 走整批）
- ADR-0170 §2（Java 错误标志 retryable 字段）
- spec §7.2（状态转移表）/ §8（i18n）/ §9.6（流式中断路径）/ §10.1 oracle
- issue #651（决策票，已解锁）/ #643（root ticket）/ #654（联动空流→content_filter）
- 姊妹 ticket：`2026-09-20-fix-empty-stream-gate.md`