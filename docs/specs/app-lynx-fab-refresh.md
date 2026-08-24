# app-lynx 列表刷新 FAB —— 功能规格

> 来源：grill-with-docs 会话（ADR-0106 T4 验收判定原生 `<refresh>` 不可行，用户拍板改 FAB）；决策记录：ADR-0107；术语：`packages/app-lynx/CONTEXT.md`（刷新 FAB / RefreshableList）
> 状态：ready-for-agent
> 取代：`docs/specs/app-lynx-pull-to-refresh.md`（superseded，保留作失败记录）

## Problem Statement

app-lynx 的 9 个列表实例需要一个统一、双端可用的刷新入口。ADR-0106 的原生下拉手势路线在模拟器验收中判定不可行（SelectorQuery 对 XElement 静默不命中导致完成信号链路平台层断裂，连带 patch 错位/布局脆弱/依赖补漏四层代偿）。改为：RefreshableList 内建右下角 M3 FAB，双端同构。

## Decisions（ADR-0107 映射）

| # | 决策 | 结论 |
|---|------|------|
| D1 | 刷新入口形态 | RefreshableList 内建 FAB（右下角），双端同构；废弃 `<refresh>` 路线 |
| D2 | 组件接口 | `:refresh` 函数 prop + 默认 slot；刷新状态机内收（防重入 + try/finally）；页面禁自持刷新态 |
| D3 | 原生面 | 整体回滚 ADR-0106 前基线（-3 依赖、-1 @LynxMethod、-校验任务、-proguard keep）；rebase drop T1 |
| D4 | patch 错位 workaround | 页面侧同 tick epoch 重建：实测证明 ①与 `<refresh>` 无关（裸 list 整体替换即复现）②epoch 必须与 items 替换同一 flush（组件内 await 后 bump 仍有 15 条错误；页面侧 sync() 后同步 ++ 错误归零）。每页 3 行 |
| D5 | FAB 行为 | refreshing 中防重入 + opacity 0.6；不做滚动隐藏；a11y 沿用 refreshList |
| D6 | 范围 | 9 列表实例（沿用 ADR-0106 D5）；排除详情页/Me/ErrorPage |
| D7 | 验收 | 单测（结构+负向+页面断言）+ 模拟器实测 V3-V9 |

## 模块接口（RefreshableList.vue）

```vue
<RefreshableList :refresh="refreshFeed">
  <list …>…</list>
</RefreshableList>
```

| 接口元素 | 类型 | 语义 | 不变量 |
|---------|------|------|--------|
| `refresh` | prop `() => Promise<void> \| void` | 页面传入的幂等刷新函数（`feed.refresh()`+sync 或 `fetchFirstPage()`） | 组件 `await` 它驱动禁用态；失败也必须在页面函数内部消化（createMixFeed 错误槽既有语义），组件 `finally` 保证复位 |
| 默认 slot | `<list>` | 现有列表原样迁入 | 每实例恰好一个可滚动子元素 |

组件内部（调用方不可见，禁止在页面重写）：

- `refreshing` 内部 ref + 防重入 guard（refreshing 中 tap 忽略）+ `try/finally` 复位
- 结构：`<view class="w-full flex-1 min-h-0 relative"><slot/><FAB/></view>`
- FAB：M3 56dp=`14.933vw`、`rounded-[var(--md-shape-large)]`、`bg-primary-container`、按压 `active:bg-layer-pressed-primary`、`shadow-[var(--md-elevation-3)]` 按压降 `elevation-1`、图标 `↻`（`text-[6.4vw] text-primary-on-container`）、`absolute bottom-6 right-4`、refreshing 中 `opacity: 0.6`
- a11y：`REFRESH_A11Y_LABELS.refreshList`（`accessibility-element` + `accessibility-label`）

**组件源码红线字面量（负向断言 oracle）**：不得出现 `<refresh` / `refresh-header` / `createSelectorQuery` / `finishRefresh` / `PictelioApp` / `isNativeMode` / `setTimeout`。

## 数据流与状态

```
用户点击 FAB
  └─ 组件 onTap：
       refreshing 内部 ref 为 true → 忽略（防重入）
       否则：
         refreshing = true（FAB opacity 0.6）
         try { await props.refresh() }   // 页面：await feed.refresh(); sync()
         finally { refreshing = false }  // 组件自持有 finally，无"忘调 done"类目
```

页面侧（每页同构，以 Recommended 为例）：

```ts
async function refreshFeed() {
  await feed.refresh()
  sync()
}
// 模板：<RefreshableList :refresh="refreshFeed"><list …/></RefreshableList>
// 无 refreshing ref、无 onRefresh 包装器、无 refreshEpoch
```

**竞态与边界**（createMixFeed 源码核对结论沿用，测试覆盖）：

| 场景 | 行为 |
|------|------|
| 刷新中重复点击 FAB | 组件 guard 忽略（logcat 请求计数=1 可验证） |
| 刷新中触发 fetchMore | `firstLoadInFlight` 拦截，fetchMore no-op（ADR-0104 既有） |
| fetchMore 在途时刷新 | generation++，在途响应丢弃（既有） |
| 刷新请求失败 | feed 内置错误槽，`refresh()` 正常 resolve → 组件 finally 复位；首屏/内联错误槽显示 |
| 刷新中切 tab（Bookmarks/UserHome `v-if` 卸载组件） | 组件销毁，内部 refreshing 随之消失；页面 refreshFeed 继续跑完并 sync（页面活着），无泄漏 timer（组件无 timer） |
| 非 FAB 路径并发刷新（onMounted/watch/onActivated 补拉） | feed 层 generation 防护兜底；不点亮 FAB 禁用态（语义正确：禁用态仅反映 FAB 发起） |
| `refresh` 永不 settle | 不可能：createMixFeed 15s TIMEOUT 保证 resolve；FollowList `fetchFirstPage` 失败路径置错误态后正常返回（T2' 单测核对） |
| KeepAlive 复用 | 组件无持久状态、无 timer、无模块级计数器 |

## 原生回滚（T1'）

1. 弃未提交改动：`git checkout -- packages/app/android/app/build.gradle packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioAppModule.java`
2. rebase drop T1：`git rebase --onto 918f731^ 918f731`（918f731 未推送；T2/T3/docs 提交不触碰 build.gradle/proguard，预期零冲突）
3. 回滚面清单（回滚后以下显式声明均应不存在）：
   - build.gradle：`xelement-refresh`（lynx/full 两行）、`viewpager2`（两行）、`verifyPinnedAars` 任务（66 行整段）
   - proguard-rules.pro：`com.lynx.xelement.refresh.**` / `com.scwang.smart.refresh.**` keep（8 行整段）
   - PictelioAppModule.java：`finishRefresh` @LynxMethod + `findRefreshingLayout` + SmartRefreshLayout import（未提交，54 行）
4. 验证：build.gradle/proguard-rules.pro grep 上述字面量零输出；lynx debug 构建绿。
   **注意（ADR-0107 决策 3 修正）**：`xelement:4.0.1` POM 将 `xelement-refresh` 声明为 runtime 依赖，
   依赖树中仍会出现 `xelement-refresh` / `refresh-layout-kernel`（origin/main 基线同款传递，非残留）；
   判据是**显式声明零残留 + 树与基线一致**，且 `viewpager2` 在树中零出现。

## 页面改造（T3'，7 页 9 实例，模式同构）

每页：`@refresh="onRefresh"` + `:refreshing="refreshing"` → `:refresh="<fn>"`；删 refreshing ref 与 onRefresh 包装器。**patch workaround（每页 3 行）**：`refreshEpoch` ref + list `:key="refreshEpoch"` + 刷新函数内数据替换后同步 `refreshEpoch.value++`（必须与 sync 同一 flush，ADR-0107 D4）。绑定目标：

| 页面 | 实例数 | `:refresh` 绑定 | 特殊处理 |
|------|-------|----------------|---------|
| Recommended.vue | 1 | `refreshFeed` | — |
| IllustList.vue / NovelList.vue / Following.vue | 各 1 | 各自 `refreshFeed` | — |
| Bookmarks.vue | 2 | `refreshIllust` / `refreshNovel` | 双列表共享一个 refreshEpoch（tab v-if 互斥，隐藏列表切回时本就重建） |
| UserHome.vue | 2 | 同上模式 | 同上 |
| FollowList.vue | 1 | `fetchFirstPage`（幂等） | epoch++ 在 `users.value` 替换同一 try 块内 |

list 尺寸类：RefreshableList 容器（`relative flex-1 min-h-0`）内 list 用 `w-full h-full`（V4 已验证原生解析正常）。

## 测试计划

**单测（`packages/app-lynx/tests/unit.test.ts`，node 环境）**——删 ADR-0106 字节码 oracle 契约断言 6 条，换形为：

1. **组件结构断言**（oracle = ADR-0107 决策 1/2/5，文件头注释注明）：函数 prop 声明（`refresh`）、防重入 guard、`try/finally` 复位、FAB 令牌类（`14.933vw` / `md-shape-large` / `primary-container` / `md-elevation-3`，oracle = M3 规范，原 Fab.vue 注释已标）、a11y label 消费（oracle = `accessibility.ts` 注册表常量）
2. **组件负向断言**（防原生方案复活）：源码无 `<refresh` / `refresh-header` / `createSelectorQuery` / `finishRefresh` / `PictelioApp` / `isNativeMode` / `setTimeout` 字面量
2b. **patch workaround 断言**（ADR-0107 D4）：7 页 list 均 `:key="refreshEpoch"` 且页面刷新函数内含 `refreshEpoch.value++`（与数据替换同 tick）；组件无 `refreshEpoch`（组件内异步 bump 已实证无效）
3. **页面断言**：7 页 9 实例均为 `:refresh="` 绑定；无 `refreshing` ref 残留（`:refreshing` / `Refreshing = ref` 字面量零命中）；Recommended 无 `refreshEpoch`；Fab.vue 文件不存在；无裸 `<refresh`（全 src 扫描）

**模拟器实测清单**（AVD `pictelio_ui`，lynx debug 构建）：

| # | 项 | 通过判据 |
|---|----|---------|
| V3 | 构建 | `pnpm build:app-lynx && pnpm sync:app-lynx-bundle && ./gradlew :app:assembleLynxDebug` 成功 |
| V4 | 布局解析 | 推荐页列表非 0×0、双列间距与 T3 前基线一致（截图比对）；不通过 → 备选结构（2 行）重验 |
| V5 | 刷新全链路 | `adb shell input tap` FAB 坐标 → logcat 见请求 → 数据替换 → FAB 恢复；期间 opacity 0.6 |
| V6 | patch 错位回归 | V5 全程 logcat 无 `RemoveNode got wrong child index` 且列表渲染新数据（页面侧同 tick epoch 重建生效）；复现 → 停下回报（红线 4） |
| V7 | 防重入 | 刷新中连点 FAB 3 次，请求计数 = 1 |
| V8 | tab 互斥 | Bookmarks 刷新中切 tab → 切回，无卡死 FAB、可再次刷新 |
| V9 | web-core 回归 | `pnpm dev:app-lynx` 浏览器预览：FAB 渲染 + 点击触发刷新 |

## 排除项（Non-goals）

- 不做滚动时隐藏 FAB
- 不引入 refreshing 动画（CSS keyframes 原生未验证）
- 不碰 load-more / footer 现状
- 详情页 / Me / ErrorPage 不加刷新入口
- 数据层（createMixFeed / fetchFirstPage）零改动
- 不复活 Fab.vue 独立组件

## 红线（实现期间）

1. 全 src 禁止出现 `<refresh` 标签（含 RefreshableList 内部）
2. RefreshableList 禁止出现 SelectorQuery / NativeModule / timer / `isNativeMode` 分支
3. 页面禁止自持刷新态（refreshing ref / onRefresh 包装器）
4. 模拟器实测发现布局/patch 异常 → 停下回报，不静默绕路
5. 降级兜底必须 warn 可见（测试硬约束 #3）

## Tickets

| # | 内容 | 前置依赖 | 验收 |
|---|------|---------|------|
| T0' | CONTEXT.md 术语 + ADR-0107 + ADR-0106/旧 spec 状态标注 + 本 spec | — | docs 提交（Conventional Commits） |
| T1' | 原生回滚：弃未提交原生改动 + rebase drop 918f731 + 依赖面验证 | T0' | grep 零输出；lynx debug 构建绿 |
| T2' | RefreshableList 重写（函数 prop + FAB 双端同构）+ 单测换形 | T0'（与 T1' 无代码依赖） | `pnpm test:app-lynx` + `check:app-lynx` 绿 |
| T3' | 7 页 9 实例改形 + 页面断言更新 | T2' | 单测绿；无 refreshing ref / refreshEpoch 残留 |
| T4' | 模拟器验收 V3-V9 | T1' + T3' | 7 项全过，截图/logcat 留证 |
| T5' | code-review 双轴 + 收尾提交 + ADR-0107 待验证项回写 | T4' | 提交绿；CONTEXT.md/ADR 同步 |
