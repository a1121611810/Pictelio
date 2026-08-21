# 账号级内容设置（R18/R18G）跨 client 同步 + 移除年龄门 —— 功能规格

> 来源：grill-with-docs / domain-modeling 会话（Q1-Q5 逐项拍板，方案评审通过）；ADR-0103
> 状态：ready-for-agent

## Problem Statement

R18/R18G 开关在 webview 与 lynx 两 client 各存各的、互不同步：

| client | 持久化介质 | 键 | 账号维度 | 真机持久化 |
|---|---|---|---|---|
| webview | SharedPreferences "CapacitorStorage" | `show_r18` / `show_r18g` | 否 | 是 |
| lynx | IndexedDB KV | `settings_show_r18` / `settings_show_r18g` | 否 | **否**（原生 LynxView 无 IndexedDB） |

用户实测：webview 开了 R18，lynx 还是关的，反之亦然。且开关不随账号走（换账号继承上一个账号的状态）。目标：**两 client 开关同步 + 从账号维度持久化**。同时**移除年龄确认功能**（`age_confirmed`/`is_adult`/年龄确认页/`requireAdult` 拦截）。

## Solution

### 账号级设置 + 共享存储契约

- 键：`show_r18_${uid}` / `show_r18g_${uid}`（下划线，跟随 registry `defineFactory` 约定）
- 介质：SharedPreferences "CapacitorStorage"（与 `pictelio_client_kind` 同文件）
- 同步机制：**读时同步**——引擎切换是 Activity 级重启（CLEAR_TASK），任意时刻仅一个 client 存活；启动/登录后读共享存储即完成同步，无实时广播

### 数据流

```
【webview 启动】__root: hydrateAll → initializeAuth（user()?.id 就绪）
  → settingsStore.loadAccountR18(): r18Factory.forId(uid).hydrate()
      （registry 读 show_r18_${uid}；缺省时查 legacy "show_r18" → 播种 → 先写新键成功再删旧键）
  → showR18()/showR18G() 信号就绪 → 各 feed 的 r18Filter 响应式生效

【webview 切换】setShowR18(true) → forId(uid).set(true)（write-gate 后落盘）
  → dispatch r18Changed/r18gChanged → UserIllusts 重取、列表响应式重过滤

【引擎切换】Activity 重启 → 另一 client 走自己的加载路径读同一文件

【登出】user() 变 null → showR18() accessor 键控 uid 返回 default false；不写盘

【lynx 启动】initRouter: restoreToken（currentUser.id 就绪）→ loadSettings(uid)
  → NativePrefsAdapter 读 show_r18_${uid}（dev: IdbKVAdapter）→ refs
【lynx 切换】setShowR18 → 写同一键
【lynx 登出】watch(currentUser) → refs 重置默认
```

### 状态变化

| 状态 | showR18() 值 |
|---|---|
| 未登录（uid null） | default false |
| 登录账号 A（已 hydrate） | A 的持久化值 |
| 登录账号 A（未 hydrate / 无记录） | default false |
| 登出后 | default false（A 的 handle 残留 LRU 但不可见、不落盘） |
| 换账号 B | B 的 handle 独立，hydrate 后为 B 的值 |

### 边界条件

- 老键存在 + 账号键缺失 → 播种 + 删老键（**先写新键成功再删**，防数据丢失）
- 老键缺失 → no-op（迁移幂等：删老键后二次加载不再触发）
- 存储读失败 → registry 内置 `report` 走 console.warn + 回退 default（静默降级规则）
- lynx native legacy=`["show_r18","show_r18g"]`；lynx dev legacy=`["settings_show_r18","settings_show_r18g"]`（参数化）
- 并发写不存在（单 client 存活）；迁移幂等
- 换账号各自独立值，互不污染

## User Stories

1. 作为用户，我在 webview 打开 R18 开关后切换到 lynx，Me 页开关保持打开状态，以便两个引擎设置一致。
2. 作为用户，我在 lynx 关闭 R18G 后切回 webview，设置页开关保持关闭，以便两个引擎设置一致。
3. 作为用户，我退出账号 A 登录账号 B，R18/R18G 恢复为 B 自己的设置（默认关），以便设置跟随账号而非设备。
4. 作为用户，我升级 App 后首次登录，原有 R18/R18G 开关状态保留，以便升级不丢失偏好。
5. 作为用户，我登录 lynx 原生真机后设置 R18/R18G，重启 App 后设置保留，以便设置真正持久化（修复当前每次启动重置）。
6. 作为用户，我不再被要求年龄确认，冷启动直接进入登录页/首页，以便流程精简。
7. 作为用户，我在未登录状态下打开 App，不看到任何 R18 内容开关的残留状态，以便不泄露上一个账号的偏好。

## Implementation Decisions

### T1 Native：PictelioPrefsModule（新模块）

- `prefsGet(key, cb)` / `prefsSet(key, value, cb)` / `prefsRemove(key, cb)`，读写 "CapacitorStorage"，回调契约对齐 `PictelioAppModule`（`cb(err)` 风格）
- 注册于 `LynxActivity`（对齐 PictelioApiModule 等注册方式）
- 通用 KV（非 R18 专用），供未来其他设置跨端同步复用
- 独立文件 `PictelioPrefsModule.java`，不塞进 `PictelioAppModule`（职责单一：client 切换 vs 共享设置桥）

### T2 webview：settingsStore 账号级改造

- `show_r18`/`show_r18g` 从 `settings.define` 改为 `settings.defineFactory<boolean>({ keyPrefix: "show_r18", default: false, legacyKeys: ["show_r18"] })`（同理 r18g）
- uid 依赖 `authStore.user()?.id`（accessor；确认无循环依赖后直接 import）
- 导出 API 不变：`showR18()/setShowR18()/showR18G()/setShowR18G()` + `r18Changed`/`r18gChanged` 事件
- 新导出 `loadAccountR18()`：`uid()` 非空时 `Promise.all([r18.forId(uid).hydrate(), r18g.forId(uid).hydrate()])`
- 编排点：`__root` 在 `initializeAuth()` 成功后调用；每个登录成功分支调用（Login.tsx / PKCE 路径）
- 登出无需显式代码（accessor 键控 uid）
- 涉及 `r18Filter.ts` 等 18+ 消费方零改动（API 不变）

### T3 webview：移除年龄功能

- 删除路由 `/age-confirmation` + `AgeConfirmation.tsx`
- `__root.tsx`：删除 `!ageConfirmed()` 跳转分支（启动时序简化为 hydrate → auth 恢复 → home/login）
- `settingsStore`：删除 `ageConfirmed/isAdult/setAgeConfirmation/applyAgeRestriction` 与键 `age_confirmed`/`is_adult`；孤儿键清理（迁移代码一次 remove）
- `SettingsContent.tsx`：删除 `requireAdult` 拦截与"重新确认年龄"行
- 相关测试更新/删除

### T4 lynx：settingsStore 账号级 + PrefsStorage seam

- 新增 seam `PrefsStorage { get/set/remove }`，双 adapter：
  - `NativePrefsAdapter`（包 `NativeModules.PictelioPrefs`）→ 原生产品面
  - `IdbKVAdapter`（现有 idbKV）→ web-core dev
- 键 `show_r18_${uid}` / `show_r18g_${uid}`；迁移参数化（native legacy vs dev legacy）
- `initRouter`：`loadSettings` 移到 `restoreToken` 之后（uid 已知）；登出 `watch(currentUser)` 重置 refs
- 导出 API 不变：`showR18/showR18G ref` + `setShowR18/setShowR18G` + `isRestricted`
- `Me.vue` 开关零改动（消费导出 API）

### T5 契约 E2E

- 扩展 client-kind-contract 模式：webview 设置页开 R18 → 切引擎 → lynx Me 页断言开关状态一致（真实 SharedPreferences 断言）
- 反向：lynx 关 R18G → 切回 webview → 设置页断言

## Testing Decisions

- **app settingsStore**（`tests/unit/stores/settingsStore.test.ts`）：登录后 hydrate 值正确（mock Preferences）/ 未登录返回默认 / 登出返回默认 / 换账号独立值 / 迁移播种 + 删老键 / 存储失败 warn + 默认。期望值 oracle：ADR-0103 契约（键格式、迁移语义）
- **lynx settingsStore**（`packages/app-lynx/src/stores/settingsStore.test.ts`）：native adapter 路径（mock PictelioPrefs）/ dev adapter 路径（mock idbKV）/ 两环境 legacy 键差异
- **PictelioPrefsModule**（JVM，对齐 `PictelioAppTest` 等）：读/写/删/错误回调契约
- **契约 E2E**：真实 SharedPreferences 断言（防自洽 mock；oracle = 跨 client 端到端行为）
- 迁移测试的 mock 数据来自真实旧键格式（`show_r18` 字面量，从源码常量提取，非手写自洽）
- 所有 IO 边界（存储读/写失败）必须有失败路径测试 + console.warn

## Out of Scope

- 其他设置的账号化（布局、画质等）——仅建立契约与 Native 桥，不迁移
- lynx IndexedDB 旧值（`settings_show_r18` dev 环境）的跨环境迁移——仅 dev 预览面，不迁移（native 真机本就不持久）
- Pixiv 服务端 R18 账号设置（不调用服务端 API）
- 屏蔽列表（blockStore）的账号化
- 翻译设置（translateR18/translateR18G）的账号化

## Further Notes

- ADR-0103（决策全文）；glossary 更新：packages/app/CONTEXT.md「设置同步」（账号级设置 / 共享设置存储）
- 契约测试先例：`client-kind-contract` E2E spec（webview/lynx 双端真实存储断言）
- 测试硬约束：#1 IO 边界双路径、#2 真实样例、#4 重构行为不变（键名/默认值改动需契约测试同步）、#6 oracle 溯源
