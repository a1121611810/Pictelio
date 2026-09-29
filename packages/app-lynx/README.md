# pictelio-app-lynx — Pictelio Lynx Client（vue-lynx）

基于 **vue-lynx**（Vue 3 custom renderer on ReactLynx runtime）的渲染 Client。
Pictelio 自 v6.3.0 起为 **Lynx 单引擎**客户端，本包是唯一运行时形态；`packages/app/` 下的
SolidJS WebView 源码仍在库中但不参与构建与运行（清理见 #819 第 4 项）。
与 WebView 侧复用同一 Pixiv 后端 / API / 凭证（跨引擎共享存储契约仍然成立）。

> 状态：已过 MVP 可行性验证。当前覆盖登录 / 推荐 / 插画详情 / 小说阅读与翻译 / 全局搜索 /
> 评论 / 收藏 / 关注 / 追更 / 用户主页 / 更新 / 错误页。
> 领域术语与平台事实见 `CONTEXT.md`（尤其「平台约束」与「真机导航钩子」两节）。

## 快速开始

```bash
# 安装（workspace 根）
pnpm install

# 开发（web 预览 + Lynx 原生 bundle）
cd packages/app-lynx
PICTELIO_LYNX_DEV=1 pnpm dev
# 浏览器打开: http://localhost:3000/__web_preview?casename=main.web.bundle
# 或在根目录：PICTELIO_LYNX_DEV=1 pnpm dev:app-lynx

# 构建 / 类型检查 / 测试（根 workspace 委托）
pnpm build:app-lynx
pnpm check:app-lynx
pnpm test:app-lynx
```

## 架构

```
src/
├── index.ts            # createApp 入口
├── App.vue             # 根组件（<component :is> 动态挂载当前路由页）
├── router.ts           # 手写内存路由（组件表 + 导航）
├── routerCore.ts       # 路由匹配纯逻辑（可单测）
├── api/                # Pixiv API（types/client/auth/illust/novel/userAgent）
├── stores/             # authStore（登录态）、settingsStore 等；clientSwitchStore 为 #819-3 挂账的遗留（读点无写入方）
├── pages/              # Login / Recommended / IllustDetail / NovelList / NovelDetail / Me
├── utils/              # fetchWrapper（worker fetch 适配）、imageUrl（代理 URL）、errors
└── styles/tokens.css   # Fluent 2 令牌（Lynx CSS 子集）
```

## 关键技术决策（wayfinder 地图 #34 记录）

| 决策 | 原因 |
|------|------|
| 手写内存路由（非 vue-router） | vue-router 的 RouterView 在 vue-lynx 0.5.1 + web-core 0.23.1 渲染为空（已实测） |
| `requestFetch` 用 `globalThis.fetch` | vue-lynx worker 内裸 `fetch` 为 undefined（web-core Function 构造器注入形参遮蔽） |
| spark-md5 静态 import | 动态 import 的 chunk 在 web dev 环境 publicPath 错误 |
| `__DEV__` 由 `PICTELIO_LYNX_DEV=1` 控制 | rspeedy build 默认 NODE_ENV=production 会消除 OAuth 分支 |
| 小说正文整段渲染 | Lynx 无 canvas/measureText，pretext 行级测量不可迁移（MVP 降级） |
| 图片走 `/pixiv-img` 代理 | 与现有 app 同策略，禁止硬编码 i.pximg.net |

## 已知限制（MVP）

- **token 持久化**：安全设计——refresh_token 仅存内存（Web 模式不写 localStorage，防 XSS 窃取）→ 刷新页面需重新登录。原生生产环境由 ticket #41 迁移到 Native Module 安全存储（Android Keystore）。
- **列表回收**：vue-lynx #302 cell 回收 no-op，5k 条内安全（实测）。
- **图片**：原生端需自研 ILynxImageService（Referer 注入），Web 端走代理已可用。
- **登录页 PKCE**：目前仅 refresh_token / 密码登录；PKCE OAuth WebView 需原生集成。

## 测试

- `tests/unit.test.ts` — 19 用例（图片 URL 重写、错误分类、OAuth 错误识别、URL 重写、小说正文提取、路由匹配）
- E2E：Playwright touch 模拟验证全链路（登录 → 列表 → 详情 → 个人中心）

## 凭证

`lynx.config.ts` 从**本包内**的 `credentials.json5` 读取（**单一事实源**）。
ADR-0203 决策 3：凭证与产品版本号原挂在宿主包，构建期跨包 fail-closed 读取；
随 WebView 客户端整包删除，事实源归位到唯一客户端，跨包读取随之解除。
`__CREDENTIALS__` 仅在 `__DEV__` 分支引用，生产构建整块消除。
