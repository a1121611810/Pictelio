# ADR-0124: v4.22.0 Release 启动闪退修复 —— R8 keep 规则显式保住 Room 反射实例化面

- 状态：accepted
- 日期：2026-08-30
- 关联：ADR-0037（PixivApiPlugin 网关）、ADR-0122（OTA web bundle 自研切换，OtaPlugin）、ADR-0123（R8 修复先例：`$$PropsSetter` keep，真机 release 白屏）、ADR-0064（Lynx R8 keep 规则先例）、`docs/adr/glossary-r8-reflection-shrink-crash.md`（新建统一术语表）、`docs/specs/ota-web-bundle.md`（OtaPlugin 规格）
- 来源：用户报告「v4.22.0 安装到手机后点击图标直接闪退」。经 diagnosing-bugs 流程（Release 包 API-28 模拟器覆盖升级必现复现 + 完整 logcat + dex/mapping 取证）确认根因；三个修复方案（A keep 规则 / B 升级 work-runtime 2.11.2 / C 移除 Startup Provider 手动初始化）均经**一次性原型**（throwaway 分支 + release 构建 + dex 取证 + 实装验证）验证后按四维度选型。
- 术语：见 `docs/adr/glossary-r8-reflection-shrink-crash.md`（本文档只记录决策，不写代码）。

## 背景

v4.22.0（OTA 里程碑）在 `build.gradle` 引入 `androidx.work:work-runtime:2.10.0`（OTA 慢通道 `OtaWorker`，ADR-0122）。该依赖的 manifest 合并进应用 `androidx.startup.InitializationProvider` —— 一个**进程启动即执行**的 `ContentProvider`（早于 Application/Activity/启动屏），反射实例化 meta-data 登记的 `WorkManagerInitializer`，进而 `WorkManager.getInstance()` 打开 Room 数据库 `WorkDatabase`。

**崩溃链（模拟器 API 28、v4.21.0→v4.22.0 覆盖升级必现；Release 包在任意设备任意启动均崩）**：

```
InitializationProvider.onCreate
 → WorkManagerInitializer.create()                       (androidx.work.WorkManagerInitializer, 第93行)
 → WorkManager.getInstance() → Room 打开 WorkDatabase
 → Class.forName("androidx.work.impl.WorkDatabase_Impl").getDeclaredConstructor().newInstance()
 → NoSuchMethodException: <init> []
 → Provider 启动异常 → 进程秒死（点击图标直接闪退）
```

**根因（dex/mapping 实测）**：R8 收缩后 `WorkDatabase_Impl` 类名保留（Room 自带 consumer 规则 `-keep class * extends androidx.room.RoomDatabase` 只匹配到类），但**无参构造器被剥离**（dex 中该类 `Direct methods` 为空）——R8 看不到 `Class.forName` 字符串反射调用，把"看似无用"的构造器优化掉了。Debug 构建无 R8，故本地开发/调试包全部正常，只有 Release 包崩（与 ADR-0064 `$$PropsSetter` 故障同族：**反射实例化面必须显式 keep，且必须带成员规格**）。

## 三方案原型验证（throwaway，证据见各 `prototype/ota-r8-fix-*` 分支）

| 方案 | 变体 | dex 中 `WorkDatabase_Impl.<init>` | API-28 实装 | 可行性 |
|---|---|---|---|---|
| **A** | `proguard-rules.pro` 加规则：`-keep class * extends androidx.room.RoomDatabase { <init>(); }` + `-keep class androidx.work.impl.WorkDatabase_Impl { <init>(); }` | ✅ 保留 | ✅ 启动存活 | 可行 |
| B | `work-runtime` 2.10.0→2.11.2（webview+full 两处依赖） | ✅ 保留（**依赖巧合**：2.11.2 传递 `room-runtime` 的 consumer 规则恰好覆盖） | ✅ 启动存活 | 可行（脆弱） |
| C | manifest `tools:node="remove"` 移除 `InitializationProvider` + Application 实现 `Configuration.Provider` | ❌ 仍缺失 | 启动存活（崩溃延迟到首次 `WorkManager.getInstance()`，即首次 OTA 预热/门槛判断时） | **不可行** |

> 补充：API-34 模拟器（Trichrome WebView 113）曾出现 V8 OOM → Chromium CHECK SIGTRAP，A/B 变体同现，与变体无关（该 AVD 环境性故障）；所有判定均在 API-28 原始复现环境完成。

## 决策

1. **选型：方案 A（R8 keep 规则）**。按四维度（高可维护性、高性能、高安全性、低内存占用）：
   - 维护性：显式声明反射实例化面，不依赖某版本 consumer 规则的隐式巧合；与 ADR-0064 既有 R8 修复模式一致；B 方案修复效果会随 AGP/R8/room 版本漂移，且 hotfix 引入依赖升级违背最小变更。
   - 性能：A 启动路径零变化；B 增 dex 体积（45.92→45.97MB）与运行时行为需回归。
   - 安全：A 不引入新依赖（供应链面不变），暴露的仅为 Room 内部类名（无敏感信息）；B 引入未验证的新版本依赖面。
   - 内存：A 零额外运行时内存；B 新增类加载与调度器占位。
2. **修复内容**：`packages/app/android/app/proguard-rules.pro` 增加两条带**成员规格**的 keep 规则（`<init>()`），覆盖 Room 数据库生成类反射实例化面；中文注释写明根因链与"无成员规格不保成员"的 R8 语义（ADR-0064 同款注释先例）。
3. **防漂移守护**：新增一致性单测（读取 `proguard-rules.pro` 与 `build.gradle` 中 work-runtime 依赖声明，按测试硬约束 2 的真实常量对照），防"规则被删/依赖消失"静默回归（参照 `backupRulesConsistency.test.ts` 模式）。
4. **回归验证**：Release 构建（R8）后 dex 断言 `WorkDatabase_Impl` 无参构造器存活 + API-28 模拟器覆盖升级实装冒烟（v4.21.0→修复版，进程存活、无 FATAL）；该验证作为发布检查项（`docs/release-checklist.md` 已有 R8 验证节）而非 CI 常驻（CI 无签名环境）。

## 后果

- 发布 v4.22.1 hotfix（v4.22.0 的 full/webview 两个 Release 包对用户全部启动闪退；lynx 包不受影响——无 work-runtime 依赖）。
- `WorkDatabase_Impl` 与匹配 `* extends RoomDatabase` 的类保留原型名（不混淆）——无安全影响（内部类名非机密面）。
- 后续若升级 work-runtime：keep 规则仍生效（规则声明的是反射实例化面而非版本），无需随版本重审；防漂移测试会守护规则-依赖一致性。
- **附带发现（另案处理，不在本修复范围）**：Release 资源优化把 `res/raw/upgrade.html` 裁剪掉了（代码用字符串字面量 `file:///android_res/raw/upgrade.html` 加载，无 R 引用→不可见；Debug 包正常，官方 v4.22.0 Release 包同样缺失）。真实用户 WebView ≥85 不触发该分支；建议后续改用资源 ID 引用或 keep 资源规则修复。

## 相关文档

- 术语表：`docs/adr/glossary-r8-reflection-shrink-crash.md`
- 原型证据（throwaway 分支，未并入 main）：`prototype/ota-r8-fix-a`（`a4b6172`）、`prototype/ota-r8-fix-b-workruntime`（`c8e12b3`）、`prototype/ota-r8-fix-c-manual-init`（`34dbf2e`）
- 规格与工单：issue #261（修复规格）、#262/#263/#264（T1/T2/T3 tickets）
- 关联 ADR：ADR-0064（Lynx `$$PropsSetter` R8 教训）、ADR-0122（OtaPlugin）、ADR-0001（插件 keep 基座）
