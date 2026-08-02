# app-lynx 原生集成统一术语表

> 范围：`packages/app-lynx` 在原生 LynxView 下的双 client 架构、NativeModule 契约、图片流水线、自动化验证基建的**统一术语**。配套 ADR：[ADR-0053](./ADR-0053-lynx-nativemodule-contract.md)、[ADR-0054](./ADR-0054-image-pipeline-unified-core.md)、[ADR-0055](./ADR-0055-lynx-native-render-compat.md)；web-core 预览差异见 `glossary-web-core-pitfalls.md`。

## 核心术语

| 术语 | 定义 |
|------|------|
| **Client（渲染引擎）** | 应用的两套 UI 渲染后端：**WebView client**（SolidJS + Capacitor，主项目 `packages/app`）与 **Lynx client**（vue-lynx，`packages/app-lynx`）。开关存 `SharedPreferences("CapacitorStorage").pictelio_client_kind`，由 `MainActivity` 入口路由分发。 |
| **双 client 启动分支** | `MainActivity.onCreate` 读 `pictelio_client_kind`：`"lynx"` → 先 `super.onCreate` 再 `startActivity(LynxActivity)+finish`（AD-硬约束）；webview 分支原逻辑不动（BridgeActivity 无法跳过 bridge，故双 Activity）。 |
| **入口路由（routing gate）** | MainActivity 开头的 client 分发逻辑（见上）。 |
| **原生模式（native mode）** | app-lynx 在 LynxView 内运行（`isNativeMode()` 为真）。与 **web-core 模式**（浏览器预览）相对。网络走绝对 URL 直连（无 dev proxy），认证走 NativeModule。 |
| **`isNativeMode()` / `getNativeModules()`** | 原生环境探测：lynx 的 `NativeModules` 全局**不在 `globalThis`**（裸全局），探测必须双通道（裸 + globalThis）。 |
| **NativeModule** | 原生暴露给 lynx JS 的模块（`extends LynxModule` + `@LynxMethod`）。本项目：`PictelioSecureStorage`（Keystore 存储）、`PictelioAuth`（OAuth/token）、`PictelioApi`（API 转发）、`PictelioApp`（client 切换/重启）。 |
| **callback 契约（no-null）** | NativeModule 回调**禁止 null 参数**（`CallbackImpl` 崩）：成功 `cb()`/`cb(value)`，错误 `cb(errMsg)`；JS 侧「首参空串 = 无错误」。 |
| **access_token 隔离** | access_token 只存 Java 堆（`PixivApiPlugin.accessToken`），JS 零知；登录（`PictelioAuth.loginWithRefreshToken`）回调只返回用户信息 + 新 refresh_token。 |
| **token 轮换回传** | `PictelioApi.request` 回调第三参携带 401 刷新轮换后的 refresh_token → JS 持久化 Keystore（防重启旧 token 硬失败）。 |
| **dev proxy 相对路径** | web-core 模式的 `rewriteUrl` 产物（`/pixiv-api`、`/pixiv-oauth`）——只对 dev server 有效；原生模式必须绝对 URL（`https://app-api.pixiv.net`）。 |
| **图片流水线（统一核心）** | `PixivImageLoader`（URL 重写 + 磁盘缓存 + OkHttp/Referer-UA）供两个薄适配共用：`MainActivity.interceptImage`（webview，WebResourceResponse）与 `PictelioImageService`（Lynx，Bitmap）。双 client 共享 `pictelio-images` 缓存目录。 |
| **image Behavior 注册** | Lynx 图片可用**必须**在服务构造时 `LynxEnv.inst().addBehaviors()` 注册 `<image>`/`<inline-image>` 的 Behavior——只实现 `ILynxImageService` 接口不够（骨架屏永久显示）。 |
| **XElement** | lynx 扩展元件集：`<input>`/`<textarea>` 属 `xelement-input`；需依赖 + `addBehaviors(XElementBehaviors)`。 |
| **原生 text tap 失效** | 原生 fiber 下 `<text>` 与 `<list-item>` 根级 `@tap` 不触发——交互绑定必须在外层 `<view>`。 |
| **详情大图塌陷** | scroll-view 内 style `aspectRatio`/`minHeight` 失效 → 大图容器高度 0；防护：固定 `h-[100vw]` 容器 + 裸 image。 |
| **item-key String** | `<list-item :item-key>` 必须字符串（数字 id 报 220201）。 |
| **启动恢复挂起** | 原生启动 `restoreToken` → Native OAuth 交换挂起时登录页渲染异常、元素定位失败——**自动化脚本先清 refresh_token** 得干净登录页。 |
| **`lynx-flow-check.sh`** | 真机完整流程自动化（登录→收藏→详情→小说→我的/R18），每步 API 日志 + 截图断言，失败即 exit（不降级手动）。 |
| **`lynx-screen-analyze.py`** | 截图分析器：`classify`（页面粗分类：login/推荐/详情/文本/我的）、`login-elements`（按钮=品牌蓝大块，输入框=按钮上方灰细条）、输入生效验证（非白占比）。 |

## 交互速查（真机 tap 坐标基线，OPPO R11s 1080×2160）

| 元素 | 位置 |
|------|------|
| 顶部返回/导航 | y≈145；"小说" x≈800、"我的" x≈900（view 包裹后） |
| 登录输入框 | 按钮（y≈960）上方灰细条（脚本自动定位） |
| 第一张卡片 ♥ | (120, 800) 附近（脚本多候选重试） |
| 卡片点击（进详情） | 第一张卡图中心 (276, 400) |

> 坐标随布局可漂移——脚本用图像识别 + 多候选 + API 日志验证，不依赖固定坐标。
