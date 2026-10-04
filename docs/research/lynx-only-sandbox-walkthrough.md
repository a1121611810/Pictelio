# Lynx 单引擎沙盒功能走查（#611）

> 走查对象：`feat/lynx-only` 分支产出的纯 Lynx 沙盒 APK（#610 产物）
> 走查时间：2026-09-28 · 设备：模拟器 `pictelio_low`（API 34 / 1080×2160 / density 480）
> 结论口径：**只记录不修复**——缺口是生产迁移立项的输入，不是本票的修复项

---

## 0. 环境与前提

| 项 | 值 |
|---|---|
| APK | `packages/app/android/app/build/outputs/apk/debug/app-debug.apk`（53MB） |
| 宿主 | `.LynxActivity`（包内唯一 MAIN/LAUNCHER） |
| 登录态 | 粘贴 `refresh_token` 登录（凭据取自 `packages/app-lynx/.env`，**未写入本文档**） |
| 账号 | Hintaooda / @1121611810 |

**走查纪律**（本轮实测得出，直接影响结论可信度）：

- 每条「缺陷」必须先排除**误判**再落笔。本轮排除了 3 个假阳性（见 §4），
  其中两个一度差点被写成缺口。
- 「操作无反应」类结论必须有 logcat 佐证（手势是否到达 JS 层 / 是否触发
  `notifyStateChange`），不能只看截图。
- 走查结束后已把改动复原：R-18 开关还原为默认关，收藏做了「加→减」往返
  （1115 → 1116 → 1115）并留在原状态。

---

## 1. 七项核心功能走查结果

| # | 功能 | 结果 | 关键证据 |
|---|---|---|---|
| 1 | **登录（refresh_token）** | ✅ 通过 | 粘贴 token → 登录成功，`PictelioPrefs.prefsGet.*` 批量读取设置项；`PictelioApi.request.GET` 开始出流量 |
| 2 | **推荐 Feed** | ✅ 通过 | `Recommended.vue` 是**横向轮播**（非纵向列表）：横滑推进到下一件作品（`OC / 上天入地小白狼`，2图/1115）；图片经 `/pixiv-img/` 代理正常加载 |
| 3 | **插画列表** | ✅ 通过 | `IllustList.vue` 的 `<list list-type="waterfall" span-count=2>` 双列瀑布流；纵向滑动 18 条 scroll 事件，列表正常推进（`Chun_Nam`/`perlica` → `エンラナlog4` 50图/`the gs25 collab`） |
| 4 | **插画详情（多图）** | ✅ 通过 | 50 图作品详情页内联多图，`1/50 → 8/50` 随滚动推进；详情页纵向滚动正常（`LynxUIScrollView notifyStateChange 0→1→0`） |
| 4b | **插画详情（收藏）** | ✅ 通过 | 点心 → `request.POST` → 计数 `1115 → 1116`；再点 → `request.DELETE` → `1115`，心形复原。**写路径双向可用** |
| 5 | **小说阅读** | ✅ 通过 | 小说列表 → 详情页（封面/作者/标签/字数/浏览量/评论数/追更·下载·目录·稍后看）→「开始阅读」进入正文；`@chenglou/pretext` 排版正常（两端对齐、段距），正文滚动正常 |
| 6 | **搜索** | ✅ 通过 | 搜索面板 → 输入 `hatsune` → 返回真实结果（缩略图 + 标题 + 作者·类型 + 查看）；空结果态与筛选（全部/插画/小说 × 最新/最早/热门）均可用 |
| 7 | **设置读写 + 重启保持** | ✅ 通过 | R-18/R-18G 开关写入 `PictelioPrefs.prefsSet.show_r18(_11717768)`；`force-stop` + 冷启动后设置仍在（小说列表仍显示 R-18 内容），且**未要求重新登录**（token 持久） |
| 8 | **R18 开关生效** | ✅ 通过（因果已证） | 同一列表页：开关**关**时三本小说全为「R-18G/R-18 受浏览限制，不予显示」；开启后立即变为真实小说列表（含 #R-18G/#R-18 标签）。**双向可证，不是静态观察** |
| 9 | **存储无损抽查** | ✅ 通过 | `shared_prefs/CapacitorStorage.xml` **文件名保留**（红线）；设置键按 Pixiv 用户 ID 命名空间隔离：`show_r18_11717768`。token 位于 `WSSecureStorageSharedPreferences.xml` |

**附带验证**：「我的」个人页（头像/收藏/追更/稍后看/好友/下载管理/网络自检/通知）、
网络自检页（逐项耗时与成败）、限流退避设置、图片质量、动图导出格式、命名模板、
主题色/明暗模式/界面语言 —— 均正常读写与渲染。

---

## 2. 功能缺口清单（生产迁移立项输入）

### GAP-1　引擎切换 UI 仍完整暴露，但两个控件已无执行者 ⭐ 主要缺口

**现象**：「我的 → 客户端」卡片仍渲染：

- **WebView（现有）/ SolidJS + Capacitor** —— 可点选的 radio（当前未选中，但**可选**）
- **Lynx（当前）/ vue-lynx 原生渲染** —— 选中
- **自动回退 WebView** 开关 —— **默认开**

**为什么是缺口**（三者都已失效，但 UI 仍承诺它们存在）：

1. 选 WebView 只会写 `pictelio_client_kind=webview`，而 WebView 宿主（`MainActivityWebview`、
   Capacitor 桥）已在 #610 整块删除 —— 写进去是一个**永远不会被满足的偏好**。
2. 「自动回退 WebView」的执行者（`EngineRouting.onLynxFailure` → `hopToWebview()`）
   已随 `engine/` 包删除 —— 开关拨动**没有任何运行时效果**，属纯装饰。
3. 源侧根因：`src/pages/Me.vue` 对 Lynx / WebView 两个选项与自动回退开关是
   **硬编码渲染**，未消费 `BuildConfig.CLIENT_KINDS`（`clientSwitchStore.getClientKinds`
   存在但此处未用于过滤）。故 `CLIENT_KINDS` 塌缩为 `{"lynx"}` 后 UI 无反应。

**对 go/no-go 的影响**：这是**单引擎化必须补的 UI 收口**，属生产迁移必做项。
在沙盒里无害（没人会去点），但若直接投产，用户能选中一个不存在的能力。

**处置建议（不在本票范围）**：单引擎包按 `CLIENT_KINDS` 过滤客户端选项，
长度 ≤1 时整张「客户端」卡片不渲染（连带自动回退开关）。

### GAP-2　列表页错误文案不可行动（与既有诊断页能力不匹配）

**现象**：首次进入插画列表时出现一次红色 **「未知错误」**，列表空白。

**已定性**：`classifyError(0, …)` 分支 —— 即**传输层失败**（无 HTTP 状态码），
不是业务错误。随后重新进入即恢复正常（两次复现均瞬态）。
走查后期「网络自检」页给出确证：**[失败] DNS 解析 · 域名解析失败**，
而 TLS 握手（462ms）、API 往返（302ms）、图片边缘（487ms）均通过。

**为什么算缺口**：应用**已经有**能精确诊断并给出行动建议的自检页
（「网络链路异常，问题在你的网络侧 / 建议：重试 / 请检查 DNS 或切换网络」），
但列表页自身只抛「未知错误」—— 与测试硬约束 #3「禁静默降级、兜底须留痕或显式暴露错误」
的精神相悖：用户拿到零可行动信息，也不知道去「网络自检」看。

**处置建议**：`status=0` 分支给可行动文案（如「网络不可达，点击重试」+ 直达网络自检入口），
而非裸「未知错误」。

### GAP-3　（澄清项，非缺陷）推荐页无纵向滚动

推荐页是横向轮播，纵向手势本无预期行为。**不是缺口**，但走查方法上需注意：
判「推荐页不滚动」为缺陷前，必须先横向验证 —— 本轮最初差点误报（见 §4）。

---

## 3. 未覆盖 / 明确不做

- **OAuth 授权流**：本轮只走 refresh_token 粘贴路径（票面允许二选一）。
- **动图（Ugoira）播放**：走查中未遇到动图作品，未验证取帧与播放。
  「动图播放 / Ugoira 动图取帧方式」设置项存在且可读，但**行为未验**。
- **WebDAV 备份 / 分享 / 下载导出 / 通知 / 追更 / 稍后看**：入口存在，未逐项走查。
- **release 构建**：需 keystore 密码，本轮只验 debug 包。**release 的 R8/minify 路径未覆盖**。

---

## 4. 本轮排除的 3 个假阳性（重要，避免下一轮重踩）

| 一度以为 | 实际 | 判据 |
|---|---|---|
| 「推荐 Feed 列表不滚动」 | 推荐是**横向轮播**，纵向无预期行为 | 横滑一次即推进到下一件作品 |
| 「插画列表不滚动」 | 滚动了，18 条 scroll 事件 | 瀑布流真列表上纵向滑动正常，日志有 `notifyStateChange` |
| 「插画列表报未知错误 = 持久缺陷」 | **瞬态 DNS 失败**，重进即恢复 | 网络自检页 `[失败] DNS 解析`；两次复现均自愈 |

> 方法论：手势类结论必须配 logcat 佐证（`LynxView dispatchTouchEvent` /
> `HandleTouchEvent tag:<id>` / `notifyStateChange`），并做**阳性对照**——
> 先证明「已知能滚的页面（详情页）确实产生 scroll 事件」，再判定「疑似不滚的页面
> 是否真的没产生」。否则无法区分「页面坏了」与「我测错了页面」。

---

## 5. 复现要点

```bash
# 构建（沙盒 worktree）
cd /path/to/Pictelio-lynx-only
ANDROID_HOME=~/Library/Android/sdk pnpm build:android

# 装到模拟器
~/Library/Android/sdk/emulator/emulator -avd pictelio_low -no-snapshot-load &
adb install -r packages/app/android/app/build/outputs/apk/debug/app-debug.apk

# 查存储（红线核对；只看键名，勿打印值）
adb shell run-as io.pictelio.app ls shared_prefs/
adb shell run-as io.pictelio.app cat shared_prefs/CapacitorStorage.xml
```

**注意**：`adb shell input text` **无法输入中日韩字符**（`%s` 是空格转义，不是 unicode）；
中文关键词需用 ADBKeyboard 或改走 UI 手工输入。英文关键词可直接输入。
