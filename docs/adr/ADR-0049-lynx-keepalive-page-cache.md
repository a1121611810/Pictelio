# ADR 0049: app-lynx 详情返回列表不重载（KeepAlive 页面实例缓存 + 极简历史栈）

## 状态

已采纳

## 分类

技术决策 / 架构

## 日期

2026-08-01

## 背景

`packages/app-lynx` 的极简内存路由（`router.ts`）用 `<component :is="currentComponent">` 切换页面。**Vue 的组件切换 = 卸载旧实例 + 挂载新实例**：

1. 推荐页进详情 → `Recommended` 组件卸载（组件内 `illusts`/`nextUrl` ref 随实例销毁）
2. 详情返回列表 → `Recommended` **重新挂载** → `onMounted` → `fetchFirstPage()` 重新请求 `/v1/illust/recommended`

用户感知：返回列表时**重新加载**（骨架屏闪烁、滚动位置丢失、重复请求）。与主项目 app（SolidJS，feedStore 缓存 + 滚动恢复）的"返回不重载"体验不一致。

另外发现 `goBack()` 硬编码回 `/recommended`（无历史栈）：从小说列表进详情后返回会错误地回到推荐页。

## 决策

### 1. KeepAlive 缓存页面实例（列表/静态页）

`App.vue` 用 `<KeepAlive>` 包裹 `<component :is>`，`include` 白名单缓存三个页面：

```vue
<KeepAlive :include="['recommended', 'novels', 'me']">
  <component :is="currentComponent" />
</KeepAlive>
```

- **缓存列表/静态页**（`recommended`/`novels`/`me`）：返回时组件**不重建**，`onMounted` 不重跑 → 数据、list DOM、滚动位置、图片加载状态**全部保留**，不重载不闪烁。
- **详情页不缓存**（不在 include 白名单）：详情数据按 `:id` 加载，缓存旧 id 的实例会显示错误内容；每次进入详情按新 id 重新挂载加载。
- 页面组件需设 `name`（`defineOptions({ name: 'xxx' })`）供 KeepAlive `include` 匹配。

### 2. 极简历史栈（router.ts）

内存路由补一个返回栈：

- `navigate(path)`：push 当前路径入栈后切换。
- `goBack()`：pop 上一路径并切换；**栈空时回退 `/recommended`**（刷新/深链接边界）。
- 登录相关导航（`navigate('/login')`、登录成功 `navigate('/recommended')`、`initRouter` 首路由）用 **replace 语义（不入栈）**——登录页不应被"返回"。
- 详情页内部翻页（`IllustDetail` 的 prev/nextPage）、小说切章均为组件内 state，不走 `navigate`，不受影响。

## 权衡

| 方案 | 结论 |
|------|------|
| **A. KeepAlive 缓存实例** | **采纳**。改动最小（App.vue 一处 + 组件 name + 历史栈），数据/DOM/滚动全保留。风险：vue-lynx 已导出 `KeepAlive` + `onActivated/onDeactivated`（类型与 runtime 证据充分），但 web-core 渲染器实际兼容性**未实测**（此前 vue-router 的 RouterView 在 Pre-Alpha 组合下不兼容）——**先小步验证，不兼容则降级 B** |
| B. 数据提升模块级 store + 跳过 fetch | 不依赖 KeepAlive 兼容性，但滚动位置恢复复杂（web-core list 虚拟滚动恢复不可靠，见 ADR-0045）、每页改造、DOM 重建（图片重载/虚拟窗口重置）体验差 |
| C. 多页面常驻 + 显隐切换 | 状态全保留但改动大（全部页面常驻 + display 管理），MVP 过度设计 |

## 风险

- **KeepAlive web-core 兼容性**（核心风险）：先小步验证（加 KeepAlive → 进详情返回 → 确认推荐页不重载且无渲染错误）；不兼容降级方案 B。
- **内存占用**：缓存 3 个页面实例常驻内存，MVP 页面少可接受；后续页面增多再评估（可加 `max` 或 LRU 策略）。
- **历史栈边界**：刷新/深链接后栈空 → `goBack` 回 `/recommended`（可接受，MVP 无深层链接需求）。
- **详情页数据语义**：详情页不缓存，返回列表后再进其他详情正常按新 id 加载。

### 正面

- 返回列表零重载（无重复请求、无骨架闪烁、滚动保留），与主项目体验一致
- 小说列表同理受益（novels 缓存 + 历史栈返回小说列表）
- 改动集中（App.vue + router.ts + 3 个页面 name），可逆（去掉 KeepAlive 即回退）

### 反面

- KeepAlive 依赖 vue-lynx/web-core 运行时能力，升级需回归
- 缓存实例内存常驻（3 页）

## 相关

- `CONTEXT.md` 浏览导航术语（返回不重载、页面实例缓存、导航历史栈）
- `routerCore.ts`（路由匹配纯逻辑，历史栈可加单测）
- 实施提交：`58c51fd`
