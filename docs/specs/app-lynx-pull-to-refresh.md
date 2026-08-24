# app-lynx 列表下拉刷新 —— 功能规格

> 来源：grill-with-docs 会话（用户逐项拍板 D1-D7）；决策记录：ADR-0106；术语：`packages/app-lynx/CONTEXT.md`（下拉刷新手势 / RefreshableList）
> 状态：ready-for-agent

## Problem Statement

app-lynx 的 9 个列表实例（Recommended / IllustList / NovelList / Following / Bookmarks×2 / UserHome×2 / FollowList）数据层刷新能力完备（`feed.refresh()` 幂等 + generation 竞态防护；FollowList `fetchFirstPage()` 幂等），但仅推荐页有 FAB 刷新入口，其余页面无任何用户可达的刷新手段。需要统一的下拉刷新手势入口。

## Decisions（用户拍板）

| # | 决策 | 结论 |
|---|------|------|
| D1 | 技术路线 | 官方 `<refresh>` XElement + web-core 条件降级（否决 JS 手势自实现） |
| D2 | 完成信号接口 | `:refreshing` prop + `@refresh` 事件 + 默认 slot（否决 done-callback） |
| D3 | 供应链 | build.gradle 内嵌双 AAR SHA-256 校验任务（否决全量 dependency verification） |
| D4 | web-core 降级 | 组件内建 web-only 刷新按钮；推荐页 FAB 删除 + `Fab.vue` 删除 |
| D5 | 范围 | 9 个列表实例（含 FollowList）；排除详情页/Me/ErrorPage |
| D6 | header 形态 | `bindrefreshstatechange` 低频双态；不绑 `headeroffset`；CSS keyframes spinner |
| D7 | 验收 | 单测（oracle=字节码常量）+ 安卓模拟器实测全链路 |

## 模块接口（RefreshableList.vue）

```vue
<RefreshableList :refreshing="refreshing" @refresh="onRefresh">
  <list …>…</list>
</RefreshableList>
```

| 接口元素 | 类型 | 语义 | 不变量 |
|---------|------|------|--------|
| `refreshing` | prop `boolean` | 外部驱动的刷新态 | `true→false` 转换时组件调 `finishRefresh()` 收起 header |
| `refresh` | event `() => void` | 用户下拉过阈值（原生 `startrefresh`） | 仅原生分支发出；web-only 按钮点击也经此事件 |
| 默认 slot | `<list>` | 现有列表原样迁入 | 每实例恰好一个可滚动子元素（`<refresh>` 约束） |

组件内部（调用方不可见）：唯一 id 生成（`refresh-<n>`）、`isNativeMode()` 双端分支、`<refresh-header>` 双态文案、SelectorQuery invoke、15s 卡死兜底、web-only 刷新按钮（固定右下角，避开底部导航的统一偏移）。

## 数据流与状态

```
原生手势下拉
  └─ <refresh> bindstartrefresh（isManual=true）
       └─ emit('refresh') → 页面 onRefresh:
            refreshing = true
            try { await feed.refresh()（或 fetchFirstPage()）; sync() }
            finally { refreshing = false }
                 └─ 组件 watch false → SelectorQuery invoke finishRefresh()
                      └─ <refresh-header> 回弹收起

header 文案（bindrefreshstatechange，每手势 ~3 次事件）：
  REFRESH_STATE_REFRESHING → spinner + 「刷新中…」
  其余（IDLE / DRAG_RELEASE）→ 「下拉刷新」

web-core 分支（isNativeMode()=false）：
  裸 slot 透传 + 组件内建 web-only 刷新按钮 → 点击走同一 @refresh 通道
```

**竞态与边界**（createMixFeed 源码核对结论，测试覆盖）：

| 场景 | 行为 |
|------|------|
| 刷新中触发 fetchMore | `firstLoadInFlight` 拦截，fetchMore no-op |
| fetchMore 在途时下拉 | generation++，在途响应丢弃 |
| 刷新请求失败 | feed 内部置错误槽，`refresh()` 正常 resolve → `finally` 收起 header |
| 刷新中再次下拉 | 原生刷新态锁定，不重复触发 |
| `finishRefresh` invoke 失败 | 15s 兜底强制再调一次；仅视觉卡 header，数据无损坏 |
| KeepAlive 复用 | 组件无持久状态；`onUnmounted` 清理兜底 timer |

## 原生集成

```groovy
// build.gradle（lynx / full 两处）
lynxImplementation "org.lynxsdk.lynx:xelement-refresh:4.0.1"
fullImplementation  "org.lynxsdk.lynx:xelement-refresh:4.0.1"
```

- `LynxActivity` **零改动**（`XElementBehaviors().create()` 经 `Class.forName` 可选注册，字节码实证）
- 哈希校验 task：`gradle.taskGraph.whenReady` 门控仅 lynx/full assemble 触发；detached configuration 解析两个 artifact → SHA-256 比对 → 不匹配 `GradleException`（构建错误，非静默）
- proguard-rules.pro：+keep `com.lynx.xelement.refresh.**` 与 `com.scwang.smart.refresh.**`（官方 consumer rules 为空，AAR 实证）

## 页面改造（7 页 9 列表，模式同构）

每页增量 ~10 行：`refreshing` ref + `onRefresh`（try/finally）+ 模板包裹。特例：

- **Recommended.vue**：删除 FAB 及 `Fab` import（`refreshFeed` 保留，onMounted/watch/onActivated 仍用）
- **Bookmarks.vue / UserHome.vue**：两个 `<list>` 各自包裹独立 RefreshableList（组件唯一 id 机制保证 SelectorQuery 不串）
- **FollowList.vue**：`@refresh` 绑 `fetchFirstPage`（幂等），加 `refreshing` ref
- **Fab.vue 删除** + `tokens.css` 注释去 Fab 字样

## 测试计划

**单测（`tests/unit.test.ts`，node 环境）**：

1. **契约断言**（oracle = xrefresh-4.0.1.aar 字节码提取，文件头注释注明出处）：RefreshableList 源码含 `finishRefresh` / `autoStartRefresh` / `enable-refresh` / `startrefresh` / `refreshstatechange` 字面量
2. **结构断言**：native 分支含 `<refresh>` + `<refresh-header>`；web-core 分支透传 slot 且含内建刷新按钮；`finally` 兜底存在；`onUnmounted` 清理 timer
3. **页面断言**：7 页均经 RefreshableList（无裸 `<refresh>`）；Recommended 无 Fab import；Fab.vue 文件不存在

**模拟器实测清单**（AVD `pictelio_ui`，lynx debug 构建）：

1. `<refresh>` 不抛 LynxError 990200（behavior 注册成功）
2. waterfall 布局穿透：推荐页首屏双列间距/图片尺寸与改造前一致（截图比对）
3. 下拉手势：header 渐显 →「下拉刷新」→ 松手 →「刷新中…」→ 数据替换 → header 收起
4. web-only 按钮（web-core 预览）：点击触发刷新
5. 刷新失败路径：飞行模式下拉 → header 收起 + 首屏错误槽显示

**E2E**：Appium swipe 手势 spec 尝试；对 LynxView 不灵则降级 `adb shell input swipe` + 截图验证。不阻塞交付。

## 排除项（Non-goals）

- 不碰 load-more（`scrolltolower` + footer 现状保留；不引入 XRefreshFooter）
- 不绑 `headeroffset`（无「释放刷新」第三态）
- 详情页 / Me / ErrorPage 不加下拉刷新
- 数据层（createMixFeed / fetchFirstPage）零改动
- 不启用全量 Gradle dependency verification

## 红线（实现期间）

1. 页面禁止出现裸 `<refresh>` 标签
2. 哈希校验失败必须构建错误
3. 模拟器实测发现布局穿透异常 → 停下回报，不静默绕路
4. web-core 分支禁止渲染 `<refresh>` 标签（无映射，防未知元素破坏预览布局）

## Tickets

| # | 内容 | 前置依赖 | 验收 |
|---|------|---------|------|
| T0 | ADR-0106 + CONTEXT.md 术语 + 本 spec | — | ✅ 已完成 |
| T1 | 原生集成：build.gradle 双 flavor 依赖 + SHA-256 校验 task + proguard keep | T0 | lynx debug 构建成功；篡改哈希负向验证 = 构建失败 |
| T2 | RefreshableList.vue + 契约/结构单测 | T0（与 T1 无代码依赖，可并行） | `pnpm test:app-lynx` + `check:app-lynx` 绿 |
| T3 | 7 页 9 列表接入 + 删 FAB/Fab.vue/tokens.css + 页面断言 | T2 | 单测绿；无裸 `<refresh>`；Recommended 无 Fab |
| T4 | 模拟器全链路验收（spec「模拟器实测清单」5 项）+ Appium/adb 手势尝试 | T1 + T3 | 5 项全过，截图留证 |
