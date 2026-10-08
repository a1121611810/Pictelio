---
title: 退役 openwiki —— 把地图与保鲜还给仓库自己
date: 2026-10-08
status: 待批准（未动任何代码）
evidence: ../research/openwiki-alternatives-2026-10.md
---

# 退役 openwiki

> **一句话**：openwiki 把**地图**（从哪看起）和**保鲜**（别让它烂掉）两件事，都做成了「每天重写 17 页 AI 散文」。
> 前者该由人写一次（`setup-matt-pocock-skills` 已建），后者该由确定性检查承担——而两者都已缺位，于是 304 行 workflow 去补了一个没人读的结构层。

## 四层词（贯穿全文与 AGENTS.md 改写）

后续每条规则都落在这四层之一。**先认层，再选工具**：

| 层 | 问什么 | 谁提供 | 保鲜方式 |
|---|---|---|---|
| **事实** | 代码在哪、怎么调用、改了炸多大 | 源码 + `codegraph`（12,909 节点 / 41,016 边） | 索引自维护 |
| **理由** | 为什么这样设计、这条约束哪来的 | `docs/adr/`（271 篇，79.6% 互引） | 人工写，ADR 流程 |
| **地图** | 从哪看起、这块归谁、领域词汇怎么说 | `CONTEXT-MAP.md` + 各包 `CONTEXT.md` | **人写一次**；缺口如实标注 |
| **保鲜** | 上面三层是否仍为真 | 确定性检查（无模型） | —— |

openwiki 的错位：它把「保鲜」做成了「重写地图」，而**地图里真正会烂的那三样（包清单 / ADR 索引 / `CONTEXT.md` 存在性）它一个都没碰**。

## 决策

1. **删除** openwiki 生成链路（workflow + 死锁测试 + npm 脚本 + 文档引用）。
2. **AGENTS.md 的工具触发协议改写为四层词**，删除 `## OpenWiki` / `## OpenWiki 查询规范` / `## OpenWiki 维护规则` 三节与 `<!-- OPENWIKI:START/END -->` 标记块。
3. **不新增** openwiki 替代生成器。地图的「建」已由上游 skill 完成（产物在 `docs/agents/domain.md`），本方案只补「保鲜」。
4. **保留** `docs/adr/` 现状、`packages/app-lynx/CONTEXT.md`（737 行 / 73 次 commit，活得最好的地图资产）与 CodeGraph。

> **不在本方案范围**：写新的 map 生成器、补 8 个包的 `CONTEXT.md`、ADR 模板与索引脚本。它们是独立决策（见 §后续）。

## 为什么删（证据链）

完整证据在 [`docs/research/openwiki-alternatives-2026-10.md`](../research/openwiki-alternatives-2026-10.md)。三条承重结论：

| 结论 | 证据 |
|---|---|
| 独有内容仅剩约 1 段，且已在仓库别处 | 「纯推模式首帧必丢」逐字在 `packages/app-lynx/src/utils/safeArea.ts:63-65`；`'root'` 模式是「静默破版脚枪」逐字在 commit `d52223bf` 的 message；样本天花板 ≈14/周 逐字在 `docs/specs/notification-delivery-probe.md:136-137` |
| 事实上层更不准 | openwiki 写「28 of the 29 route entries」，`packages/app-lynx/src/router.ts` 实为 **27/28**；两处 `openwiki: broken internal link` 施工注释留在发布页正文 |
| 保鲜的是错误的对象 | 每日全量重写让「地图」烂掉，却让 `CONTEXT-MAP.md`（3/10 包）、`docs/adr/`（0 行索引）、`NOTES.md`（cron/timeout 抄错 2 个月）无人问津 |

商业/托管替代方案已穷尽并否决：唯一产出意图叙事的 DeepWiki 产物锁在 SaaS、默认用你的数据训练、无导出与定时重生成路径——与本仓「地图住在仓库里」的制度不兼容。详见调研笔记第五节。

## 步骤

按序执行。每步的**完成判据**是可跑的检查，不是「理解了」。

---

### T1 · 重写 AGENTS.md 的路由协议

**动作**

1. 「工具触发协议」表替换为四层词版本（下方给出成品文案），并**删掉**「任何任务第一步必须先读 openwiki 页」的硬约束——它依赖的 `openwiki_search` / `openwiki_read` 从未在本仓接线，是一条**无法执行**的规则。
2. 删除三节：`## OpenWiki`（AGENTS.md:306-319）、`## OpenWiki 查询规范`（:100-109）、`## OpenWiki 维护规则`（:321-333）。
3. 删除 `<!-- OPENWIKI:START -->` / `<!-- OPENWIKI:END -->` 整块（:~288-304）。该块每轮都在上下文里，退役后是纯负担。
4. 「Monorepo 结构」(:126-128) 中「结构信息走 openwiki + CodeGraph」改为「走地图 + CodeGraph」。
5. 「关键设计决策」六条双锚指针 (:142-152) 的 wiki 半边改为 ADR 半边。
6. 「任务完成前自检」里 openwiki 那条改为**保鲜**那条（见 T5）。
7. **全局禁令转正向**：退役后剩余涉及 openwiki 的禁令（禁手改 / 禁本地跑 / 请勿提交 CLAUDE.md）全部消失，无需等价替代。新增规则一律写成正向目标。

**拟替换文案（工具触发协议）**

```markdown
## 工具触发协议

先认层，再选工具：**事实问代码，理由问 ADR，路线问地图。**

| 问题 | 走哪 |
|---|---|
| 代码在哪 / 怎么调用 / 改了炸多大 | `codegraph explore`（默认路径，无需先问） |
| 为什么这样设计 / 这条约束哪来的 | `docs/adr/` 里对号入座的 ADR |
| 从哪看起 / 这块归谁 / 领域词汇怎么说 | `CONTEXT-MAP.md` |
| 第三方库与框架文档 | Context7 → MDN → web_fetch |
| 浏览器标准 API | MDN → web_fetch |
```

**完成判据**

```bash
grep -c 'openwiki' AGENTS.md        # 期望 0
grep -c 'OPENWIKI:START' AGENTS.md  # 期望 0
grep -n '四层词\|事实问代码' AGENTS.md  # 期望命中 ≥1
wc -l AGENTS.md                     # 期望 < 300（当前 352）
```

---

### T2 · 同步契约测试

**动作**

1. 删 `packages/android-host/tests/unit/agentsMd.contract.test.ts:167-170`（「OPENWIKI 标记对存活」用例）。
2. 改 `:149` 的用例名与断言：标题去掉「OpenWiki 查询」，表头数量断言由三张改两张。
3. `:12` 文件头注释中 openwiki 相关说明一并清理。

**完成判据**

```bash
ls packages/android-host/tests/unit/openwikiGateDeadlock.test.ts 2>&1   # 期望：No such file
grep -c -i openwiki packages/android-host/tests/unit/agentsMd.contract.test.ts  # 期望 0
pnpm test:android-host:unit                                           # 期望全绿
```

---

### T3 · 删除生成链路

**动作**（每项一行，全是删除或注释清理）

| 文件 | 动作 |
|---|---|
| `.github/workflows/openwiki-update.yml` | 删整文件（−304 行 / −17 step / −3 secrets / −3 门禁） |
| `packages/android-host/tests/unit/openwikiGateDeadlock.test.ts` | 删整文件（−139 行） |
| `package.json:58` | 删 `"openwiki:update": "openwiki --update"` |
| `README.md:60` | 删 openwiki 链接行 |
| `NOTES.md:23,27,40` | 删 3 处（顺带消除抄错的 cron/timeout） |
| `vite.config.ts:186` | 删 oxfmt 注释里的 openwiki 半句 |
| `openwiki/` 整目录 | 删（−1.9 MB）。**内容已在 git 历史中**，需要时可 `git revert` 恢复 |

**完成判据**

```bash
gh run list --workflow=openwiki-update.yml   # 期望：workflow 不存在
grep -rn 'openwiki' --include='*.md' --include='*.ts' --include='*.yml' --include='*.json' . 2>/dev/null \
  | grep -v '^./openwiki/' | grep -v docs/research | grep -v node_modules   # 期望 0
ls openwiki 2>&1                            # 期望：No such file
gh api repos/$REPO/contents/openwiki 2>&1    # 期望：404
```

---

### T4 · 补最后一段残差

**背景**：全量核对后，openwiki 唯一找不到仓库内出处的陈述是一条否定性知识——**Lynx 4.0.1 的无障碍树不暴露 view/text 节点，`uiautomator dump` 在参考 AVD 上被 SIGKILL，因此 E2E 只能靠 adb 触控 + 截图像素断言**（现仅存于 `openwiki/testing/overview.md:193`）。

该约束其实编码在 `packages/android-host/tests/android-e2e/driver.ts` 的实现形态与 12 个 spec 的命名里，但**没有任何一处显式陈述原因**。

**动作**：在 `docs/testing/conventions.md` 的「E2E 覆盖原则」条下补一句正向陈述——不是加禁令，是写清**断言方式的物理边界**：

> 断言走截图像素比对，因为 Lynx 无障碍树不暴露节点、`uiautomator dump` 在参考 AVD 上被 SIGKILL；触达尺寸、圆角、对比度、状态层 alpha 因此无法结构化断言。

**完成判据**

```bash
grep -n 'uiautomator' docs/testing/conventions.md   # 期望命中 ≥1
```

---

### T5 · 让地图如实标注缺口（保鲜）

**动作**

1. **保留** `docs/agents/domain.md` 的「静默继续」条款原文不动——那是上游 skill 的设计，目的是让 agent 别制造噪声。
2. **改的是 artifact，不是 agent 行为**：`CONTEXT-MAP.md` 的表格补齐 `packages/*` 实际存在的全部包，未创建 `CONTEXT.md` 的显式标注 `未创建`。
   > 「agent 不抱怨缺失」与「地图假装完整」可以并存：前者是行为，后者是事实。
3. 在 `docs/adr/` 新增一份索引（按主题/状态分组 + 交叉引用图；160/201 篇已互引，只是没人渲染）。

**完成判据**

```bash
# CONTEXT-MAP 覆盖全部实际包
comm -13 <(grep -o 'packages/[a-z-]*' CONTEXT-MAP.md | sort -u) \
         <(ls -d packages/*/ | sed 's:/$::' | sort -u)   # 期望 0 行
test -f docs/adr/README.md || test -f docs/adr/INDEX.md   # 期望存在
grep -c '未创建' CONTEXT-MAP.md                            # 期望 ≥1（缺口可见）
```

---

### T6 · 验收

**完成判据**（全部必须满足）

```bash
pnpm check:all && pnpm lint:all && pnpm test:all    # 三道 CI 门禁等价物，全绿
git diff --stat                                     # 净删减（无新增实现文件，除 docs/adr 索引）
```

外加**穷尽判据**（本方案的核心验收，不能抽样）：

> `openwiki/` 的 17 页中**每一页的每一条事实性断言**，都能指向仓库内的一处出处——ADR、`CONTEXT.md`、源码注释、git 历史、或测试形态。

调研笔记第三节已抽样 6 条并全部定位（4 条已在仓库、1 条为 openwiki 计数错误、1 条转入 T4）。**全量对照表作为验收产物留档**，任一条找不到出处，即视为未完成。

## 回滚

本方案每一步都可单独回滚，且不需要「保留开关」：

- `openwiki/` 全部内容与 workflow 均在 git 历史中，`git revert <commit>` 即恢复。
- T5 的地图标注是纯新增信息，回滚无副作用。
- T4 是补一句话，回滚无副作用。

**唯一不可逆的**是 AGENTS.md 的路由改写措辞——但它同样在 git 历史中。

## 不在范围（后续独立决策）

| 项 | 为什么不在本方案 |
|---|---|
| 补 8 个包的 `CONTEXT.md` | 这是地图真正缺的东西（词汇层），工作量按包计，需单独排期 |
| `docs/adr/` 索引脚本（T5-3 之外的自动化） | 当前先手写一次；是否需要脚本化取决于更新频率 |
| ADR 模板与脚手架 | 271 篇骨架已统一（背景→编号决策→后果），缺的是模板文件，另议 |
| CodeWiki 等开源生成器 | 无 Vue SFC 支持，本仓 19,345 行页面/组件层不入图；且仍需自建 CI 门禁 |
| DeepWiki 免费 MCP 作外部对照 | 可零成本接入，但产物在仓库外，只作交叉校验、不作事实源 |
