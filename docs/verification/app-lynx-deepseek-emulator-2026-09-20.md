# app-lynx 翻译真实 endpoint 验证 — 2026-09-20 — DeepSeek-flash

**目的**：在 AVD `pictelio_ui` 上用**真实 LLM endpoint**（DeepSeek-flash，非 mock SSE）验证翻译功能是否端到端工作。
**构建**：基于 main HEAD `d86475f5`（PR #671/#672/#673/#674 全部合并）
**Endpoint**：`https://api.deepseek.com` + `deepseek-flash`（DEEPSEEK_API_KEY 从 `packages/app-lynx/.env`，不 echo）
**被测章节**：`25434593`（R-18G 小說）
**环境**：代理 `http://127.0.0.1:7897`（`https_proxy` 已设）

> 注：上轮 PR #675 已用 mock 跑过完整 7 步验证，本报告**专门**对比 handoff §5「真实 endpoint 验证」上轮未完整跑的部分。

## 核心结论：handoff §5 已知现象完整复现 ✅

| 维度 | handoff §5 上轮记录 | 本轮实测 | 结果 |
|------|---------|---------|------|
| DeepSeek 建流 | HTTP 200 | HTTP 200 + chunks 分割正常 | ✅ |
| chunked pipeline | 5 chunks (51/25/22/28/19) | **5 chunks 同样大小** | ✅ 完全一致 |
| 长流稳定性 | 已知限制（handoff §5） | **60s+ 持续返回 reasoning 帧，未复现限制** | ✅ 优于预期 |
| **content_filter (F2)** | DeepSeek 对 R-18G 只返 reasoning 不返 output_text | **完整复现** —— 触发 #654 修复 oracle | ✅ |
| UI 显示 | 「服务端未返回译文」+ R-18G 红色提示 | **完整呈现** | ✅ |

## 关键 oracle 时间线

```
18:19:48  LynxActivity: dev hook: 翻译 endpoint 已播种 baseURL=https://api.deepseek.com model=deepseek-flash
18:19:50  [novelTranslateStore] getEndpoint raw={"baseURL":"https://api.openai.com/v1","model":"gpt-5"...}
                                    ↑ Java 硬编码默认（native getEndpoint 用 DEFAULT_BASE_URL）
                                    ↑ 但 JS 端 loadEndpointConfig 用 meta.baseURL ?? ep.baseURL 合并 → 实际 deepseek
18:20:00  PictelioTranslateModule: translateStream 入口 baseURL=https://api.deepseek.com model=deepseek-flash input=51 abortToken=true
18:20:00  PictelioTranslateModule: translateStream HTTP 200 开始读流 bodyBytes=-1 stream=true
18:20:10  translateStream 入口 ... input=25      ← chunk 2 (10s 后)
18:20:22  translateStream 入口 ... input=22      ← chunk 3 (12s 后)
18:20:28  translateStream 入口 ... input=28      ← chunk 4 (6s 后)
18:20:39  translateStream 入口 ... input=19      ← chunk 5 (11s 后)
18:20:50  [nativeTranslate][probe] 事件到达 type=reasoning_delta (× N) ← 持续返回推理帧
            ↑ **零 output_text 帧** ← F2 复现
[ +error: hasText=false → 空流失败 → 不写缓存 + UI 显示「内容可能被内容策略拦截」]
```

### JS 端 native getEndpoint vs 实际请求的差异

```js
// novelTranslateStore.loadEndpointConfig:
const ep = await nativeGetEndpoint()  // ← Java 硬编码默认（"openai.com/v1"/"gpt-5"）
const meta = await readEndpointMetadata()  // ← JS prefs（dev hook 注入的 deepseek）
return {
  ...ep,
  baseURL: meta.baseURL ?? ep.baseURL,  // ← meta 优先
  model: meta.model ?? ep.model,
}
```

也就是说：`getEndpoint` 的 native 返回值是 Java 硬编码默认；JS 端 `loadEndpointConfig` 把 dev hook 注入的 prefs 叠加上去（`meta ?? ep`），最终请求用 **deepseek**。

→ 这是**有意设计**（native 不持 baseURL，JS prefs 是 single source of truth），但**日志可读性陷阱**：logcat 的 `getEndpoint 成功` 行只显示 native 默认值，看到 `openai.com/v1` 不代表真的往那里发请求。**必须看 `translateStream 入口` 日志**才是真实请求目标。

## 完整验证

### DeepSeek 长流式稳定（**未复现 handoff §5 已知限制**）

handoff §5：「模拟器上长流式响应的后续帧不稳定送达」。本轮实测：

- `translatePoll` 每 ~250ms 一次（logcat 持续 60s+）
- DeepSeek 持续返回 reasoning 帧（`[nativeTranslate][probe] 事件到达 type=reasoning_delta` 多次）
- 没有任何「超时」「connection reset」「incomplete」异常

**结论**：长流式限制**未复现**。可能是：
1. 当前模拟器网络状态好于上轮
2. DeepSeek-flash 实际帧间隔稳定（不像 DeepSeek-V3 推理慢）
3. lynx Native 侧长流处理改进（PR #657 commit 6e1ad678 之前是问题来源）

### chunked pipeline 在真实 endpoint 上也稳定

```
input=51 → 25 → 22 → 28 → 19 = 145 段
```

- 与 mock SSE 完全一致的切分
- 每个 chunk 独立 HTTP 200 + stream=true
- 没有「流中断触发整批回退」

### #654 修复 oracle（content_filter 拦截路径）

handoff §5 F2 描述：DeepSeek 对 R-18G 拒绝形态 = HTTP 200 + 推理帧 + 零 output_text

本轮实测：
- 5 chunks 全部 HTTP 200
- **持续返回 reasoning 帧**（仅 reasoning，无 output_text）
- 触发空流失败 → store 标记 `error.code = 'content_filter'`
- **UI 显示「服务端未返回译文：内容可能被内容策略拦截」**（红色 inline error）
- + 右侧「配置翻译」链接
- 正文仍是原文 + 显示段落索引 [0][1][2][3][4][5]

→ **#654 修复 oracle 完整呈现**：修复前 DeepSeek 返回 HTTP 200 + `response.completed`（自带空 delta_all）会让空块被判 `done` → 写缓存 → UI「✓ 翻译完成」但正文空白；修复后 `hasText=false` 触发空流失败分支，UI 显示「服务端未返回译文」+ 可重试。

### 整批回退路径**未触发**

| Chunk | 时间 | input | stream | HTTP |
|-------|------|-------|--------|------|
| 1 | 18:20:00 | 51 | true | 200 |
| 2 | 18:20:10 | 25 | true | 200 |
| 3 | 18:20:22 | 22 | true | 200 |
| 4 | 18:20:28 | 28 | true | 200 |
| 5 | 18:20:39 | 19 | true | 200 |

- 每个 chunk 都 stream=true（流式）
- 每个 chunk 都 HTTP 200
- **没有** stream=false（整批回退路径）

原因：DeepSeek 不断返回 reasoning 帧但不出 output_text —— Java 侧 `hasText=false` 触发**空流失败**（spec §7.2 行 526）→ 状态置 `failed`/`content_filter`，**不**走整批回退（spec §7.2 行 528「chunk `error (retryable)` → 整批回退」）。

→ 这是符合设计的路径：空流失败 = 终态失败，无需回退。

### 已修复的 #671/#672/#673 实测

| 修复 | 验证方式 | 结果 |
|------|---------|------|
| **#671** ImageHostConfig 种子覆盖改单调 | 跑翻译流程触发图片代理 | （未单测，但构建产物已含修复） |
| **#672** novelTranslateStore generation-gate | 5 chunks 流式持续 60s+，旧请求未被新请求覆盖 | ✅ logcat 显示 `gen` 序号自增、无跨 chunk 污染 |
| **#673** reset abort 防线 | 上轮 mock 验证已通过（`abortStream 取消: smu9mlgc0-1` 日志） | 间接验证 |

## 诚实边界

1. **真机未验证**（handoff §5 限制）：本轮仍在模拟器，模拟器与真机差异未覆盖
2. **非 R-18G 章节未测**：如换普通章节应该走完 5 chunks 拿到译文；本轮只测 R-18G（content_filter 触发路径）
3. **#671 直接修复未触发**：图片代理竞态未在真机重现（翻译流程不直接触发图片缓存路径）
4. **JS 端 raw 日志陷阱**：`getEndpoint 成功 hasKey=true baseURL=https://api.openai.com/v1 model=gpt-5` 显示的是 native 默认值，不是实际请求；**实际请求要查 `translateStream 入口` 日志**——这点对后续调试很重要

## 产物

- 验证报告：`docs/verification/app-lynx-deepseek-emulator-2026-09-20.md`
- 3 张截图：`docs/verification/2026-09-20-deepseek/deepseek-{1,2,3}-*.png`
- 上轮 mock 7 步验证：`docs/verification/app-lynx-translation-emulator-post-merge-2026-09-20.md`（PR #675）

## 关联

- PR #671 (`350dec30`) / #672 (`f4cda161`) / #673 (`b5332b6f`) / #674 (`d86475f5`)
- PR #675（mock 验证报告）<https://github.com/a1121611810/Pictelio/pull/675>
- handoff §5「已知限制」（模拟器长流式不稳定）—— **本轮未复现**
- handoff §5「F2 真实证据」（DeepSeek content_filter 形态）—— **本轮完整复现**
