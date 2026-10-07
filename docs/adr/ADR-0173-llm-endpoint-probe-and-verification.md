# ADR-0173: LLM endpoint 探测与凭据验证（两层状态）

- **状态**：accepted（2026-09-19）
- **日期**：2026-09-19
- **关联**：wayfinder map #617 / spec `docs/specs/app-lynx-novel-translation.md` §6.1 §6.2 §9.1 §9.5 / ADR-0169（provider 接口）/ ADR-0170（native bridge，probe 契约）/ ADR-0037（apiKey 字节零进 JS 堆）/ ADR-0172（运行时 API 面）

---

## 背景

设置页的「Base URL」下方按 spec §6.1 应有一条兼容性提示（`✓ Responses API 兼容` 等六态），「保存」左侧应是「测试连接」按钮（真实 key 发一次最小翻译）。实现把两者合并成**一个按钮**，且按钮标题直接绑定了 `endpoint.probe.success`（=「连接成功」）这个**结果文案**——用户什么都没输入、也没点过任何东西，就看到一个写着「连接成功」的按钮（2026-09-19 真机截图报障）。

同一个按钮还有三个连带问题：
1. 六态被压成 boolean（`store.probeEndpoint(): Promise<boolean>`），丢失「仅 chat/completions」「无法探测」等对用户决策有用的区分；
2. probe 被 `formValid` 卡住（要求 key ≥20 字符），而保存后 ``apiKey`` 被清空且不回填（JS 堆永不持明文）→「已保存的配置想再测一次」必须重新输入密钥；
3. 探测结果用完即弃，重进设置页又显示与用户实际经历无关的状态，从未回答过「我上次这个 key 是通的吗」。

spec/ADR 里**没有**任何关于「已验证状态」「免密钥重测」「保存后 API Key 字段 UX」的约定（2026-09-19 全量 grep 零命中）——本 ADR 是新增决策。

## 决策

### D1 · 两层状态，互不冒充

「这个地址支不支持 Responses API」与「我这套凭据能不能用」是两个独立事实，各有各的状态与数据来源：

| 层 | 状态 | 触发 | 用什么 key |
|---|---|---|---|
| **端点兼容性** | `idle`（未探测）/ `ok` / `azure` / `deepseek` / `partial`（仅 chat-completions）/ `incompatible` / `unknown`（无法探测） | 输入 baseURL 后 **debounce 600ms 自动** | **dummy key** |
| **凭据验证** | `unverified` / `verified` / `failed` | 用户点「测试连接」 | **真实 key**（用户当场输入） |

禁止：用兼容性冒充凭据有效；缺少 key 时沿用上一次的 `verified` 徽章；把结果文案当作动作按钮的标题。

### D2 · dummy-key 探测（照 spec §9.1 / ADR-0170 原设计）

探测请求永不携带用户密钥（固定假 key），因此**未配置密钥也能回答「这家支不支持」**，也让「已保存的配置免密钥重测」天然成立——不需要任何新增 native 方法。ADR-0170 的 `probeEndpoint(baseUrl, apiKey, model, cb)` 签名保持现状（其余调用方不受影响），前端传固定的探测假 key。

### D3 · 兼容性看地址，不看密钥（**修订 2026-09-19，code-review 后；推理修订 2026-10-07，#831**）

探测的 HTTP 分流（`PictelioTranslateModule.classifyProbe`，**值域只有四种**）：

| HTTP | status | 说明 |
|---|---|---|
| 2xx | `ok` | 地址兼容且凭据可用 |
| 401 / 403 | `ok` + `keyInvalid: true` | 该地址在接收 Responses 请求且要求鉴权，密钥无效 → 凭据层判 failed |
| 400 + invalid-key body | `ok` + `keyInvalid: true` | 同上 |
| 404 | `incompatible` | **不是** Responses 端点（spec §9.1；此前误判为 partial） |
| 405 | `partial` | 仅 chat/completions 兼容 |
| 其它 / 网络错 | `unknown` | 无法探测 |

**provider 归属（`azure` / `deepseek`）由 JS 侧按 hostname 判定**，原生不回这些值——早期版本的 ADR 与测试曾声称原生会发 6-8 态，那是**不存在的 wire 契约**（code-review M3 已修：测试改用真实值域 + 白名单校验未知串）。

#### 能力边界：dummy key 无法证明「路径存在」（2026-10-07 修订，#831）

上表 401/403 行的**结论保留**，但**原推理「地址兼容（endpoint 在）」不成立**，改写为「该地址在接收请求且要求鉴权」。

原因：**鉴权先于路由的服务上，401 只证明地址在收请求，完全不证明 `/responses` 路径存在。** DeepSeek 即如此——实测以 dummy key 打**任意路径**（含构造的不存在路径）均返回 401 而非 404。

由此产生的两个已知局限，均**接受、不整改**：

1. **绿灯的结论可能是对的，理由却是错的**。若某服务后来下线 Responses 支持，本表仍会给绿灯。因此绿灯**不得被当作协议兼容的证明**，UI 文案只陈述已验证事实（见 #945：`✓ DeepSeek（Responses API）`）。
2. **不要反向过度修正**。曾有 bug 票据「DeepSeek 不支持 Responses」推断应把 401 判为不兼容——该前提为假（DeepSeek 自 2026-07-31 起原生支持 Responses API，2026-08-13 扩展至 V4-Pro），照此整改会把真兼容判红、**制造假阴性**。证据来源：官方更新日志 <https://api-docs.deepseek.com/zh-cn/updates/> 与 Responses API 指南 <https://api-docs.deepseek.com/guides/responses_api/>；完整取证记录见 `docs/specs/llm-endpoint-probe-payload-and-verdict-honesty.md`（§上游取证，含真实密钥实测 200 与 SSE 事件名）。

#### 探测报文的形态要求（2026-10-07 新增，#831）

探测请求体的 `input` **必须是标量字符串**，不得写成裸字符串数组 `["ping"]` —— Responses API 只接受标量字符串或消息数组（`[{role, content}]`）。

该形态缺陷曾长期不可见，因 dummy key 总先撞 401、把它掩盖成绿灯；「测试连接」用真实 key 鉴权通过后才显形（**修复前**实测 422 `input: invalid input item`），造成**同一端点自动探测判兼容、测试连接判失败**。

**修复后取证**（#944）：同一报文、真实密钥 → `200` `object: response`（`status: incomplete` 因 `max_output_tokens=1` 截断，属预期）。两条路径对同一端点判定就此一致。该 200 响应存为 fixture `resources/llm-probe/deepseek-200-completed.json`，由 `PictelioTranslateProbeTest.classify2xxIsOk` 消费。约定探测报文与运行时报文同形（标量字符串），二者共用同一形态语义。

#### 相关但不在本决策范围

**#943 已处置（2026-10-07）**：该缺陷是**注释错述**而非代码不一致 —— 原 `buildInput` 注释称「两端同形是硬约束…native 无 [N] 锚定」，两句均与实现相反。实测结论：

- 两路的**锚定文本逐字节相同**（`[i] ` 前缀 + `\n\n` 分隔），该部分本就一致；
- 外层报文形态**本就不同且都合法**（运行时发标量字符串、web dev 发 `[{role:'user', content}]`），实测两者打 `/v1/responses` 均返回 200 —— 故「形态必须一致」是伪约束，照它改反而会让正确代码去满足一条错的规则；
- 已改写 `buildInput` 注释为两条真不变量，并补齐 `buildInput` 的契约测试（此前零覆盖，而它是真机唯一在跑的锚点产出者）；
- 核对链路时另发现一个**既存**缺陷（native 段落对齐塌陷，N−1 段静默回退原文），与本 ADR 无关，已开 **#948** 跟踪。

「形态差异是否需统一」的答案是**不需要**；若日后出现只收单一形态的服务，再单开票。

### D4 · 凭据验证状态持久化（含失效规则）

- 只在「测试连接」成功后写 `verified` + 时间戳；失败写 `failed` + 时间戳。
- **只存结果枚举与时间戳，不存任何密钥材料**（不存 key、不存其哈希——哈希也能用于离线校验，无必要）。
- 失效规则：① **任何一次保存都清除验证**（key 无法比较：同一 baseURL 换新 key 时沿用旧的「已验证」正是 D1 禁止的假象）；② 清除 endpoint → 状态清除；③ **baseURL 变化 → 状态清除**；④ **model 变化不失效**（地址与凭据都没变），仅在 UI 提示「换了模型建议重测」。
- 状态里带 `baseUrl`（非密）：UI 必须拿它跟**当前输入框**比对——用户改了地址但还没保存时，徽章不得继续显示旧地址的「已验证」（code-review M2）。
- 存储键：`llm_endpoint_verified_state`（`verified|failed`）、`llm_endpoint_verified_at`（毫秒时间戳）、`llm_endpoint_verified_base_url`（判定失效用），与既有 `llm_endpoint_base_url|model|target_lang` 同存储（native 走 `PictelioPrefs` 共享 SharedPreferences，dev 走 idbKV）。
- 读失败不阻断（维持 `unverified`），但必须 `console.warn`（AGENTS.md 测试硬约束 #3）。

### D4b · 翻译授权独立于内容显示（spec §9.7 落地）

设置页新增两个**账号级**授权开关（`settings_translate_r18_${uid}` / `settings_translate_r18g_${uid}`，**与内容显示开关 `show_r18_*` 完全独立**）：看见 R18 内容 ≠ 允许把 R18 正文发给第三方 LLM。首次开启任一开关前弹**行内风险确认**（R18：服务商可能记录 / 用于训练、账号可能受限；R18G：法律红线 + 可能上报）。

应用层闸门（`settingsStore.isTranslationRestricted(xRestrict)`）：`xRestrict=1` 需前者、`=2` 需后者；未授权时**不发请求**（正文零外发），状态置 `aborted`，错误码区分 `R18_BLOCKED` / `R18G_BLOCKED`。

早期实现复用了内容显示谓词（「开了 R18 显示就允许翻译」）——那是把两种授权混为一谈，本决策取代之。

### D5 · 「测试连接」按钮语义

- 按钮标题恒为**动作**（`endpoint.test.button` = 「测试连接」），结果只出现在**结果区**（内联一行：成功/失败 + 原因）。
- 结果呈现偏离 spec §6.1 的「M3 Snackbar」：app-lynx 无全局 Snackbar/toast 设施，采用**页内内联提示**（4s 后淡出），与仓库既有做法一致（如导出提示）。理由记此，避免被误读为遗漏。
- 成功即写 D4 的 `verified`；失败写 `failed`（含 `invalid_key` 区分文案）。

### D6 · 翻译按钮态（spec §6.2 收敛为 4 态）

`未译`（翻译本章）/ `未配置`（**配置翻译** → 跳设置页）/ `翻译中`（**可点 → abort**，此前 `disabled` 时 `onTap` 直接 return，用户没有任何停止手段）/ `已缓存`（**重译**，点击清缓存重译；此前点击只是切换原文/译文，无重译入口）。

不做「续译」：依赖 partial 段落标记（spec §7.2 独立票），硬做会造出假的续译语义。

### D7 · 失败必须可见

`store.error` 目前全仓无渲染点（`translate-error` emit 也无人监听）→ 翻译失败对用户完全静默。补一条**内联失败条**（§6.4 的最小形态）：显示错误文案 + 「更换 endpoint」入口。完整 §6.4（error-container 配色 + 查看文档链接）留待后续票。

## 后果

- 正面：用户看到的每个状态都对得上它的来源；未配置时有明确引导；翻译中能停；失败不再是黑箱；已保存配置免密钥可重测。
- 代价：设置页多**两行**状态（兼容性 chip + 凭据徽章）与一个内联结果区；新增 3 个存储键 + **20 个 i18n 键**（每语种）。
- 偏离 spec 两处（D5 Snackbar → 内联提示；D6 5 态 → 4 态）已在本 ADR 显式记录，不属遗漏。
