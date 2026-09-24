# app-lynx 翻译流程手动验证 spec — PR #657 后版（#640 step 7 / #645 收口）

> **背景**：原 #640 票面 7 步经 #645 核查发现：
> - step 7（章节切换 generation-gate）需 #652/#653 落地才跑得通 → 现已在 PR #657 落地（commit 6e1ad678 wire JS abort to native OkHttp / commit 15fedc21 polyfill AbortError）
> - step 6（R18 闸门）的 store 实装与票面「按钮 disabled」措辞不一致（store 层 `aborted + R18_BLOCKED`），按 ADR-0173 D5 走「页内内联提示」是有意偏离
> - 「已缓存 ✓」标识原本要求 UI 渲染，但 `i18n/locales/zh-CN/novelTranslate.ts:46` 键已定义但 LABEL_KEYS 无 cached 项；本 spec 沿用现状不做强制
>
> 本 spec 是 PR #657 落地后的**可执行版本**，按 7 步跑即可，每步含 oracle + 截图命名 + 通过条件。

---

## 环境基线

- 模拟器：API 34 (Android 14) Apple Silicon — `Pixel 6` profile
- 真机（备份）：Pixel 6 / 小米 13
- 真实 LLM endpoint：OpenAI gpt-5 / DeepSeek-V4（备）
- 网络：海外代理（`https_proxy` / `HTTPS_PROXY`，回退 `http://127.0.0.1:7897`）
- Pixel env：`packages/app-lynx/.env` 的 `PIXIV_REFRESH_TOKEN` / `DEEPSEEK_API_KEY`（**不要 echo**）
- Dev hook：`BENCH_NAV=1 NODE_ENV=production pnpm --dir packages/app-lynx run build` 后 `pnpm --dir packages/app/android run build:android:debug`

---

## Step 1 — endpoint 配置 + Keystore 持久化

**操作**：
1. 启动 app-lynx → 进「我」→「翻译」分组（Me.vue:1096-1099）
2. 填 Base URL（OpenAI `https://api.openai.com/v1`）+ API Key（≥20 字符）+ Model（`gpt-5`）
3. 点「保存」

**断言**：
- ✅ 保存成功 → 设置页出现「✓ 已保存」内联提示（ADR-0173 D5：页内内联，非 Snackbar）
- ✅ 杀掉 app 进程（`adb shell am force-stop io.pictelio.app`）→ 重启 → endpoint 仍在设置页
- ✅ 重启后 inline probe 仍能跑（说明 baseURL/model 在 Keystore 外层 metadata 也持久化了）

**截图**：`step1-keystore.png` —— 重启前后 endpoint 一致

**已知偏离**：
- 票面要求「✓ 已保存」用 Snackbar → ADR-0173 D5 显式偏离到页内内联，不属遗漏
- 「杀进程重启后仍在」由 1 次手动重启 + 1 次截图覆盖；3 次重启更稳

---

## Step 2 — 翻译一章 + 流式输出（PR #657 改进）

**操作**：
1. 进小说详情（任意章节，3+ 段）
2. 点右下 FAB「翻译本章」（首次）或「重译」（已缓存）
3. 观察进度：圆环百分比 + 段落增量替换

**断言**：
- ✅ 流中断自动触发整批回退（fallbackToWholeBatch，commit 96d45ef9）：sse 5xx 中断 → UI 微提示「重试中…」≤3s → 成功则状态变 completed + 写缓存
- ✅ 完成后按钮变「重译」+ segmented bar 出现「✓ 翻译」
- ⚠️ 「逐段增量渲染」在真机上**可能**只看到整章替换（已知限制 #1）：chunked pipeline 在真机 3 路并发下被 Java 侧串行（line 781-784），体感与整批近似，但底层仍是逐 chunk

**截图**：
- `step2-1-pre-fallback.png` —— 流中断触发 fallback 瞬间
- `step2-2-retrying-hint.png` —— 「重试中…」微提示（commit 654e6fdf）
- `step2-3-completed.png` —— 完成后 cached 态

---

## Step 3 — 原文 / 译文切换 + 用户 retry 1.5s debounce

**操作**：
1. 翻译完成后 → segmented bar 切换「原文」↔「译文」
2. 故意制造 retry：清缓存 → 切 baseURL 到 OpenRouter（仅 chat/completions）→ 重译
3. 连点 retry 按钮 3 次（间隔 100ms）

**断言**：
- ✅ 切换原文/译文 < 50ms（store 的 `displayParagraphs` 单点决定，spec §6.3）
- ✅ OpenRouter 错误显示「⚠ 仅 chat/completions 兼容」（spec §5 探测路径）
- ✅ 用户 retry debounce 1.5s：连点 3 次只触发 1 次（TODO: #637 a11y 残余，本步依赖 #637 完成后才能验）

**截图**：
- `step3-1-original.png` —— 切回原文 < 1ms
- `step3-2-translated.png` —— 切译文 < 50ms
- `step3-3-openrouter-error.png` —— OpenRouter chip

**已知偏离**：
- retry debounce 1.5s 是 ADR-0178 D3 设计，但 commit 85467a6a 暂未实现 UI 按钮 debounce（仅 store 层 fallback 0ms）。需 #637 一并落地

---

## Step 4 — model 切换 → 缓存 namespace 隔离

**操作**：
1. 设置页改 Model 为 `deepseek-v4-pro`
2. 保存 → 回详情页
3. 点「重译」

**断言**：
- ✅ 重新发起翻译请求（缓存 key 含 modelId 维度，6 元组 namespace 隔离，spec §4.5 + ADR-0171 §1）
- ✅ 旧 model 缓存未命中，强制走 provider

**截图**：`step4-model-namespace.png` —— logcat 显示新 model 的 translate 请求

---

## Step 5 — 异常路径 / OpenRouter partial probe（PR #657 已修）

**操作**：
1. 设置 → Base URL 改 OpenRouter（`https://openrouter.ai/api/v1`）
2. 保存 → 触发 inline probe 600ms debounce

**断言**：
- ✅ inline probe chip 显示「⚠ 仅 chat/completions 兼容」
- ✅ 点「翻译」→ 走 OpenAIResponsesProvider → 404 `endpoint_not_responses`（test ID 552）
- ✅ 切换 `error.code === 'rate_limit'` 不自动 retry（429 例外，commit a82dd29 + test ID 552）

**截图**：`step5-openrouter-partial.png` —— 探测 chip + error chip 双重反馈

---

## Step 6 — R18 闸门（ADR-0173 D5 偏离确认）

**操作**：
1. 设置页「翻译」分组 → 关 R18 内容开关
2. 进 R-18 章节详情

**断言**：
- ✅ 进 R18 章节时 store 层判 `xRestrict===2` + `settings.translationRestricted === true` → `store.status.value = 'aborted'` + `error.code = 'R18_BLOCKED'`
- ✅ 按钮 `disabled = true`（仅当 R18_BLOCKED 时，TranslateButton.vue:78-80）
- ✅ 点击不发起 provider 请求（store 早退）
- ⚠️ 与票面「按钮 disabled 永久」措辞不一致 —— 实装为「R18_BLOCKED 状态时 disabled」；按 ADR-0173 D5 是有意偏离

**截图**：`step6-r18-blocked.png` —— disabled 按钮 + R18 提示

**已知偏离**：
- ADR-0173 D5 显式记录「R18 拦截 + disabled 按钮」与 spec §15 不一致是有意偏离（避免空章节详情页空转）

---

## Step 7 — 章节切换 generation-gate（PR #657 关键解锁）

**操作**：
1. 进长章节（30+ 段）→ 点「翻译」开始
2. **立即**（不等翻译完成）→ 切到下一章
3. 观察旧请求是否被取消（logcat / mock 服务端连接计数）

**断言**：
- ✅ 旧请求 `abortStream(token)` 真的取消 OkHttp Call（commit 6e1ad678）
- ✅ logcat 出现 `abortStream 取消:` 日志（`PictelioTranslateModule.java:718`，PR #653 路径）
- ✅ 切到下一章后立即显示「翻译本章」按钮（旧请求 abort + gen gate `gen !== genNow` 不写新状态）
- ✅ 旧请求的 chunk 不会写入新章节的 `translatedParagraphs`

**截图**：
- `step7-1-translating-long.png` —— 长章节开始翻译
- `step7-2-aborted.png` —— 切章节后旧流已 abort（logcat 截图）

**依赖解除**：#652 / #653 在 commit 6e1ad678 / 15fedc21 落地，#640 step 7 不再阻塞

---

## 验证报告模板

```md
# app-lynx 翻译 Android 验证 — YYYY-MM-DD — PR #657 后

| Step | 描述 | 结果 | 截图 | 备注 |
|------|------|------|------|------|
| 1 | endpoint Keystore 持久化 | ✅/❌ | step1-keystore.png | 重启后 endpoint 仍在 |
| 2 | 流式翻译 + fallback 微提示 | ✅/❌ | step2-{1,2,3}-*.png | 流中断 fallback 验证 |
| 3 | 原文/译文切换 | ✅/❌ | step3-{1,2,3}-*.png | OpenRouter chip |
| 4 | model 切换 namespace 隔离 | ✅/❌ | step4-model-namespace.png | |
| 5 | OpenRouter partial probe | ✅/❌ | step5-openrouter-partial.png | |
| 6 | R18 闸门（ADR-0173 D5 偏离） | ✅/❌ | step6-r18-blocked.png | |
| 7 | 章节切换 generation-gate | ✅/❌ | step7-{1,2}-*.png | #652/#653 已解锁 |

总体：X/7 PASS（剩余 Y 项详见备注）

## 与 PR #657 关键能力对照
- ✅ step 2：fallbackToWholeBatch + 「重试中…」微提示（commit 96d45ef9 + 654e6fdf）
- ✅ step 7：abortStream 真的取消 OkHttp（commit 6e1ad678）
- ⚠️ step 3 retry 1.5s debounce：设计完成（ADR-0178 D3）但 UI debounce 待 #637 a11y 残余
- ⚠️ step 6 R18：按 ADR-0173 D5 偏离「按钮永久 disabled」措辞
```

---

## 复用脚本

`packages/app/tests/android-e2e/tools/verify-translation.sh`（106 行）做构建/安装/mock SSE 启动。
`packages/app/tests/android-e2e/tools/verify-abort.sh`（commit `c321825e`）做 abort 通道验证，可作为 step 7 的参考。

建议：**新增 `verify-fallback.sh`**（参考 verify-abort.sh 模式），专门验证 step 2 fallback 路径：
- mock 服务返回 200 + 正常 SSE 前 5 段
- 然后 mock 返回 HTTP 500
- 断言「重试中…」微提示 + fallback 成功 + 译文完整

---

## Resolution 时

- close issue #640
- 在 #617 「Decisions so far」追加 `[T12 Android 验证](link): 7 step 全部 PASS（PR #657 后版）`
- 同时 close #637 a11y 残余（详见 docs/agents/settings-endpoint-a11y-residual.md）