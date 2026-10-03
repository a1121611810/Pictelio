# 原型：Pictelio 冷启动 / splash / IFR 时机测量（2026-10-04）

> **THROWAWAY / 一次性原型。** 本分支不进 main。保留目的仅是让当时的
> 探针代码与原始数据可复现、可审计。main 分支只保留已验证的决策
> （见 `docs/app-lynx` 分支的文档修正）。

## 它回答了什么问题

| # | 问题 | 裁决 |
|---|---|---|
| 1 | Android 启动屏那个 app 图标能否去掉（既然开了 IFR 首帧直出） | **不能**。Android 12+ 平台强制启动屏且不可 opt-out；API 28–30 由 AndroidX `core-splashscreen` 复刻同样行为。两条路径均在模拟器上实测确认。 |
| 2 | 「IFR 首帧一出就关 splash」是否可行 | **不可行，且方向反了**。实测 12/12：`onLoadSuccess`（当前退出点）比首帧**绘制完成**早 83–121ms。`onFirstScreen` 不是首帧信号（API 34 上比真实首帧晚 79–255ms）。 |
| 3 | splash 撤走到内容上屏之间的裸窗口（83–121ms）能否修 | **不可修**。首帧要等的正是绘制本身，而 splash 恰好挡住那次绘制。押到首帧再撤 = 死锁（实测 10,085ms / 10,041ms，只被 10s 加载超时兜底解开）。原实现即最优。 |
| 4 | 2MB bundle 在主线程读取（`PictelioTemplateProvider`）是否是瓶颈 | **是真实开销但不在关键路径**。6/6 样本 `thread=main`、17–55ms；改成后台预读后该步降到 0ms，但端到端 API 34 持平、API 28 慢 79ms ⇒ **负收益，已回滚**。 |
| 5 | IFR 是净赚还是净赔 | **代理指标下净负，但不可据此改开关**。见下方「不可越界的三点」。 |

## 测量环境

| | API 34 `pictelio_ui` | API 28 `pictelio_low` |
|---|---|---|
| 屏幕 / 密度 | 1080×2160 / 480dpi | 720×1280 / 320dpi |
| RAM | 3072M | 2048M |
| 启动 Activity | `io.pictelio.app/.LynxActivity` | 同 |

- 包型：**release**（`build:android-host:release`，R8 开启）。debug 包首帧虚高约 100ms
  （API 34：debug 中位 466ms vs release 中位 366ms）——debug 数据不可用于绝对判断。
- **未登录**，首屏是登录页而非 feed。
- **无真机**（`adb devices` 只有两个模拟器）。项目纪律要求变体验收只在真机算数。

## 探针（三个通道，全部已验证可复现）

1. **原生分段计时** — `LynxActivity.java` 的 `PICO_PROTO` 埋点，
   抓 `onCreate_enter` / `setContentView_done` / `onLoadSuccess` / `lynxView_FIRST_DRAW`。
   `FIRST_DRAW` 用 `ViewTreeObserver.OnDrawListener` 抓，**独立于任何 Lynx 回调**。
2. **bundle 读取计时** — `PictelioTemplateProvider.loadTemplate` 内埋点，
   同时打印线程名（用于证明「在主线程」）。
3. **JS 侧 `LoadBundleEntry`** — `packages/app-lynx/src/index.ts` 顶部
   `lynx.performance.createObserver`，数据经 `PictelioAppModule.__protoLog` 落地
   （release 下 `enableLynxDebug(false)`，`console.log` 到不了 logcat）。

### 通道 3 是死的（重要）

`lynx.performance` 的自有键只有内部 profiling 函数：

```
_emitter, _generatePipelineOptions, _onPipelineStart, _markTiming,
_profileStart, _profileEnd, _profileMark, _profileFlowId,
_isProfileRecording, _bindPipelineIdWithTimingFlag
```

`createObserver` 来自原型、能调用、能 `observe(['pipeline'])` 成功，
但**一条条目都不投递**。与另两个通道同根因：
`LynxView.forceGetPerf()` 返回 `null`、`LynxViewClient.onFirstLoadPerfReady` 从不触发。

⇒ **官方口径的 `LoadBundleEntry` 分段（parse / mtsRender / layout / paint）
在本工具链下取不到**，那 176ms 的 parse+MTS 拆不开。不要假装量到了。

## 关键数据

### release 基线分段（3 次冷启动中位）

| 分段 | API 34 | API 28 |
|---|---|---|
| 进程启动 → `setContentView` | 65ms | 11ms |
| 读 2MB 资产（**主线程**） | 33ms（28–55） | 17ms（10–17） |
| parse + MTS 渲染 | 176ms | 51ms |
| resolve / layout / paint | 85ms | 111ms |
| **首帧** | **366ms** | **191ms** |

行业经验值 release + 中端真机 300–500ms ⇒ **app 本身不算异常慢**。

### bundle 体积（字节计数，免疫漂移）

| | 字节 |
|---|---|
| IFR=on | 2,026,785 |
| IFR=off | 1,043,780 |
| 比值 | **1.94×** |

与 vue-lynx 文档的 ~2.26× 同量级。

### 死锁实验（问题 3 的裁决）

把 splash 退出点后移到首次 draw：

| 模拟器 | `onLoadSuccess` → `FIRST_DRAW_RELEASE` |
|---|---|
| API 34 | **10,085ms** |
| API 28 | **10,041ms** |

间隔 = `LOAD_TIMEOUT_MS = 10_000`。**首帧在 splash 压着时根本不绘制**，
死锁只被 10s 兜底解开 ⇒ 每次启动卡 10 秒再落错误页。**已回滚。**

> 判据教训：「提前解除条件，看下游事件跟不跟」只能证「不更早」，
> 证明「未被挡住」必须**反向再做一次**——把条件延后，看事件还发不发生。
> 提前解除的观测同时兼容 (a) 内容就绪度决定 和 (b) 被 gate 且内容本来就晚，
> 只做前者会把 (b) 误判成 (a)。**兜底会把死锁伪装成「能跑」，这是红旗。**

### IFR 交错 ABBA（5 对，release，埋点一致）

| 对 | IFR=off 首帧 | IFR=on 首帧 | 差 |
|---|---|---|---|
| 1 | 225 | 215 | **−10** |
| 2 | 276 | 390 | +114 |
| 3 | 248 | 453 | +205 |
| 4 | 206 | 420 | +214 |
| 5 | 224 | 420 | +196 |

- OFF 中位 225ms（跨度 70ms）；ON 中位 420ms（跨度 238ms，**双峰**）。
- 配对差中位 **+196ms**，t=3.39/df=4，**p≈0.03**。
- **第 1 对是反的** ⇒ 只跑一对会得出「无效应」。
- 非交错批次曾给出 +147ms / +81ms 两个不同的数，**同配置不同批次漂移达 66ms**，
  与效应量同量级 ⇒ **非交错 A/B 不作数**（本原型最初就是这么错的）。

## 不可越界的三点（为什么不能据此关掉 IFR）

1. 模拟器 ≠ 真机。
2. 未登录，首屏是登录页而非 feed。
3. 「首次 draw」是**绘制完成**时刻，**不等于用户感知的 FCP**——
   vue-lynx 文档衡量的是 FCP，本原型只能测到 draw。

且 `packages/app-lynx/CONTEXT.md` 记有 **2026-09-02 用户在真机确认的视觉改善**。
本原型的数据**与之不冲突**，也不构成关闭依据。

## 未做成的实验

**像素对比**（固定时刻截图比「那一刻有没有内容」，本可免疫漂移）：
**不可行**。`adb exec-out screencap -p` 单帧 1.9s，设备侧 `screencap -p` 1.8s
（原始格式 2.6s）——截图管线本身就 1.8–2.6s，250ms 的时刻抓不到。

## 复现方式

```bash
# 1) 出两个包（埋点一致，仅 IFR 不同）
#    填 enableIFR: false → pnpm build:android-host:release → cp 到 /tmp/pictelifr-OFF.apk
#    填 enableIFR: true  → 同上                      → cp 到 /tmp/pictelifr-ON.apk
# 2) 交错跑（ABBA 抵消顺序效应）
#    probe 脚本见本目录 probe.sh
```

APK 体积对照：OFF 44,223,951 B / ON 44,614,167 B（**+390,216 B**）。
