---
title: OpenWiki 是否值得保留 —— 本仓一手证据（成本 / 已有替代资产 / 独有贡献与失真点）
date: 2026-10-08
scope: 本仓一手实测（一~三节）+ 开源与商业/托管方案 primary sources 调研（四~五节）+ 三方结论冲突的解法（六节）
conclusion: 三条路——①先做零风险调参实验（并发 + 收窄证据源，小时级可证伪）；②并行补 docs/adr 索引脚本（与 openwiki 去留解耦）；③用①②的实测决定去留。商业/托管方案结构性否决（产物不入 git）；CodeWiki 是唯一合格 OSS 替代但不支持 Vue SFC（本仓 19.3k 行页面/组件层不入图）。
---

> 本阶段只交付三节，全部结论均带可复现证据坐标（命令 / 文件:行号 / git 命令输出摘要）。
> 调研基准 commit：`e3104f541c86306190f85e3d05be52c370ccc37e`（2026-10-08 "docs: update OpenWiki (#959)"）。
> 本次调研**未执行任何 openwiki 命令**（遵守 ADR-0099 与 AGENTS.md「禁止本地 openwiki:update」），**未修改 openwiki/、AGENTS.md 或任何其他既有文件**。

**来源清单（primary sources）**

| # | 来源 | 用途 |
|---|------|------|
| S1 | `.github/workflows/openwiki-update.yml`（304 行） | A1 门禁拓扑 |
| S2 | `openwiki/` 目录 + `openwiki/.claims/` + `openwiki/.page-manifest.json` + `openwiki/.last-update.json` | A2 体积 / A4 页面集 / C 组抽样 |
| S3 | `packages/android-host/tests/unit/openwikiGateDeadlock.test.ts`（139 行） | A3 专门测试 |
| S4 | `docs/adr/ADR-0099-local-openwiki-disable.md`（60 行） | A3 决策结论 |
| S5 | 全仓 `grep -ri openwiki`（排除 `openwiki/`、`node_modules`、`.git`、`dist`、`.codegraph`） | A3 维护面 |
| S6 | `AGENTS.md`（352 行）、`CONTEXT-MAP.md`、`NOTES.md` | B5 / B7 |
| S7 | `docs/`（530 个 tracked md）+ `git log --since` 活性统计 | B6 |
| S8 | `docs/adr/`（271 个 tracked 文件） | B8 |
| S9 | `codegraph status --json` / `codegraph --help` / 各子命令 `--help` | B9 |
| S10 | `docs/research/codegraph-vs-openwiki.md`（既有同类笔记，2026-08-11） | 反面对照 |
| S11 | `packages/app-lynx/src/{router.ts,routerCore.ts,App.vue,utils/topInset.ts,utils/safeArea.ts}`、`packages/android-host/android/{app/build.gradle,variables.gradle,build.gradle}`、根 `package.json`、`pnpm-workspace.yaml` | C11 事实核验源 |

---

## 一、OpenWiki 的真实成本（仓库实测）

### A1. CI workflow 的真实结构

命令：`wc -l .github/workflows/openwiki-update.yml` → **304 行**；`cat -n` 全文通读。

**结构骨架**（单 job `update`，`runs-on: ubuntu-latest`）：

- **step 总数 = 13 个主 step + 4 个 `continue-on-error` 后的收尾 step**（共 17 个 `- name:` 块，与 S3 测试里 `parseSteps` 的判据 `steps.length < 5` 同一抽取口径）：

| # | step 名（行号） | 作用 |
|---|---|---|
| 1 | Check required secret (L30) | 脱敏校验 `OPENAI_COMPATIBLE_API_KEY` |
| 2 | Check PAT secret (L45) | 校验 `OPENWIKI_PAT` |
| 3 | Check out repository (L56) | `fetch-depth: 0`（L64） |
| 4 | Set up Node.js (L66) | node 22 |
| 5 | Install OpenWiki (L71) | `npm i -g openwiki@0.7.1 mermaid@11.16.0 jsdom@29.1.1`（L90） |
| 6 | **Snapshot pre-run OpenWiki state** (L92, id `prestate`) | 快照上轮 `gitHead` |
| 7 | Run OpenWiki (L105) | `openwiki code --update --print`，`continue-on-error: true`（L109） |
| 8 | **Snapshot post-run OpenWiki state** (L131, id `poststate`) | 快照本轮 `status`/`gitHead` |
| 9 | Remove transient OpenWiki run state (L158) | `rm -f openwiki/.run.json` |
| 10 | Remove deprecated CLAUDE.md (L164) | `rm -f CLAUDE.md` |
| 11 | List OpenWiki update paths (L169, id `paths`) | `add-paths = openwiki,AGENTS.md,.github/workflows/openwiki-update.yml`（L173） |
| 12 | **Detect silent no-op update** (L175, id `noop`) | 空跑检测器（只判定、只输出标记） |
| 13 | **Create OpenWiki update pull request** (L221) | `peter-evans/create-pull-request` |
| 14 | **Gate auto-merge on a complete run** (L246) | 门禁 1：complete |
| 15 | **Enforce no-op detection** (L272) | 门禁 2：空跑假绿 |
| 16 | Propagate OpenWiki failure (L288) | `exit 1` |
| 17 | Enable auto-merge on OpenWiki PR (L292) | `gh pr merge --auto --squash` |

**三道自研门禁（全部为本仓自写，非 openwiki 官方模板自带）**

1. **poststate 防死锁快照**（step 8，L131–L156）。注释自陈成因（L132–L138）：`peter-evans/create-pull-request` 会 `git stash push --include-untracked` / `git reset --hard origin/main` / 切回 main，把工作区还原回 `main`；门禁若在那之后读 `openwiki/.last-update.json` 读到的永远是上一轮的 `interrupted`，于是 `main` 永久停在 interrupted → 永不自动合并 → 人工把 interrupted 合回 main → 下一轮继续锁死。实证：**Actions run 37714665688（2026-10-08）**，PR 分支上 `status=complete`/`gitHead=fdf2052c`，门禁却读到 `interrupted`/`666fe1de`（同一事实也被 S3 测试文件头 L10-12 与 `openwiki/testing/overview.md` 记录）。status 值经 `env:` 传入而非插值，理由是防脚本注入（L255）。
2. **complete 门禁**（L246–L270）。判据：不许自动合并，除非状态文件可解析且 `status == "complete"`。注释明说 `openwiki#921` 记录过被中断的 run 仍可能 exit 0，**退出码不是可信信号，状态文件才是**（L252-254）。
3. **no-op 空跑假绿门禁**（检测器 L175–L219，判定 L272–L286）。判据链：`gitHead` 未前进 → 放行；区间内非 `docs/` 改动 = 0 个文件 → 放行（"只有 docs/ 变动，wiki 无变化属预期"）；否则对 `openwiki/`（排除 `.last-update.json`/`.run.json`）做内容 diff，为空即 `::error::`。注释自陈已知误报面：纯重命名测试文件会误判，取舍是"假绿的代价是 wiki 静默失真，误报的代价是一次人工确认"（L276-279）。

**其余成本参数**

- **timeout：`timeout-minutes: 150`**（L28）。演进注释在 L24-27：0.7.x 的 `--print` 仍是批量缓冲输出，长跑期间日志全白；**90 → 150 是因为「实测 13 个页面全量重写要 56 分钟（2026-10-08 实测）」，90 分钟只剩 1.6 倍余量**。
- **schedule cron：`10 10 * * *`**（L15），另有 `workflow_dispatch`（L4）带 `debug` 布尔开关。L11-14 的注释是一整段排程史：原值 `0 8 * * *` 实测启动落在 12:37–16:23 UTC（"刷新发生在下班之后，白天读到的永远是上一轮"），曾改成北京 09:00，现按需改为北京 18:10。
- **依赖的 secrets（3 个）**：`secrets.OPENAI_COMPATIBLE_API_KEY`（L34/L123）、`secrets.OPENWIKI_PAT`（L48/L229/L296）、`secrets.LANGSMITH_API_KEY`（L127，可选，仅配了 key 才开 tracing）。
- **权限**：`permissions: contents: write` + `pull-requests: write`（L17-18）。
- **模型/端点硬编码在 workflow 里**：`OPENWIKI_PROVIDER=openai-compatible`、`BASE_URL=https://api.deepseek.com/v1`、`OPENWIKI_MODEL_ID=deepseek-flash`（L122-125）。`openwiki/.last-update.json` 的 `model` 字段确为 `deepseek-flash`，与 workflow 一致。
- **单次运行挂钟规模**：最近三次重写级提交 `f6b08131`(2026-10-08, #936) 34 文件 / +7056 −567、`791d4b95`(#958) 18 文件 / +3789 −259、`82c16464`(#933) 26 文件 / +3782 −2446。

### A2. `openwiki/` 的体积构成：正文 vs 机器元数据

命令与输出：

```
$ du -sh openwiki                → 1.9M
$ du -sh openwiki/.claims        → 1.2M
$ du -sh openwiki/* openwiki/.[a-z]* | sort -h
  4.0K  openwiki/.last-update.json      4.0K  openwiki/INSTRUCTIONS.md
  4.0K  openwiki/index.md               8.0K  openwiki/.page-manifest.json
  24K   openwiki/quickstart.md          32K   openwiki/workflows
  36K   openwiki/operations             52K   openwiki/integrations
  56K   openwiki/testing                96K   openwiki/concepts
 160K   openwiki/architecture          248K   openwiki/domain
 1.2M   openwiki/.claims
$ find openwiki -name '*.md' | xargs wc -l | tail -1   → 6374 lines / 672021 bytes
$ find openwiki/.claims -type f | wc -l                 → 17
```

**结论（一句话）**：**人类可读的正文 6,374 行 / 672 KB，只占 openwiki/ 体积的约 1/3；机器元数据 `.claims/` 1.2 MB、17 个 JSON，占约 2/3。** 单看 `du -sh openwiki` 会把 `.claims/` 的体积误算作"文档成本"。

- 页面正文行数（`wc -l`，17 页）：`domain/downloads-and-export.md` 642 · `domain/continue-reading-and-history.md` 438 · `concepts/viewport-geometry-and-motion.md` 426 · `integrations/android-native.md` 402 · `workflows/change-and-verification-loop.md` 399 · `architecture/app-shell-and-navigation.md` 392 · `architecture/api-layer.md` 365 · `architecture/image-pipeline.md` 355 · `domain/feed-and-browsing.md` 354 · `domain/settings-and-backup.md` 344 · `architecture/overview.md` 340 · `operations/release-and-deploy.md` 338 · `domain/notifications-and-delivery-probe.md` 328 · `domain/novel-reader.md` 327 · `concepts/md3-design-system.md` 321 · `testing/overview.md` 322 · `quickstart.md` 233。
- 另有 7 个 3–8 行的 `index.md` 目录桩 + 1 行 `INSTRUCTIONS.md` + 17 行根 `index.md`。
- **每页都带 50–100 行 YAML front-matter**：`type`/`title`/`description`/`tags` + **`sources:` 清单（每条一个 `openwiki-source-<hash>` + `repo://` 路径）** + `generated:` + `verified:`。例：`openwiki/quickstart.md:1-65` 的 front-matter 独占 65 行，是该页正文（67 行起）的 43%。这是"生成物自证来源"机制的直接成本。

### A3. 为 openwiki 专门存在的测试与文档债

**(1) 专门的死锁防线测试确实存在**：
`packages/android-host/tests/unit/openwikiGateDeadlock.test.ts`，**6,274 字节 / 139 行**，mtime `Oct 8 10:31`。

它测什么（读全文）：

- 被测对象**不是产品代码，是 CI 工件** `.github/workflows/openwiki-update.yml`（L28）。
- 不引 `yaml`/`js-yaml`（本仓未安装），改用 `/^ {6}- name: (.+)$/` 行扫描自抽 step 列表（L36-49，理由见 L22-24）。
- 断言 5 条不变量（L56-95）：① poststate 快照必须排在 `Create OpenWiki update pull request` 之前；② 快照步骤本身必须读 `openwiki/.last-update.json`；③ 门禁步骤**不得**直接读该文件（缺陷的原始形态）；④ 门禁必须消费 `steps.poststate.outputs`；⑤ `status != "complete"` 校验必须存活。另：抽取器只认出 <5 个 step 本身即视为违规。
- **4 条检测式阳性对照**（L102-138），把三个反事实常驻成测试：门禁改回直接读文件 / 快照挪到建 PR 之后 / 掏掉 complete 校验 / 喂非 workflow 文本——每条都必须让同一评估器转红。注释称之为"强制项"，并写明"否则本文件是恒真的假防线"（L19-20）。
- 判据溯源（L9-12）指向 Actions run 37714665688。

**成本含义**：为了让一个第三方生成器的 CI 门禁不被自己改坏，本仓养了一个 139 行的契约测试 + 一整套阳性对照组，位置还放在 `packages/android-host/tests/unit/`（与 Android 构建宿主毫无关系的包里，纯粹因为那是 `test:all` 的收集路径）。

**(2) ADR-0099 的结论**：`docs/adr/ADR-0099-local-openwiki-disable.md`（60 行，状态"已批准"，日期 2026-08）。

- 决策 1：**禁止** AI Agent 本地执行 `pnpm openwiki:update`（L23）。
- 决策 2：**禁止手动编辑** `openwiki/` 下任何生成文件；只改源码/`CONTEXT.md`（L24）。
- 决策 3：更新失败/滞后**不影响**本地开发或 commit，CI 会收敛（L25）。
- 决策 4：保留根 `package.json` 的 `openwiki:update` 脚本供人工应急（L26；实际仍在 `package.json:58`）。
- 决策 5：`openwiki/quickstart.md` 是生成文件，其过时的 `openwiki:update` 描述**不手改**，由 CI 修复（L27）——这条直接催生了 C11 失真 4。
- 替代方案评估表（L31-35）：保留"agent 主动执行"被否决的三条理由是 ① 权限脆弱（`EPERM: chmod ~/.openwiki`）② 重建 `CLAUDE.md` 污染工作区 ③ 与 CI 每日同步重复。
- 风险表（L50-54）自陈"quickstart.md 过时引用长期残留"被判定为"不构成功能影响"。

**(3) 全仓维护面统计**（`grep` 工具，pattern `openwiki`，include `*.{md,ts,tsx,js,json,yml,yaml,sh,vue}`）：

- 全仓命中 **944** 处 / **72 个文件**。
- 其中 `openwiki/` **自身** 18 个文件 / 766 处。
- **`openwiki/` 之外 = 54 个文件 / 178 处**，前 20 按次数：

| 次数 | 文件 | 性质 |
|---|---|---|
| 28 | `AGENTS.md` | 硬约束 + 页面索引表 + CI 维护块 + OPENWIKI:START/END 标记对 |
| 25 | `research/agents-md-trim-audit.md` | 根级历史审计笔记（已陈旧：仍在论证"双引擎"取舍） |
| 18 | `docs/adr/ADR-0099-local-openwiki-disable.md` | A3(2) |
| 14 | `docs/research/webview-perf-diagnosis.md` | 提及 |
| 9 | `docs/research/codegraph-vs-openwiki.md` | 既有同类选型笔记（S10） |
| 8 | `packages/android-host/tests/unit/openwikiGateDeadlock.test.ts` | A3(1) |
| 8 | `docs/research/network-self-check-patterns.md` | 提及 |
| 3 | `docs/specs/single-engine-facade-consolidation.md` · `packages/android-host/tests/unit/scripts/release-preflight.test.ts` · `docs/research/competitor-features-comparison.md` · `docs/adr/ADR-0202-ota-web-bundle-channel-retirement.md` | 零星 |
| 2 | `NOTES.md` · `docs/adr/ADR-0063-github-actions-ci-gate.md` · `docs/adr/ADR-0201…` · `docs/adr/ADR-0213…` · `docs/adr/ADR-0083…` · `docs/specs/*`（4 篇）· `docs/research/*`（6 篇）· `packages/android-host/tests/unit/agentsMd.contract.test.ts` | 零星 |
| 1 | 其余 40 余个 docs/adr、docs/specs、docs/research 文件 | 各 1 处 |

**专属于 openwiki 的"结构性挂钩"**（不只是散文提及，删掉 openwiki 就必须改的文件）：

| 文件:行 | 挂钩内容 | 删 openwiki 的后果 |
|---|---|---|
| `.github/workflows/openwiki-update.yml` 全文 | 304 行 workflow | 整文件删除 |
| `AGENTS.md:306-319` | `## OpenWiki` 节 + `<!-- OPENWIKI:START/END -->` 标记对 | 由 `agentsMd.contract.test.ts:167-170` 断言必须存活（`toContain("<!-- OPENWIKI:START -->")`），**删了 CI 会红** |
| `AGENTS.md:19,102-109,128,132,144-152,294,325-332` | 工具触发协议行、8 行页面索引表、4 处结构指针、6 条双锚指针、自检项、强制约束 | 需逐条重写 |
| `packages/android-host/tests/unit/openwikiGateDeadlock.test.ts` | 139 行 | 整文件删除 |
| `packages/android-host/tests/unit/agentsMd.contract.test.ts:12,167-170` | OPENWIKI 标记对存活断言 | 需删断言 |
| `vite.config.ts:186-188` | oxfmt 豁免注释明写"openwiki 为 CI 生成物本就禁手改" | 注释失效 |
| `package.json:58` | `"openwiki:update": "openwiki --update"` | 删一行 |
| `README.md:60` | 落地页文档链接 `[openwiki](openwiki/quickstart.md)` | 删一行 |
| `NOTES.md:23,40` | 命令行 + openwiki 每日重生成节 | 删两处 |
| `docs/adr/ADR-0099`、`docs/research/codegraph-vs-openwiki.md`、`research/agents-md-trim-audit.md` | 决策 / 研究 / 审计 | 归档或改写 |

**维护面小结**：**54 个仓内文件、178 处提及，其中 9 个文件带硬挂钩（1 个 workflow + 2 个测试 + AGENTS.md 标记对 + 6 个配置/入口文件）**。AGENTS.md 单独占 28 处。

### A4. git log 实测的更新频率与 churn

命令：`git log --date=short --format='C|%h|%ad|%s' --numstat -- openwiki/` → Python 聚合。

- **共 125 个 commit 触碰过 `openwiki/`**，其中 **37 个**是自动的 `docs: update OpenWiki`（首个 2026-08-12 `40b654a3` #183，最近 2026-10-08 `e3104f54` #959）。
- **最近 40 个 commit 合计 churn = +17,373 / −4,233 = 21,606 行**，257 个文件触点。
- **全部 37 个自动 commit 合计 = +17,289 / −4,185 = 21,474 行**，246 个文件触点。
- churn 构成拆分：**`.claims/*.json` 38 次触点 / +9,038 −162**（纯增长的机器元数据）；**`*.md` 367 次触点 / +10,827 −4,453**（真正的文档改写）；其他（`.last-update.json`、`index.md`、`INSTRUCTIONS.md`）116 次 / +511 −377。

**最近 40 条逐条（日期 / hash / 文件数 / +/− / 标题）**：

```
2026-10-08 e3104f54 files=  9 +  450 -   87  docs: update OpenWiki (#959)
2026-10-08 791d4b95 files= 18 + 3789 -  259  docs: update OpenWiki (#958)
2026-10-08 f6b08131 files= 34 + 7056 -  567  docs: update OpenWiki (#936)
2026-10-05 15a098f7 files= 20 +  786 -  115  docs: update OpenWiki (#935)
2026-10-05 82c16464 files= 26 + 3782 - 2446  docs: update OpenWiki (#933)
2026-10-04 e8efe946 files=  3 +    5 -    3  docs: update OpenWiki (#930)
2026-10-03 0e0d084f files=  2 +    8 -    5  docs: update OpenWiki (#923)
2026-09-30 7d2335f5 files=  2 +    5 -    3  docs: update OpenWiki (#869)
2026-09-29 52cb7ed2 files=  9 +  151 -  123  docs: update OpenWiki (#817)
2026-09-27 084fff82 files=  2 +    7 -    2  docs: update OpenWiki (#764)
2026-09-26 1da59efe files=  2 +    3 -    2  docs: update OpenWiki (#738)
2026-09-25 5f8649bd files=  4 +   16 -   10  docs: update OpenWiki (#727)
2026-09-23 a4dfafe8 files=  6 +   61 -   10  docs: update OpenWiki (#710)
2026-09-19 c868ccca files=  5 +   17 -    6  docs: update OpenWiki (#626)
2026-09-18 4e676ea1 files=  3 +   12 -    2  docs: update OpenWiki (#605)
2026-09-17 5956619b files=  5 +   23 -    8  docs: update OpenWiki (#574)
2026-09-16 adbc35f6 files=  4 +   20 -    6  docs: update OpenWiki (#551)
2026-09-15 ee2564b1 files=  8 +  166 -   20  docs: update OpenWiki (#546)
2026-09-12 bd0962dd files=  2 +    3 -    3  docs: update OpenWiki (#499)
2026-09-11 820c9f66 files=  2 +    2 -   13  docs: update OpenWiki (#473)
2026-09-10 51751b26 files=  7 +    9 -  152  docs: update OpenWiki (#430)
2026-09-07 c791e4d5 files=  6 +  152 -    2  docs: update OpenWiki (#397)
2026-09-06 dba02416 files=  4 +   60 -    4  docs: update OpenWiki (#384)
2026-09-05 0e8964ef files=  5 +   59 -    4  docs: update OpenWiki (#370)
2026-09-04 778f76d0 files=  4 +   28 -    7  docs: update OpenWiki (#354)
2026-09-03 76a4feaf files=  3 +   17 -    5  docs: update OpenWiki (#348)
2026-09-01 36177ef3 files=  5 +   41 -    3  docs: update OpenWiki (#303)
2026-08-31 9a3335c8 files=  5 +   41 -   12  docs: update OpenWiki (#285)
2026-08-30 ac697eb8 files=  5 +   94 -   20  docs: update OpenWiki (#227)
2026-08-26 dbd94378 files=  9 +  168 -   52  docs: update OpenWiki (#219)
2026-08-22 9f24e632 files=  2 +    5 -    5  docs: update OpenWiki (#209)
2026-08-21 b25f29a3 files=  2 +    4 -    2  docs: update OpenWiki (#186)
2026-08-15 86249c3e files=  4 +   28 -   94  docs: update OpenWiki (#185)
2026-08-14 199c748e files=  7 +   63 -   35  refactor(dead-code): 执行 ADR-0083 死代码清理
2026-08-13 05405163 files=  3 +   41 -    5  docs: update OpenWiki
2026-08-13 da70d467 files=  3 +    6 -    2  docs: update OpenWiki
2026-08-13 9cdbffa2 files=  4 +    5 -    5  docs: update OpenWiki (#184)
2026-08-12 40b654a3 files=  9 +  169 -  121  docs: update OpenWiki (#183)
2026-08-06 e005483e files=  1 +    2 -    2  fix(website): feed/详情截图等待图片加载完成后再截取
2026-08-06 6b2d0d48 files=  3 +   19 -   11  feat(website): 落地页同步 v4.x 功能（双引擎、AI 翻译、安全）
```

**churn 最高的单文件（全历史）**：

```
48 commits +1187 -785  openwiki/integrations/android-native.md
59 commits  +994 -654  openwiki/architecture/overview.md
27 commits  +926 -572  openwiki/domain/feed-and-browsing.md
76 commits  +852 -619  openwiki/quickstart.md      ← 全仓被改次数最多的 openwiki 文件
36 commits  +784 -462  openwiki/testing/overview.md
23 commits  +783 -428  openwiki/architecture/image-pipeline.md
15 commits  +631 -304  openwiki/domain/novel-reader.md
16 commits  +611 -246  openwiki/architecture/api-layer.md
 1 commit  +712 -0    openwiki/.claims/architecture/app-shell-and-navigation.json
 1 commit  +672 -0    openwiki/.claims/domain/notifications-and-delivery-probe.json
 1 commit  +668 -0    openwiki/.claims/domain/downloads-and-export.json
 1 commit  +642 -0    openwiki/domain/downloads-and-export.md   ← 单次新增整页
```

**churn 估算（把任务书的"每天重写 13 页"换成实测）**：

- 频率：2026-08-12 → 2026-10-08 共 58 天，37 次自动提交 ≈ **每 1.57 天一次**（cron 每日 1 次，但落地受门禁/失败影响，落地率约 64%）。
- 单次平均（37 次自动 commit）：**+467 / −113 行，约 6.7 个文件**。
- 分布极不均：**中位数的 commit 只改 2 个文件、+5 −3**；**最近 5 次是重写级**（#936 34 文件 +7056、#958 18 文件 +3789、#933 26 文件 +3782、#935 20 文件 +786、#959 9 文件 +450），合计 **12,863 行 / 6,060 删**，占 58 天全部 churn 的 **59%**。
- **"每天重写 N 页"的准确说法**：不是每天 13 页，而是**约每 1.6 天一次、平均触及 6.7 个文件 / 580 行，但每 4–5 天出现一次 10,000+ 行的全量重写**（2026-10-03 → 10-05 → 10-08 三天内三次重写级提交）。
- 另注：workflow 注释里"13 个页面"是**某一次 run 的快照口径**（L26-27），当前页面集已长到 **17 页**（`.page-manifest.json` 有 17 个页面键）。

---

## 二、仓库内已有的地图层资产

### B5. 根 AGENTS.md vs `openwiki/quickstart.md` 逐节对照

事实：`wc -l AGENTS.md` → **352 行**，20 个 H2 章节。`grep -n '^#{1,3} ' openwiki/quickstart.md` → 1 个 H1 + **7 个 H2** + 3 个 H3。

| # | quickstart.md 章节（行号） | 内容摘要 | AGENTS.md 覆盖情况 | 判定 |
|---|---|---|---|---|
| 1 | `## Ground rules before you touch anything` (L78-94) | 5 行"问题→答案在哪"路由表（AGENTS.md / docs/adr / CONTEXT-MAP.md / change-and-verification-loop / testing）；3 条约定（ADR-first 双锚、门禁冻结线已外移、MD3 是唯一现行设计契约）；末段转述工具路由 | **几乎全覆盖**。`工具触发协议`(L13-38) 三张路由表逐行对应；`约定`(L189-196) 已把 Fluent 标为"历史存档"并指向 glossary；ADR-first 双锚见 `关键设计决策`(L142-152) | **AGENTS.md 已覆盖** |
| 2 | `## Quick Facts` (L96-109) | 11 行版本事实表：client 6.8.0 / Android versionName+versionCode / vue-lynx 0.5.1 + Vue 3.5.40 / vue-router 5.3.1 + Pinia 4 + vue-query 5.103 / rspeedy ^0.13.6 + Vitest 5.0.1 / Tailwind 3.4 / TS 7.0.2 vs app-lynx 5.9.3 / Java 21 + AGP 9.2.1 + Lynx SDK 4.0.1 + minSdk 28 / pnpm 11.9.0 + Node ≥22.22.2 / CI 三门禁 | **AGENTS.md `项目概览(L5-11) 覆盖 7/11 行**（技术栈含 AGP 9.2.1 / Lynx SDK 4.0.1 / Java 21 / vue 3.5 / TS 7.0.2 vs 5.9.3 / Tailwind 3.4）；**AGENTS.md 刻意不维护的**：client 版本号、versionCode、vue-router/Pinia/vue-query 小版本、rspeedy 版本、pnpm 小版本、minSdk（后者指向 `docs/platform-compatibility.md`） | **部分覆盖：AGENTS.md 覆盖 7 行，quickstart 独有约 4 行**（client 6.8.0、versionCode 60800、vue-router 5.3.1 / Pinia 4 / vue-query 5.103、rspeedy ^0.13.6、pnpm 11.9.0 / Node 22.22.2） |
| 3a | `### Architecture & concepts` (L115-124) | 6 行"我要改 X → 看哪页" | AGENTS.md `OpenWiki 查询规范(L100-109) 是 **8 行**同型表（quickstart 只映射 17 页中的 6 页） | **AGENTS.md 已覆盖（且更全）** |
| 3b | `### Domains` (L126-135) | 6 行 | **AGENTS.md 缺 5 个 domain 页**（continue-reading / downloads-and-export / settings-and-backup / notifications-and-delivery-probe）+ app-shell-and-navigation | **quickstart 独有** |
| 3c | `### Integrations, operations, testing & workflow` (L137-144) | 4 行 | AGENTS.md 覆盖 android-native + testing 两行；缺 operations/release-and-deploy 与 workflows/change-and-verification-loop | **quickstart 独有 2 行** |
| 4 | `## Development Quick Start` (L148-186) | 前置条件（Node/pnpm/JDK/SDK）+ 21 行命令块 + 3 条"读起来意外的命令面事实"（`:all` 有界并发、`check:all` 缓存 `test:all` 不缓存、lint/fmt 无 per-package 变体）+ 本地代理 `127.0.0.1:7897` 必需 | **AGENTS.md `命令(L111-124) 是 8 行摘要表 + 门禁边界节(L262-270) 已逐条覆盖"缓存不对称"与"lint/fmt 单一配置源"**；`devEngines` 指向根 `package.json`（L249）。**AGENTS.md 缺的**：21 行完整命令清单、`RUN_CONCURRENCY` 默认 2 / CI 9、代理环境变量与 `10.0.2.2:7897` 模拟器代理、`vitest.fallback.config.ts` 双配置 | **部分重叠：AGENTS.md 覆盖规则，quickstart 独有清单 / 并发 / 代理三块** |
| 5 | `## Key Decisions` (L188-204) | ADR 编号"past ADR-0221" + 9 行 ADR 0201-0221 主题表 + glossary 用法 | AGENTS.md `关键设计决策(L142-152) 只列 **6 条**双锚指针（0037 / 0090 / 0075 / 0164 / 安全存储 / 更新检查），**且刻意不维护 ADR 清单**（L330 明写"ADR 计数…均曾失真"） | **quickstart 独有（ADR 近期索引）**，但属"可由脚本生成"的资产 |
| 6 | `## Key Source Files` (L206-216) | 7 行入口文件路径表 | AGENTS.md `项目概览(L7) 已给 `index.ts → App.vue → src/router.ts`；`Monorepo 结构(L126-128) 显式**把该表委托给本节**（L128 原话：指向 `openwiki/quickstart.md `Key Source Files`） | **AGENTS.md 刻意不维护，委托给 quickstart** |
| 7 | `## How this wiki is maintained` (L218-233) | 3 段 CI 门禁拓扑（cron、`continue-on-error`、poststate 间接层、complete/no-op 两道门禁、`add-paths` 含 workflow 自身）+ 4 条贡献者纪律 | **AGENTS.md 完全没有**：其"OpenWiki 维护规则"节(L321-333)只讲"别手改 / 别本地跑 / CLAUDE.md 勿提交"三条，**不含门禁拓扑**。实测 `poststate` / `add-paths` / `peter-evans` / `create-pull-request` / `openwiki/update` / `continue-on-error` 六个关键词在 `docs/` + AGENTS.md + NOTES.md + `workflows/` 中**命中 0 次** | **quickstart 完全独有（见 C10-1）** |

**B5 判定：quickstart 这一页是否几乎完全冗余？**

**不。逐节判定结果是"冗余约 55%、独有约 45%"，且独有价值集中在四处：**

- **冗余部分**（可被 AGENTS.md 完全替代）：Ground rules 全部、Architecture & concepts 全部、Quick Facts 的 7/11 行、Development Quick Start 的规则部分。在这个直觉上**是**成立的。
- **不可替代部分**：
  1. **`How this wiki is maintained（L218-233）** —— 全仓唯一的 CI 门禁拓扑散文（关键词命中 0，C10-1）；
  2. **`Documentation Map 的 7 个页面入口**（continue-reading / downloads-and-export / settings-and-backup / notifications / app-shell / operations / workflows）—— AGENTS.md 的 8 行索引表**没有这 7 页**，读者按 AGENTS.md 走不到它们；
  3. **`Quick Facts 的约 4 行精确版本事实**（client 6.8.0 / versionCode 60800 / vue-router 5.3.1·Pinia 4·vue-query 5.103 / rspeedy ^0.13.6 / pnpm 11.9.0·Node 22.22.2）—— AGENTS.md 刻意不写，且这些值**每次发版就变**（versionCode 由 `sync-android-version.mjs` 回写），由 CI 每日重生成比人工维护划算；
  4. **`Key Source Files + `Key Decisions 的近期 ADR 索引** —— AGENTS.md 明确拒收（防陈腐），但读者确实需要；
  5. **`Development Quick Start 的命令清单 + 本地代理必需性** —— AGENTS.md 只给 8 行摘要，"没有本地代理 Pixiv/GitHub 全黑洞"这条只有 quickstart 有。

**结论**：quickstart **不是** AGENTS.md 的冗余副本，它承担了 AGENTS.md 明确拒收的三类内容（结构清单 / 逐文件入口 / 随发布漂移的版本号）+ 全仓唯一的 CI 门禁拓扑说明。**但这些内容几乎全部是可确定性生成的**（路由表可从 `router.ts` 抽、版本号可从 `package.json` 抽、ADR 索引可从 `docs/adr/` 抽、门禁拓扑可从 workflow yaml 抽）—— 唯一真正"不可生成"的是门禁拓扑里的**失效机理叙事**（为什么必须间接、为什么曾经死锁）。

### B6. `docs/` 全貌与目录活性

命令：`git ls-files 'docs/*.md' | wc -l` → **530**。按一级子目录统计（tracked md / 全部 tracked 文件）：

| 目录 | md 篇数 | 全部文件 | 总 commit | 最后提交 | 近 60 天 | 近 30 天 | 活性 |
|---|---|---|---|---|---|---|---|
| `docs/adr/` | 271 | 271 | 330 | 2026-10-07 `fb047d2b` | 254 | 170 | **活的**（最活跃） |
| `docs/specs/` | 112 | 112 | 220 | 2026-10-07 `24fc5fc4` | 213 | 167 | **活的** |
| `docs/research/` | 94 | 455 | 88 | 2026-10-06 `f3e6366b` | 74 | 32 | **活的**（361 个截图/日志附件） |
| `docs/verification/` | 7 | 38 | 16 | 2026-09-21 `3063809d` | 16 | 16 | 半活（近 14 天 0） |
| `docs/agents/` | 5 | 5 | 7 | 2026-09-29 `98193208` | 5 | 4 | 半活 |
| `docs/wayfinder/` | 4 | 4 | 1 | 2026-09-20 `96195b98` | 1 | 1 | 半活（仅 1 次提交） |
| `docs/design-variants/` | 4 | 4 | 1 | 2026-08-04 `bd646c7d` | 0 | 0 | **死的** |
| `docs/prototypes/` | 4 | 4 | 2 | 2026-09-17 `267076ab` | 1 | 1 | 半活 |
| `docs/testing/` | 1 | 1 | 9 | 2026-10-07 `1a0fec10` | 9 | 9 | **活的**（1 篇但高频改） |
| `docs/style-guides/` | 1 | 1 | 2 | 2026-09-25 `9c69a500` | 2 | 2 | 半活 |
| `docs/spec/`（单数） | 1 | 1 | 1 | 2026-07-30 `cdc71edb` | 0 | 0 | **死的**（疑似 `specs/` 的历史重名） |
| `docs/` 根级散篇 | 24 | 24 | — | `release-checklist.md` 2026-10-05 · `platform-compatibility.md` 2026-09-29 · `release-signing.md` 2026-06-27 | — | — | 混合 |

统计命令：`for d in adr specs research …; do git log --oneline --since='2026-08-09' -- docs/$d/ | wc -l; done`（HEAD 日期 = 2026-10-08，故 60 天 = `--since=2026-08-09`、30 天 = `--since=2026-09-08`、14 天 = `--since=2026-09-24`）。

**对 openwiki 的直接含义**：

- `docs/adr/`(271) + `docs/specs/`(112) + `docs/research/`(94) = **477 篇**人工维护的决策/规格/研究文档，是 openwiki 17 页的 **28 倍**体量；近 60 天提交合计 **254+213+74 = 541 次**，比 openwiki 的 37 次自动提交**活跃 14.6 倍**。
- **docs/ 缺的不是内容，是导航**：530 篇散在 11 个子目录 + 24 篇根级散篇，**没有 README、没有 index、没有 landing page**（`git ls-files docs/ | grep -iE 'readme|index|toc|nav'` 命中 0 个真实索引文件，命中的全是文件名含 "nav" 的无关文档）。
- **两个死目录**：`docs/design-variants/`（4 篇，最后提交 2026-08-04）、`docs/spec/`（单数，1 篇，最后 2026-07-30）。

### B7. `CONTEXT-MAP.md` 声称的 `packages/*/CONTEXT.md` 实际存在情况

`cat -n CONTEXT-MAP.md`（15 行）。表格 3 行：

| Context | 表中路径 | **实际存在？** | 表中标注 | 实测 |
|---|---|---|---|---|
| `app-lynx` | `packages/app-lynx/CONTEXT.md` | **存在** | （无"尚未创建"标注） | **737 行 / 103,219 字节**，tracked，**73 次 commit**，最后提交 **2026-10-07 `587d84d5`**（"docs: 同步 vllm 死状态清除的文档面（八态→七态）"），mtime `Oct 7 11:57` |
| `ugoira` | `packages/ugoira/CONTEXT.md` | **不存在** | "尚未创建，按需补充" | 目录下无 `CONTEXT.md` |
| `website` | `packages/website/CONTEXT.md` | **不存在** | "尚未创建，按需补充" | 目录下无 `CONTEXT.md` |

证据命令：`find . -name 'CONTEXT.md' -not -path './node_modules/*'` → 仅 `./packages/app-lynx/CONTEXT.md`；`git ls-files '*CONTEXT*.md'` → `CONTEXT-MAP.md` + `packages/app-lynx/CONTEXT.md`。

**表格自身已失真（3 个问题）**：

1. **漏了 7 个包**：工作区有 10 个 `packages/*/`（android-host, app-lynx, app-nuxt*, net-diagnostics, novel-export, ranking-core, search-core, ugoira, update-check, website；其中 `app-nuxt` 是未跟踪的空壳目录 + node_modules，不算 workspace 包）。表中只列 3 个，漏 android-host、update-check、novel-export、search-core、ranking-core、net-diagnostics。
2. **CONTEXT-MAP.md 自身已 10 天未更新**（最后提交 2026-09-29 `8f86f7d4`），而它描述的 app-lynx 上下文 2026-10-07 还在改。
3. **"静默跳过"规则让漏项不可见**（L14 原文："`CONTEXT.md` 不存在时**静默继续**，不要为缺失标记，也不要立即创建"）—— 所以"漏了 7 个包"这件事**永远不会有人从这张表里发现**。

**`app-lynx/CONTEXT.md` 的实际体量值得单列**：**737 行 / 103 KB / 24 个三级小节**（受限内容、覆盖层与命中测试、作品标识、分页、追更、小说导航、列表操作、作品交互、图片三态、多图详情、客户端、外观/主题色、翻译端点、翻译栈、状态管理、构建约定、放射导航、视口几何、性能、正文渲染与滚动信号、路由层、排行榜、质量防线与平台事实、系统栏、正文选中与操作菜单、搜索、图床缓存契约），**73 次 commit、最后 2026-10-07**。**它是本仓体量最大、更新最勤、且由人工直接维护的"地图层"资产** —— 103 KB 是 openwiki 全部 17 页散文（672 KB）的 1/6.5，但只覆盖一个包；结构上是"术语 + 领域规则"而非"页面导航"。

### B8. ADR 索引 / 交叉引用 / 结构统一性

**(1) 索引文件：不存在。**

- `git ls-files docs/adr/ | grep -v '/ADR-[0-9]'` → 68 个非 `ADR-NNNN` 文件：47 个 `glossary-*.md` + 21 个历史编号 `0001-0021-*.md`（无 ADR- 前缀）+ 1 个 `plan-virtual-scroll-migration.md` + `spikes/bottom-allowance-list-append.md`。
- `git ls-files docs/ | grep -iE 'readme|index|toc|nav'` → **0 个真实索引/导航文件**（命中的全是文件名含 "nav" 的业务文档）。
- 结论：**271 个 ADR/glossary 文件，0 行索引**。读者唯一入口是 AGENTS.md 里散落的 6 条指针（L146-152）和 openwiki quickstart `Key Decisions 的 9 行表（L192-202）。

**(2) 语料构成**：`ADR-NNNN` 201 篇 · 遗留 `0001-0021` 21 篇 · `glossary-*.md` 47 篇 · 合计 271。最大编号 **ADR-0221**（与 quickstart "numbered past ADR-0221" 一致）。

**(3) 交叉引用：密但无索引。**

- 被引最多的 ADR：`ADR-0175`(69 次) · `ADR-0211`(61) · `ADR-0169`(33) · `ADR-0140`(33) · `ADR-0219`(32) · `ADR-0209`(32) · `ADR-0170`(30) · `ADR-0214`(27)。
- **201 篇 ADR 中有 160 篇（79.6%）至少引用了另一篇 ADR**（脚本：逐文件 grep `ADR-[0-9]{4}` 并排除自身编号）。
- 也就是说：**语料内部已经长出了一张手工维护的引用图，但它没有任何可查询的呈现形式**（无 index、无反向引用表、无"被引次数"视图）。这正是"生成式地图层"能低成本补上的缺口。

**(4) 结构统一性：抽样 5 篇，结论 = "骨架统一、无模板强制"。**

| 样本 | 行数 | 二级标题 |
|---|---|---|
| `ADR-0205-md3-baseline-and-scope.md` | 149 | 状态 / 背景 / 决策（决策 1-7）/ 后果 / **复核判据** / 参考 |
| `ADR-0203-webview-client-source-removal.md` | 232 | 状态 / 背景 / 决策（决策 1-8）/ 存量格式契约（不可动）/ 后果 / **复核判据** / 参考 |
| `ADR-0219-lynx-continue-reading.md` | 296 | 1. 背景 / 2. 决策（2.1-2.6）/ 3. 后果（正面·负面·与外部做法差异）/ 4. 落地时必须同轮改写的既有描述 / 5. 证据缺口 |
| `ADR-0221-row-action-leaves-trailing-band.md` | 151 | 1. 背景（1.1/1.2）/ 2. 决策（2.1-2.3）/ 3. 代价 / 4. 覆盖范围 / 5. 取证要求 / 6. 不宣称的事项 / 7. 后果 |
| `ADR-0185-vite-plus-1rc-toolchain.md` | 69 | 背景 / 决策 / 执行结果终态 / 回退 / 遗留与再评估触发器 |

共同骨架：**背景 → 编号决策 → 后果**（201/201 篇都有）。分化点：① 编号风格两派（`## 状态` 派 vs `## 1. 背景` 派）；② "复核判据 / 取证要求 / 证据缺口 / 不宣称的事项"这类**反过度归因**章节只在 ADR-0203/0205/0219/0221 这类吃过教训的新 ADR 里出现；③ 长度跨度 69–296 行。
**没有模板文件**：`git ls-files | grep -i template` 命中的全是组件 `*.template.test.ts` 与一个 Java 类，**无 `ADR 模板.md`、无 `adr-new.sh` 脚手架**。

### B9. 代码事实层的既有工具：CodeGraph

**`codegraph status --json`**（`~/.vite-plus/bin/codegraph`，version 1.5.0）：

```json
{"initialized":true,"version":"1.5.0","lastIndexed":"2026-10-03T04:43:06.580Z",
 "fileCount":802,"nodeCount":12909,"edgeCount":41016,"dbSizeBytes":64479232,
 "backend":"node-sqlite","journalMode":"wal",
 "nodesByKind":{"class":171,"component":80,"constant":2680,"enum":4,"enum_member":24,
   "field":273,"file":794,"function":2549,"import":4011,"interface":414,"method":1267,
   "namespace":94,"property":41,"route":43,"type_alias":167,"variable":297},
 "languages":["astro","java","javascript","properties","python","typescript","vue","xml","yaml"],
 "pendingChanges":{"added":0,"modified":0,"removed":0},"worktreeMismatch":null,
 "index":{"builtWithVersion":"1.5.0","builtWithExtractionVersion":24,
   "currentExtractionVersion":24,"reindexRecommended":false,"state":"complete","pendingRefs":0}}
```

**计数**：**802 文件 / 12,909 节点 / 41,016 边 / 64.5 MB SQLite(WAL)**；索引时间 2026-10-03，`reindexRecommended: false`，`state: complete`，工作区无待处理变更。
（对照 S10 `docs/research/codegraph-vs-openwiki.md:48` 记的"488 文件 / 5,675 节点 / 15,216 边" —— **两个月内规模翻 1.6–2.7 倍**。）

**各子命令能力**（逐个 `--help` 实测）：

| 命令 | 一句话能力 | 参数 | 实际输出示例 |
|---|---|---|---|
| `explore <query...>` | 一次返回符号源码 + 调用路径 + blast radius | `-p <path>`、`--max-files <n>` | `codegraph explore 'virtual scroll layout' --max-files 2` → "Found 34 symbols across 2 files" + **Blast radius** 段（每符号带调用点与 "⚠️ no covering tests found" 警告）+ calls/references 关系图 |
| `query <search>` | 按名定位符号（只要位置不要源码） | `-l <n>`(默认 10)、`-k <kind>`、`-j` | `codegraph query PixivApiCore -l 5` → 4 条：method/class/file 精确到 `PixivApiCore.java:51/39/1` |
| `impact <symbol>` | 改一个符号会影响什么 | `-d <depth>`(默认 2)、`-j` | 与 explore 内联 blast radius 等价，AGENTS.md 称此为独立报告路径 |
| `affected [files...]` | 变更文件 → 受影响的测试 | `--stdin`、`-d <depth>`(默认 5)、`-f <glob>`、`-q`、`-j` | AGENTS.md 规定 CI 形态：`git diff --name-only | codegraph affected --stdin` |
| `status [path]` | 索引健康 | `-j` | 上表 JSON |

**AGENTS.md 未记录但实际存在的子命令**（`codegraph --help` 全表 vs `AGENTS.md:39-73` 速查表）：`init` / `uninit` / `index` / `sync` / `node`（"One symbol's source + caller/callee trail, or read a file with line numbers + dependents"）/ `files`（"Show project file structure from the index"）/ `daemon` / `unlock` / `callers` / `callees` / `install` / `uninstall` / `telemetry` / `upgrade`。
其中与 openwiki 能力最接近的是两个：**`node`（读文件 + 带行号 + dependents）** 与 **`files`（打印项目文件结构）** —— 后者正是 AGENTS.md `Monorepo 结构(L126-128) 明令"本文档不维护目录树，结构信息走 openwiki + CodeGraph"里承诺的"走 CodeGraph"的那一半。

**B9 小结**：代码事实层已有**一个 12,909 节点 / 41,016 边、覆盖 802 文件（含 typescript / vue / java / astro / yaml / xml / python）**的即时索引，带完整的调用链、blast radius、影响分析与"改哪些文件要跑哪些测试"能力。**它与 openwiki 不在同一层**：openwiki 管"为什么 / 整体流程"，CodeGraph 管"在哪 / 怎么调用"。但 openwiki 声称的"结构信息"职责，CodeGraph 至少能接走一半（`files` + `node`）。

---

## 三、OpenWiki 的独有贡献与失真点

### C10. OpenWiki 的独有贡献（docs/ 与 AGENTS.md 中都找不到的段落）

判定方法：对每条候选段落取 2–3 个**低碰撞特征串**，在 `docs/` + `AGENTS.md` + `packages/app-lynx/CONTEXT.md` + `NOTES.md` + `workflows/` 全量 grep，命中 0 才算"独有"。以下 5 条全部通过该检验。

---

**C10-1｜全仓唯一的 OpenWiki CI 门禁拓扑说明：为什么必须"间接"，以及它曾经怎样永久死锁**

- 位置：`openwiki/quickstart.md:218-233`（`## How this wiki is maintained`，全文 16 行）
- 独有性证据：特征串 `poststate` / `add-paths` / `peter-evans` / `create-pull-request` / `openwiki/update` / `continue-on-error` / `56 min` 在 `docs/` + `AGENTS.md` + `NOTES.md` + `workflows/` 中**全部命中 0**。
- 独有内容（不是转述 workflow，是解释 workflow）：
  - L223："**`Snapshot post-run OpenWiki state` (id `poststate`, L131–L156) reads `openwiki/.last-update.json` *before* `Create OpenWiki update pull request` (L221–L244)** … The ordering is the whole point: `peter-evans/create-pull-request` restores the workspace to `main`, so a gate reading the file afterwards sees the *previous* run's values — the shape of the deadlock that once kept the gate red forever."
  - L226："That step order and the step-output indirection are pinned by `openwikiGateDeadlock.test.ts` … so a workflow edit that re-breaks the gate fails CI."
  - L233："The PR's `add-paths` covers `openwiki`, `AGENTS.md`, **and the workflow file itself** (L169–L173), so an OpenWiki run can rewrite the very gate that governs it — which is why the invariant is enforced by a test rather than by comment discipline."
- **为什么不可替代**（不能从代码推导）：这三段回答的是"**为什么这个 CI 长成这样**"，而不是"CI 做了什么"。yaml 里只有 `id: poststate` 和 step 顺序，从 yml 无法推出"若把快照挪到建 PR 之后会导致**永久锁死而非一次性失败**"——那需要知道 `create-pull-request` 会还原工作区（只能实测）、以及"人工把 interrupted 合回 main"这个**人的动作**在闭环里的角色。`.github/workflows/openwiki-update.yml` 的注释 L131-138 确实讲了同一件事，但那是 **CI 配置文件里的注释**，读者不会去 workflow 里找架构解释；且该注释只有 8 行，只覆盖 poststate 一个门禁，不覆盖 no-op 门禁的"已知误报面"取舍（L275-279）。

---

**C10-2｜领域概念定义："样本天花板就是用户的打开频率" —— 一条让功能降级为实验的统计学论证**

- 位置：`openwiki/domain/notifications-and-delivery-probe.md:160-164`
- 原文（L162-163）：

  > measures only `clicked ÷ sent` and compares it against how often the user opens the app by themselves (a ratio is self-calibrating; absolute thresholds are guesses);
  > sets **no statistical threshold**: with roughly five app opens a day, of which most are filtered by the quiet period, a single user yields on the order of 14 sent samples a week — this cannot separate 20% from 40%, and no experiment duration fixes it, because a single user's sample ceiling *is* their open frequency;

- 独有性证据：特征串 `sample ceiling` / `self-calibrating` 在 `docs/` + `AGENTS.md` + `CONTEXT.md` 中**命中 0**（`docs/specs/notification-delivery-probe.md` 与 `docs/adr/ADR-0220` 存在，但不含这两句论证）。
- **为什么不可替代**：这是**从"使用频率"这个纯事实推出"该功能只能出定性结论、不能出定量结论"的完整推理链**。代码里能看到 `QUIET_PERIOD_MS = 90_000`、能看到点击计数写入，但推不出"14 个样本/周无法区分 20% 与 40%"——这需要把"每天约 5 次打开"这个经验值代入统计分辨力再回推产品验收标准。删掉这段，读者会重新问"为什么不设一个 20% 的阈值"。

---

**C10-3｜跨语言事件时序缺陷："纯推送模型必然丢第一帧"**

- 位置：`openwiki/concepts/viewport-geometry-and-motion.md:149`
- 原文：

  > Insets arrive through a **subscribe-then-pull** channel: `initSafeArea()` first adds a `pictelioInsets` listener via `GlobalEventEmitter`, then calls `NativeModules.PictelioApp.getSafeAreaInsets` for the current value. Pull is the initial-value source because the first insets dispatch happens during view attach, before JS subscription — a pure push model always loses the first frame. A missing emitter or native module is a visible `console.warn`, never a silent zero (web-core preview is the expected zero case).

- 独有性证据：特征串 `first frame` 与 `view attach` 在 `docs/` + `AGENTS.md` + `CONTEXT.md` 中**命中 0**（`subscribe-then-pull` 只在无关的 `docs/adr/ADR-0180-lynx-dark-mode.md` 出现）。
- **为什么不可替代**：它把"安卓 `onResume`/`onLayout` 早于 JS 挂载"这个**跨语言运行时顺序事实**与"因此必须补一次 pull"这个**设计动作**连起来。`packages/app-lynx/src/utils/safeArea.ts` 的代码能证明"确实调了两次"，但**代码里没有 `view attach` 这个词，也没有"否则丢第一帧"这个后果**——后果只在真机上表现为"首帧内容整体上移 safeTop 像素"，且该症状早在引入 `safeArea.ts` 之前就存在（同一文件 L23 记录"safeBottom spacer 同理各多 144px 死白"）。同类断言在 C10-4 提到的 `onResume` 段落再次出现，说明这是一个**反复踩过的、只能靠文字传承的时序知识**。

---

**C10-4｜被删掉的第三种模式：一个"编译过、测试绿、门禁全绿"的静默破版脚枪**

- 位置：`openwiki/concepts/viewport-geometry-and-motion.md:174` 与 `:198`（另 L176 描述跨语言契约门禁"声明与实现必须同时存在"）
- 原文（L174）：

  > A third mode `'root'` was **deleted**, not deprecated. Once the root compensation was removed it degraded to byte-for-byte "no yielding" — identical to `bleed` while looking nothing like it, so anyone writing `'root'` (natural, since it used to be the default) would push content under the status bar with compilation, unit tests and gates all green. `resolveTopInsetOwnership(mode, safeTop)` therefore normalises unknown modes to `'self'` **and warns once**; the failure direction is "does not yield" and must never silently become "bleed everything".

- 原文（L198）：

  > **There is no mode flag for the occlusion allowance.** `bottomInsetMode: 'self' | 'bleed'`-style options are explicitly rejected: the top has modes because bleeding is a *product choice*, whereas if a page has a FAB the last item must be able to scroll above it — inventing a "don't yield" mode would recreate exactly the silent-layout-breakage footgun that got `'root'` deleted.

- 独有性证据：`docs/adr/ADR-0214-top-inset-per-page-ownership.md` / `ADR-0216` / `ADR-0217` / `glossary-top-inset-and-verification.md` / `glossary-bottom-occlusion-allowance.md` 确实覆盖 `self`/`bleed` 与 `border-box`；但特征串 `declaration and implementation exist together` 在 `docs/` + AGENTS.md + CONTEXT.md 中**命中 0**。
- **为什么不可替代**：L174-176 讲的是"**为什么删**"和"**为什么会静默**"。`docs/adr/ADR-0216` 记录了删除动作与理由，但没有把"曾被删的模式与现行模式**逐字节同义、却长得完全不像**"这一层写出来——而这一层正是"为什么 normalize 未知模式要选 `self` 而不是报错"的理由。L198 的"为什么底部遮挡**故意不对称**（顶部有模式、底部没有）"是**跨 ADR 的对比推理**（拿顶部 ADR-0214 的设计来否决一个尚未写出来的底部 ADR），任何单篇 ADR 都装不下。

---

**C10-5｜断言方式的物理边界："Lynx 无障碍树不暴露节点，E2E 只能靠像素"**

- 位置：`openwiki/testing/overview.md:193`
- 原文：

  > **Assertion reality:** Lynx 4.0.1's `LynxView` accessibility tree does **not** expose view/text nodes, and `uiautomator dump` is SIGKILLed on the reference AVD, so interaction is driven by adb taps/swipes and content is asserted via **screenshot + pixel analysis** (region-scoped frame diffs), not text reads.

- 相邻的 `openwiki/testing/overview.md:187` 还纠正了别处的计数漂移：

  > (Prose counts drift: AGENTS.md's 测试 section still says 10 and the directory README says 11 — count the directory.) —— 实测 `ls packages/android-host/tests/android-e2e/specs/ | grep -c spec` → **12**，openwiki 自身说的 12 **正确**。

- 独有性证据：特征串 `assertion reality` 在 `docs/` + `AGENTS.md` + `workflows/` 中**命中 0**（`uiautomator` 一词在 `docs/` 有 15 处命中，但均为"uiautomator2 / Appium 选型"，**没有一处记录"Lynx 树不暴露节点 + dump 被 SIGKILL"这条物理约束**）。
- **为什么不可替代**：这是一条**平台事实层的否定性知识**——它解释了为什么 12 个 E2E spec 里没有一个用文本断言，也是紧跟其后的"覆盖面上限"（触达尺寸 / 圆角 / 对比度 / 状态层 alpha 无法结构化断言）的**唯一根据**。从代码里推不出来：没有任何一行代码说明"查不到节点"，只有跑过一次真机才知道。这条知识一旦丢失，整仓 E2E 的选型会被无声地重新发明一遍（选一个拿不到节点树的断言方式，跑 300 s 超时，然后失败）。

---

**C10 综合判断**：openwiki 的独有贡献可归为四类，**都不是"目录树"或"索引"**：

1. **跨语言/跨进程时序知识**（C10-3、notifications 页 L174-175 的 `onResume` 早于 JS 挂载）：代码只能证明"做了补偿"，不能证明"不补偿会丢第一帧"。
2. **决策的失效方向与静默失败形态**（C10-4、app-shell 页 L214 的 back guard 抛异常必须 fail-open、`:246` 的"严格镜像等于把同一动画倒放"）：代码能证明"现在的行为"，不能证明"为什么不是另一种"。
3. **能力边界的否定性知识**（C10-2 的样本上限、C10-5 的无障碍树）：这些是"**为什么这条路走不通**"，天然不存在于任何正向文档里。
4. **纯流程知识**（C10-1 的门禁拓扑）。

这四类都无法从 `docs/` 或代码反推，但其中第 1、3 类**体量极小**（各 1–2 段），完全可以用"往现有 ADR / glossary 里补 2 段文字 + 一个生成式索引"的方式替代。

### C11. OpenWiki 页面自身的失真点（逐条已回源码/配置核验）

> 前提说明：AGENTS.md 指向 openwiki 的两处**断锚**（L132 `Component Architecture`、L150 `Engine Availability Fallback`）**不计入本节** —— 那是 AGENTS.md 侧的问题。核验：`grep -n 'Component Architecture' openwiki/architecture/overview.md` → 0 命中；`grep -n 'Engine Availability' openwiki/integrations/android-native.md` → 0 命中（该页实际标题是 L142 `## Engine availability & failure funnel (ADR-0153 / ADR-0164 residue)`）。但它们是**同一维护面的证据**：AGENTS.md 每次改标题就要人工同步 openwiki 锚点。

**失真 1｜两处 openwiki 自承认的断链（生成器自带的 broken-link 标记未被清除）**

```
$ grep -rn 'openwiki: broken internal link' openwiki/
openwiki/architecture/app-shell-and-navigation.md:242:
  <!-- openwiki: broken internal link [../../docs/adr/ADR-0211-lynx-motion-contract.md]
       file "…ADR-0211-lynx-motion-contract.md" does not exist. Fix the href or restore
       the target, then delete this comment. -->
openwiki/domain/novel-reader.md:105:
  <!-- openwiki: broken internal link [./feed-and-browsing.md#unified-pagination-createmixfeed]
       heading anchor "unified-pagination-createmixfeed" does not exist in
       "./feed-and-browsing.md". … -->
$ ls docs/adr/ | grep ADR-0211   → ADR-0211-ui-continuity-motion-contract.md
$ grep -n '^#{2,3} ' openwiki/domain/feed-and-browsing.md
  140:## The shared pagination seam: `createMixFeed`
```

- 失真类型：**文件名与标题都对不上**。workflow 注释里特别记了上游 `#901 根绝对内链检测`（L85），即"修了根绝对内链"——但**这两处仍断着，且断链标记以 HTML 注释形式留在正式发布页正文里**。读者打开 `app-shell-and-navigation.md` 会在"Route Transitions"章节开头直接看到一条"这个文件不存在，请修 href"的施工提示。
- 严重性：**中**。不影响结论正确性（openwiki 正确指向了 ADR-0211，只是文件名错），但作为"发布给 agent 读的地图"它在正文里留了两处未清理的脚手架。

**失真 2｜`viewport-geometry-and-motion.md:171-172`：路由条目数与模式分布双错**

- openwiki 原文（L171-172 表格）：

  > | `self` | The page renders its own zero-content spacer of height `safeTop` | 28 of the 29 route entries |
  > | `bleed` | Neither side yields … | Only the `discover` route, and only when the build macro says so |

- 实测（`packages/app-lynx/src/router.ts`）：
  - `grep -cE "^\s*\{ path: '" packages/app-lynx/src/router.ts` → **28 条路由**（不是 29）。
  - 路由表内的 `meta.topInset: 'self'` 只有 **27 条**（L100 / 112 / 115 / 118 / 121 / 122 / 123 / 127 / 128 / 129 / 130 / 131 / 132 / 133 / 134 / 137 / 140 / 142 / 145 / 147 / 150 / 151 / 152 / 153 / 154 / 156 / 159），第 28 条是 L107 `discover` 的构建宏 `__HOME_BLEED_HEADER__ ? 'bleed' : 'self'`。
  - （全文件 `grep -c "topInset: 'self'"` 得 29，是因为多出 L222 的 `navigateTo` 兜底默认与 L236 的 `topInset: to.meta.topInset` 透传两处非路由行。）
- 修正值：**27 / 28**（而非 28 / 29）。两个数字**各错 1**。
- 失真类型：**纯计数陈旧**。这类计数正是 `research/agents-md-trim-audit.md:112`（R2）当初点名要消除的 openwiki 病 —— "E2（12-cell vs 源码 13 路径 vs AGENTS.md 15 格）、E3 证明 openwiki 会滞后/出错"。**同一类失真在 2026-10 仍然存在，只是换了文件。**

**失真 3｜`viewport-geometry-and-motion.md:176`：PageTopBar 页数少报 4 页，且"两种消费形态"不是二分**

- openwiki 原文（L176）：

  > Two consumption shapes exist: sixteen pages call `useTopInsetSpacer()` and render their own zero-content spacer, while **thirteen pages** render the shared `PageTopBar`, which renders the spacer *before* the visible bar row inside a single-column root

- 实测：

  - `grep -rl 'useTopInsetSpacer' packages/app-lynx/src/pages/` → **16**（✅ 正确）。
  - `grep -rl '<PageTopBar' packages/app-lynx/src/pages/ | grep '\.vue$'` → **17**（❌ openwiki 说 13）。
  - 集合运算：**5 个页面同时做两件事**，`PageTopBar` 独占 12 个，仅 spacer 11 个。**"two consumption shapes" 不是二分法** —— 它把重叠当成了互斥。
- 失真类型：**计数陈旧 + 结构性误述**。这条特别值得注意：L176 后半句的用途是论证"跨语言契约门禁能同时抓到'声明了没实现'和'实现了没声明'"，而把 5 个双实现页面描述成分立的两类，会让读者以为门禁只需处理 16+13=29 个页面，实际要面对 28 个路由 × 两种可能组合。

**失真 4｜ADR-0099 决策 5 的兜底机制确实生效（正面证据，不是缺陷）**

- `docs/adr/ADR-0099-local-openwiki-disable.md:27` 原文："`openwiki/quickstart.md` 是生成文件，其**过时的 pre-commit/openwiki:update 描述**由 CI 定时重生成修复，不手改。"
- 现状（`openwiki/quickstart.md:218-233`，2026-10-08 由 `openwiki/0.7.1` 生成）：该章**已重写为正确的 CI 门禁拓扑**，L231 甚至正确复述了"不要本地跑 `pnpm openwiki:update`（ADR-0099）"。
- 曾经存在的具体缺陷（`docs/research/codegraph-vs-openwiki.md:16` 与 `research/agents-md-trim-audit.md:16` 都记录过）："**`openwiki/quickstart` 仍写 'CodeGraph MCP server is registered in .mcp.json'**"。核验：`grep -n 'mcp.json' openwiki/quickstart.md` → 0 命中（该条已随 0.7.1 修复）。
- 结论：**这一条现在不是缺陷，而是"ADR-0099 决策 5 的兜底机制确实生效了"的一个正面证据**。记在此处是为了让读者知道：`openwiki/` 里凡是"看起来过时"的内容，都可能是"下一次 CI 跑完就会自己好"的东西，不能据此判断页面质量。

**失真 5｜既有同类笔记 `docs/research/codegraph-vs-openwiki.md` 的 4 组事实全部失真（反面对照）**

`docs/research/codegraph-vs-openwiki.md`（2026-08-11）自述为"CodeGraph vs OpenWiki 选型研究报告"，其 `二` 实测表：

| 该笔记的断言（行号） | 2026-10-08 实测 | 偏离 |
|---|---|---|
| L35 "openwiki/ 目录，**约 240 KB**" | `du -sh openwiki` → **1.9M**（其中 `.claims/` 1.2M） | 8× |
| L35 "AI（**deepseek-v4-pro**）" | `openwiki/.last-update.json` → `"model": "deepseek-flash"`；workflow L125 亦为 `deepseek-flash` | 模型已换，笔记未更新 |
| L39 / L48 "仅 **8 个页面** + quickstart" | `.page-manifest.json` → **17 个页面键** | 2.1× |
| L48 "CodeGraph **488 文件 / 5,675 节点 / 15,216 边**" | `codegraph status --json` → **802 / 12,909 / 41,016** | 1.6× / 2.3× / 2.7× |
| L81 "OpenWiki 最近一次更新 **2026-08-06**，git head `6b2d0d4`" | `.last-update.json` → `2026-10-08T02:43:51Z`，`gitHead a82ba49` | 2 个月 |
| L89-91 引 AGENTS.md "分层互补"、openwiki 优先为硬约束 | 与现行 AGENTS.md 一致（**此项未失真**） | — |

**这条对"OpenWiki 是否值得保留"这个命题的意义**：**本仓已经有过一次"写一份地图层选型笔记"的尝试，那份笔记在两个月内 4 组核心数字全错。** openwiki 每日重生成能保证**被生成物**（`openwiki/`）新鲜，但**保证不了任何围绕它手写的东西**（散文式结论、`docs/research/` 里的引用、AGENTS.md 里的锚点、`NOTES.md` 里的 cron/timeout 抄写）。这是"用生成式机制替代生成式文档"时最容易忽略的成本项。

---

## 四、外部方案：开源 / 本地可跑（primary sources）

> 评估基线（本节全部为本代理实测，只读统计）：仓库 **PUBLIC**；TypeScript **599 文件 / 116,590 行**、Vue SFC **82 文件 / 19,345 行**、
> 手写 Java **101 文件 / 23,625 行**（`packages/android-host/android/app/src`，排除 `.gradle/wrapper/dists` 里 gradle-9.6.1-all 的 19,457 个发行版源码文件）。
> 判定标准固定为一条：**相对 CodeGraph 的增量价值**——CodeGraph 已能给的（符号定义 / 调用链 / blast radius / affected 测试）一律记零增量。

### D1 候选筛选结果总表

| 候选 | 性质 | 许可 | 活跃度（一手） | 相对 CodeGraph 增量 | 判定 |
|---|---|---|---|---|---|
| [repomix](https://github.com/yamadashy/repomix) | code-as-context | MIT | v1.18.1 / 2026-10-03 推送 / 28,741★ | 零（唯一独有：把全仓压成一块文本投外部 LLM） | ❌ 不值得 |
| [gitingest](https://github.com/coderamp-labs/gitingest) | code-as-context | MIT | 最后 commit **2025-08-16**（停滞 14 月）/ 15,863★ | 零（且已被 repomix 覆盖；原 `ishino0530/gitingest` 已 404 迁仓） | ❌ 不值得 |
| [aider repo map](https://aider.chat/docs/repomap.html) | code-as-context | Apache-2.0 | release 停在 v0.86.0 / 2025-08-09 | 零且**更弱**（官方自述：文件为节点、依赖为边的 PageRank 图排序） | ❌ 不值得 |
| [llms.txt](https://llmstxt.org/) 规范 v2 | 正交（管网站如何暴露已有人写的内容） | Apache-2.0 | 0.0.7 / 2026-09-24 | 零 | ⚪ 与本决策分开立项 |
| [DeepWiki](https://github.com/CognitionAI/deepwiki)（Cognition） | intent-as-context，**闭源 SaaS** | 无开源许可 | 官方仓库最后 commit 2025-05-22；产品 docs 持续更新 | 有（跨文件叙事），但**产物不入 git**、不可自托管、不可评审 | ⚠️ 只作外部交叉校验层 |
| [SCIP](https://github.com/scip-code/scip) / Sourcegraph | code-as-context | Apache-2.0 | scip v0.10.0 / 2026-09-03，健康 | 零（**`sourcegraph/sourcegraph` 已 404**，仅存 public-snapshot 受 LICENSE.enterprise 约束） | ❌ 不值得 |
| **[CodeWiki](https://github.com/FSoft-AI4Code/CodeWiki)** | **intent-as-context** | **MIT** | 2.0.0 / 2026-10-07 推送 / 1,757★ / 有 ACL 2026 论文 | **有，且可增量** | ✅ **唯一合格候选** |

### D2 CodeWiki 深挖（唯一通过筛选者）

**机制**（官方 README 原文）：「CodeWiki reads a repository, builds its dependency graph, splits the graph into a hierarchy of modules, 
and has agents write one page per module plus an overview, with Mermaid diagrams.」——即**分块 + 每叶子模块派一个 agent 撰写叙述 + 父页由子页汇总**。
产物含 `overview.md`、每模块一页、`module_tree.json`、`metadata.json`、**`update_record.json`（记录每次 `--update` 的决策与每个 agent 调用的 token 成本、耗时）**。

**成本（官方实测，svelte ≈125k 行 JS，同一模型）** —— 本代理已用 `gh api` 拉取原文复核：

| 模式 | 成本 | 挂钟 |
|---|---|---|
| Full build | **\$21.48** | 2 h 46 min |
| Update after one commit | **\$0.34** | 3 min |

官方结论原文：「Cost of an update scales with the change, not with the repository.」

**与本仓的匹配度**：本仓可结构化分析面 ≈ **140k 行**（116,590 TS + 23,625 Java），与官方基准的 125k 行量级相当。

**对本仓的三项关键适配**（均来自官方 guides/cli-reference.md）：

- `--output/-o` **默认就是 `docs`** ⇒ 本仓必须改目录，否则污染已有的 530 篇 `docs/`；
- `--with-prose`「Also read the root README and `docs/` as a prose artifact class」⇒ **可直接喂进本仓 530 篇 ADR**，把「为什么这样设计」注入生成上下文——这正好对上 C10 认定的 openwiki 独有价值；
- 支持 `openai-compatible` provider（可直指 DeepSeek 端点，与现有 workflow 同一模型通道）+ `--language zh`。

**⚠️ 硬伤（已一手复核，见 D3）**：不支持 Vue SFC。

### D3 对 CodeWiki 关键论断的一手复核（本代理亲自执行，非转述）

| 论断 | 复核命令 | 结果 |
|---|---|---|
| 许可干净、无 AGPL / 非商业条款 | `gh api repos/FSoft-AI4Code/CodeWiki` | `license: MIT`，`pushed_at 2026-10-07`，1757★ |
| **不支持 Vue SFC** | `gh api .../contents/codewiki/src/be/dependency_analyzer/utils/patterns.py \| base64 -d \| grep -i vue` | **0 命中** |
| 无 vue 分析器 | `gh api .../contents/codewiki/src/be/dependency_analyzer/analyzers` | 15 个：`c/cpp/csharp/java/javascript/kotlin/php/python/ruby/rust/scala/typescript/artifact` —— **无 vue** |
| 增量成本远低于全量 | `gh api .../contents/guides/incremental-updates.md` | L124-125 原文：`Full build \| \$21.48 \| 2 h 46 min` / `Update after one commit \| \$0.34 \| 3 min` |
| Sourcegraph 本体已下线 | `gh api repos/sourcegraph/sourcegraph` | **HTTP 404** |
| gitingest 已迁仓 | `gh api repos/coderamp-labs/gitingest` | 存在，MIT，15,863★ |

**Vue 盲区的量化后果**：本仓 82 个 SFC / **19,345 行**（占手写代码的 12%）不会进依赖图。能进图的是 TS + Java + 全部 artifact
（Gradle / CI workflow / tailwind.config.ts / tokens/*.scss）+ `--with-prose` 读到的 530 篇 docs。对本仓而言，
**页面/组件层（`src/pages/`、`src/components/`）恰恰是 Vue SFC 密集区**，而这正是 openwiki 地图价值最集中的地方——这是 CodeWiki 相对 openwiki 的**实质性缺口，不是边角问题**。

### D4 两件近乎零成本、可与本决策解耦的并行项

1. **DeepWiki 免费层**（本仓 PUBLIC ⇒ 免费）：官方提供 `https://mcp.deepwiki.com/mcp`，原文「a free, remote, no-authentication-required service that provides access to public repositories」，三工具 `read_wiki_structure` / `read_wiki_contents` / `ask_question`；挂 badge 的仓库会自动刷新。**定位是外部交叉校验层，不是事实源**（产物不在 git、不可版本化、无法被 AGENTS.md 当锚点）。
2. **llms.txt 给 website 文档页加机器可读入口**：给 `pictelio-website` 文档页补 `.md` 同址版本 + 根 `llms.txt`，成本≈0。**与 openwiki 去留无关，应单独立项**。

### D5 本节结论

开源界目前**只有 CodeWiki（MIT）**同时满足「产出意图层 + 增量更新 + 官方成本可算 + 许可干净 + 可 CI 化」。
它相对现有 openwiki 的最大增量**不是质量，而是成本结构与可追溯性**（全量 \$21/2h46m → 增量 \$0.34/3 min，每次决策落进 `update_record.json`），
最大风险是**对 Vue SFC 的结构性盲区**（本仓 19.3k 行页面/组件层不入图）。

其余候选——repomix / gitingest / aider repo map / SCIP——**全部是 code-as-context，与 CodeGraph 零增量**，可以直接排除。

---

## 五、外部方案：商业 / 托管（primary sources）

### E0 先钉死一个高频误判：openwiki 与 DeepWiki 是两家公司

| | openwiki（本仓现用） | DeepWiki |
|---|---|---|
| 归属 | **LangChain** · `langchain-ai/openwiki` | **Cognition**（Devin 母公司） |
| 许可 | **MIT** | 闭源托管 SaaS |
| 官方描述 | "a CLI that writes and maintains agent documentation for your codebase" | "Devin-generated docs for any public repo" |
| 规模 / 活跃度 | **17,014★**，2026-10-07 推送 | 99★，README 性质，官方仓库最后 commit 2025-05-22 |

**同名不同物，是路线竞品而非上下游。** 本代理复核命令：`gh repo view langchain-ai/openwiki` / `gh repo view CognitionAI/deepwiki`；
并在 openwiki 官方 README 全文检索 `deepwiki`（忽略大小写）—— **0 次命中**，README 里出现的是 LangChain 自己的 **Deep Agents**，与 Cognition 的 DeepWiki 无关。

### E1 横向对比总表

| 产品 | 私有仓库 | 数据出本机 | 定价（USD；除注明外页面无日期） | context 类型 | 2025–26 关键事件 |
|---|---|---|---|---|---|
| **openwiki（现用）** | 支持 | **不出**（自带 key，可 OpenAI-compatible 端点） | MIT，模型成本自付 | **intent + code** | --update 已是增量 + Claims 溯源 |
| **DeepWiki / Devin** | 支持（须 Devin 账号 + API key） | **全出** | Free 0 / Pro **20** / Max 200 / Teams 80+40；Medium **5–10 ACU**、High **20–40 ACU** per wiki | **intent** | 2025-07 收购 Windsurf；**默认拿你的数据训练**（付费需手动 opt-out） |
| **GitHub Copilot** | 支持 | 出（索引在 GitHub，**声明不用于训练**） | 0 / **10** / 39 / 100 每月 + AI Credits | code（语义检索）+ 人工 instructions | 2025-08-28 支持 AGENTS.md；Workspace 最后更新 2025-02-28，事实上停更 |
| **Sourcegraph** | 支持 | 出 | **Enterprise $16K/年起** | **纯 code** | 2025-07-23 Cody Free/Pro 下线；2026-02-25 浏览器端被 Deep Search 取代 |
| **Cursor** | 支持 | 索引**本地**（官方称不存 embedding），云 agent 出 | 0 / **20** / 40 per user | code（**已退化为 grep**） | 2.1（2025-11-21）Instant Grep |
| **Windsurf** | 支持 | 出 | **已并入 Devin 定价** | code（RAG）+ Codemaps（intent，但按需/托管） | **2025-07-14 被 Cognition 收购，改名 Devin Desktop** |
| **Continue.dev** | 支持（OSS） | 不出 | **定价页 404，已无商业档** | code（**@Codebase 已废弃**） | **被 Cursor 收购**；官方文档现主动推荐改用 DeepWiki MCP |
| **JetBrains AI / Air** | 支持 | 出 | 0 / **10** / 30 / 60（1 credit = 1 USD） | code（Air Context 语义索引，early access） | Junie 并入 Air |

### E2 唯一真正产出 intent 叙事的商业产品：DeepWiki —— 四条独立否决

1. **产物进不了仓库**。逐行检索官方 DeepWiki 文档，**无任何 export / 导出 Markdown / 提交回仓库的说明**；也**无任何定时重生成机制**（对比 openwiki README 明确给 GitHub Actions / GitLab CI / Bitbucket Pipelines 三种定时示例）。
2. **数据默认用于训练**。官方原文：「By default, we may use your data for model training purposes… If you're on a paid plan, you can opt out at any time… **If you're an Enterprise customer, we will never train on your data without your express prior written consent.**」——即付费个人/团队**默认开启训练，须手动 opt-out**。
3. **私有仓库拿不到免费 MCP**。官方对照：DeepWiki MCP = 无需认证 / **仅 public** / free；Devin MCP = **需 API key** / public+private / 需 Devin 账号。本仓 PUBLIC 虽能用免费层，但这恰好意味着**它只能读已经公开的代码**。
4. **贵 1–2 个数量级**：Devin Pro $20/月、Medium effort 约 5–10 ACU/wiki（ACU 美元单价在自助档位未公开）。

**可控性是 DeepWiki 唯一超过 openwiki 的地方**（`.devin/wiki.json` 可强制指定页面清单与 repo_notes，「we bypass the default cluster-based planning and create exactly the pages you specify」，上限 30 页）。
但产物锁在 SaaS 里这一条，是**结构性否决**——见下节。

### E3 致命点：与本仓既有制度不兼容

本仓的地图层不是「一堆 markdown」，而是一整条链路，每一环都有测试或硬约束钉着：

| 环节 | 本仓现状 | 证据 |
|---|---|---|
| 生成 | CI 定时重生成 | `.github/workflows/openwiki-update.yml` |
| 落地 | 提交 PR + 门禁 + 自动合并 | 同上，3 道自研门禁 |
| 归属 | 「`openwiki/` 由 CI 重生成，提交前不手改」 | AGENTS.md「生成物归属」 |
| 存在性 | **`<!-- OPENWIKI:START -->` 由契约测试断言必须存在** | `packages/android-host/tests/unit/agentsMd.contract.test.ts:167-170`，删了 CI 直接红 |
| 消费 | 本地 agent 经 `openwiki_search` / `openwiki_read` 检索 | AGENTS.md 工具触发协议 |

**任何「产物不入 git」的方案，与这条链路的每一环都是负分**：不可版本化、不可 code review、仓库离线时不可用、第三方持有你的代码。
这不是「效果差一点」，是**接不上**。

### E4 商业侧唯一有真实增量、但不替代地图层的东西：GitHub Copilot

- 官方：「There is **no limit to how many repositories you can index**.」
- 官方：「**Copilot will not use your indexed repository for model training.**」
- 官方：初次索引「大仓库最多 **60 秒**」，之后「新会话开始后数秒内自动更新」——**相对本仓 56 分钟差 56 倍**。
- 官方完整支持 **AGENTS.md**（2025-08-28 changelog 起 coding agent 与 code review 均支持；就近目录的 AGENTS.md 优先）。

**但它是 code-as-context + 人工 instructions 的组合，不产出意图地图。** 它的真实价值是让 Copilot 自己的 agent 也能读懂本仓那 352 行 AGENTS.md 约定——属于**互补**，不是替代。

> **诚实标注（本代理未能独立复核）**：`web_fetch` 在本会话对 `docs.github.com` 与 `docs.devin.ai` 均被网络策略拦截（域名解析到非公网 IP），
> 上述 Copilot / DeepWiki 官方文档引文**沿用商业调研代理的一手取证**，本代理未能二次验证。
> 可验证的替代路径：`github/docs` 仓库内含官方文档**源文件**（`content/copilot/concepts/context/repository-indexing.md` 已确认存在），后续复核应走 `gh api` 取源文件而非文档站。

### E5 一手来源未能证实的项（商业侧诚实清单）

1. GitHub 未发布 Copilot Workspace 正式下线公告（仅「最后 changelog 停于 2025-02-28」+「现行文档导航中不存在」+「落地页仍在」三项间接证据）。
2. Cursor 未发布移除 embedding 索引的 changelog 公告（仅现行文档显式声明）。
3. JetBrains Air Context 的 early access 状态来自搜索结果标题，正文 JS 渲染未直取。
4. Junie 的 repo understanding 机制：相关文档站 403，无法取证。
5. Devin ACU 的美元单价：官方仅对 Enterprise 披露（order form）。
6. Continue 收购公告 FAQ 三答原文在折叠面板，需 JS 渲染。
7. Sourcegraph 自身是否被收购、Amp 独立索引机制：未找到一手证据，未作断言。
8. 除 JetBrains（页面版本标注 2026.2）与两处 changelog（2025-06-25 / 2026-02-25）外，**全部定价页本身未标注更新日期**。

---

## 六、综合结论：三份调研的冲突与解法

### F1 先承认：三份调研的结论互相冲突

| 来源 | 结论 | 隐含前提 |
|---|---|---|
| C（本仓实测） | openwiki 的**独有内容只有 5 段**（C10-1..5），体量上「往 ADR 补 2 段 + 生成一个索引」即可替代 | 以「docs/ 里找不到」为判据 |
| A（开源调研） | 唯一合格的 OSS 替代是 **CodeWiki**，但**不支持 Vue SFC**（已一手复核），本仓 19.3k 行页面/组件层不入图 | 候选集限于「现成的生成器产品」 |
| B（商业调研） | **保留 openwiki**，投 1–2 天把 56 分钟压下来（并行 page workers + 收窄证据源） | 「替代方案」只指**别人家的产品** |

**冲突的根源不是事实矛盾，而是问题定义不同**：A 与 B 都在「换一个现成生成器」的集合里找答案，因此都只能给出换/不换；
C 问的是「这些内容**本来该由谁拥有**」，答案落在**确定性脚本 + ADR** 上——而那不是一个产品，不在 A/B 的候选集里。

### F2 把 openwiki 每天干的活拆开看

C 的 C10 + B5 合起来给出一个分解结论：openwiki 一次 56 分钟全量重写，输出里混着**两种性质完全不同的东西**——

| 成分 | 占比判断 | 本该由谁产出 |
|---|---|---|
| **可确定性生成**的导航与事实（目录树、入口文件、ADR 索引、版本号、路由表、CI 门禁拓扑） | B5 实测：quickstart 约 **55% 冗余** + 其余多数可从 `router.ts` / `package.json` / `docs/adr/` / workflow yaml 抽出 | **一个脚本**（分钟级、零模型、零 CI、零门禁） |
| **不可生成**的意图知识（跨语言时序、失效方向、否定性能力边界、门禁拓扑的失效机理） | C10 全仓只找到 **5 段** | **ADR / glossary**（人工，每段 1–2 段文字） |
| **每次重写的失真**（两处 broken-link 标记、28/29 应为 27/28） | C11 | —— |

**这就是 openwiki 失真的机制性解释**：把两类本可极便宜获得的东西，绑死在一次全量 AI 重写上——而全量重写正是它产出计数陈旧与断链未清的原因。

### F3 四个选项，各自的账

| 选项 | 做什么 | 一次性成本 | 持续成本 | 保留什么 / 失去什么 |
|---|---|---|---|---|
| **0 · 只调参（保 openwiki）** | 按 B 的杠杆设 `OPENWIKI_PAGE_CONCURRENCY`、收窄 `openwiki/INSTRUCTIONS.md` 的证据源 | **小时级、可证伪** | 56 分钟 → 目标个位数 | 全保留 / 零失去 |
| **1 · 拆解（删 openwiki）** | ① 写一个确定性脚本生成导航层（`docs/adr` 索引 + 交叉引用图 + 入口文件 + 版本事实）；② 把 C10 的 5 段搬进对应 ADR/glossary | **1–2 天** | **零 CI、零门禁、零模型** | 保留全部意图知识 + 全部结构事实 / 失去「AI 每日重新发现」与「MCP 语义检索」 |
| **2 · 换 CodeWiki** | CI 改跑 `codewiki generate --update`，`-o` 指向独立目录 | 1–2 天试点 + 每次全量 $21/2h46m 量级 | 增量 $0.34/3min | 保留自动生成 + 可追溯（`update_record.json`）/ **失去 19.3k 行 Vue 页面层的图覆盖**，且仍要自建 CI 门禁 |
| **3 · 接托管产品** | DeepWiki / Copilot | — | $10–20/月起 | **否决**：产物不入 git、不可版本化、默认训练私有代码、无定时重生成 |

### F4 推荐路径（分三步，每步都可单独回滚）

1. **先做选项 0 的实验**——它是唯一「小时级、可证伪」的：设并发 + 收窄证据源，跑一次 workflow 看真实挂钟与 diff 规模。
   **这不预设结论**：若真能从 56 分钟降到个位数，「保留 openwiki」的成本论据就基本消失，选项 2 也随之失去必要性。
2. **并行做选项 1 的导航层脚本**——因为**无论 openwiki 去留，这个索引都缺**（`docs/adr/` 271 个文件、0 行索引、160/201 篇互引却无可查询呈现）。
   它与 openwiki 无耦合，可以独立验证价值。
3. **用 1、2 的实测结果决定 openwiki 去留**——判据应当是「5 段意图知识是否已被搬进 ADR」+「导航层是否已覆盖」+「56 分钟是否真的压下来了」，
   而不是「文档读起来好不好」。

### F5 无论走哪条路都成立的三条

1. **C10 的 5 段意图知识应当搬进 `docs/adr/` 或 `glossary-*.md`**——它们本来就属于那里，现在只是碰巧寄生在 wiki 的重写范围里，随时可能被一次全量重写冲掉。
2. **`docs/adr/` 的索引与交叉引用视图应当建起来**——271 个文件、0 行索引、79.6% 互引却不可查询，这是当前文档体系最实的一个洞，且与 openwiki 的存废完全解耦。
3. **AGENTS.md 指向 openwiki 的两处断锚应尽快修**（`§Component Architecture` → 现名 `§app-lynx Layer Map`；`§Engine Availability Fallback` → 现名 `§Engine Availability and Single-Engine Fallback`，且在 `overview.md` 而非 `android-native.md`）。
   这与去留无关——**现在就是坏的**。

---

## 附录：本文件证据坐标速查

| 编号 | 事实 | 可复现命令 / 坐标 |
|---|---|---|
| A1 | workflow 304 行 / 17 step / 150 min / cron `10 10 * * *` / 3 secrets / 3 自研门禁 | `wc -l .github/workflows/openwiki-update.yml`；`cat -n` L15 / L17-18 / L28 / L30-304 |
| A2 | openwiki 1.9M（`.claims/` 1.2M / 正文 6,374 行 672 KB） | `du -sh openwiki openwiki/.claims`；`find openwiki -name '*.md' | xargs wc -l | tail -1` |
| A3-1 | 死锁防线测试 139 行 / 5 不变量 / 4 阳性对照 | `packages/android-host/tests/unit/openwikiGateDeadlock.test.ts` L36-49, L56-95, L102-138 |
| A3-2 | ADR-0099 五条决策 + 三条否决理由 | `docs/adr/ADR-0099-local-openwiki-disable.md` L23-27, L31-35 |
| A3-3 | 仓内 54 文件 / 178 处；9 个文件带硬挂钩 | grep pattern=openwiki（排除 openwiki/ 自身 18 文件 / 766 处） |
| A4 | 125 commit / 37 次自动 / 21,606 行 churn / `.claims` 占 +9,038 | `git log --numstat -- openwiki/` 聚合 |
| B5 | quickstart 7 个 H2 逐节对照 | `grep -n '^#{1,3} ' openwiki/quickstart.md` vs AGENTS.md 20 个 H2 |
| B6 | 530 md / 11 子目录 / adr+specs+research 近 60 天 541 次提交 | `git ls-files 'docs/*.md' | wc -l`；`git log --since -- docs/<dir>/` |
| B7 | 3 行表 2 个"尚未创建"；app-lynx/CONTEXT.md 737 行 103 KB 73 commit | `cat -n CONTEXT-MAP.md`；`find . -name CONTEXT.md` |
| B8 | 271 文件 0 索引；160/201 有交叉引用；骨架统一无模板 | `git ls-files docs/adr/`；`grep -o 'ADR-[0-9]{4}'` 逐文件去自身 |
| B9 | 802 文件 / 12,909 节点 / 41,016 边 / 64.5 MB | `codegraph status --json`；`codegraph --help` + 5 个子命令 `--help` |
| C10-1 | 门禁拓扑全仓唯一 | `grep -rl 'poststate' docs/ AGENTS.md NOTES.md workflows/` → 0 |
| C10-2 | 样本上限论证 | `grep -rl 'sample ceiling' docs/ AGENTS.md` → 0 |
| C10-3 | 丢第一帧 | `grep -rl 'view attach' docs/ AGENTS.md` → 0 |
| C10-4 | 静默破版脚枪 | `grep -rl 'declaration and implementation exist together' docs/ AGENTS.md` → 0 |
| C10-5 | 无障碍树不暴露节点 | `grep -rl 'assertion reality' docs/ AGENTS.md workflows/` → 0 |
| C11-1 | 2 处 broken-link 标记 | `grep -rn 'openwiki: broken internal link' openwiki/` |
| C11-2 | 28/29 应为 27/28 | `grep -cE "^\s*\{ path: '" packages/app-lynx/src/router.ts`；逐条 topInset 行号 |
| C11-3 | 13 应为 17；"two shapes" 非二分 | `grep -rl '<PageTopBar' packages/app-lynx/src/pages/ | grep '\.vue$' | wc -l` |
| C11-5 | 既有笔记 4 组数字全错 | `docs/research/codegraph-vs-openwiki.md` L35 / L39 / L48 / L81 vs 实测 |
