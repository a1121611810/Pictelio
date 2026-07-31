# pictelio-app-lynx — Pictelio Lynx Client（vue-lynx MVP）

基于 **vue-lynx**（Vue 3 custom renderer on ReactLynx runtime）的第二个渲染 Client。
与现有 `pictelio-app`（SolidJS + Capacitor WebView）共存，复用同一 Pixiv 后端 / API / 凭证。

> 状态：**MVP 可行性验证**（Pre-Alpha 技术栈，见 `docs/research/vue-lynx-production-readiness.md`）
> 目标：验证「登录 → 推荐插画 → 插画详情 → 小说列表 → 小说详情 → 个人中心 + Client 切换」全链路。

## 快速开始

```bash
# 安装（workspace 根）
pnpm install

# 开发（web 预览 + Lynx 原生 bundle）
cd packages/app-lynx
PICTELIO_LYNX_DEV=1 pnpm dev
# 浏览器打开: http://localhost:3000/__web_preview?casename=main.web.bundle

# 构建 / 类型检查 / 测试（根 workspace 委托）
pnpm build:lynx
pnpm check:lynx
pnpm --filter pictelio-app-lynx test
```

## 架构

```
src/
├── index.ts            # createApp 入口
├── App.vue             # 根组件（<component :is> 动态挂载当前路由页）
├── router.ts           # 手写内存路由（组件表 + 导航）
├── routerCore.ts       # 路由匹配纯逻辑（可单测）
├── api/                # Pixiv API（types/client/auth/illust/novel/userAgent）
├── stores/             # authStore（登录态）、clientSwitchStore（Client 切换）
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

- **token 持久化**：Web 模式用 localStorage 占位，但 vue-lynx worker 无 localStorage → 刷新需重新登录。原生安全存储见 ticket #41。
- **列表回收**：vue-lynx #302 cell 回收 no-op，5k 条内安全（实测）。
- **图片**：原生端需自研 ILynxImageService（Referer 注入），Web 端走代理已可用。
- **登录页 PKCE**：MVP 仅 refresh_token / 密码登录；PKCE OAuth WebView 需原生集成。

## 测试

- `tests/unit.test.ts` — 19 用例（图片 URL 重写、错误分类、OAuth 错误识别、URL 重写、小说正文提取、路由匹配）
- E2E：Playwright touch 模拟验证全链路（登录 → 列表 → 详情 → 个人中心）

## 凭证

`lynx.config.ts` 从 `../app/credentials.json5` 读取（**单一事实源**，与现有 app 同源）。
`__CREDENTIALS__` 仅在 `__DEV__` 分支引用，生产构建整块消除。
