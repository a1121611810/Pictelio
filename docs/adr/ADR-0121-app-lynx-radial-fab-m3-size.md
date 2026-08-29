# ADR-0121: app-lynx 放射导航 FAB 展开项按 M3 尺寸重定（B 方案 56dp 圆）+ 层叠与扫角修复

- 状态：accepted
- 日期：2026-08-30
- 关联：ADR-0120（放射双层环悬浮 FAB，`GlobalFab.vue`）、ADR-0111（M3 FAB menu，`RefreshableList` 分页/回顶 FAB）、`packages/app-lynx/CONTEXT.md`（「放射导航」「环项尺寸基准」「放射菜单项 56dp 圆」「展开层叠序」「外环扫角约束」词条）、`docs/adr/glossary-app-lynx-radial-nav-fab.md`（更新术语表）
- 来源：需求「放射导航 FAB 展开项太小、且被遮罩盖住」。经原型（`packages/app-lynx/prototype/prototype-radial-menu-sizes.html`）三变体（A 去文字 / B 大圆 / C 紧凑）比选，与用户确认定稿 **B 方案（56dp 大圆，圆内 24dp 图标 + 12sp 文字）**。
- 术语：见 `docs/adr/glossary-app-lynx-radial-nav-fab.md`（本文档只记录决策，不写代码）。

## 背景

ADR-0120 把全局导航（4 tab 底部栏）+ 各页刷新 FAB 合并为「右下角放射双层环悬浮 FAB」（B 方案：外环=4 导航 tab、内环=页面动作项）。但实现后有两个用户可见问题：

1. **层叠 bug**：FAB 展开后，外环/内环菜单项落在半透明 `scrim` 遮罩**之下**。原因：菜单项未设 z-index（默认 0），而遮罩为 `z-10`。结果展开内容被压暗、且点击会被遮罩拦截（`pointer-events-auto` + `inset-0`），点菜单项实际点的是遮罩→直接收起。
2. **内容偏小**：菜单项圆本身尺寸接近 M3，但**圆内内容太小**——外环图标 20dp（`5.33vw`）、文字 11sp（`2.93vw`）、内环图标 16dp（`4.27vw`）、FAB 图标 22px 硬编码，均低于 M3 推荐（24dp 图标 / 12sp 文字 / 24dp FAB 图标）。

另经原型/几何测量确认一个**独立真实 bug**：外环扫角 `OUTER_END = -100°`。外环从 -8° 扫到 -100°，**越过 -90° 的项 y 坐标反而往屏幕下方走**（`polar()` 中 `y = fabCy - cos(r)·R`，角度过 -90° 后 `cos` 变负）。FAB 本就贴屏幕底部，末端项会**探出屏幕底边**（375×812 实测 B 变体溢出约 7px）。

## 决策

1. **层叠序**：把外环/内环菜单项显式设 z-index，令 `scrim(z-10) < 菜单项(z-20) < 主 FAB(z-30)`（同一 `z-40` 容器内）。菜单项浮于遮罩之上，展开内容可见、可点。
2. **尺寸按 M3（B 方案定稿）**：环项尺寸统一按 **vw 缩放 + 375dp 设计宽**（`1vw=3.75px`）换算：

   | 元素 | 现状 | 改为 | 换算 |
   |------|------|------|------|
   | 外环圆 | `12.8vw`（48dp） | **`14.93vw`**（56dp） | M3 导航目标 |
   | 外环图标 | `5.33vw`（20dp） | **`6.4vw`**（24dp） | M3 图标 |
   | 外环文字 | `2.93vw`（11sp） | **`3.2vw`**（12sp） | M3 label |
   | 内环图标 | `4.27vw`（16dp） | **`6.4vw`**（24dp） | M3 图标 |
   | FAB 图标 | `22px` 硬编码 | **`6.4vw`**（24dp） | M3 FAB 图标 |
   | 内环圆 | `10.67vw`（40dp） | 不变 | 已对齐 M3 |

   - 外环半径 `R_OUTER_VW`：`31` → **`35`**（56dp 大圆需更大半径防 4 项重叠；实测 35vw 时中心距 57.1px > 56+4px 间隙，无重叠且不溢出）。
   - 内环半径 `R_INNER_VW`：保持 `20`（不变）。
3. **外环扫角**：`OUTER_END`：`-100` → **`-88`**。末端项停在 FAB 水平线上方，不再探出屏幕底边。原型实测（375×812、1vw=3.75px）所有变体菜单项均落在屏内、无重叠。
4. **不改 `RefreshableList` 的 pill FAB menu**（非 tab 页局部列表操作 ADR-0111）：形态不同是刻意的（一个全局导航、一个局部列表操作），本次只改放射导航 FAB。

## 被考虑的方案

- **A 去文字（48dp 图标圆 + 圆外小字）**：文字层级降低，但失去「导航项带 label」的可读性；否决。
- **C 保 48dp 圆 + 紧凑 10sp 文字**：图标缩到 24dp 后文字贴底/被裁（48dp 圆内塞 24dp 图标 + 12sp 文字垂直高度 ≈40-41dp 超出直径内切可用区）；否决。
- **固定 dp 而非 vw**：破坏 app-lynx 全项目统一 vw 缩放约定（`spacing=vw`、`fontSize=rpx`），且仅 375dp 屏精确等于 M3；否决。

## 后果

**正面**：
- 展开内容可见、可点（层叠修复），尺寸符合 M3（图标 24dp、文字 12sp、外环 56dp 圆）。
- 修复「末端项探出屏幕底边」的真实 bug。
- 改动面小且集中：所有改动在 `GlobalFab.vue`（几何常量 + 模板 vw 值）与对应单测；`createGlobalFab.ts` 深模块**零改动**（几何不属其职责），其现有 `createGlobalFab.test.ts` 行为单测**不受影响**。

**负面/风险**：
- 外环半径 31vw→35vw、圆 48dp→56dp，展开态占屏更多；已实测不溢出、不重叠。
- 外环文字 11sp→12sp / 图标 20→24dp，需确认真机上不贴底、不裁（原型已验证，真机仍需回归）。
- **无障碍标注不变**：`GLOBAL_FAB_A11Y_LABELS`（主 FAB 开/关）与内环复用 `FAB_MENU_A11Y_LABELS` 不变，Appium/E2E 定位不受影响。

## 验收

- [ ] 放射 FAB 展开后，外环/内环菜单项**浮于遮罩之上**，可见、可点（不点遮罩）。
- [ ] 外环导航项为 **56dp 圆**（`14.93vw`），圆内 24dp 图标（`6.4vw`）+ 12sp 文字（`3.2vw`）；内环动作项 40dp 圆 + 24dp 图标；FAB 图标 24dp（`6.4vw`）。
- [ ] 外环半径 `R_OUTER_VW=35`、`OUTER_END=-88`；展开态所有菜单项在屏内、无重叠、无探底。
- [ ] `RefreshableList`（非 tab 页）的 pill FAB menu **不变**。
- [ ] `createGlobalFab.test.ts` 行为单测全绿（深模块无改动）。
- [ ] `tests/unit.test.ts` 结构断言新增/更新：GlobalFab.vue 含 56dp/24dp/12sp 几何类与遮罩层叠序；通过。
- [ ] `pnpm check:app-lynx` 类型检查通过。
- [ ] 模拟器 E2E：展开后菜单项可见可点、刷新/回顶正常、无 RemoveNode。

## 相关文档

- docs/specs/app-lynx-radial-fab-m3-size.md
- docs/adr/glossary-app-lynx-radial-nav-fab.md（术语更新）
- packages/app-lynx/CONTEXT.md（术语更新）
