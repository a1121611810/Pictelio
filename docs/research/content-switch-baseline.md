# 内容切换等待剖面基线（地图 #371 / 基线票 #372）

- 日期：2026-09-06；测量脚本 `scripts/audit-real-interaction/switch_baseline.mjs`（原始数据 `regression-out/switch_baseline_20260905-173207/`）
- 用户主诉：内容切换即时性差，「看起来是等待数据加载完才切换过去的」，需求是立即切过去

## 环境

| 项 | 值 |
|---|---|
| 设备 | emulator-5554 `pictelio_ui` AVD，**已改参为 OPPO R11S 口径**（1080×2160 @ 480dpi，dpr=3，WebView 视口 360×672 CSS px） |
| WebView | 113.0.5672.136（系统镜像自带；**与真机 R11S 的 138.0.7204.179 有代差**，真机复测待做） |
| APK | 4.32.0 webview debug（内容 ≡ main HEAD `0fc1d2d1`，4.33.0 仅版本号 bump）；4.33.0 已另装但会话失效未能复测 |
| 口径 | DOM 元素存在性（`illust-card` / `novel-card` / `skeleton-shimmer`），CDP `Runtime.evaluate` 轮询 ~110ms；settle = UI 签名相对 tap 前变化 + 2s 稳定 |

## 结论速览（对照主诉）

1. **缓存回访不慢**：已访问 tab（持久化恢复/会话缓存）切换 **85-350ms 内容直现、零骨架、零空白窗**。慢的不是「切换」，是「无数据时的网络等待」。
2. **插画↔小说切换不慢**：92/97ms 直现（novel feed 同样被 feedQueryPersist 覆盖）。
3. **冷启动后切 tab 无恢复窗口**（本机）：shell 就绪（~2s）时持久化恢复已完成，+0ms/+3000ms 两档均 ~90ms 直现。M 系 host 上 4.5MB JSON.parse 亚秒级；**低端机（骁龙 660 真机）此窗口预期放大，待真机复测**。
4. **主诉成立的口径**：
   - **真首访（无缓存）**：骨架持续到网络返回——ri-366 实测 **5-9s（网络支配）**；本轮 fresh 复测因 .env token 失效被阻塞（见坑账 #6）。
   - **装着 <4.32.0 的旧版本**：无 feedQueryPersist，每会话每个 tab 的首访都是网络等待。若用户手机装的是旧包，体感完全吻合主诉。
   - **更新弹窗吞交互**（附带发现）：装机版本 < 远端 release 时，冷启 ~5s 后 StartupUpdateDialog 弹出，**模态遮罩吞掉一切 tap**——本轮测量三连吞 tap 的真凶。产品问题：自动弹全屏模态打断交互。

## 数据（switch_baseline_20260905-173207，4.32.0）

### warm（冷启→就绪→静置 6s→关更新弹窗→切换）

| 切换 | rep | 响应ms | 骨架 | 内容就绪ms | 空白窗ms | 备注 |
|---|---|---|---|---|---|---|
| 推荐→关注 | 1 | 91 | 无 | 91 | 0 | tap_retries=2；本轮唯一异常：切到关注后 ~0.8s 内容区短暂空→~1.2s 回到推荐→重试回关注（一次未复现，待查项） |
| 关注→收藏 | 1 | 87 | 无 | 87 | 0 | |
| 收藏→推荐 | 1 | 342 | 无 | 342 | 0 | 162 卡重建（无虚拟化全量 remount） |
| 推荐→关注 | 2 | 103 | 无 | 103 | 0 | 纯 remount 口径 |

### toggle（ContentTypeToggle）

| 切换 | 响应ms | 骨架 | 内容就绪ms |
|---|---|---|---|
| illust→novel | 92 | 无 | 92 |
| novel→illust | 97 | 无 | 97 |

### coldearly（冷启动 shell 就绪后 +0ms / +3000ms 切关注）

| 档 | shell 就绪 | 内容就绪ms | 骨架 |
|---|---|---|---|
| +0ms | 1880ms | 87 | 无 |
| +3000ms | 2329ms | 98 | 无 |

### fresh（pm clear 真首访）——未完成

`.env` refresh_token 已被轮换失效（Pixiv refresh token 一次一换；实测 app 自身报 `OAuth failed (HTTP 400): Invalid refresh token`），pm clear 后无法自动重登。**引用 ri-366 报告的等价口径**：首访切换骨架即现、内容就绪 ~5-9s（当日网络支配）。复测需新 token 后重跑 `--phases fresh`。

## 坑账（全部实测，已固化进脚本注释）

1. **硬编码 tap 坐标跨分辨率全废**：旧 720p 口径坐标在 DPR≠1 视口打偏（tap 落按钮间隙，切换静默失败、settle 误判稳定）。修复 = `navCoords()` CDP 读 rect × DPR。
2. **WebView 控件有状态栏 inset**：网页 CSS(0,0) ≠ 屏幕(0,0)（实测 bounds [0,72][1080,2088]）。修复 = `viewportOrigin()` uiautomator 标定，`screen = origin + css×DPR`。
3. **更新弹窗吞 tap**：见结论 4。修复 = 测量前 `dismissUpdateDialog()`（「稍后再说」DOM 定位）+ 重试分支先关弹窗再补 tap；根治 = 装与远端同版本的包。
4. **settle 判据必须要求「签名相对 tap 前变化」**：否则旧面板被误判为已稳定，观察窗提前终止（coldearly r2 三连误判的教训）。
5. **登录按钮选择器**：`includes("登录")` 会命中 DOM 序靠前的「通过 Pixiv 登录」（PKCE 按钮）拉起 OAuth 网页流——必须精确匹配 `trim() === "登录"`。
6. **`.env` refresh_token 已失效**：Pixiv refresh token 一次一换（参考 gallery-dl/PixivUtil2 社区观察）；多次登录尝试相互作废。**阻塞 fresh 复测，需用户重新提供 token**；顺带 secure storage 会话亦随轮换竞态登出（#368 已知坑）。
7. pm clear 后 `cdp_login.mjs` 的 CDP 设值不触发 SolidJS 信号（#368 已知）→ `loginViaAdbInput` 走 adb 真实键入 + filled 校验。

## 对选型票（#375）的输入

- 优化主杠杆=**首访等待**（预取 / 空闲 ensureLoaded），不是回访（已 85-350ms）。
- keep-alive 的收益上界 = 回访 remount 的 ~90-340ms × 低端机放大系数；必须配卡片级上限（见 #373 事实：renderer native 堆无上限 + 首页 feed 无虚拟化全量渲染）。
- 预取落点：冷启动恢复窗口本机 <2.5s 已关闭，真机若放大，预取优先服务「恢复完成前切换」与「无持久缓存首访」两类场景。
