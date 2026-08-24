# app-lynx FAB menu（M3 官方规范适配）

> 状态：待实现（to-spec）  
> 前置决策：ADR-0107（刷新 FAB）、ADR-0108（旋转动画）、ADR-0110（回顶按钮常驻 + 重建回顶）。

## 1. 目标

将 app-lynx 的列表刷新入口升级为 **Material Design 3 FAB menu**（2025 M3 Expressive 新增组件），把原「刷新 FAB + 独立回顶 FAB」合并为「一个 FAB 展开显示两项操作：刷新、回顶」。

核心杠杆：
- 9 个列表页接口不变（`:refresh` + `@back-to-top` + slot）。
- 全部交互、状态、动画、无障碍集中在 `RefreshableList` 内部。
- 遵循 M3 官方规范（M3 官网 `components/fab-menu/*` 四页）。

## 2. M3 官方规范要点（已抓取）

| 官方页 | 关键规则 |
|--------|----------|
| Overview | FAB menu 从 FAB 展开 2–6 个相关操作；取代 speed dial 与堆叠 small FAB；支持 primary/secondary/tertiary 色系；不与 extended FAB 共用。 |
| Specs | 一种 variant；Anatomy = Close button + Menu item；最多 6 项；menu item 与 medium button 同尺寸；close button 恒 56dp；FAB 与 menu 均保持 16dp 边距；动画从 FAB 的 top-trailing edge 展开；web 推荐 menu 与 FAB 间距 4dp。 |
| Guidelines | 必须与打开它的 FAB 同位置；2–6 项、避免无关操作；从 FAB（而非其他组件）打开；item 必须有 label + icon、贴合内容、圆角、不截断；FAB 应**变身为 close button**，items 用 enter/exit transition；必要时 items 可在 close button 后滚动。 |
| Accessibility | 最小触达 48dp；初始焦点在 close button；Tab/Enter/Space 导航；Android close button label「Toggle menu」+ role Button + expanded/collapsed state；item label 与 UI 文本一致。 |

## 3. 设计决策

### 3.1 接口零膨胀

`RefreshableList` 外部接口保持三件：

```vue
<RefreshableList :refresh="refreshFeed" @back-to-top="listKey++">
  <list :key="listKey">...</list>
</RefreshableList>
```

- `:refresh`：页面传入幂等刷新函数（已有 createMixFeed 竞态防护）。
- `@back-to-top`：点击「回顶」→ 页面 bump list `:key` 重建（与 ADR-0110 一致）。
- 默认 slot：唯一 `<list>`。

FAB menu 的展开/收起、菜单项、scrim、动画、互斥全部内收组件内部。

### 3.2 内部 seam：`createFabMenuState` 纯函数状态机

行为逻辑（互斥、状态转移）无法通过模板结构断言测试，因此抽为纯逻辑原语（`primitives/createFabMenu.ts`），由 node 单测锁定。

接口：

```ts
export interface FabMenuState {
  readonly open: boolean
  readonly busy: boolean
  toggle(): void   // 点 FAB：展开/收起；busy 时 no-op
  open(): void     // 显式展开；busy 时 no-op
  close(): void    // 显式收起
  startRefresh(): void // 点「刷新」：收起 + busy=true
  endRefresh(): void   // 刷新结束：busy=false
  reset(): void   // 卸载/清理
}

export function createFabMenuState(): FabMenuState
```

核心不变量（单测覆盖）：

1. `busy=true` 时 `toggle()/open()` no-op（刷新中不能展开）。
2. `open=true` 时 `toggle()` 触发 `close()`（close button 语义）。
3. `startRefresh()` 同时 `open=false, busy=true`。
4. `reset()` 把状态归零并幂等。

### 3.3 交互状态机

```
[常态] 单 FAB（图标 ↻）
   ↓ 点击 FAB
[展开] FAB 变身为 close button（图标 ✕，56dp 原位）+ scrim + 两项浮出
   ├── 点击 scrim ──→ 收起
   ├── 点击 FAB ────→ 收起
   ├── 点击「刷新」 → 收起 + 刷新中（busy）→ 刷新结束复位
   └── 点击「回顶」 → 收起 + emit('back-to-top')
```

- 刷新中（busy）点 FAB：no-op，不展开。
- 展开中点「刷新」：先收起，再启动刷新，避免展开态与旋转态叠加。

### 3.4 视觉与动画

| 元素 | 规格 |
|------|------|
| 主 FAB | 56dp（`w-[14.933vw] h-[14.933vw]`），primary-container，右上角大圆角（`--md-shape-large`）。常态图标 ↻。 |
| 展开态 close button | 与主 FAB **同一节点/同一尺寸**，图标切换为 ✕；背景保持 primary-container。 |
| 菜单项 | medium button 规格：高 40dp（`10.667vw`），pill 全圆角（`rounded-full`），surface-container 背景，左侧图标 + 右侧 label。 |
| 间距 | FAB 右/下边距 `right-4 bottom-6`（16px）；menu 面板 `bottom` 在 FAB 顶边上方 4dp（约 `bottom-[17.6vw]`）；项间距 8dp（`gap-2`）。 |
| 展开动画 | scrim fade-in 200ms；items 从 FAB top-trailing corner 依次浮出，stagger 60ms，M3 emphasized-decelerate（`--motion-emphasized-decelerate`）。 |
| 收起动画 | v1 **瞬撤**——Lynx 无 `transitionend`，延迟卸载会触碰 `setTimeout` 红线；收起后立即移除 panel DOM。 |

### 3.5 无障碍

新增 `FAB_MENU_A11Y_LABELS`（替换旧的 `REFRESH_A11Y_LABELS` 与 `BACK_TO_TOP_A11Y_LABELS`）：

```ts
export const FAB_MENU_A11Y_LABELS = {
  toggleMenu: '列表操作菜单',   // close button / FAB 播报：打开/关闭菜单
  refreshList: '刷新列表',       // menu item UI 文本 = label
  backToTop: '回到顶部',         // menu item UI 文本 = label
} as const
```

- 主 FAB：`:accessibility-label="FAB_MENU_A11Y_LABELS.toggleMenu"`（M3 规范：FAB label 描述将打开的菜单）。
- 菜单项：label 与显示文本一致。
- 触达：菜单项高度 40dp + 上下 padding ≥48dp。

## 4. 文件变更范围

| 文件 | 变更 |
|------|------|
| `packages/app-lynx/src/primitives/createFabMenu.ts` | 新增纯函数状态机。 |
| `packages/app-lynx/src/primitives/createFabMenu.test.ts` | 新增 node 行为单测。 |
| `packages/app-lynx/src/utils/accessibility.ts` | 移除 `REFRESH_A11Y_LABELS`、`BACK_TO_TOP_A11Y_LABELS`；新增 `FAB_MENU_A11Y_LABELS`。 |
| `packages/app-lynx/src/components/RefreshableList.vue` | 重写为 FAB menu：模板结构、状态机绑定、动画类。 |
| `packages/app-lynx/tests/unit.test.ts` | 新增 RefreshableList 结构断言 + a11y 完整性断言。 |
| `packages/app-lynx/CONTEXT.md` | 更新「列表刷新」术语（刷新 FAB / 回顶按钮 → 列表操作 FAB menu）。 |
| `docs/adr/ADR-0111-lynx-fab-menu.md` | 新增决策记录。 |
| 9 个页面（Recommended/IllustList/NovelList/Following/Bookmarks/UserHome/FollowList） | **零改动**（接口不变）。 |

## 5. 测试策略

| 层级 | 覆盖点 |
|------|--------|
| 行为单测 `createFabMenu.test.ts` | 互斥不变量 / toggle / open / close / startRefresh / endRefresh / reset。 |
| 结构单测 `tests/unit.test.ts` | RefreshableList.vue 引用全部 `FAB_MENU_A11Y_LABELS` key；模板含 menu、scrim、两项文本（刷新/回顶）、close button 图标切换绑定；无 `<refresh>`；timer 仅 back-to-top 复位逻辑（新增 menu 状态机零 timer）；emit('back-to-top') 绑定。 |
| 页面契约 | 9 页仍通过 `:refresh` + `@back-to-top="listKey++"` 使用；无需新单测，但回归需确认。 |
| 模拟器 E2E | 常态单 FAB；点击展开（两项 + ✕）；点刷新（旋转 + 数据替换）；点回顶（epoch 重建 0.0）；刷新中不可展开；无 RemoveNode。 |

## 6. 风险与红线

| 风险 | 缓解 |
|------|------|
| 退出动画缺失导致体验硬切 | 已在决策中接受（Lynx 无 transitionend + setTimeout 红线），后续 Lynx 支持再补。 |
| a11y label 调整影响 Appium E2E | 当前无 RefreshableList 覆盖测试；实现时同步更新 E2E 定位（如需要）。 |
| 菜单项 40dp 高度在 vw 下不是整数 | 使用 `10.667vw`（40px@375）+ padding 凑 48dp 触达。 |
| 页面零改动承诺 | 接口 `:refresh/@back-to-top/slot` 不变，CodeGraph 已确认 7 个调用点。 |

## 7. 验收标准

- [ ] `RefreshableList` 常态显示一个刷新 FAB；点击展开为 M3 FAB menu（✕ close button + scrim + 「刷新」「回顶」两项）。
- [ ] 点「刷新」执行刷新并收起；刷新中点击 FAB 不展开。
- [ ] 点「回顶」emit `back-to-top`，页面 list `:key` 重建回顶。
- [ ] 点 scrim / close button 均可收起。
- [ ] `createFabMenu.test.ts` 与 `tests/unit.test.ts` 全绿。
- [ ] 9 个列表页面零改动仍正常工作。
- [ ] 模拟器验证双端（LynxView + web-core）。
