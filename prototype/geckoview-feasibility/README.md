# GeckoView 可行性原型（throwaway）

**问题**：GeckoView（Mozilla Gecko 引擎）能否替代 Capacitor + System WebView 成为 Pictelio 的新客户端引擎？

**结论**：见 `docs/research/geckoview-client-feasibility.md`（分支 `prototype/geckoview-feasibility`）。
本目录是回答该问题的一次性原型，**不进主构建、不合入 main**。

## 组成

- `android-proto/` — 独立 Gradle 工程（`io.pictelio.geckoproto`）：
  - GeckoView 155.0.20260903215306（arm64）宿主 + 内嵌 HTTP 网关（127.0.0.1:18080，
    逐字对齐 Vite dev proxy 契约 `/pixiv-img` `/pixiv-api` `/pixiv-oauth` …）
  - pixiv 流量走无 SNI 钉定 IP 通道（搬运主工程 DirectAccessTransport 已验证机制，
    IP 来源 `DirectIpTableDefaults` 探针实测值）；DNS 污染下带 SNI 直连被注入伪响应（实测 404）
  - 内置 WebExtension：JS↔Java 消息桥（native messaging）+ webRequest Referer 注入 PoC
    + 生命周期打点 + 自动登录 + ping/fps/api 探针
  - `assets/public/` — 主工程 SPA bundle（NODE_ENV=development 构建，保留 web 登录链路）
- `scripts/`
  - `fetch-geckoview.sh` — 手动拉 AAR 进工程内 local-maven（Gradle 直连 maven.mozilla.org
    大文件下载失败；含 minCompileSdk 37→36 原型补丁，理由见报告）
  - `build-web-bundle.sh` — 构建 SPA bundle 并拷入 assets
  - `bench-proto.sh` / `bench-baseline.sh` / `cdp_eval.py` — 模拟器基准与基线对比

## 复跑

```bash
bash scripts/fetch-geckoview.sh
bash scripts/build-web-bundle.sh
cd android-proto && ./gradlew :app:assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n io.pictelio.geckoproto/.MainActivity --es refresh_token '<token>'
```
