# app-lynx 翻译 Android 模拟器验证（2026-09-20，PR #657 后）

**设备**：`emulator-5554`（AVD `pictelio_ui`，Apple Silicon）
**构建**：`BENCH_NAV=1 NODE_ENV=production` + `assembleLynxDebug`（APK 57MB，14:35 产出）
**Endpoint**：真实 DeepSeek（`https://api.deepseek.com` / `deepseek-flash`）
**被测章节**：`chapter=25434593`（「烈焰与刀锋：夜赛道的交易（欧美风）」，**R-18G 内容**）
**工具**：`packages/app/tests/android-e2e/tools/verify-translation.sh`

---

## 核心结论：`#654` 修复在真机实测生效 ✅

真机 logcat 逐块时序（chunked pipeline，native 侧 `concurrency: 1` 串行）：

| 时刻 | 块 | Java 侧判定 | 说明 |
|---|---|---|---|
| 14:35:59 | `input=51` | `terminal=false hasText=false` → **报空流失败** | DeepSeek 对该块零输出 |
| 14:36:10 | `input=25` | `terminal=false hasText=false` → **报空流失败** | 同上 |
| 14:36:14 | `input=22` | `terminal=true hasText=true queued=324` | ✅ 译文交付 |
| 14:36:17 | `input=28` | `terminal=true hasText=true queued=358` | ✅ |
| 14:36:20 | `input=19` | `terminal=true hasText=true queued=348` | ✅ |

**这恰是 #654 要修的行为**：修复前，DeepSeek 返回 HTTP 200 + `response.completed`（自带空 `delta_all` 帧）会让空块被判 `done`，写进缓存并把状态推进 `completed` —— 用户看到「翻译成功却没译文」。修复后 `hasText=false` 触发空流失败分支，UI 显示 `服务端未返回译文：内容可能被内容策略拦截`（截图 `e2e-final.png` 实证）。

风险窗口前后对比：

| | 修复前 | 修复后 |
|---|---|---|
| R-18G 块被内容策略拦截 | 静默 `done` → 写缓存 → UI「✓ 翻译完成」但正文空白 | 报 `content_filter` → UI 显示「服务端未返回译文」+ 可重试 |

---

## 新发现（真机证据，需后续 ticket）

### F1：R-18G 章节会被**逐块**拒绝，产生「部分块成功 / 部分块空流」

实测 5 块中 2 块空流、3 块成功。这意味着：
- `status` 应收敛到 **`partial`**（有 ≥1 段译文），而非 `failed`。
- 未译块应显示 `〔未翻译〕` 占位（ADR-0178 D4 / commit `85467a6a`）—— 本次截图未验证到该占位（截图时刻 UI 仍显示原文）。

**影响**：issue #651 范围补充里的「partial 段落标记」正是为此场景设计；本次真机证据把它的**实际触发概率**从假设提升为实测高频（2/5 块）。

### F2：DeepSeek 对 R-18G 的拒绝形态 = HTTP 200 + 推理帧 + 零 `output_text`

日志显示 `queued=237` / `queued=2413` —— 帧数很多但 `hasText=false`，说明 DeepSeek 持续输出 reasoning 内容却不产出译文段。这与 `spec §11` 的「内容策略拒答」形态一致，但帧量巨大（2413 帧）值得注意：轮询侧需能承受这个量级而不阻塞 UI。

---

## 附录：原始 logcat 摘录

```
14:35:53 I PictelioTranslateModule: translateStream 入口 baseURL=https://api.deepseek.com model=deepseek-flash input=51 abortToken=true
14:35:53 I PictelioTranslateModule: translateStream HTTP 200 开始读流 bodyBytes=-1 stream=true
14:35:59 I PictelioTranslateModule: SSE 流结束 terminal=false hasText=false queued=237
14:35:59 W PictelioTranslateModule: SSE 流结束但未产出任何译文段 → 报空流失败
14:35:59 I PictelioTranslateModule: SSE 流就绪待拉取 streamId=smu9g02rd-1 frames=237 terminal=LLM 未返回任何译文（可能被服务端内容策略拦截）
14:35:59 I PictelioTranslateModule: 事件总线交付 frames=238
...
14:36:14 I PictelioTranslateModule: SSE 流结束 terminal=true hasText=true queued=324
14:36:14 I PictelioTranslateModule: SSE 流就绪待拉取 streamId=smu9g0gz0-3 frames=324 terminal=done
14:36:14 I PictelioTranslateModule: 事件总线交付 frames=325
```

`stream=true` 字段出现在日志里 —— 这是本 PR 新增的诊断字段（`translateStream HTTP ... 开始读流 ... stream=`），**证明 P1 改动未破坏流式路径**（默认仍为 true）。

---

## 未覆盖的验证项（诚实清单）

| 步 | 状态 | 原因 |
|---|---|---|
| Step 1 Keystore 持久化 | 未验 | 脚本每次启动重新播种 dev hook；结构上无法证明持久化（#645 已指出） |
| Step 2 流式增量渲染 | 部分 | 只证「译文交付」（`hasText=true` + frames 交付），未证逐字渐显 |
| Step 3 原文/译文切换 <50ms | 未验 | 需人工点击 + 计时 |
| Step 4 model 切换 namespace | 未验 | 需改配置后重译 |
| Step 5 OpenRouter partial probe | 未验 | 需切 endpoint 到 OpenRouter |
| Step 6 R18 闸门 | 部分 | 截图显示 R-18G 章节可进入且发出请求（说明闸门放行），未验「关闭后 disabled」 |
| Step 7 章节切换 generation-gate | 未验 | 需人工计时切换 |
| F1 partial 占位渲染 | 未验 | 见上 |

---

## 复现命令

```bash
# 1. 启动模拟器
~/Library/Android/sdk/emulator/emulator -avd pictelio_ui -no-snapshot-load -no-boot-anim
# 2. 等 boot
adb -s emulator-5554 shell getprop sys.boot_completed   # 期望 1
# 3. 跑验证（构建 + 安装 + mock + 导航 + 点击 + 取证）
bash packages/app/tests/android-e2e/tools/verify-translation.sh
# 4. 看结果
adb logcat -d | grep -E "translateStream|SSE 流结束|hasText"
```

截图：`/tmp/pictelio-e2e/e2e-final.png`（含 `服务端未返回译文：内容可能被内容策略拦截` 文案）

---

## 关联

- PR #657（本验证对应的实现）
- `#654`（空流闸门修复 —— 本验证的核心对象，真机确认生效）
- issue #651（partial 段落标记 —— F1 证据支持其必要性）
- issue #640（step 7 设备取证 —— 本文档为其收口材料之一）
- ADR-0170（callback 通道不可靠）+ ADR-0178 D1/D4