# 原型：图片交付 copy 可否去掉（2026-10-04）

> **THROWAWAY / 一次性原型，不进 main。** 保留目的：让探针代码与原始 log 可复现、可审计。
> 关联 issue #924。

## 它回答的问题

`PictelioImageService` 每次交付图片都给引擎一份**全量像素拷贝**
（`bitmap.copy(ARGB_8888, false)`）。#147 用它防「引擎回收所收 Bitmap 导致二次显示空白」。
**这份 copy 能否去掉（或换成 bitmap 池）？**

## 结论：可行（在本测量配置下），且**池化不必要**

| 观测 | copy 模式（现状） | direct 模式（无拷贝） |
|---|---|---|
| 交付次数 | 85 | 100 |
| **`recycled=true`（引擎回收了交付物）** | **0** | **0** |
| `same=true`（交付的就是缓存原实例） | 0（设计如此） | **100 / 100** |
| REDELIVER 二次显示成功 | 全部 | **全部**（`sameAsFirst=true sameAsCached=true`） |
| REDELIVER 失败 | 0 | **0** |
| `图片加载失败` 日志 | 0 | **0** |

**两次合计 185 次交付、1.5s / 5s 两个观察窗，`recycled` 一次都没发生过。**
direct 模式下引擎直接持有缓存原实例 100 次，二次显示照样正常、拿到同一实例、零失败。
⇒ **#147 防的那个现象在本配置下没有发生；copy 是一份纯开销。**

## 收益是算术，不是测出来的差值

每张图省下**一份 `width × height × 4` 字节**的拷贝：

- 600×800 缩略图 ≈ **1.9MB/张**
- 1200px 级 master ≈ **5.8MB/张**

⚠️ **两次整页运行的内存对比不可用**：detail 页渐进加载，两次首屏交付数不同（19 vs 14），
整页 Native Heap 差（88.0MB vs 75.8MB）里混了「多加载了 5 张图」的成分。
按 5 张 ≈ 12.2MB 反推约 2.4MB/张，与拷贝尺寸量级一致，但这只是佐证，**结论不依赖该对比**。

## 复现方式

```bash
# 前置（全部实测就绪）
#   宿主代理 7897 在跑；packages/app-lynx/.env 有 PIXIV_REFRESH_TOKEN
#   emulator-5554 = pictelio_ui（API 34，e2e harness 绑定的复现环境）

BENCH_NAV=1 pnpm build:android-host          # 深链钩子随 bundle 注入
adb -s emulator-5554 install -r -g packages/android-host/android/app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5554 shell settings put global http_proxy 10.0.2.2:7897
# 登录（dev intent hook，BuildConfig.DEBUG 门禁）
adb -s emulator-5554 shell am start -n io.pictelio.app/.LynxActivity --es pictelio_dev_refresh_token "$TOKEN"
# 深链直达详情页（#542 通道）
adb -s emulator-5554 shell am start -n io.pictelio.app/.LynxActivity \
    --es benchNav illust-detail --es benchNavIllustId 149179678
# 读探针
adb -s emulator-5554 logcat -d -s PICO_IMG:I
```

`PictelioImageService.java.proto` 是探针版源码，`PROTO_MODE` 常量在 `copy` / `direct` 间切换
（copy 在 miss 与 hit 两处都要切，本文件已改好两处）。

## ⚠️ 这个结论**不能**推翻 #147

本次覆盖不到的：

| 未覆盖 | 为什么重要 |
|---|---|
| **真机** | 全程 API 34 模拟器。#147 原文也写「模拟器实测」，但未记引擎版本 |
| **master 大图** | 实测全是 600px 级缩略图（`decodeSampled` 的 `MAX_DECODE_DIMENSION=2048` 之前就降了）。大图内存压力路径不同 |
| **更长观察窗** | 只看 1.5s / 5s。若引擎是「滚动出屏后才 recycle」，这个窗抓不到 |
| **引擎版本** | Lynx 4.0.1。#147 若在更早版本复现过，行为可能已变 |

⇒ **合并前必须在真机 + master 大图 + 长观察窗复测。**
但如果复测通过，改动面就是**删掉两处 `copy()`**，风险极低。

## 附带发现（顺手记一下）

1. `ImageMemoryCache` **有** 64MB 上限（`MAX_BYTES`，LRU + 线程安全）。e2e spec
   `lynx-detail-image-probe.spec.ts` 决策树里写的「ImageMemoryCache 无上界审计」**已过期**。
2. e2e spec 里「master1200 解码 + copy ≈16MB/张」的估算，与本次实测的 600px 缩略图
   （1–2MB/张）不符——该估算可能针对另一条尺寸路径。
