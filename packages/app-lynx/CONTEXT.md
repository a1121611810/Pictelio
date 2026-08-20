# Pictelio app-lynx 上下文

app-lynx 是 Pictelio 基于 vue-lynx 的轻量客户端：覆盖登录、插画/小说浏览、收藏与个人中心，与 webview 客户端共享同一 Pixiv 数据源，但导航与渲染完全独立。

## 导航与返回

**系统返回（System back）**：
由 Android 系统返回手势或返回键触发的返回事件，区别于页面内的「‹ 返回」按钮。
_Avoid_: 侧滑返回（仅指手势形态，不涵盖返回键）、返回键（与系统返回混用）

**根路由（Root route）**：
无可返回历史时的落地路由（推荐页、登录页）。系统返回在根路由上不翻页，而是触发「再按一次退出应用」提示，2 秒内再次返回才退出应用。

**路由历史栈（Route history stack）**：
内存路由为「返回」维护的页面路径栈；进入子页面入栈、返回时出栈，登录等替换语义不入栈。

## 图片与列表

**详情比例显示（Detail ratio display）**：
插画详情页图片容器按原图宽高比撑开高度、宽度铺满视口。
_Avoid_: 等比缩放（有歧义）、自适应

**图片级骨架屏（Image-level skeleton）**：
单张图片在加载完成前显示的 shimmer 占位，区别于数据加载期的整页骨架屏。

**插画卡片（Illust card）**：
插画列表（推荐/关注/收藏/用户作品）中的单个条目；整卡含图片区可点击进入详情，受限条目除外。

**受限条目（Restricted item）**：
因 R18/R18G 设置开关处于隐藏态的条目；显示遮罩且点击无响应。
_Avoid_: 受限内容（与「受限条目」混用）、被隐藏的条目

**综合推荐（Mixed recommendation）**：
「推荐」tab 的内容——插画推荐与小说推荐按比例（4:1）交替合并的单一 feed，数据层由 `createMixFeed` 承载。区别于单源 feed（仅插画或仅小说）。
_Avoid_: 推荐插画（旧称，仅指插画单源）、混排（有歧义）

**插画分类页（Illust category page）**：
「插画」tab 的路由页（`/illusts`）——推荐/关注两个子 tab + waterfall 双列插画卡，同小说页（`/novels`）的子 tab 结构。
_Avoid_: 插画页（与旧「推荐插画」混淆）、作品分类页

## 错误与登录

**会话失效（Session expiry）**：
登录凭证（refresh_token）失效且 401 自动刷新失败后的终态；此时页面级请求无法恢复，强制重定向到错误页。
_Avoid_: 登录过期（与「会话失效」混用）、token 失效

**错误页（Error page）**：
会话失效时强制进入的全屏路由页（`/error`）；展示错误详情并提供「返回登录」按钮，返回键退出应用，不可回退。
_Avoid_: 错误弹窗（指页面内浮层，区别于全屏错误页）、报错页

## 前后台与任务恢复

**退后台（Backgrounding）**：
用户通过 Home 手势/按键（上滑回桌面）使 App 进入后台；task 与宿主实例全部保留。
_Avoid_: 缩小（用户口语，规范术语用「退后台」）、最小化（桌面窗口语境）

**回前台（Foreground return）**：
从后台重新进入 App，两条路径：**点桌面图标**（launcher 重投递）与**从最近任务进入**（最近任务恢复）。

**任务恢复契约（Task restore contract）**：
系统级保证——task 存活且宿主 Activity 未被销毁时，回前台恢复原页面状态（页面、历史栈、滚动位置），App 无需自行实现；App 的职责是不破坏该契约。

**launcher 重投递（Launcher re-delivery）**：
点桌面图标时 launcher 发送 `MAIN/LAUNCHER` intent；对 `singleTask` 活动，系统按 affinity 找到既有 task 并投递给**存活的目标实例**（`onNewIntent`）。目标实例不存在时系统只能重建，且压在既有 task 之上（非根）。
_Avoid_: 重新启动（与冷启动混淆）

**路由壳 Activity（Routing shell activity）**：
MainActivity 在 lynx 模式下的角色——launcher 入口 + 读取 client 开关 + 路由到 LynxActivity + 立即 `finish()`。路由壳永远没有存活实例，是 launcher 重投递命中不了的目标（ADR-0102 修复）。
_Avoid_: 中转页、launcher 页

**根 Activity（Task root activity）**：
task 栈底 Activity；`Activity.isTaskRoot()` 判断当前实例是否为 task 根——「缩小后点图标」场景重建的路由壳不是根（下面压着存活的旧宿主），冷启动/客户端切换（CLEAR_TASK）下是根。

**实例堆叠（Instance stacking）**：
路由壳每次重建都新开宿主实例叠在旧实例之上，task 逐层累积；每层一个完整 JS runtime（内存泄漏级）。修复前每次「缩小→点图标」堆叠一层。
_Avoid_: 栈堆积（与路由历史栈混淆）

**会话重置（Session reset）**：
宿主实例被重建 → 全新 JS 上下文 → 内存路由 `_state` 归零为初始值 → 落在首路由（推荐页）。用户感知为「回到推荐页」。
_Avoid_: 回到推荐页（描述现象而非概念）

**进程死亡（Process death）**：
系统回收 App 进程；task 记录保留但宿主实例全部销毁，回前台 = 会话重置（系统无能为力，JS 层持久化兜底不在本次范围）。

**引擎会话（Engine session）**：
一个宿主 Activity 实例存活期间的前端状态（路由、登录态、页面数据）。实例存活时前后台切换不重置引擎会话；实例重建必然重置。
_Avoid_: 会话（与「登录会话」/「会话失效」混淆）
