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
| 7 | **320 窄屏**：♥ + 收藏数 + 字数 不与回顶 FAB 冲突 | web-core 320×790，小说滑页量三元素矩形 | ✅ chip `x20.5 w54`（右 74.4）｜字数 `y736 h22`（左对齐、单行）｜FAB `x258.5 w47.8`（左边缘）→ 水平间距 **184px**，无重叠（字数元素盒宽 = scrim 内容宽，但字形短且左对齐，无视觉碰撞） | `app-lynx-bookmark-chip-webcore-320-novel.png` |
| 8 | **真实响应**钉死字段依赖 | 预览登录后 `run-code` 监听 `page.on('response')` 取 `/v1/novel/recommended` 响应体 | ✅ HTTP 200，原始 body **88,626 字节 / 33 条**，每条均带 `is_bookmarked`/`total_bookmarks`/`text_length`（另发现响应含 `is_muted`/`is_x_restricted`/`restrict`/`visible` 等 `PixivNovel` 未声明字段，应用只消费已声明子集）→ 落 fixture `tests/fixtures/novel-recommended.real.json`（保留 3 条字段逐字、覆盖 `x_restrict` 0/1/2） | — |

## 未闭环项（明确挂账，不当作已验证）

| 项 | 原因 | 追踪 |
|---|---|---|
| 深色主题逐 palette 目视 | 未做 | `bookmark-color.md` 残余风险 |
| 设备 oracle（`lynx-bookmark-tags.spec.ts` / `lynx-flow-check.sh`）随配色失效 | 颜色判据过期 | issue #709 |

> 320 窄屏实测使用** mock 小说优先的 feed**（真实 `/v1/novel/recommended` 被 `playwright-cli route` 换成 2 条真实条目、仅改 `create_date`），原因：时间合并流中小说稀疏、连拖 16 页未命中。被测对象是**版面几何**，数据来源不影响结论；真实数据下的小说滑页已在设备端验证（截图 1）。

## 附：真实响应 fixture 抓取方法（用于重抓）

```bash
pnpm dev:app-lynx                     # 预览需可用登录态
playwright-cli open "http://127.0.0.1:<port>/__web_preview?casename=main.web.bundle"
playwright-cli run-code "async page => { const fs = await import('node:fs'); ... }"   # 注：run-code 无 require/process
# 实际可行做法：run-code 里用 page.on('response') 收集命中 '/novel/recommended' 的响应体，
# 把 response.text() 回传给 CLI（stdout 重定向到文件），再用脚本提取并裁剪入库：
#   playwright-cli run-code "async page => { const hits=[]; page.on('response', async r => { if (/\/novel\/recommended/.test(r.url())) hits.push(await r.text()); }); await page.reload(); await page.waitForTimeout(15000); return hits[0] ?? 'NO_CAPTURE'; }" > /tmp/cap.txt
```

裁剪规则：保留 3 条**完整条目**（字段逐字未改），去掉条数（33→3）与两个应用未消费的顶层键（`ranking_novels` / `privacy_policy`）；测试头注已记录该裁剪。

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
