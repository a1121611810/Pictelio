# Domain Docs

工程技能在探索代码库时应如何消费本仓库的领域文档。

## 探索前先读

- **`CONTEXT-MAP.md`**（仓库根目录）—— 它把每个上下文指向各自的 `CONTEXT.md`，读取与主题相关的每个上下文。
- **`docs/adr/`** —— 读取与你将要工作的区域相关的 ADR。多上下文仓库中，还应检查 `packages/<context>/docs/adr/` 下的上下文级决策。

如果这些文件不存在，**静默继续**。不要标记缺失，也不要建议立即创建 —— `/domain-modeling`（经 `/grill-with-docs` 与 `/improve-codebase-architecture` 触达）会在术语或决策真正确定时按需创建。

## 文件结构

多上下文仓库（根目录存在 `CONTEXT-MAP.md`）：

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← 系统级决策
└── packages/
    ├── app/
    │   ├── CONTEXT.md                 ← app 上下文（浏览导航、错误处理）
    │   └── docs/adr/                  ← 上下文级决策（暂无，按需创建）
    ├── app-lynx/                      ← CONTEXT.md 尚未创建
    ├── ugoira/                        ← CONTEXT.md 尚未创建
    └── website/                       ← CONTEXT.md 尚未创建
```

## 使用术语表的词汇

输出中命名领域概念（issue 标题、重构提案、假设、测试名）时，使用 `CONTEXT.md` 中定义的术语，不要漂移到术语表明确回避的同义词。

如果需要的概念不在术语表中，这是一个信号 —— 要么你在发明项目不用的语言（重新考虑），要么存在真实缺口（记下来交给 `/domain-modeling`）。

## 标记 ADR 冲突

如果输出与现有 ADR 矛盾，显式浮出而不是静默覆盖：

> _与 ADR-XXXX 矛盾（示例）—— 但值得重新讨论，因为……_
