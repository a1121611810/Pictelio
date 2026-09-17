# ADR-0166: 发布文案的「模型总结」步骤与通用 OpenAI 兼容通道

- 状态：accepted
- 日期：2026-09-17
- 关联：`packages/app/scripts/lib/release-notes-ai.mjs`（实现）、`packages/app/scripts/release.mjs`（接线）、`packages/app/tests/unit/scripts/release-notes-ai.test.ts`（46 例，含变异实证）、`docs/release-checklist.md`「发布文案的模型总结」、`packages/app/CONTEXT.md`（词条：发布文案 / 模型总结 / 未配置模型）、ADR-0085（AI 断言收缩——同一 DeepSeek 家族通道的既有先例）、ADR-0068（version.json changelog 截断上限）

## 背景

发版文案此前全靠人写：交互模式产出的是「分类 + hash + 提交原文」的机器清单，自定义模式（`-c`）要作者把成稿粘贴进去——2026-09 的两次发版都是先在 agent 会话里写好再粘。而文案是对外门面（GitHub Release、应用内更新弹窗、`version.json` 更新清单），其中四类活是纯机械劳动：按内容分节、把实现改写成用户视角、删工单号/PR 号/ADR 号/hash、标注「作用于谁」（双端 / 仅 Lynx / 仅 WebView）。

要不要让发布脚本自己调模型？四条候选通道：

1. **本机 agent CLI**（`claude -p` / `codex exec`）——模型能读仓库上下文，文案质量上限最高；但本机 PATH 上没有任何 agent CLI（实测 `claude`/`codex`/`gemini`/`copilot`/`ollama` 全无），且会把发布流程绑到「这台机器装了哪个 CLI」。
2. **绑死某家 API**（如 DeepSeek）——零配置，但换供应商要改脚本。
3. **通用 OpenAI 兼容 HTTP**——两种协议形态覆盖绝大多数供应商与本地推理（DeepSeek / OpenAI / Azure / Ollama / 各类中转网关）。
4. **不自动调用**，只打印提示词由人贴进 agent 会话——零风险但不算自动化。

## 决策

1. **通道取通用 OpenAI 兼容，支持两种协议形态**：`chat`（POST `{base}/chat/completions`，取 `choices[0].message.content`）与 `responses`（POST `{base}/responses`，取 `output[].content[].text`）。base URL 是**拼接前缀**（DeepSeek 给 `https://api.deepseek.com`，OpenAI 给 `https://api.openai.com/v1`）；协议显式配置、**不做自动探测**（探测白费一次请求，还会把配错藏起来）。**注意 `output_text` 只是各家 SDK 合成的便利属性，线上报文里没有**——实现必须自己走 `output` 数组，这条有单测钉住。
2. **配置四键全部无默认值**，填在 `packages/app/.env`（gitignore）：`PICTELIO_AI_BASE_URL` / `_API_KEY` / `_MODEL` / `_PROTOCOL`（`chat` | `responses`）。优先级 `process.env` > `.env`。**缺任一键 = 未配置** → 打一行 warn 说明缺哪个键并跳过该步骤——不去问一个做不到的问题；协议值非法同样算未配置并点名非法值（不把配错静默当成没配）。
3. **触发点：文案选定之后、选版本号之前**，`-i`（交互，`pnpm release` 的默认）与 `-c`（自定义粘贴）共用同一步；`-o` 覆盖发布**不做**（它改的是已发布版本的旧文案，且要另写插入点）。
4. **成稿替换同一条 `changelog` 变量**，因此四处落点永远同文：git commit body、fastlane `changelog/<versionCode>.txt`、GitHub Release notes、`website/version.json` 的 `changelog` 字段。原始提交清单仍可从 git log 追溯，不需要在 commit body 里重复。
5. **成稿必须过人工闸口**：整篇打印后问 `确认使用? (Y/n/e=重新总结)`。`e` 始终以**原始文案**为输入重跑，不拿上一版成稿再喂一遍（避免逐轮漂移）——该契约有专门的单测与变异实证。
6. **失败一律可见、不替使用者决定**（本仓库「禁止静默降级」硬约束）：任何失败（网络 / 401 / 402 / 404 / 429 / 5xx / 非 JSON / 空输出）打 warn 说明成因，再问「改用原文案继续? (Y/n)」，答 `n` 中止发布。最多 2 次尝试：429 / 5xx / 网络错误 / 非 JSON / 空输出重试一次；**4xx 与超时不重试**（超时默认 240s——慢模型重试一次等于把等待翻倍）。
7. **只发最小必需字段**（`model` + 消息体），不发 `temperature` / `max_tokens` / `stream`：不同供应商对可选参数的支持不一（部分模型直接 400 拒绝），长度改用提示词约束（≤900 字）。唯一例外是 responses 协议显式 `store: false`——该协议缺省会把请求留在服务端，发版素材没有留存价值，显式关闭比依赖供应商默认值可靠。
8. **本轮不做输出后处理**：成稿直接落盘，格式由提示词 + 人工闸口兜底。提示词是代码常量 `RELEASE_NOTES_SYSTEM_PROMPT`（风格口径取自 5.1.0 已发布的 `50100.txt`），示例条目为**虚构**，避免模型把某一版的真实条目抄进后续版本。
9. **交互闭环与失败语义下沉为可测模块**：`lib/release-notes-ai.mjs` 的 `runSummaryStep`（端口注入：`ask` / `summarize` / `warn` / `log`），`release.mjs` 只做端口接线与日志口吻——与 `lib/` 其余模块（release-utils / release-panel / release-webonly）的既有分工一致。

## 后果

- 发版文案从「人来写」变成「模型出稿 + 人拍板」：交互模式选完提交即可拿到成稿；自定义模式仍可粘贴草稿（答 `n` 走原路径，零变化）。
- **实测数据（2026-09-17，素材为 v5.0.0→v5.1.0 的 32 条提交）**：`deepseek-flash` 13s / 572 字，节标题带主题（`## ✨ 新功能：Lynx 成为默认引擎`）、条目用功能名作前缀（`**Lynx 搜索**`）、文档与测试类提交被正确剔除，与已发布的 `50100.txt` 口径一致；`deepseek-v4-pro` 默认思考单次 **103s**（口径可用），关掉思考 9s 但口径回退（改用「仅 Lynx」这类纯作用域标签，并把仅开发者可见的自检页写进对外文案）。**超时默认值（240s）与「建议先用快档」的文档口径由这两条实测反推**；模型档位不写死，由使用者在 `.env` 里定。
- **已知后果（未处理）**：成稿带 Markdown 标记（`#` / `##` / `-` / `**`）流入 `website/version.json` 的 `changelog` 字段，而应用内更新弹窗（`StartupUpdateDialog.tsx`，`whitespace-pre-wrap` 纯文本插值）与 Lynx `UpdatePage.vue`（按行塞 `<text>`）会**原样显示**这些标记。这是**既有现状**（5.1.0 的 `version.json` 就已如此，`-c` 粘贴的成稿一直是 Markdown），不是本决策引入；若要修，应单独决定「`version.json` 走纯文本变体」，而不是在模型环节剥标记。
- 该步骤在 step 1（签名环境检查）**之前**：若 keystore 密码或 OTA 私钥未就绪，会先花一次模型调用与等待，再在 step 1 失败。位置是「文案选定之后」的必然结果，接受。
- 缺陷面收窄为四条可测断言（均有单测 + 变异实证：删掉任一条都会被测试抓住）：超时信号真的接上、两个拍板常量（240s / 2 次）、响应提取只认 `content`（不回退 `reasoning_content`）、`e` 以原始文案重跑。
- 该通道是**通用**的：将来任何「让脚本用模型处理文本」的需求（例如整理 issue、生成 ADR 草稿）可复用同一模块与同一组配置键，不必再引一条供应商专线。
