# agent-browser E2E 提速落地报告（2026-08-15）

## 结论

**全量墙钟从 764s（12.7 min）降至 166s（2.8 min），提速 4.6 倍；45/45 用例全部通过。**

## 各方向实测收益（同一机器/网络/token）

| 方向 | 墙钟 | 相对上一阶段 | 累计提速 | 核心改动 |
|---|---|---|---|---|
| 阶段 0 基线（套件健康化） | 764s | — | 1.0x | 修复 7 个过期用例 + 8 条失真断言 + token 脱敏 + teardown + data-testid |
| B：SLEEP→条件等待 | 419s | -45% | 1.8x | 131 处 SLEEP → waitFor* 原语（waitForText/Count/Js/Url） |
| A-1：共享会话 + D：batch | 359s | -14% | 2.1x | 15→1 次登录（resetToHome 复位）；abBatch 工具（clickReliable 探测改造回退） |
| C：AI 断言降级 | 167s | -53% | 4.6x | 68 处 aiAssert → 1 处（s48），确定性 DOM 断言 |
| F2：retry 调优 | 166s | -1% | 4.6x | retry 2→0 + 单用例 flake 兜底 |

## 关键成果

1. **LLM 调用 68 → 1**（-98.5%）：唯一保留的 s48（标签语义判断）符合 ADR-0085「AI 归位」决策。
2. **登录次数 15 → 1**（共享会话）：sub-flows 14 个 describe 嵌套，resetToHome 复位（推荐 Tab + 插画内容类型 + Feed 就绪）。
3. **固定等待几乎清零**：剩余 SLEEP 均为 ≤500ms 的 S 类动画等待（Fluent 规范）。
4. **确定性断言暴露并修复 6 类真实缺陷**：小说空态「暂无内容」漏配、收藏按钮选择器错误、/me 头像 testid 不存在、滚动方式未触发分页、fluent-switch 读 attribute 应为 property、内容类型切换 @ref 歧义。
5. **基础设施修复**：dev server 泄漏（globalSetup 返回 teardown + 端口强制回收）、token 日志脱敏、CI 精简（check+lint only）。

## 验证

- pnpm test:agent-browser：45/45 通过，墙钟 166s
- pnpm check:all、pnpm lint:all、单测 915/915 全绿
- 端口 5173 运行后无残留
- pre-push 静态锚点守卫已生效（.husky/pre-push）

## 未做（按方案契约）

- E（图片降载）：实测收益被高估（0.5-1 min），且 mockFetch 拦不住 img、abort 击穿详情页断言
- A-2（--state 持久登录）：明文 token 落盘安全代价，默认不做
- F1（降并行）：实测无提速证据（墙钟由 sub-flows 单文件决定），且 --maxForks 是无效选项
