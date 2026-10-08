---
title: 包文档漂移修正 + android-host 领域上下文
date: 2026-10-08
status: 已批准（推荐项，/ship 按推荐继续）
parent: docs/specs/openwiki-retirement.md「留给后续」节
---

# 包文档漂移修正 + android-host CONTEXT.md

## 背景

openwiki 退役任务（#966）登记了两项后续漂移：5 个共享包 description 仍引用已删的 webview 客户端；8 个包无 CONTEXT.md（CONTEXT-MAP 如实标注）。本规格按推荐收敛范围：**description 全改；CONTEXT.md 只做 android-host**（需求已被退役任务实证——「宿主包不是客户端」「lynx/java vs main/java」在同一任务内被反复解释 ≥3 次，触发 docs/agents/domain.md 的「术语真正确定时」条件；其余 7 包保持缺口，无工作驱动建文档 = 造未来漂移源）。

## 决策

1. 5 个 description：消费者改为 app-lynx；保留仍有效的 spec 链接（ranking.md / search-advanced-filters.md 已验证存在）。
2. 新增 `packages/android-host/CONTEXT.md`（~120 行，app-lynx 的 1/5 体量），词汇全部从 ADR + 代码事实抽取，每条带锚点，不发明。
3. CONTEXT-MAP.md 的 android-host 行「未创建」→「已创建」。
4. 顺带修正 AGENTS.md「关键设计决策」行的一处陈旧机制引用：`shouldInterceptRequest` 是 WebView 时代机制（ADR-0090 描述已删客户端），现行机制为 lynx/java 的 PictelioImageService + main/java 的 PixivImageLoader（`/pixiv-img/` 代理）。

## 票

- **票 A**：5 个 package.json description 修正。判据：5 包内 grep 'webview|主 app' == 0。
- **票 B**：android-host CONTEXT.md + CONTEXT-MAP 状态 + AGENTS.md 短语修正。判据：CONTEXT-MAP comm 差集仍为 0；check:all / lint:all / test:all 全绿。

## 不做

- 其余 7 包的 CONTEXT.md（按需触发，`/domain-modeling` 负责）。
- package.json description 的其它重写（只消除已删消费者引用，不做文案润色）。
