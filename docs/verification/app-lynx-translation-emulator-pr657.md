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
| Step 1 Keystore 持久化 | **✅ 已补齐**（见下节） | — |
| Step 2 流式增量渲染 | **✅ 已查清：实装中不存在**（见下节 —— 票面断言与实装不一致，需裁定） | — |
| Step 3 原文/译文切换 <50ms + 长按重译 | **✅ 已查清**（见下节：长按入口未实装、切换耗时无法外部测量） | — |
| Step 4 model 切换 namespace | **✅ 已补齐**（见下节；并查出 #641 缓存真机失效的真缺陷） | — |
| Step 5 OpenRouter partial probe | 未验 | 需切 endpoint 到 OpenRouter |
| Step 6 R18 闸门 | **✅ 已补齐**（见下节；并发现两处 UI 缺陷，已修） | — |
| Step 7 章节切换 generation-gate | **✅ 实现面已验 + 发现并修复真缺陷**（见下节） | — |
| F1 partial 占位渲染 | 未验 | 见上 |

---

## Step 6 补齐：R18 闸门「关闭授权 → 点击不发请求」

#640 的收口修订指出既有报告证的是**相反方向**（授权开启态）。本轮按票面要求验「**关闭**后」：

```bash
# 1. 关掉 R18G 翻译授权（改 prefs；设备 sed 不支持 -i → pull/改/push）
adb shell am force-stop io.pictelio.app
adb shell run-as io.pictelio.app cat shared_prefs/CapacitorStorage.xml > /tmp/cap.xml
# 把 settings_translate_r18g_<uid> 从 true 改为 false，push 回去
# 2. 清 logcat 后深链到 R-18G 章节
adb logcat -c
adb shell am start -n io.pictelio.app/io.pictelio.app.LynxActivity \
  --es benchNav novel-detail --es benchNavNovelId 25434593
# 3. 点击「翻译本章」
adb shell input touchscreen tap 539 962
```

**结果**（核心断言成立）：

```
15:24:22 W lynx: "[novelTranslateStore] R18 gate blocked x_restrict=2 chapter=25434593"
$ adb logcat -d | grep -c "translateStream 入口"
0                                    ← 点击**未发起任何请求**（正文零外发）
```

即票面要求的「点击不发起请求」✅ 成立。

### 但同时暴露两处 UI 缺陷（已修，PR #663）

| # | 缺陷 | 位置 | 后果 |
|---|---|---|---|
| 1 | `disabled` 只判 `R18_BLOCKED`，**漏 `R18G_BLOCKED`** | `TranslateButton.vue:77-80` | 未授权 R-18G 章节点击后 store 已正确拦截，但按钮**视觉上仍可点** |
| 2 | 错误文案只在 `failed` / `partial` 时渲染，`aborted` 被排除 | `NovelDetail.vue:225` | 授权拦截的提示**根本不显示**（store 置的是 `aborted`） |

两者叠加 = 用户点击后**界面毫无反应**（静默 no-op）。截图 `step6-r18g-blocked.png` 实证：拦截发生后按钮仍为蓝色可点态、无任何提示文案。

**修复**（`TranslateButton` 的 disabled 纳入 `R18G_BLOCKED`；`NovelDetail.errorText` 对 `aborted + R18*_BLOCKED` 显示对应文案）+ 源码断言测试（`TranslateButton.template.test.ts`）+ 变异实验（撤掉 R18G 判断 → 必红）。

---

## Step 4 补齐：model 切换 → 缓存 namespace 隔离（并查出 #641 真机失效）

用本地 mock SSE（`MOCK_SLOW_MS` 默认）+ 同一 R-18G 章节做**对照实验**（mock 无内容策略 → 5 块全部成功 → `completed` → 写缓存）：

| Phase | model | `cacheMiss` | `translateStream 入口` | 判定 |
|---|---|---|---|---|
| 1 | `mock-A`（首次，缓存空） | 1 | 5 | 走 provider（预期） |
| 2 | `mock-A`（重跑） | **0** | **0** | ✅ **缓存命中，零 provider 调用** |
| 3 | `mock-B`（改 model） | **1** | **5** | ✅ **namespace 失效，重新翻译** |

缓存目录实测落盘：
```
$ adb shell run-as io.pictelio.app ls -la cache/pictelio_translate_cache/
-rw------- 4ead87fc5c5939ed59c555dfa9765a3d4c13a195070e1dd0361b448fba4e1f68.json   (53085 B)
-rw------- manifest.json                                                          (118 B)
```
（sha256 命名的条目 + LRU manifest，与 ADR-0175 §D1/D2/D3 一致）

### 过程中查出的真缺陷：#641 缓存**真机完全失效**

Phase 1/2/3 首轮全部 `cacheMiss`，日志暴露根因：

```
[translationCache] IndexedDB 不可用（native runtime）→ 翻译缓存停用，本章不读写缓存
[translationCache] IDB unavailable, skip write || {key: "25434593:…:mock-B:acee5f…"}
```

即 `isFilesystemTranslationCacheAvailable()` 在真机返回 **false** → 回落到 IDB → 原生无 IDB → 缓存整体停用。

**根因**：`filesystemTranslationCache.ts` 的 `nativeModule()` 只读 `globalThis.NativeModules`。
这条「只读 globalThis」是为了绕开 happy-dom 把 `NativeModules` 定义成空对象遮蔽注入 —— 但**真机 PrimJS 走的是裸 `NativeModules` 通道**（`nativeTranslate.ts` 用双通道探测，工作正常）。于是：

- 真机：裸通道有模块、`globalThis` 没有 → 只读 globalThis → **判不可用** → 缓存停用
- 测试：mock 注入到 `globalThis.NativeModules` → **恰好命中实现读的那个通道** → 19/19 全绿

这是典型的「两侧自洽 mock 互相掩盖」——**33 条测试（14 Robolectric + 19 vitest）全绿，功能在真机 0% 生效**。

**修复**：改为「**逐通道找模块本体**」（裸通道优先，其次 globalThis），与 `nativeTranslate.ts` 同形。补 2 条用例守「空容器不误判」（早期失败模式）；并注明「进程内无法分离两个通道 → 真机走裸通道这条只能由设备取证」。

**修复后真机复验**：`IDB unavailable` 计数 **0**；缓存目录出现条目；Phase 2 命中、Phase 3 失效（上表）。

### 教训（值得沉淀）

ADR-0175 的「双通道探测」被 `nativeTranslate.ts` 与 `tokenStorage` 正确实现，但本模块为了迁就测试环境的遮蔽问题**改成了单通道** —— 测试全绿掩盖了真机失效。**探测逻辑不允许为测试环境妥协**：要么两个通道都试（本修复），要么在测试里同时提供两个通道。

---

## Step 2 查清：「段落增量渲染」在实装中**不存在**（票面断言与实装不一致）

票面 step 2 的断言是「**段落增量渲染**（可视化截图记录）」。用慢速 mock（`MOCK_SLOW_MS=300`，51 段/chunk）逐秒采样：

| 采样点 | `SSE 流结束` | 事件总线交付 | UI 实际状态 |
|---|---|---|---|
| t≈5s | 0 | 0 | 原文 |
| t≈10s | 0 | 0 | 原文 |
| **t≈20s** | **1** | **1** | **按钮「35%翻译中」+ 正文仍是原文** |
| t≈35s | 1 | 1 | 同上 |
| t≈50s | 2 | 2 | 同上 |

截图 `step2-20s-progress-only.png` 实证：**进度条在走（35%），但正文一个字都没变**。

### 根因（代码级）

| 事实 | 位置 |
|---|---|
| `showTranslation` 只在**终态**（completed / partial / cache-hit / fallback 成功）置 `true` | `novelTranslateStore.ts:705 / 950 / 969 / 1094` |
| delta 处理器只更新 `translatedParagraphs[abs]` 与 `progress`，**不调用 `refreshDisplay()`** | 同文件 delta 分支（`:847+`） |
| `refreshDisplay` 的渲染源 = `showTranslation && translatedParagraphs.length > 0 ? 译文 : 原文` | `:378-390` |

⇒ 翻译期间 `showTranslation === false` → `displayParagraphs` **恒等于原文切片** → 用户看到的是「原文 + 按钮上的百分比」，译文在**结束时整章切换**。

### 附带发现：渐进粒度上限 = chunk 级（架构约束）

`TranslationSseParser.emitConsolidated` 的注释与 ADR-0170 记录：lynx NativeModule **一次流只可靠投递一帧**（逐帧直发 / 加间隔 / 主线程派发 / 合并单帧四种策略实测均只收到 0-1 帧），故整块译文被打包成一帧 `delta_all`。因此即便是「渐进」，粒度也只会是 **chunk 级**（本章 5 块 → 5 次出现），不可能是逐段 / 逐字。

### 结论与建议

- 票面断言「段落增量渲染」**当前不成立**，且不是 bug —— 是「进度用百分比、内容终态切换」的设计选择 + 单帧交付的架构约束共同决定的。
- 若要真做渐进显示：delta 分支首次收到 delta 时置 `showTranslation=true` + `refreshDisplay()`（约 3 行）。但这是 **UX 产品决策**（会在翻译过程中反复重排正文；lynx 侧每 chunk 重渲染的代价需评估），**不宜由实施方单方变更**。
- 已按 #640 处理 step 6 的先例（措辞与实装不一致 → 改判定）记入本报告，建议票面改判定或另开 feature 票。

---

## Step 3 查清：长按重译入口**未实装**、切换耗时**无法外部测量**

票面 step 3 含两条：「切换 < 50ms」+「**长按** segmented button → 弹「重译」入口」。

### 3a 长按重译入口：未实装（且实装形态更优）

`packages/app-lynx/src/components/TranslateModeSwitch.vue` 只有两个 `@tap`：

```
:39  @tap="pick('original')"
:53  @tap="pick('translation')"
```

全仓 `longpress` 只出现在**文本选择**域（`useTextSelection` / `createTextSelection`），与翻译无关。

**重译入口的实际实装**：在 `TranslateButton`（FAB）的 `retranslate` 态 —— `buttonState` 派生 + `LABEL_KEYS.retranslate`，点击走 `store.retranslate()`（先失效本章缓存再翻）。

⇒ 这是**可见入口 vs 隐藏手势**的取舍：FAB 上的「重译」是常驻可见的，长按手势需要用户发现。属产品决策，建议票面改判定（与 step 6 同先例）。**不是缺陷**。

### 3b 切换 < 50ms：代码路径支持，但**外部无法测量**

代码路径（`novelTranslateStore.toggleMode` → `refreshDisplay`）：
- 同步翻转 `showTranslation` signal
- `refreshDisplay` 只做一次 `map`（把 `translatedParagraphs` 逐段填入 `sourceParagraphs`）—— O(段落数)，无网络、无 IO、无 await
- 渲染由虚拟滚动承担（仅可见段重排）

⇒ 逻辑耗时在微秒量级，**瓶颈只可能在 Lynx 渲染层**。

**为何无法从外部证实 50ms**：本轮的测量手段是 `adb exec-out screencap`，单次截图往返 ~150–300ms，远大于 50ms 的门限 —— 用截图测「是否 < 50ms」在方法上就不成立（测的是截图延迟，不是切换延迟）。

**建议**：若要保留该数值门槛，应改用**可测量的手段**（任选）：
- `screenrecord --bugreport` 逐帧（高 fps 下可到 ~16ms 分辨率）
- 在 `toggleMode` 里打 `Log.i` 时间戳 + 在渲染完成回调里打第二个（Lynx 侧可挂 layout 完成事件）
- instrumented test（Espresso + `IdlingResource`）

本报告**不主张**该条已通过 —— 只能说代码路径不含可解释 50ms+ 的同步开销。

---

## Step 1 补齐：Keystore 持久化（用 prefs 直读证明）

#640 的收口修订指出：既有报告走的是 dev hook 播种，`verify-translation.sh:47-49` 每次启动都重新播种，
**结构上无法证明持久化**。本轮改用「force-stop → 重启 → 直读 SharedPreferences」证明：

```bash
adb logcat -c
adb shell am force-stop io.pictelio.app
adb shell am start -n io.pictelio.app/io.pictelio.app.LynxActivity
# 重启后直接读落盘状态（debug 构建允许 run-as）
adb shell run-as io.pictelio.app cat shared_prefs/WSSecureStorageSharedPreferences.xml
adb shell run-as io.pictelio.app cat shared_prefs/CapacitorStorage.xml
```

**结果（重启后仍在）**：

| 键 | 文件 | 性质 |
|---|---|---|
| `capacitor-storage_translate_llm_api_key` | `WSSecureStorageSharedPreferences.xml` | **加密**（Keystore 支持）—— 证明密钥层持久化 |
| `capacitor-storage_refresh_token` | 同上 | 加密 —— 证明 auth 恢复路径未被破坏 |
| `llm_endpoint_base_url` = `https://api.deepseek.com` | `CapacitorStorage.xml` | 非密元数据 |
| `llm_endpoint_model` = `deepseek-flash` | 同上 | 非密元数据 |

**结论**：Step 1 的核心断言（「杀掉 app 重启 → endpoint 仍在」）**成立**，密钥层与非密元数据层均存活。
（未覆盖：设置页「✓ 已保存」内联提示的截图 —— 那需要 UI 交互。）

---

## Step 7 补齐：章节切换发现并修复真缺陷

#640 的收口修订把 step 7 标为「零取证 且 前提不成立」。前提问题（#649：`abortHandle` 从不赋值
→ `abortStream` 不可达）已由 #653（`6e1ad678`）修复，并有设备取证
（`docs/verification/app-lynx-translation-emulator-abort.md`：`abortStream 取消: smu97dwp2-1`）。

本轮补查**章节切换这条触发路径**，发现 `novelTranslateStore.reset()`（`NovelDetail.vue` 的
`watch(novelId)` 在切章节时调用）**既不 abort、也不 bump `gen`**，而 spec §7.2 转移表末行明确要求
「任何 | chapter switch | idle | **abort() if in-flight**; reset state」。三个后果：

1. 旧章节请求继续跑（白烧 token 到自然结束 / 轮询超时）；
2. 旧请求 settle 时越过 generation-gate → **旧章节译文写进新章节的 `displayParagraphs`**（跨章节污染）；
3. `status` 被旧结果推成 `completed` / `failed`，覆盖新章节状态。

**修复**：`reset()` 补 `activeController?.abort()` + `gen += 1`。
**验证**：新增用例（挂起 iterator + 可 abort signal 造确定 in-flight 窗口）；变异实验「退回只清状态」
→ 该用例必红（实测）；vitest 1805/1805；vue-tsc exit 0。已提 PR #660。

---

## 关联

- PR #657（实现）/ PR #660（step 7 缺陷修复）
- `#654`（空流闸门 —— 真机确认生效）
- `#640` step 1 / step 7（本报告补齐两项）
- issue #651（partial 段落标记 —— F1 证据支持必要性）
- ADR-0170（callback 通道不可靠）+ ADR-0178 D1/D4

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