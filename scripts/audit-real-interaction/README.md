# 交互回归脚本（run_regression.mjs）

一条命令复跑真实交互六场景（冷启动/进详情/系统返回/tab 切换/滚动/查看器），逐帧量化并按判定线出 pass/fail——「实际报告」前后对比数据生成器 + 防纸面化复发的验收门禁（地图 #361 / FT-5 #368）。

## 用法

```bash
# 前提：模拟器/设备已连接，webview flavor debug APK 已装且已登录
node scripts/audit-real-interaction/run_regression.mjs                # 全场景
node scripts/audit-real-interaction/run_regression.mjs --scenes coldstart,back   # 子集
node scripts/audit-real-interaction/run_regression.mjs --serial <serial>         # 指定设备
node scripts/audit-real-interaction/run_regression.mjs --compare <旧summary.json> # 前后对比表
```

产出：`scripts/audit-real-interaction/regression-out/<时间戳>/`（每场景 mp4/screencap 帧 + frames.json + summary.json/summary.md）。

## 前提与自检

- **flavor**：必须 webview flavor（launcher=`.MainActivityWebview`）——脚本自检 launcher，误装 full/lynx flavor 会报错退出（versionName 不可用于判别）。
- **登录态**：未登录先试 `cdp_login.mjs`；pm clear 后 CDP 设值不触发 SolidJS 信号（按钮恒 disabled），脚本自动降级 **adb input text 真实键入**（token 取 `packages/app/.env`）。
- **APK 构建**：`pnpm build:android` → 装 `android/app/build/outputs/apk/webview/debug/app-webview-debug.apk`。

## 判定线（出处 = 各 FT 修复票验收线 + 体检报告）

| 场景 | 指标 | 判定线 | 出处 |
|---|---|---|---|
| 冷启动 | 最长完全静止段 | <1000ms | FT-2（#365）验收线 |
| 冷启动 | WaitTime/TotalTime/chrome/首图 | 仅记录 | 网络支配，不设回归线 |
| 进详情 | 骨架帧 / 可交互帧 | ≤1100 / ≤2000ms | 体检报告场景 2 |
| 系统返回 | 响应 max / 过渡帧 max / 方差 | ≤400ms / ≥1 帧 / <100ms | FT-1A（#364）验收线 |
| tab 切换 | 响应 / 空白窗 | ≤1100ms / =0 | 体检场景 4 / FT-3（#366）验收线 |
| 滚动 | delta p90 / >200ms 停滞 | ≤34ms / =0 | 体检报告场景 5 |
| 查看器 | 开启占位 / 翻页释放→新页 | ≤200ms / ≤500ms | 体检场景 6 / FT-4（#367）验收线 |

## 已知坑（全部实测踩过）

- **screenrecord 编码器静默失效**：产出 3232B 空文件或 ffmpeg 不可解的损坏 mp4（force-stop 后高发）→ 脚本自动降级 screencap 轮询（~350ms 粒度，读数相应变粗）整场景重跑。
- **flavor 误装**：`.MainActivity` = full（双引擎）/`.MainActivityWebview` = webview——重装后必须核对 launcher。
- **登出竞态**：`install -r` + 冷启可触发 refresh token 轮换竞态登出（四轮报告已知）→ 冷启动场景前置预检，/login 则 adb 键入重登后重测；back 场景详情图未就绪的 rep 直接跳过（保证 rep 间可比，防方差污染）。
- **模拟器对 Pixiv 连接卡死**：`adb reboot` 后重跑（重启后需重新核对登录态与 flavor）。
- **低对比度动效不可用灰度 diff 判冻结**（#366 教训）：skeleton 阶段的静止判定应结合骨架元素存在性（本脚本 tabs 场景的空白窗判定即为此口径）。
