# ADR 0103：账号级内容设置（R18/R18G）跨 client 同步 + 移除年龄门

**状态**：已批准
**日期**：2026-08（grill-with-docs / domain-modeling 会话收敛，方案评审通过）
**决策者**：团队成员
**背景**：R18/R18G 开关在 webview 与 lynx 两 client 各存各的互不同步、且非账号维度；用户要求两 client 开关同步 + 从账号维度持久化，并顺带移除年龄确认功能。

---

## 背景

Pictelio full 包支持 webview / lynx 双 client 切换（ADR-0062/0064）。内容过滤设置（R18/R18G）在两 client 的现状：

| client | 持久化介质 | 键 | 账号维度 | 真机持久化 |
|---|---|---|---|---|
| webview | SharedPreferences "CapacitorStorage"（@capacitor/preferences） | `show_r18` / `show_r18g` | 否（设备级） | 是 |
| lynx | IndexedDB KV（`pictelio_lynx`） | `settings_show_r18` / `settings_show_r18g` | 否 | **否**（原生 LynxView 无 IndexedDB，每次启动重置） |

问题：开关状态两边不同步（用户实测 webview 开了 lynx 还是关的，反之亦然）；且换账号登录会继承上一个账号的开关。

## 决策

### 1. 账号级键 + 共享存储契约

- 键格式：`show_r18_${uid}` / `show_r18g_${uid}`（**下划线**分隔，跟随 settings registry `defineFactory` 的 `${prefix}_${id}` 约定；`uid` 为 Pixiv userId）
- 存储介质：SharedPreferences "CapacitorStorage"（@capacitor/preferences 默认 group，与 `pictelio_client_kind` 同一文件）
- 读时同步：引擎切换是 Activity 级重启（CLEAR_TASK，ADR-0064），任意时刻仅一个 client 存活——**启动/登录后读共享存储即完成同步**，无需实时事件广播

### 2. webview：复用 settings registry 的 defineFactory seam

- `settingsStore` 的 `show_r18`/`show_r18g` 从静态 `settings.define` 改为 `settings.defineFactory<boolean>({ keyPrefix: "show_r18", default: false, legacyKeys: ["show_r18"] })`
- **不绕开 registry**（早前"静态键无法动态化"的判断在核实 `defineFactory` 后作废）：`forId(uid)` 返回完整 `SettingHandle`（codec / validate / hydrate / write-gate / LRU / onChange 全复用）
- 迁移由 registry 内置 `legacyKeys` 语义承载：读新键为空且老键存在 → 播种 → 先写新键成功再删旧键
- 外部 seam 不变：`showR18()/setShowR18()/showR18G()/setShowR18G()` + `r18Changed`/`r18gChanged` 事件（`UserIllusts.tsx` 监听）——18+ 调用点零改动
- uid 依赖：`authStore.user()?.id`（accessor 读取；已确认无循环依赖）
- 登出语义零代码：accessor 键控 uid，登出后 uid 为 null → 返回默认 false；旧账号 handle 残留 LRU 但不可见、不落盘
- hydrate 编排：`__root` 在 `initializeAuth()` 之后 + 每个登录成功分支调用 `forId(uid).hydrate()`

### 3. lynx：新增 PrefsStorage seam + 双 adapter

- `settingsStore` 持久化从 IndexedDB 直连改为 seam 注入：`PrefsStorage { get / set / remove }`
  - `NativePrefsAdapter`（包 `NativeModules.PictelioPrefs`）→ 真实产品面（原生 LynxView）
  - `IdbKVAdapter`（现有 idbKV）→ web-core dev 预览降级（无 NativeModules）
- 键与 webview 同契约：`show_r18_${uid}` / `show_r18g_${uid}`
- 迁移参数化：native 环境 legacy=`["show_r18","show_r18g"]`；dev 环境 legacy=`["settings_show_r18","settings_show_r18g"]`
- 编排：`initRouter` 中 `restoreToken()`（uid 已知）之后 → 迁移 → 加载 → refs

### 4. Native：新增 PictelioPrefsModule

- `prefsGet(key, cb)` / `prefsSet(key, value, cb)` / `prefsRemove(key, cb)`，读写 "CapacitorStorage"，回调契约对齐 `PictelioAppModule`（`cb(err)` 风格）
- 独立模块而非塞进 `PictelioAppModule`：后者职责是 client 切换重启，塞通用 prefs 破坏 locality；新模块内聚"共享设置桥"单一职责
- 通用 KV 而非 R18 专用方法：未来其他设置跨端同步（布局、画质等）直接复用

### 5. 移除年龄确认功能（webview）

- 删除：`/age-confirmation` 路由 + `AgeConfirmation.tsx`、`__root.tsx` 年龄跳转分支、`ageConfirmed`/`isAdult`/`setAgeConfirmation`/`applyAgeRestriction`、`SettingsContent` 的 `requireAdult` 拦截与"重新确认年龄"行
- 孤儿键 `age_confirmed` / `is_adult` 清理删除
- 启动时序简化为：hydrate → auth 恢复 → home/login（冷启动第一屏从年龄确认变为登录页）
- lynx 本无年龄门，无需动
- 残余说明：R18 内容的账号级合规性由 Pixiv 服务端账号权限承载（账号未过成人认证时 API 通常不返回 R18），本地年龄门是第二道闸；移除后第一道闸仍在，风险可控

### 6. 契约测试兜底（不做共享包）

- 遵循 `pictelio_client_kind` 先例（ADR-0062/0064）：双端字面量契约 + 无共享包，靠契约测试强制
- 契约：键格式 `show_r18_${uid}`、介质 "CapacitorStorage"、迁移"播种 → 删老键（先写后删）"
- 测试：app settingsStore 账号级加载/登出/迁移；lynx settingsStore 双 adapter 路径；`PictelioPrefsModule` JVM 单测；**契约 E2E**（client-kind-contract 模式扩展：webview 开 R18 → 切引擎 → lynx Me 页开关一致，断言真实 SharedPreferences）

## Considered Options

- **共享包 `@pictelio/account-settings` vs 双端实现 + 契约测试（选后者）**：webview 侧迁移/存储已被 registry 深度覆盖，共享包要么让 webview 放弃 registry 深度、要么造成迁移算法两份实现（registry 版 + 共享包版）——比现状更糟；clientSwitch 先例证明契约测试可兜底。
- **年龄门账号化 vs 全删（选全删）**：账号化需改启动时序（年龄确认后置到登录后）且 lynx 补页面；用户明确不再需要年龄判断与展示。Pixiv 服务端已有账号级 R18 合规闸，本地年龄门属可移除的第二道闸。
- **冒号键 `show_r18:<uid>` vs 下划线键 `show_r18_${uid}`（选下划线）**：跟随 registry `defineFactory` 的 `${prefix}_${id}` 既定约定（`novel_progress_${id}` 先例），与静态键不冲突（`show_r18` 与 `show_r18_42` 是不同键）。
- **R18 专用 Native 方法 vs 通用 KV 桥（选通用 KV）**：`PictelioPrefsModule` 三方法对任意设置通用，一次实现多次复用；键值来自自有 JS 常量，无用户输入注入面。

## Consequences

- 冷启动第一屏从年龄确认页变为登录页（行为变化，符合"移除年龄功能"决策）。
- 老设备级值只归升级时当前登录账号（播种后删老键）；此后新账号一律默认值（R18/R18G 关）。
- lynx 原生真机的 R18/R18G 设置首次真正持久化（修复"每次启动重置"的隐性 bug）。
- 引擎切换后开关状态一致（修复用户报告的不同步 bug）。
- 未来任何设置要跨 client 同步：沿用本契约（共享存储 + 双端实现 + 契约测试），Native 桥已就绪。
- 术语参见 [glossary 更新](../../packages/app/CONTEXT.md「设置同步」)。

## 关联

- 前序：ADR-0050/0051（lynx 持久化与 IndexedDB）、ADR-0062/0064（client 切换契约）、ADR-0102（full 包路由壳）
- 契约测试模式：`client-kind-contract` E2E spec、测试硬约束 #2（真实样例）/#6（oracle 溯源）
