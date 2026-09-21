# app-lynx 推荐轮播小说滑页收藏入口 + 收藏按钮 chip 配色/尺寸 — 设备与 web-core 验证 — 2026-09-21

**目的**：为票 #707（推荐轮播小说滑页补 ♥）与 spec `docs/specs/bookmark-color.md`（chip 配色方案 E + hug content 尺寸）留下**可复现的探针记录**（code-review 审计「声称但无留痕 = 阻塞」）。
**构建**：`pnpm build:app-lynx` → `node packages/app-lynx/scripts/sync-android-assets.mjs` → `./gradlew :app:assembleLynxDebug --offline` → `adb install -r app-lynx-debug.apk`（58.8 MB，15:49 产出，基于工作区改动）
**设备**：`emulator-5554`（1080×2160 @3x）；客户端 `io.pictelio.app/.LynxActivity`（`pictelio_client_kind=lynx`；**未**传 `pictelio_dev_refresh_token`，沿用设备既有登录态）
**web-core**：`pnpm dev:app-lynx` → `http://127.0.0.1:3003/__web_preview?casename=main.web.bundle`，playwright-cli 视口 400×790 / 1280×720

## 结论

| # | 验证点 | 方法 | 结果 | 截图 |
|---|---|---|---|---|
| 1 | 小说滑页出现 ♥（与插画同槽位同形）+ 「N 字」次行 | 设备滑动到小说滑页（舟渡）截图 | ✅ ♥ **540** chip + 「**5011 字**」在下方次行（用户原始截图里该位置只有字数） | `app-lynx-novel-bookmark-emulator-01-novel-slide.png` |
| 2 | 点 ♥ 不误跳 + 计数双向翻转 | `adb shell input tap 163 1759`（chip 中心）两次 | ✅ 计数 **115 → 116 → 115**；页面全程停在「推荐」（`@tap.stop` 生效）；账号状态**已还原** | `...-02-bookmarked.png` / `...-03-restored.png` |
| 3 | chip 底色取自 M3 token（原生 Lynx 生效） | 截图定点取色（chip 胶囊内 x=240,y=1760） | ✅ 未收藏 = **(46,49,54)** = `--md-inverse-surface #2e3136`；已收藏 = **(59,100,112)** = `--md-tertiary #3b6470` | 同上 |
| 4 | **复合/后代 CSS 选择器在原生生效**（Audit 三 P1-4 的反证） | 同上取色：`.bookmark-chip.is-bookmarked` 换底 + `.bookmark-chip .bookmark-ring-*` 同源 | ✅ 底色随状态切换为 tertiary 精确值 → 复合选择器确实命中（否则底色恒为 inverse-surface） | 同上 |
| 5 | 前景色随状态切换（心形/计数） | 截图取色：未收藏心形 ≈ `#eff1f7`(`--md-inverse-on-surface`)、已收藏心形 = `#ffffff`(`--md-on-tertiary`) | ✅ | 同上 |
| 6 | chip hug content（不再横贯整屏） | web-core 量元素 `getBoundingClientRect` | ✅ 400 视口：chip **93.9px**（父 348.8px）＝内容宽；未修前 1280 视口 **1116px** == 父宽 | `app-lynx-bookmark-chip-webcore-400.png` |

## 未闭环项（明确挂账，不当作已验证）

| 项 | 原因 | 追踪 |
|---|---|---|
| web-core **320** 窄屏档（♥ + 收藏数 + 字数 不与 FAB 冲突） | `PIXIV_REFRESH_TOKEN` 被设备端轮换（Pixiv 刷新令牌单次轮换：web-core 预览与设备端互相踢），预览掉登录态 | 待新 token 后补测 |
| `/v1/novel/recommended` **逐字节真实响应** fixture | 同上 | issue #708 |
| 深色主题逐 palette 目视 | 未做 | `bookmark-color.md` 残余风险 |
| 设备 oracle（`lynx-bookmark-tags.spec.ts` / `lynx-flow-check.sh`）随配色失效 | 颜色判据过期 | issue #709 |

## 复现命令

```bash
# 设备（原生 Lynx）
pnpm build:app-lynx && node packages/app-lynx/scripts/sync-android-assets.mjs
(cd packages/app/android && ./gradlew :app:assembleLynxDebug --offline)
adb install -r packages/app/android/app/build/outputs/apk/lynx/debug/app-lynx-debug.apk
adb logcat -c; adb shell am force-stop io.pictelio.app
adb shell am start -n io.pictelio.app/.LynxActivity          # 不要传 dev refresh token（会覆盖设备登录态）
adb shell input swipe 950 700 100 700 200                     # 在图片区横滑；重复直到 scrim 出现「N 字」（小说滑页）
adb exec-out screencap -p > /tmp/lynx.png                     # 取色：chip 胶囊内 (240,1760)
adb shell input tap 163 1759                                  # 点 ♥（chip 中心）；再点一次还原

# web-core（预览需可用登录态）
pnpm dev:app-lynx   # → http://127.0.0.1:<port>/__web_preview?casename=main.web.bundle
```
