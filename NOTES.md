# NOTES

写给「读规格的 agent」，不是给人读的日记。**只记 `AGENTS.md` 没有的东西** ——
能指回 `AGENTS.md` 的一律不重复，避免两份事实源打架。每条带出处。

---

## 一、本仓已知的空缺（读规格时别去找，它不存在）

| 空缺 | 结论 |
| --- | --- |
| 「收敛」「问题完全解决」「迭代几轮算够」的可判定定义 | **全仓未找到**。这不是遗漏 —— 是刻意留白，已由 `workflows/review-fix-loop.md` 填补 |
| `/tdd`、`/grill-me`、`/grill-with-docs`、`/to-spec`、`/to-tickets`、`/diagnosing-bugs` 的仓内定义 | 不存在。仓库只有 `.agents/skills/code-review/` 一个 skill；其余走全局 catalog |
| `docs/development/`、`CONTRIBUTING.md` | 不存在。code-review 的 standards 源是**发现式（存在即用）**，缺失不算缺陷 |

---

## 二、`AGENTS.md` 命令表未覆盖的工具

- `test:mutation`（Stryker，仅 ugoira + update-check）—— `package.json:40`
- `dev:all` / `build:all` / `preview:all`（多包并行）；`check:all` 带 `--cache`、**`test:all` 不带** —— `package.json:14,19,24,29,43`
- `release:android-host:transition`（过渡期发布分支固定 `release/transition-6.2.0`）—— `package.json:51`
- `sync:app-lynx-bundle`、`kill:all`、`openwiki:update` —— `package.json:54,57,58`
- 宿主包独有：`appium:setup`、`sync:android-version`、`sync:credentials` —— `packages/android-host/package.json`
- `test:lynx-web` —— `packages/app-lynx/package.json`
- pre-push 三域触碰校验（app → E2E 锚点 / app-lynx → 单测 / `.agents/` → skill 校验）+ fmt 门禁 —— `.husky/pre-push:2`、`scripts/check-push-refs.mjs:2,7,181`
- commit-msg 走 commitlint —— `.husky/commit-msg:3`；**pre-commit 当前是空壳**（OpenWiki 已移交 CI）—— `.husky/pre-commit:2`
- CI 三个 job：check / test / android-unit-test（Robolectric）—— `.github/workflows/ci.yml:16,41,68`
- 第四个 workflow 未在 `AGENTS.md` 提及：`.github/workflows/sysbars-acceptance.yml`

---

## 三、尚未规格化的循环候选

`AGENTS.md` 只规定了多轮推进的纪律，没规定这些活动**怎么跑**。它们都符合 loop 的形状，
需要时可各开一份 `workflows/*.md`：

1. **触达探测** —— 强杀 → 点通知 → 落通知中心的单点信号实验 —— `docs/testing/conventions.md:40`
2. **发版前过渡矩阵门** —— 单引擎后 3 行 Lynx —— `packages/android-host/tests/android-e2e/specs/transition-matrix.spec.ts:3`；矩阵事实源 `docs/specs/qa-defense-lines.md` §3.T2
3. **openwiki 每日重生成 + PR** —— cron `0 1 * * *`（北京 09:00，90 min timeout）—— `.github/workflows/openwiki-update.yml:9-13,22`
4. **五片串行实施模式** —— 判定链+存储 → 汇总 → 落点 → 报告 → 发布门 —— `docs/adr/ADR-0220-notification-delivery-channel-probe.md:6`
5. **模拟器/真机取证通道** —— `adb --es benchNav <scenario>`，**已知不保证动画时序**（登记于 2026-10-05，#908）—— `docs/testing/conventions.md:104-107`

---

## 四、术语（`AGENTS.md` 之外 / 易混）

| 术语 | 定义 | 出处 |
| --- | --- | --- |
| **触达探测**（delivery probe） | 「送达通道」的**单点信号实验**，不是功能名。别名「通知功能/推送功能」须避免 | `docs/adr/glossary-notification-center.md:36` |
| **送达通道**（delivery channel） | 通知 + 角标 + 已读记忆**三层**总称 | `glossary-notification-center.md:35` |
| **read-point evidence** | 声明「X 由 Y 驱动」必须有 Y 的**生产读点**；无读点标 `possible silent misconfiguration` | `.agents/skills/code-review/SKILL.md:60-66` |
| **characterization ≠ specification** | 期望值只是当前行为锁定，**不能**作「实现正确」的证据 | `code-review/SKILL.md:35` |
| **conformance problem / oracle problem** | 精确判别定义 | `docs/research/ai-generated-test-quality.md:28-52` |
| **防空转断言** | 抽取器/剥除器必须有「结果非空 / 长度下界」，否则全称断言**静默恒真** | `docs/adr/glossary-top-inset-and-verification.md:40` |
| **别名标注格式** | 表头写「别名（避免使用）」 | `docs/adr/glossary-app-lynx-rate-limit-backoff.md:8` |

**已知叫法漂移（已规范，别再用旧叫法）**：
- Android 生命周期的「缩小 / 回到推荐页 / 前台后台 / 重建」曾混用 → `docs/adr/glossary-android-lifecycle-restore.md:19`
- ADR-0188 §Phase 2 与 ADR-0218 §4 对「送达通道」措辞不一致 → 已在 ADR-0220 §6 对齐

---

## 五、`AGENTS.md` 写了原则、没给可判定定义的判据

这些是写门禁时必须先查的，**不得另造**：

- **门禁判别力三要件** —— 反事实（须喂两种以上换皮形态）· 抽取器自身有效（扫描面非空 + 命中数下界）· 阳性对照 —— `docs/specs/md3-continuity.md:429-437`
- **阴性证据三禁令** —— 搜到 0 条 / 手动跑过 / 门禁绿 ⇒ 视为空转门禁 —— `docs/specs/bottom-occlusion-allowance.md:128`
- **「零命中 ≠ 不支持」（JIT 假象）** —— 产物 grep 0 命中有两种成因，产物本身区分不了，必须跑一次真实编译 —— `docs/adr/glossary-md3-alignment.md:471`
- **「采样没看到中间态 ≠ 没有过渡」** —— 同族判据 —— `glossary-md3-alignment.md:549`
- **无登记失效面的门禁比没门禁更危险** —— 两条已付代价：`not.toContain` 把缺失功能锁成合规；只匹配首个标记的正则 —— `glossary-md3-alignment.md:566-574`
- **失效面登记的单一入口** —— `glossary-md3-alignment.md` §13.8 —— `docs/adr/ADR-0211-ui-continuity-motion-contract.md:906`
- **C2 / C5 分工不可合并** —— C2 验判别力（对任何令牌改动恒绿），C5 钉现状（引入塌陷即转红）；缺一条则门禁要么空转要么失灵 —— `docs/adr/ADR-0207-shape-and-state-layer-guardrails.md:251`
- **门禁只做无歧义断言**，且文件头明写「不做全站枚举」 —— `docs/adr/ADR-0215-fail-safe-aux-mechanisms.md:56`
- **E2E 只钉「只有真机能证伪」的链路**；门禁职责由单测与跨端契约承担 —— `docs/testing/conventions.md:37-39`
- **差分测试语义退化的合法形态只有两种**（`X ↔ Java/spec 契约` / `X 单端行为基准`）—— `docs/testing/conventions.md:58-60`
- **单引擎后待重定义项** —— `docs/agents/qa-transition-checklist.md:16-17`；且 `docs/release-checklist.md:70` 明确「在重新定义前本项视为未设防」

---

## 六、待办（有人在跟进，不是笔误）

- `docs/agents/qa-transition-checklist.md` 整份待 #805 重新定义
- `docs/release-checklist.md:70` 第 1 项在重定义前**视为未设防**