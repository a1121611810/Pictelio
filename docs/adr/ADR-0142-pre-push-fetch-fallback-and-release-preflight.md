# ADR-0142: pre-push 钩子加固与 release 分叉预检的 fail 语义分层

- 状态：accepted
- 日期：2026-09-04（accepted，用户拍板「全部按照推荐」）
- 关联：
  - spec [#349](https://github.com/a1121611810/Pictelio/issues/349) / tickets [#350](https://github.com/a1121611810/Pictelio/issues/350)-[#353](https://github.com/a1121611810/Pictelio/issues/353)
  - [ADR-0059-root-script-convention.md](./ADR-0059-root-script-convention.md)（根脚本约定）
  - [ADR-0097-agent-skill-repo-localization.md](./ADR-0097-agent-skill-repo-localization.md)（T0 门禁与 pre-push 校验体系的治理记录来源）

## 背景

2026-09-04 发布 v4.31.0 时，`pnpm release` 在 [5/6] 推送步骤失败：

```
fatal: Invalid revision range 76a4feaf..dddd8b19
husky - pre-push script failed (code 128)
```

根因链：

1. OpenWiki 定时工作流在 GitHub 侧合并 docs PR（`76a4fea docs: update OpenWiki (#348)`），远端 main 前进；本地未 fetch，仓库内**不存在**该 commit 对象（非浅克隆）。
2. `.husky/pre-push` 收到 stdin 传入的远端真实 `remote_sha` 后直接 `git diff --name-only "$remote_sha..$local_sha"`；对象缺失 → diff fatal → 脚本 exit 128 → husky 判失败 → **push 在任何 ref 传输前被中止**（main 与 tag 都没推上去）。
3. release.mjs 无断点续跑，版本 bump commit + tag 已打，留下半成品（tag 指向的 commit 在 rebase 后变成孤儿，必须重打）。

该问题是**结构性**的：只要 OpenWiki CI 持续合并、发布前不先 fetch，每次 release 必踩。且 `fatal: Invalid revision range` 对用户完全不可操作——看不出根因、不知道修法。

## 决策

### D1：hook 三层降级（缺失 → fetch 重试 → fail-open）

pre-push 钩子对本地缺失的 `remote_sha` 先执行**精准** `git fetch origin <remote_ref>`（只取所需引用），重试 diff；fetch 失败则打 warn（带模块前缀）并 **fail-open 放行**。

理由：push 本身必须联网，fetch 失败时 push 也必然失败——fail-open 在实践上不会放行坏代码，只避免「代理抖动 → 钩子硬阻塞」的假阳性。

### D2：真分叉 fail-closed + 人话报错

fetch 成功后用 `git merge-base --is-ancestor` 判定：远端含本地没有的提交（分叉或远端历史改写）→ exit 1，错误信息为中文、含成因提示（常见于 OpenWiki CI 合并）与确切修复命令 `git fetch origin && git rebase origin/main`。

同样阻塞，但把 `fatal: Invalid revision range` 换成可操作的指引。

### D3：release.mjs 确认前预检（fail-fast 零半成品）

在 release.mjs「确认发布」提示**之前**的预检区（与 P4 tag 预检并列）做 fetch + 分叉检查：确认分叉 → throw 走统一 catch（版本号未 bump、无 commit/tag，零半成品）；fetch 失败 → warn + 继续（与 P4 `ls-remote` 失败处理先例一致），由 D1/D2 的钩子在 push 时兜底。比较对象是**本地 main 引用与 origin/main**（与 push 步骤实际推送的引用一致），不是 HEAD。

### D4：职责分层与共享原语

- hook = 所有 push（含手动 `git push`）的最后防线；release.mjs 预检 = 发布场景的 fail-fast UX。两者不互相替代。
- 「存在性检查 / 精准 fetch / 祖先判定」三原语收敛为共享模块（packages/app scripts/lib 区），编排器（根 scripts/）与 release.mjs 共用，防两处逻辑漂移；保持「根脚本 → packages/app 脚本」的既有依赖方向。
- 预检/钩子只 fail-fast 或放行，**不做自动 rebase**（冲突场景不适合脚本内处理）。

## 被否备选

| 备选 | 否决理由 |
| ---- | -------- |
| merge-base 退化对比（不 fetch，用本地可能陈旧的 origin/main） | 校验范围不精确（diff 偏大方向安全但浪费；force-push 场景方向不再安全） |
| 缺失即 fail-closed 要求手动 fetch | 网络抖动变成死锁；hook 内 fetch 成本极低 |
| hook 内自动 rebase / release.mjs 交互式自动 rebase | rebase 可能冲突，脚本内处理冲突状态很糟；预检在版本 bump 前，中止后重跑成本极低 |
| 预检放步骤 5 推送前（而非确认前） | 发现分叉时 commit+tag 已打，rebase 后还要重打 tag——半成品正是要避免的 |
| mock git 输出的单元测试 | 违反「契约测试必须使用真实样例」硬约束；一律用 mkdtemp + git init 真实双仓库 fixture |

## 后果

- 任何 push（不只 release）在远端超前时都得到明确指引；release 在确认前零半成品中止。
- hook 内新增一次精准 fetch 的网络开销仅在 remote_sha 缺失时发生（正常路径零开销放行的现状不变）。
- fail-open 路径以 warn 保持可见（遵守「禁止静默降级」约束）。
- 钩子核心逻辑迁入可测的编排器脚本，四分支（正常 / fetch 成功 / fetch 失败放行 / 分叉报错）有真实 fixture 单测。
- **有意偏离 spec 一处**：`diffTreeNames` 增加 `--root` flag——原 shell 钩子对 orphan 分支根提交的 `git diff-tree` 漏检为 0 文件（无 `--root` 时根提交不与空树 diff），现为全量检出。方向更安全（校验范围只增不减），已在 commit message 按「重构行为不变约束」标注。
- code-review 复审补充（Round 1 P2 修复）：分叉指引按实际远端与分支名生成（不再硬编码 `origin/main`）；tag 等非分支引用的分叉给覆盖指引而非 rebase 指引；fail-open 的「fetch 失败」与「fetch 成功但对象仍缺失」两种文案分离；薄壳透传 pre-push 协议的 `$1` 远端名（非 origin remote 不再误 fetch origin）。
- 可达性推论（已记入测试头注释）：「remote_sha 缺失 → fetch 成功 → 正常校验」分支逻辑上不可达——缺失 ⟹ 不在本地历史 ⟹ fetch 后必非祖先 ⟹ 必走分叉报错。
