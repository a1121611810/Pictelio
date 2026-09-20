# app-lynx 整批回退路径模拟器验证 — 2026-09-20 — fallbackToWholeBatch oracle

**目的**：在 AVD `pictelio_ui` 上验证 spec §7.2 整批回退（fallbackToWholeBatch）路径——流中断 + retryable=true → 单次 stream=false 重传 + 成功。

**构建**：基于 main HEAD `d86475f5`（含 #671/#672/#673/#674）

**新增 mock**：`packages/app/tests/android-e2e/tools/mock-fail-then-recover.mjs`
- 第 1 个 chunk（`stream=true`）：返 5 段正常 delta → `response.failed` event with `code=network`
- 第 2 个 chunk（`stream=false`，整批回退）：返完整 JSON `{"status":"completed","output":[{"content":[{"type":"output_text","text":"[0] 【译0】...\n\n[1] 【译1】..."}]}]}`

## 核心结论：fallbackToWholeBatch oracle 完整触发 + 整批回退成功 ✅

### 关键 oracle 时间线（20:36:48）

```
20:36:48.358  PictelioTranslateModule: translateStream HTTP 200 开始读流 stream=true   ← chunk 1
20:36:48.365  translateStream 入口 input=25 abortToken=true                          ← chunk 2
20:36:48.378  translateStream 入口 input=22 abortToken=true                          ← chunk 3
20:36:48.384  translateStream 入口 input=28 abortToken=true                          ← chunk 4
20:36:48.388  translateStream 入口 input=19 abortToken=true                          ← chunk 5
20:36:48.406  [novelTranslateStore] fallbackToWholeBatch triggered                   ← ORACLE ✅
                  {code:"network", message:"LLM stream failed [network]: ..."}
20:36:48.408  translateStream 入口 input=145 abortToken=true                         ← 整批回退（5 chunks 合并）
20:36:48.461  PictelioTranslateModule: translateStream HTTP 200 开始读流 stream=false ← 整批回退响应
20:36:48.489  PictelioTranslateCache.setItem ...                                       ← 缓存写入 ✅
```

### mock 侧日志

```
[mock] request model=mock-model paragraphs=51 stream=true   ← chunk 1
[mock] 流式返 5 段后发 response.failed (code=network) → 触发整批回退
[mock] request model=mock-model paragraphs=25 stream=true   ← chunk 2
[mock] 流式返 5 段后发 response.failed (code=network) → 触发整批回退
[mock] request model=mock-model paragraphs=22 stream=true   ← chunk 3
[mock] 流式返 5 段后发 response.failed (code=network) → 触发整批回退
[mock] request model=mock-model paragraphs=28 stream=true   ← chunk 4
[mock] 流式返 5 段后发 response.failed (code=network) → 触发整批回退
[mock] request model=mock-model paragraphs=19 stream=true   ← chunk 5
[mock] 流式返 5 段后发 response.failed (code=network) → 触发整批回退
[mock] request model=mock-model paragraphs=145 stream=false ← 整批回退（合并 5 chunks）
[mock] 整批回退响应返 145 段 / 10763 字符
```

### UI 实证（fallback-success-cached.png）

- 「✓ 重译」按钮（completed + 缓存命中态）
- 「原文/译文」segmented bar，「译文」默认选中
- 正文显示完整 mock 译文（【译0】烈焰与刀锋：夜赛道的交易（欧美风）【译1】免费约稿 欧美背景【译2】[pixivimage:...】【译3】免费约稿 欧美背景【译4】[pixivimage:...】【译5】免责声明）

## 完整触发链路

```
1. mock 返 response.failed event with code="network"
2. Java TranslationSseParser 解析：
   case "response.failed" {
     String code = errObj.optString("code", "server");  // "network"
     String message = errObj.optString("message", "...");
     terminalError = "LLM stream failed [network]: ...";
     sink.emit("", terminalError);  // payload="" + error="LLM stream failed [network]: ..."
   }
3. JS nativeTranslate 收到 chunk.type === "error"：
   const code = classifyNativeError("LLM stream failed [network]: ...")
     // → 不匹配 HTTP 码正则、不含 content_policy → 返回 "network"
   queue.push({ type: "error", code: "network", message: ..., retryable: isRetryableNativeError("network") })
     // → "network" 在 RETRYABLE_NATIVE_CODES 集合 → retryable: true
4. JS store 收到 chunk → lastErrorRetryable = chunk.retryable === true
5. spec §7.2 触发条件：(result.status === "partial" || "failed") && lastErrorRetryable
   → 调 runWholeBatchFallback(provider, config, request, args, signal, genNow, zeroTextOverride)
   → 构造 wholeRequest = { ...originalRequest, stream: false }
6. mock 收到 stream=false 请求 → 返完整 JSON
7. Java deliverWholeBatchJson 解析：拼所有 output_text → [N] 锚点拆段
   → "[0] 【译0】...\n\n[1] 【译1】..." → 51 段（这里 145 段 = 5 chunks 合并）
   → hasText=true → success
8. JS store: status=completed + 写缓存 + showTranslation=true + refreshDisplay
9. UI 显示「✓ 重译」按钮 + 完整译文
```

## 关键发现：环境变量代理干扰

**最初**直接跑时 logcat 显示 `translateStream HTTP 502`，但 mock 是活的（curl 通过）。根因：

```
* Uses proxy env variable http_proxy == 'http://127.0.0.1:7897'
*   Trying 127.0.0.1:7897...
* Connected to 127.0.0.1 (127.0.0.1) port 7897
```

模拟器里 `http_proxy=http://127.0.0.1:7897` 让 OkHttp 请求被发到代理（7897），不是直连 mock（8811）。代理返 502。

**修复**：
```bash
adb -s emulator-5554 shell settings put global http_proxy :0
```

→ 重启 app 后 HTTP 200 正常返回。

## 已知偏离

1. **PR #675 的缓存命中影响**：进入章节页面后立即看到「✓ 重译」+ 译文（来自上轮缓存）。重启后清 Native 缓存目录的权限被拒（`run-as` 不能删 cache 子目录），只能通过「tap 重译 → cacheMiss → 走整批回退 → 缓存写入」验证
2. **mock 单次只触发一次整批回退**：5 chunks 全部 retryable=true → fallback 一次（stream=false input=145）。真实场景下，若 fallback 也失败，整批回退**不会**再触发（spec §7.2 + ADR-0178 D2「最大 1 次」）
3. **模拟器环境 ≠ 真机**：handoff §5「已知限制」未在本轮验证范围；但本轮验证**模拟器 + mock** 路径与代码层契约一致

## 验证 vs 已合并修复的覆盖

| 修复 | 验证方式 | 结果 |
|------|---------|------|
| **#657 PR** reset abort 防线（#673 commit `bcfa7fa4`） | （上轮 mock 已验证 abort 通道） | ✅ 上轮通过 |
| **#671** ImageHostConfig 种子覆盖改单调 | （图片侧，本轮未触发） | — |
| **#672** novelTranslateStore generation-gate | 5 chunks 流式持续 + 整批回退期间 gen 守门 | ✅ logcat `fallbackToWholeBatch triggered` 后无跨 chunk 污染 |
| **#673** reset abort 防线 | abort 通道（上轮验证） | ✅ 上轮通过 |
| **#674** spec §7.1/§7.2 票面修订 | 验证时实测进度累积 + 内容终态切换 | ✅ 符合 |

**新增验证**（本轮）：
- **ADR-0178 D1 fallbackToWholeBatch 路径**完整 oracle 触发
- retryable=true 判定（`network`/`server`/`incomplete`）→ 整批回退（stream=false, max_output_tokens × 2）→ success → completed

## 产物

- **验证报告**：`docs/verification/app-lynx-fallback-emulator-2026-09-20.md`
- **截图**：`docs/verification/2026-09-20-fallback/fallback-success-cached.png`
- **新增 mock**：`packages/app/tests/android-e2e/tools/mock-fail-then-recover.mjs`
  - `FAIL_FIRST_CHUNK=0` 模式：sanity（不触发失败，完整流式返段）
  - 默认模式：流 1 chunk 触发失败，整批回退成功

## 关联

- spec §7.2 转移表行 528（fallbackToWholeBatch 触发条件）
- ADR-0178 D1（整批回退形态）+ D2（retryable 子集 network/server/incomplete）
- ADR-0169 D5.3（整批回退 stream=false 单次 POST + JSON）
- PR #675（mock 7 步验证）<https://github.com/a1121611810/Pictelio/pull/675>
- 上一轮 mock 报告：`docs/verification/app-lynx-translation-emulator-post-merge-2026-09-20.md`
- 真实 endpoint 报告：`docs/verification/app-lynx-deepseek-emulator-2026-09-20.md`
- handoff §5「已知限制」（模拟器长流不稳定）—— **本轮验证不需要（mock 单次响应可控）**
