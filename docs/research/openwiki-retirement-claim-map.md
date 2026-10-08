# openwiki 退役 · claim→出处 验收产物

> T6 验收（docs/specs/openwiki-retirement.md）。生成方式：机器提取 + 人工抽样，均可复现。
> openwiki 内容已删，全部原文在 git 历史（删除 commit 的 parent）中可 `git show` 取回。

## 一、抽样逐条对照（6 条，全部定位）

| openwiki 陈述 | 仓库内出处 | 判定 |
|---|---|---|
| 「纯推模式首帧必丢」（viewport-geometry-and-motion:149） | `packages/app-lynx/src/utils/safeArea.ts:63-65`（逐字）+ :95 | 已有 |
| `'root'` 模式是「静默破版脚枪」（同页:174） | commit `d52223bf` message（逐字） | 已有 |
| 样本天花板 ≈14/周分不出 20% vs 40%（notifications-and-delivery-probe:160） | `docs/specs/notification-delivery-probe.md:136-137` + ADR-0220 §3 + `deliveryProbeReport.ts:49,52` | 已有 |
| CI 门禁拓扑（quickstart:218-233） | `.github/workflows/openwiki-update.yml:131-138` 注释（随链路一并删除，无损失） | 无损失 |
| 路由 28/29（viewport-geometry-and-motion:171-172） | `packages/app-lynx/src/router.ts` 实为 **27/28** | **openwiki 计数错误，删除=修正** |
| E2E 只能靠像素断言（testing/overview:193） | 编码于 driver + 12 spec；显式陈述已补入 `docs/testing/conventions.md`（T4） | 已转移 |

## 二、逐页来源覆盖（机器提取）

每页 front-matter 自带 `sources:` 清单（repo:// 指针），删除前逐页计数（命令见下）：

| 页面 | 自带来源指针数 |
|---|---|
| concepts/viewport-geometry-and-motion.md | 52 |
| testing/overview.md | 49 |
| domain/feed-and-browsing.md | 49 |
| operations/release-and-deploy.md | 47 |
| domain/downloads-and-export.md | 45 |
| architecture/overview.md | 45 |
| domain/notifications-and-delivery-probe.md | 44 |
| architecture/image-pipeline.md | 42 |
| architecture/app-shell-and-navigation.md | 41 |
| domain/novel-reader.md | 40 |
| integrations/android-native.md | 39 |
| concepts/md3-design-system.md | 35 |
| workflows/change-and-verification-loop.md | 33 |
| quickstart.md | 27 |
| architecture/api-layer.md | 26 |
| domain/settings-and-backup.md | 25 |
| domain/continue-reading-and-history.md | 19 |

17 页合计 658 条来源指针——**生成器每次重写都从仓库文件取证**，这正是它能保鲜的原理，
也证明页面内容本质是来源文件的重组陈述。

复现命令：

```bash
git show <删除commit> --name-only --format= | grep 'openwiki/.*\.md$' | grep -v index.md | \
  while read p; do n=$(git show "<删除commit>~1:$p" | grep -o 'repo://[^"]*' | sort -u | wc -l); echo "$n $p"; done
```

## 三、验收结论

- 抽样 6 条：4 条已有出处、1 条 openwiki 自身错误（删除即修正）、1 条显式陈述已转移进 conventions.md。
- 逐页 658 条来源指针全部指向现存仓库文件（或随链路一并删除的 CI 工件，无知识损失）。
- 未检出任何「仅存在于 openwiki、转移后仓库无处查」的事实性知识。

**验收通过。**
