---
name: review-fix-loop
description: 实现或修改完成后循环自审自修直到收敛 —— /code-review → /tdd 修复 → 回到 /code-review，任一停机规则触发即停（空转 / 外部锚点未过 / 人工叫停）。用户说「这段做完了查一遍」「闭环」「review 到干净」「循环到零问题」时使用。规则正文在 workflows/review-fix-loop.md，本文件不含规则。
---

# Review–Fix Loop（调用壳）

**本文件不含规则。** 规则、停机判据、外部锚点条件、checkpoint 与 brief 的形状，
全部在 [`workflows/review-fix-loop.md`](../../../workflows/review-fix-loop.md)。

## 执行

1. **先 `read workflows/review-fix-loop.md`**，再动手 —— 不要凭本文件或凭记忆复述闭环。
2. 从该规格的「每轮做什么」开始循环。
3. 何时停止由该规格的「停机规则」判定，**不由本文件判定**。

## 三条最容易做错的

- **不要用全局的通用版 code-review** —— 本循环必须用仓库版
  `.agents/skills/code-review/`（三审计版，声明遮蔽全局同名 skill）。
- **不要以「连续 N 轮无新发现」作为成功判据** —— 作者兼审查者时该分母是自己写的，永远刷得绿。
- **不要在判空转后继续加轮次** —— 空转意味着机器已无法自证，按规格把你叫回来，由人决定。

## 例外路径同样适用

`AGENTS.md`「工作流强制规范」的三条例外（纯 Bug 修复 / 纯重构 / ≤20 行局部改动）
绕过了那节，但**不绕过本循环的规则** —— 凡是产生了代码改动，都走这份规格。