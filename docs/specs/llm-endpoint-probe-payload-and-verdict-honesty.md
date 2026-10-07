# LLM 端点探测：报文形态修正与判定诚实化

- **状态**：draft（待 `/to-tickets` 拆票）
- **日期**：2026-10-07
- **关联**：issue #831（就地改写）· ADR-0173（修订 D3）· ADR-0169 · ADR-0170 · spec `app-lynx-novel-translation.md` §6.1 §9.1
- **上游取证**：DeepSeek 官方 Responses API 指南 + 更新日志（2026-07-31 V4-Flash-0731 原生支持；2026-08-13 扩展至 V4-Pro）；实测以仓库自带 `DEEPSEEK_API_KEY` 打出，密钥不回显、不入库

---

## Problem Statement

用户在「我的 → LLM 翻译设置」配置 DeepSeek 端点时，遇到一条自相矛盾的链路：

1. 填入 baseURL 后，兼容性一行显示绿灯「✓ DeepSeek (Codex 兼容)」；
2. 填好 key 与模型、保存成功，按钮从「配置翻译」变为「翻译本章」；
3. 点「翻译本章」失败，报「请求参数无效（400）：请检查模型与 endpoint 配置」。

用户被引导向一个自己无法诊断的方向——错误文案把矛头指向「模型与 endpoint 配置」，而这两项都没填错。

### 原票根因已被推翻

原票断言「DeepSeek 不提供 `/v1/responses`，翻译必然 400」。**该前提不成立**：

- DeepSeek 自 **2026-07-31**（V4-Flash-0731）起原生支持 OpenAI Responses API，**2026-08-13** 扩展至 V4-Pro（官方更新日志）；
- #831 提交于 **2026-09-29**，在上述支持落地约两个月之后；
- 以仓库自带密钥实测：`POST /v1/responses` 返回 **200**，且流式 SSE 正常产出 `response.output_text.delta` 与 `response.completed`——正是本应用解析器所依赖的事件。

因此「让 DeepSeek 可用」不需要新增 chat/completions 协议分支（见 Out of Scope）。

### 真实根因：探测请求体形态非法

`probeEndpoint` 发出的探测报文是 `input: ["ping"]`——**裸字符串数组**。Responses API 不接受该形态。实测：

| 报文来源 | `input` 形态 | DeepSeek 实测 |
|---|---|---|
| Java 运行时 `buildRequestBody` | 标量字符串（`buildInput` 拼接） | 200 |
| **Java 探测 `probeEndpoint`** | **裸字符串数组 `["ping"]`** | **422 `invalid input item`** |
| web dev `buildResponsesRequestBody` | 消息数组 `[{role:'user',content}]` | 200 |

该形态自 2026-09-19 首次提交起即如此，**从未修改**（v6.3.0 与当前 main 逐字节相同）。

### 缺陷如何变成「绿灯 + 失败」的矛盾

关键在于 **DeepSeek 的鉴权先于路由**：dummy key 打**任意路径**（含不存在的路径）均返回 401，而非 404。由此：

- **自动探测**（dummy key）：先撞上 401 → `classifyProbe` 判 `ok` + `keyInvalid` → `classifyProvider` 认出 `api.deepseek.com` → **绿灯**。报文形态错误被鉴权层掩盖，从未暴露。
- **「测试连接」**（真实 key）：鉴权通过，报文形态缺陷立刻显形 → 422 → `authenticated=false`、`invalidKey=false` → 报 `http_422`，并把凭据状态写成 **failed**。

**同一个端点、自动探测判「兼容」而「测试连接」判「失败」，且后者是正确的一方。** 用户拿着完全有效的密钥点「测试连接」必定失败，而实际翻译链路是通的——应用比它自己的测试按钮所声称的更可用。

### 第二重缺陷：绿灯的理由是错的（不只是措辞）

ADR-0173 D3 记载「401/403 → 地址兼容（endpoint 在），密钥无效」。该**结论**在 DeepSeek 语境下碰巧为真，但**理由不成立**：鉴权先于路由时，401 只证明「该地址在接收请求并要求鉴权」，**根本没告诉你 `/responses` 路径是否存在**。绿灯建立在一个无法成立的推断上。

### 第三重缺陷：判定表零测试

`classifyProbe` 是一张决定用户看到绿灯还是红灯的判定表，**没有任何测试覆盖**（CodeGraph：`no covering tests found`）。`responsesUrl` 同样零覆盖。下一次改动这张表将无人守门。

---

## Solution

1. **修正探测报文形态**：`input` 由裸字符串数组改为 Responses API 接受的形态，使「测试连接」在有效密钥下返回 200，探测与运行时对同一端点的判定不再互相矛盾。
2. **修订 ADR-0173 D3 的推理**：保留其结论（401 → 地址层成立），但把理由改写为可成立的表述，并显式记录「dummy key 无法证明路径存在」这一能力边界。
3. **绿灯文案改为只陈述已验证事实**：`✓ DeepSeek (Codex 兼容)` → `✓ DeepSeek（Responses API）`。现文案把一个 DeepSeek 事实表述成 Codex 事实，且「兼容」二字正是争议核心。
4. **补齐 Java 判定表测试**：覆盖 ADR-0173 D3 每一行 + 实测 422。
5. **清除 `vllm` 死状态**：该状态在任何代码路径上都产生不出来，属不可达分支；留着会让后来者误以为存在这条分流。

---

## User Stories

1. As a DeepSeek 用户, I want 兼容性提示只陈述我已验证的事实, so that 我不会把「供应商归属」误读为「协议兼容结论」。
2. As a DeepSeek 用户, I want 点「测试连接」在有效密钥下返回成功, so that 我不必反复怀疑自己的 key 是不是坏了。
3. As a DeepSeek 用户, I want 探测与「测试连接」对同一端点给出一致判定, so that 我看到的绿灯不是自相矛盾的假象。
4. As a DeepSeek 用户, I want 错误文案不再把我指向没填错的字段, so that 我知道该查哪里而不是反复改模型名。
5. As a DeepSeek 用户, I want 端点行显示「✓ DeepSeek（Responses API）」, so that 我知道这家确实提供 Responses API（官方文档可溯源）。
6. As a 使用自托管 /vLLM 的用户, I want 界面不再出现一个永远不会被显示的状态, so that 我不会去追问「vLLM 自托管」到底什么时候会亮。
7. As a 维护者, I want Java 判定表每一行都有测试, so that 下次改分流时有人守门。
8. As a 维护者, I want 探测报文形态的期望值锚定 Responses API 规约而非当前实现, so that 测试不会把错误实现钉成正确。
9. As a 维护者, I want 测试样例来自真实响应, so that 我不会用手写自洽字段造出一个不存在的世界。
10. As a 维护者, I want ADR 记录 dummy key 的能力边界, so that 后人不会把 401 读成「端点存在」的证明。
11. As a 使用 Azure OpenAI 的用户, I want 本次改动不影响我的 Azure 路径, so that `/openai/v1` 自动补全与 `api-version` header 保持原样。
12. As a 使用 OpenAI 官方端点的用户, I want 本次改动不影响我的运行时翻译, so that 现有可用配置继续可用。
13. As a 开发者, I want web dev 预览路径保持现状, so that 本地预览不会因本票引入新的行为差异。
14. As a 维护者, I want 改动不触碰运行时 `buildRequestBody`, so that 已验证可用的翻译链路零风险。

---

## Implementation Decisions

### D1 · 探测报文 `input` 改为标量字符串

探测的 `input` 由裸字符串数组改为标量字符串 `"ping"`。

选择理由：标量字符串是 Responses API 的规范形态，且与 Java 运行时路径（`buildInput` 产出的字符串）**同形**——一次改动即让探测与运行时共用同一形态语义。消息数组形态（web dev 路径所用）同样有效，但对一个「ping」探测而言更重。

### D2 · 不改 web dev 路径

web dev 路径发消息数组，实测 200，**无需修改**。

> **更正记录**：grill 阶段曾建议「两端一起改」，前提是「web 路径也发裸数组、会复现同一 422」。实测推翻该前提——web 路径不是裸数组。故本决策收敛为只改 Java 探测报文。

### D3 · 不改运行时 `buildRequestBody`

运行时路径实测 200，**零改动**。本票全部风险集中在探测报文一处。

### D4 · ADR-0173 D3 修订而非推翻

保留 D3 的结论表（其结论在 DeepSeek 语境下成立），**只修订推理**：把「401 ⇒ 端点存在」改写为「401 ⇒ 该地址在接收 Responses 请求且要求鉴权」，并显式记录能力边界——dummy key 无法区分「路径存在」与「路径不存在但同样要求鉴权」。

不新开 ADR 推翻一个结论仍成立的决策，避免制造 ADR 负债。

### D5 · 绿灯文案

`compat.deepseek` 的中英文案由「Codex 兼容」改为「Responses API」。

原则：文案只陈述**已验证的事实**。「端点可达」这类措辞反而更不诚实——dummy key 恰恰证明不了可达性（D4 已记录该边界）。

### D6 · 清除 `vllm` 死状态

从类型联合、`COMPAT_KEYS` 映射、中英文 i18n 条目、配色分支，以及遍历八态的模板测试中一并移除。

`classifyProvider` 只产出 `azure` / `deepseek` / `ok`；`vllm` 在任何路径上都不可达。删除后兼容性状态由八态降为七态。

### D7 · `classifyProbe` 放宽可见性以可测

`classifyProbe` 由 `private static` 放宽为包内可见（package-private），使其可被同包 Robolectric 测试直接调用。

这是本票唯一一处为可测性放宽可见性的改动，不改变行为。

### D8 · ADR 修订文案示例的中文语境

ADR-0173 通篇为中文。修订段落保持中文，与既有文档一致。

---

## Testing Decisions

**什么算好测试**：只测外部可观察行为，不测实现细节。断言必须指向**独立来源**，禁止从当前实现反推。

### 缝 1 · Java 判定表（新增 Robolectric 测试）

- **位置**：与既有 `TranslationSseParserTest` 同目录、同风格（`@RunWith(RobolectricTestRunner.class)` + `@Config(sdk = 28)`）。
- **缝**：`classifyProbe(code, body)` 纯函数（依 D7 放宽可见性）。
- **覆盖**：ADR-0173 D3 表的每一行——2xx / 401 / 403 / 400+invalid-key body / 404 / 405 / 其余；外加实测 422。
- **oracle 溯源**（测试硬约束 #6）：期望状态锚定 **ADR-0173 D3 的表格条款**，而非「当前实现返回什么」。只改实现不改 ADR，本测试必须转红。
- **当前缺口**：D3 表的 `422` 未被任何行覆盖，落入 else 分支得 `unknown`——本票将其显式钉住。

### 缝 2 · Java 探测报文形态（新增）

- **缝**：探测请求体序列化结果。
- **oracle 溯源**：断言锚定 **Responses API 规约**——`input` 必须是标量字符串或消息数组，**不得为裸字符串数组**。
- **变异验证要求**：该断言若被写成「等于当前实现的输出」，必须能立刻放行错误实现。故断言钉规约、不是钉现状。

### 缝 3 · JS store 与模板层（扩展既有测试）

- **缝**：`classifyProvider` 分类 + 兼容性 chip 渲染。
- **既有落点**：扩展 `novelTranslateStore.test.ts`（`classifyProvider` 行为）与 `SettingsEndpoint.template.test.ts`（八态遍历）。
- **D6 连带要求**：`SettingsEndpoint.template.test.ts` 中遍历八态的用例**必须同步改为七态**，否则门禁转红。这是一处刻意的强制连带——它证明删除死状态确实穿透了渲染层。

### 真实样例（测试硬约束 #2）

实测抓到的真实 DeepSeek 响应体将存为测试 fixture：

- 401 · `authentication_error`（含 `invalid_request_error` code 与 request_id）
- 400 · 未知模型名（**不含** invalid-key 关键词 → 落 `unknown`，非 `ok`）
- 422 · `input: invalid input item`
- 422 · missing field `model`

**200 / 404 / 5xx 不需要 fixture**：`classifyProbe` 这几行只读状态码，不消费 body 任何字段，故用内联惰性字面量即可。真正需要真实样例的是**关键词敏感的行**（401 / 400 / 422）——它们读 body 内容，手写样例会与实现共享同一错误假设。

**禁止手写自洽字段**——mock 必须来自真实数据源。

### 兜底路径告警（测试硬约束 #3）

探测落 `unknown` 分支时必须可观测。现状已有 `console.warn`（「原生返回未知兼容性状态，回落 unknown」），本票保持并纳入测试。

---

## Out of Scope

1. **chat/completions 协议分支**（原票方向 3）。动机已消失——DeepSeek 直接提供 Responses API。此举属无需求的功能扩张。
2. **运行时 `buildRequestBody` 改动**。实测 200，零风险原则不动。
3. **web dev 路径改动**。实测 200（见 D2 更正记录）。
4. **「两端不同形」独立缺陷**。Java 运行时发标量字符串、web dev 发消息数组，而 Java 注释称「两端同形是硬约束」——该约束**当前不成立**（两种形态都能 200，故从未暴露）。**另开票**，不塞进本票。
5. **原票所述运行期 400 的复现**。以真实密钥 + 运行时报文实测得 200，**无法在当前代码上重演**。本票只对探测 / 「测试连接」路径负责；原票该条结论将从票中移除，不留一个无法证实的断言。
6. **原票引用的 `packages/app/.env`（`PICTELIO_AI_PROTOCOL=chat`）**。`packages/app/` 已随 ADR-0203 删除，该目录不存在，此段影响分析已失效。
7. **补真实样例契约测试之外的端到端真机验证**。android-e2e 不进 CI（ADR-0084），本票以单测 + 契约门禁为防线。

---

## Further Notes

### 原票根因的三处自我矛盾（留档）

1. 票称 `classifyProvider` 把 `unknown` 洗成 `deepseek`，但该函数第一行即 `if (hostStatus !== "ok") return hostStatus`——此路径不可能发生。票自身已察觉（指出首行是 early return），随后以「真正需要核对的矛盾点是……」含糊收尾。
2. 票称 DeepSeek 对 `/v1/responses` 返回 400；实测该端点返回 200。
3. 票的「建议方向 1/2」（不再标绿、把 400 判为 incompatible）若实施，会把**真兼容**判红，制造假阴性。

### 为何绿灯今天是对的、但理由是错的

DeepSeek 确实支持 Responses API，所以绿灯的**结论**正确。但它由「401 ⇒ 端点存在」得出，而该推断在鉴权先于路由的服务上不成立。修 D5 文案而不修 D4 推理，等于把一个错误推断的结果擦亮——用户看到的仍是「绿灯」，只是换了措辞。

### 术语边界（本票不拆状态，但记录张力）

`deepseek` 这一个状态**同时承载两件事**：按 hostname 认定供应商归属（JS 侧），与端点协议兼容性（ADR-0173 D1 声明二者正交）。D5 缓解文案层的冒充，**未解决状态层混载**。彻底拆分需牵动八态机、持久化键与 D1 两层模型，代价远超本票；若日后 DeepSeek 之外再出现归属与兼容性背离的供应商，应重新评估。

### 与 #830 的关系

原票称本缺陷导致落地页图库重采删掉 04_translate 对照图（#830）。本票修复后，AI 翻译在仓库自带凭据下应可端到端跑通——是否恢复该对照图由 #830 自行判断，本票不代为决定。