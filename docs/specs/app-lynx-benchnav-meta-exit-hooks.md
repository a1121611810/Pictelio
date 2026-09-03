# Spec: benchNav 测试钩子扩展（/update、/error 直达）—— 启用系统返回回归 S6

> 背景：ADR-0138 迁移遗留项（ticket #334 关闭评论）——回归脚本 S6（`/update`、`/error` meta-exit 场景）需产品补 benchNav 测试钩子后启用。术语：`docs/adr/glossary-vue-router-migration.md`「benchNav / 真机导航钩子（ADR-0136）」与 `packages/app-lynx/CONTEXT.md`「真机导航钩子」词条。

## Problem Statement

回归脚本 `packages/app-lynx/scripts/lynx-router-back-regression.sh` 的 S6 场景需要进入 `/update`（强制更新页）与 `/error`（会话失效错误页）验证「返回键直接退出应用」（`meta.backBehavior:'exit'`）；但这两个页面无外部触发通道（版本检查依赖真实 GitHub release、会话失效依赖真实 401 链），只能依赖 debug 专用导航钩子 benchNav（ADR-0136）。当前钩子缺两个目标，且 full 包存在 extras 转发断层（MainActivity launcher 路径裸 `new Intent`，`--es benchNav` 参数被丢弃），导致 S6 无法执行。

## Solution

扩展 benchNav 钩子：原生事件映射加 `update`/`error` 两 case、JS 侧 TARGETS 加 `/update`、`/error` 两路由、修复 full 包冷启动路径的 extras 转发（一行）。钩子仍受既有双重门禁（原生 `BuildConfig.DEBUG` + JS `__BENCH_NAV__`），生产零影响；回归脚本 S6 前置检测（bundle 含钩子标记）已写好，钩子存在即自动执行。

## User Stories

1. 作为验证者，我希望 `adb shell am start --es benchNav update -n io.pictelio.app/.MainActivity` 能直达强制更新页，以便验证该页返回键直接退出（meta-exit）
2. 作为验证者，我希望 `--es benchNav error` 能直达会话失效错误页，以便验证该页返回键直接退出
3. 作为验证者，我希望 full 包（MainActivity→LynxActivity 分发）也能收到 benchNav 参数，以便主安装包可跑 S6
4. 作为验证者，我希望回归脚本 S6 在钩子存在时自动执行、无钩子时保持 SKIP，以便套装可复跑不被破坏
5. 作为用户（生产），我希望钩子绝不影响生产包（双重门禁下 release 零代码残留），以便安全边界不变

## Implementation Decisions

- **D1 事件命名**（沿既有惯例）：

  | 场景 | 原生 case | 事件名 | JS 目标 |
  |---|---|---|---|
  | 强制更新页 | `update` | `pictelioBenchNavUpdate` | `/update` |
  | 会话错误页 | `error` | `pictelioBenchNavError` | `/error` |

- **D2 修复范围（冷启动路径）**：`MainActivity`（full 包）lynx 分支启动 `LynxActivity` 前 `putExtras(getIntent())` 转发 benchNav 参数——仅冷启动链路（回归脚本 S6 固定 force-stop 后冷启动直达，覆盖所需路径）；restart/已运行实例的 onNewIntent 转发不做（无使用场景）。
- **D3 门禁不变**：原生 `BuildConfig.DEBUG` 包裹 + JS `__BENCH_NAV__`；生产 bundle 验证无 `pictelioBenchNav*` 字符串。
- **D4 回归脚本零改动**：S6 前置（`bundle_has_benchnav` + 场景逻辑）本分支已具备，钩子到位即自动执行；S6 断言：直达 `/update`（/error）→ 返回键 → 焦点=launcher。

## Testing Decisions

- **Seam 1 — 原生模拟器 S6 实跑**（唯一门禁）：`BENCH_NAV=1` 构建 lynx bundle + assembleDebug（debug 包 BuildConfig.DEBUG=true）→ sync → 安装 → `S1=0 S2=0 S3=0 S4=0 S5=0 S6=1 SKIP_INSTALL=1` 跑回归脚本 → S6 PASS（update 与 error 两目标）。
- **Seam 2 — 生产零残留**：默认（无 BENCH_NAV）构建 → `unzip -p APK assets/main.lynx.bundle | strings | grep pictelioBenchNav` 无命中（复用脚本 `bundle_has_benchnav` 逻辑）。
- **Seam 3 — 现有套件不回归**：`pnpm test:app-lynx`（JS 侧仅 TARGETS 两行增补）全绿；S1-S5 已有 PASS 记录，本轮不重跑（避免 S5 破坏登录态）。

## Out of Scope

- 已运行实例的 onNewIntent benchNav 转发（无场景）
- 页面级 benchNav 监听新增（update/error 无子 tab 逻辑，路由级直达足够）
- 钩子的产品化（保持 adb 测试通道形态）

## Further Notes

- 涉及文件：`LynxActivity.java`（switch +2 case）、`MainActivity.java`（putExtras 一行）、`router.ts`（TARGETS +2）。
- 完成后提交（Conventional Commits）、推送、合并 main（与 ADR-0138 迁移同收尾方式），ticket 关闭并在 #334 遗留项回应。
