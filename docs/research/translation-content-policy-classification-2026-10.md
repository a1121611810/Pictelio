# 服务端内容策略拦截的错误分类取证与归因修复（2026-10-23）

> 起因：issue #1037 的 AC3 实跑补证（翻译闸门放行）过程中，捕获到 MiniMax 服务端
> **HTTP 400 显式拒绝**形态的拦截；追查发现本仓错误分类器认不出该形态 ⇒ 归因错误。
> 本文记录一手取证、缺陷定位、修复与双端语义统一。

---

## 1. 结论先行

| 项 | 修复前 | 修复后 |
| --- | --- | --- |
| MiniMax 真实 400 body 的**分类** | `invalid_request`（归因错误） | `content_filter`（归因正确） |
| web 路径同构缺陷 | `unknown` ⇒「未知错误」 | `content_filter` |
| 「HTTP 200 但零输出」空流形态（#654） | `content_filter` | `content_filter`（不变） |
| **UI 实际显示** | **取决于竞态**（见下方「⚠️ 口径订正」） | 恒为「服务端未返回译文：内容可能被内容策略拦截」 |

**关键判断**：拦截也返回 **HTTP 400**。修复前分类器先按状态码判，400 一律落
`invalid_request`，于是服务端明明说了「是内容策略拦的」，UI 却告诉用户去改
endpoint / model 配置 —— 用户会白折腾，而真实原因是章节正文被内容策略拦了，
换任何 endpoint 都不会好。

### ⚠️ 口径订正（2026-10-23，Spec 轴复核后）

**不能断言「修复前 UI 一定显示『请求参数无效（400）』」** —— 那在已记录的实跑里
**未被观测到**。同一次 2026-10-23 14:16–14:21 模拟器实跑的记录
（[`debug-release-isolation-2026-10.md`](./debug-release-isolation-2026-10.md) §3.6），
UI 终态记的是「**服务端未返回译文：内容可能被内容策略拦截**」。

原因：那次跑里 **首个 chunk 拿到 HTTP 200**（开始读流、产出 323 个 `reasoning_delta`
+ 1 个 `delta_all`），其余 6 个 chunk 才拿到 400。而 store 的错误收敛是
「**首个错误优先**」（`novelTranslateStore.ts` 的 `if (lastErrorCode === null)`）——
先到的那个错误胜出。首个错误来自「200 但零译文」形态（Java 侧产
「LLM 未返回任何译文（可能被服务端内容策略拦截）」⇒ 旧分类器**已**命中
`content_filter`），于是**碰巧**显示成了 content_filter。

⇒ 精确表述：修复前 **400 形态本身被误判为 `invalid_request`**（可复现、已由单测钉住）；
**UI 显示哪个文案取决于竞态**（本次实跑恰好落在 content_filter）。
⇒ 修复的价值在于**消除这个竞态依赖**：无论哪个错误先到，只要服务端明说内容策略，
就稳定归 `content_filter`。

---

## 2. 一手取证

### 2.1 实测环境与通道

- 模拟器 `emulator-5556` + debug 变体 `io.pictelio.app.debug`
- 服务商：MiniMax（`https://api.minimax.cn/v1`，模型 `MiniMax-M3.1-Flash-Preview`）
- 被译内容：Pixiv 小说 R-18G 章节正文（真实章节，非构造样本）
- 旁证服务商：DeepSeek（`https://api.deepseek.com/v1`，模型 `deepseek-chat`）

> 凭据纪律：API key 仅用于设备播种，**值不入本仓 / 不入 issue / 不入聊天**。

### 2.2 MiniMax 侧实测输出（原文）

```
translateStream 入口 baseURL=https://api.minimax.cn/v1 model=MiniMax-M3.1-Flash-Preview input=34 abortToken=true
translateStream HTTP 200 开始读流 bodyBytes=-1 stream=true
translateStream HTTP 400 body=HTTP 400: {"error":{"message":"input new_sensitive (1026)","code":"image_content_policy_violation"}}
```

帧统计：`reasoning_delta` 323 / `delta_all` 1 / `error` 9。

### 2.3 DeepSeek 侧对照（同一份正文）

**5/5 chunk 全 HTTP 200**，帧 `delta_all` 5 / `done` 5，中文译文正文已渲染。

⇒ **拦截来自服务商侧内容策略，不是本仓闸门**：同一份正文，DeepSeek 全通、MiniMax 被拒。
（这与 #1037 AC3 的判定互补：本地 `_translateR18` 闸门**放行**已由「Java 侧
`translateStream` 入口日志 + HTTP 交互都发生」证明；服务商侧内容审核是**另一道外部闸**。）

### 2.4 服务商官方口径（一手源）

- **错误码表**（<https://platform.minimax.cn/docs/api-reference/errorcode.md>）：
  `1026` = 输入内容涉敏（解决方法「请调整输入内容」）；`1027` = 输出内容涉敏。
- **响应 schema**（<https://platform.minimax.cn/docs/api-reference/text-chat.md>）：
  兼容层响应体顶层带 `input_sensitive` / `input_sensitive_type`
  （1 严重违规 · 2 色情 · 3 广告 · 4 违禁 · 5 谩骂 · 6 暴恐 · 7 其他）、
  `output_sensitive` / `output_sensitive_type`，以及 `base_resp.status_code` / `status_msg`。
  ⚠️ 官方错误结构**不直接复用 HTTP 状态码**：业务错误在 `base_resp.status_code`，
  HTTP 常为 200。

---

## 3. 缺陷定位

### 3.1 分类器只认「空格版」形态

修复前 `classifyNativeError`（nativeTranslate.ts）的判定串：

```
"content policy"（空格） || "content_filter" || "未返回任何译文"
```

而真实服务商返回的是：

- OpenAI 兼容层 code：**下划线** `content_policy_violation`
  （MiniMax 兼容层实测返回带领域前缀的 `image_content_policy_violation`）
- MiniMax 自有语义：`new_sensitive` + 错误码 `1026`

⇒ 三条判定**全部命不中** ⇒ 落到 HTTP 状态码分支 ⇒ 400 ⇒ `invalid_request`。

⚠️ 再次强调（§1 口径订正）：`invalid_request` 是**400 形态本身的错误分类**；
**UI 显示哪句取决于竞态**（首个错误优先）。已记录的实跑碰巧显示的是 content_filter
（因首个 chunk 走的是 200-零输出形态）。

### 3.2 两条路径同构

| 路径 | 入口 | 修复前结果 |
| --- | --- | --- |
| native（真机主力） | `classifyNativeError`（读 Java 侧终态消息，含 body 摘要） | `invalid_request` |
| web（web-core 预览） | `mapErrorCode`（读 `error.code`） | `unknown`（映射表无此 code） |

⚠️ web 路径另有一处**顺序缺口**（Spec 轴复核发现）：`mapErrorCode` **只在
`status === 400` 时被调用**，且非 400 的内容策略 body 一律按状态码分流
（Azure 用 403、部分服务商用 422）⇒ 漏判。⇒ 修复把内容策略判定提到状态码分流**之前**。

### 3.3 Java 侧未丢信息

`PictelioTranslateModule.parseHttpError` 限 256 字防日志膨胀；本例 body（JSON 本体）
**90 字**（含 `"HTTP 400: "` 前缀整条消息 100 字），**均 < 256** ⇒ **完整保留**，
`code` 与 `message` 均未截断 ⇒ 缺陷**不在传输层，在分类层**
（排除「信息被截断导致认不出」这一假说）。

### 3.4 本仓零读取服务商专有风险字段

全仓 grep：`input_sensitive` / `output_sensitive` / `base_resp` / `status_code` /
`status_msg` —— **零命中**（app-lynx src + android-host src）。

⇒ 本仓既不读 `input_sensitive_type` 这类**细分涉敏类别**（色情 / 广告 / 谩骂…），
也不读 `base_resp.status_msg`。这是**已知的能力边界**（见 §5），本轮不扩张；
本轮只保证**服务端已经明说「被内容策略拦」时不把它误报成「参数无效」**。

---

## 4. 修复

### 4.1 判据抽成单一事实源（`src/api/contentPolicy.ts`，新增）

native 路径（读 Java 侧终态消息全文）与 web 路径（读 `error.code`）都要判
「这次失败是不是服务商内容策略拦的」。两份判据各写一份必然漂移 ⇒ **抽成共享模块**：

- `isContentPolicyRejection(text)` —— 判任意文本（native 路径用）：
  ① 既有形态（保留不动）：空格版 `content policy` / `content_filter` / `未返回任何译文`
  ② 下划线 `content_policy_violation`
  ③ MiniMax 自有 `new_sensitive`
- `isContentPolicyCode(code)` —— 判服务商错误 code（web 路径用）：
  裸 `content_filter` + **后缀**匹配 `content_policy_violation`
  （后缀而非全等，为了覆盖带领域前缀的 `image_content_policy_violation` —— OpenAI
  兼容层允许服务商在 code 前加领域前缀）

### 4.2 native 路径

`packages/app-lynx/src/api/nativeTranslate.ts` 的 `classifyNativeError` 改用
`isContentPolicyRejection`，判定位置仍在 HTTP 状态码分支**之前**
（顺序是修复的核心：拦截也是 400，先按状态码判会被吞）。

### 4.3 web 路径

`packages/app-lynx/src/api/translate.ts` 的**两处**失败形态，判定都提到状态码分流**之前**，
且**同时消费 code 与 message 两个信号**：

1. **HTTP 非 2xx 分支**：`isContentPolicyCode(code) || isContentPolicyRejection(message)`。
   这一步同时修掉两处旧缺口：
   - 旧口径「仅 400 才查 `error.code`」⇒ 非 400 的内容策略 body（Azure 403、
     部分服务商 422）一律按状态码分流 ⇒ 漏判；
   - 裸 `content_filter` code（部分服务商直接用它当 code）旧映射表不认 ⇒ `unknown`。
2. **`stream=false` 的 `status: 'failed'` 分支**（整批回退路径）：旧口径一律归
   `server` + `retryable=true` ⇒ 若实为内容策略拦截，会**误触发整批回退**
   （重发同一份被拦的正文，必然再被拒，且再耗一次计费）。现按同一判据分流。

> ⚠️ **为什么 message 也必须看**（Standards 轴 2026-10-23 复核实测）：同一 body
> `{"error":{"code":"invalid_request_error","message":"input new_sensitive (1026)"}}`
> —— native 侧读**消息全文**⇒ 命中 `new_sensitive` ⇒ `content_filter`；
> web 侧若只看 `code` ⇒ `invalid_request` ⇒ **跨路径漂移**（真机与 web 预览两套说法）。
> ⇒ 两条路径必须消费**同一组信号**。

### 4.4 双端语义统一

修复后两种拦截形态（#654 空流 / 本次 4xx 显式拒绝）**同归 `content_filter`** ⇒
UI 同一句文案，不再出现「同一件事两种说法」。

### 4.5 反向边界（防过度拦截）

各配**反向用例**：普通 400（`bad request` / `invalid_request_error`）**仍**归
`invalid_request` —— 不得把 400 一律当拦截。

---

## 5. 已知边界与不做的部分

| 项 | 状态 | 理由 |
| --- | --- | --- |
| 读 `input_sensitive_type`（1–7 类细分）并在 UI 区分「色情 / 广告 / 谩骂」 | **不做** | 需解析服务商专有字段且 OpenAI 兼容层无此字段 ⇒ 会把本仓错误分类绑死在某一家服务商的私有扩展上；文案层表达「内容可能被内容策略拦截」已可行动 |
| 读 `base_resp.status_msg` 并展示 | **不做** | 同上；且 `status_msg` 是技术串，与 ADR-0173 D7「UI 按 code 选 i18n 文案，不直接渲染技术串」冲突 |
| 把 MiniMax 技术错误串直接展示给用户 | **不做** | 同 ADR-0173 D7 |
| retryable 判定 | **保持 `content_filter` 不在 retryable 子集表** | ADR-0178 D2 子集表 = `{server, network, incomplete}`；内容策略拦截重发同一份正文无意义 ⇒ 不触发整批回退，正确 |

---

## 6. 验证

### 6.1 TDD 红→绿

- 写完用例先跑：`3 failed | 1 passed | 38 skipped`（红灯确认缺陷真实，
  且「普通 400 仍归 invalid_request」那条当时就**已通过** ⇒ 既有行为边界正确）
- 修复后：`85 passed`（两文件合计）

### 6.2 变异验证（防假绿）

在隔离 worktree（`git worktree add --detach /tmp/wt-1063 HEAD`）还原修复：

| 变异 | 结果 |
| --- | --- |
| native 去掉形态 ②③ + web 去掉后缀映射 | **4 failed \| 81 passed**（红） |
| 恢复修复 | 85 passed（绿） |

⇒ 新门禁**确实**能抓到该缺陷，不是恒绿。

### 6.3 第二、三轮（双轴复核后追加的 web 覆盖修复）

Spec 轴发现 web 路径的顺序缺口（内容策略判定未先于状态码分流、非 400 漏判）后，
追加修复与新用例；Standards 轴进一步发现 **message 级判据未消费**（跨路径漂移）
与 **`status: 'failed'` 分支误判为 `server` + `retryable=true`**（会误触发整批回退），
一并修掉。变异验证：

| 轮次 | 变异 | 结果 |
| --- | --- | --- |
| ② | 删掉 web 侧「内容策略先于状态码」的判定 | **4 failed \| 42 passed**（红） |
| ③ | 去掉 web 侧 message 级判据（2 处：HTTP 错误分支 / `status=failed` 分支） | 各 **1 failed**（红） |
| 恢复 | — | 90 passed（绿） |

### 6.4 全仓门禁

```
pnpm check:all && pnpm lint:all && pnpm fmt:check && pnpm test:all
→ EXIT=0
→ app-lynx 298 files / 4361 tests 全过
→ vp run: 0/9 cache hit (0%)（禁 --cache，确认真跑非日志重放）
```

⚠️ 门禁**抓到过本轮自己的问题**：判据抽到新文件 `api/contentPolicy.ts` 后，
硬编码中文文案回潮门禁（`tests/hardcode-gate.test.ts`）判红 ——
「未返回任何译文」是 Java 侧空流终态消息的字面量（#654），属**契约串**而非用户可见文案。
已在 `tests/hardcode-whitelist.json` 登记（理由：与 `api/nativeTranslate.ts` 同款契约串豁免；
展示层文案由 error code → i18n 派生，此串永不被直接渲染给用户）。

---

## 7. 复现命令（凭据不入输出）

```bash
cd <repo>
set -a; . packages/app-lynx/.env; set +a
adb shell am force-stop io.pictelio.app.debug   # 必须先 force-stop，否则 singleTask 不重跑 onCreate 里的 dev hook
adb shell am start -n io.pictelio.app.debug/io.pictelio.app.LynxActivity \
  --es pictelio_dev_llm_base_url "https://api.minimax.cn/v1" \
  --es pictelio_dev_llm_model "MiniMax-M3.1-Flash-Preview" \
  --es pictelio_dev_llm_api_key "$PICTELIO_AI_API_KEY" \
  --es pictelio_dev_force_r18 true --es pictelio_dev_force_translate_r18 true

# 翻译证据（只取状态码与 body 摘要，不打印正文）
adb logcat -d | grep -E "PictelioTranslateModule: translateStream (入口|HTTP)"
```

UI 导航：小说 tab `(900,141)` → `#R-18G` 小说 `(540,1500)` → 「开始阅读」`(540,1954)`
→ 章节页「翻译本章」`(574,1124)`。

---

## 8. 与 #1037 AC3 的关系（口径澄清）

两者是**两道不同的闸**，不要混谈：

| 闸 | 位置 | #1037 AC3 的判定 |
| --- | --- | --- |
| 本地 `_translateR18` 闸门 | 本仓 | **放行成立** —— 入口日志与 HTTP 交互都发生 ⇒ 未被本地拦截 |
| 服务商内容审核 | MiniMax / DeepSeek | 本仓**无法**控制；本轮实测证明它**存在且可触发**（MiniMax 拒 / DeepSeek 放行） |

⇒ 修复后的 UI 提示「内容可能被内容策略拦截」是**对外部闸的如实反馈**，不是本仓闸门失败。
