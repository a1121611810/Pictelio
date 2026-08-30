# R8 反射收缩启动崩溃 — 术语表

> 范围：Release 构建经 R8 收缩后，**反射实例化面**上的类成员被剥离导致的**启动闪退**；涉及 `androidx.startup` 启动初始化、`work-runtime`、Room 生成类、keep 规则语义与防漂移守护。配套 ADR：[ADR-0124-r8-keep-room-generated-constructor.md](./ADR-0124-r8-keep-room-generated-constructor.md)。
> 原型证据：分支 `prototype/ota-r8-fix-a`（A 方案）、`prototype/ota-r8-fix-b-workruntime`（B 方案）、`prototype/ota-r8-fix-c-manual-init`（C 方案），各自 `PROTOTYPE-EVIDENCE.md`。

## 核心术语

| 术语 | 定义 |
|------|------|
| **启动闪退（Launch flash-crash）** | 点击应用图标后进程在**启动屏出现前**即死亡、瞬间退回桌面的故障形态。区别于 JS 白屏/错误页：进程真的终止，通常源于 `ContentProvider`/`Application.onCreate`/`Activity.onCreate` 中的未捕获原生异常（本仓库案例为 `androidx.startup.InitializationProvider` 启动即抛 `RuntimeException`）。 |
| **启动初始化 Provider（Startup Initialization Provider）** | `androidx.startup.InitializationProvider`：随依赖 manifest 合并进入应用的 `ContentProvider`，**进程启动即执行 `onCreate()`**（早于 `Application`/`Activity`/启动屏），通过反射实例化 `meta-data` 登记的各个 `Initializer`。work-runtime 2.10 起用它做 WorkManager 的默认初始化。 |
| **WorkManager 初始化器（WorkManagerInitializer）** | 上述 Provider 登记的 `Initializer`（`androidx.work.WorkManagerInitializer`）：`create()` 内调用 `WorkManager.getInstance(context)`，触发 Room 数据库 `WorkDatabase` 的打开。在 v4.22.0 崩溃链中它是「Provider → Room 反射」之间的必经环节。 |
| **Room 生成类（Room-generated `*_Impl` class）** | Room 编译期为 `@Database` 抽象类生成的实现类（如 `androidx.work.impl.WorkDatabase_Impl`），**由 Room 运行时用 `Class.forName("<db>_Impl").getDeclaredConstructor().newInstance()` 反射实例化**（模拟器 dex 实证）。R8 静态分析看不到该反射调用，可能剥离其成员（见「keep 语义」）。 |
| **反射实例化面（Reflection instantiation surface）** | 运行时通过 `Class.forName`/`getDeclaredConstructor`/`newInstance` 等字符串驱动反射创建对象的代码面（Room 数据库实现、Lynx `$$PropsSetter`、Capacitor 插件发现、`androidx.startup` Initializer）。R8 无法追踪字符串引用，**该面上的类与成员必须由 keep 规则显式声明**，否则优化可将其收缩为「类名在、成员无」的残骸（`NoSuchMethodException: <init> []`）。 |
| **keep 规则 / 成员规格（Keep rule / member spec）** | ProGuard/R8 规则语法：`-keep class X` **无成员规格时只保类名不保成员**（本仓库已在 ADR-0064 Lynx `$$PropsSetter` 教训中固化该语义）；要保住反射所需的构造器，必须给规格：`-keep class X { <init>(); }`（或 `-keepclasseswithmembers`）。「类残骸」故障 = keep 规则缺成员规格的典型症状。 |
| **keep 规则防漂移（Keep-rule anti-drift check）** | 守护测试（如 `proguardRulesConsistency.test.ts`）：从会被反射实例化的真实依赖面（work-runtime/Room）提取事实常量，与 `proguard-rules.pro` 实际内容比对，任一方漂移即红灯——防止「规则注释与规则本体脱节」或「依赖升级后人没同步规则」的静默回归（参照 `backupRulesConsistency.test.ts` 模式，测试硬约束 2）。 |
| **依赖巧合修复（Coincidental dependency fix）** | 修复效果依赖「某个依赖版本的 consumer 规则恰好覆盖目标类」的隐式事实（原型 B：work-runtime 2.11.2 经由传递 `room-runtime` 规则恰好保住构造器）。脆弱性：AGP/R8/Room 任一版本变动就可能复现崩溃，且无显式声明可审计。选型上劣于显式 keep 规则（原型 A）。 |
| **资源名混淆（Resource name obfuscation）** | Release 构建对**无 R 引用**的资源做文件名混淆/裁剪（APK 内 `res/raw/upgrade.html` 消失、名称变短）：代码中 `file:///android_res/raw/upgrade.html` 以字符串字面量引用资源时不可见，Release 包上该路径 `ERR_FILE_NOT_FOUND`（Debug 正常）。同一「字符串引用被优化断开」故障族，另案处理。 |

## 故障链速查（v4.22.0 实证）

```
点击图标 → 进程启动 → InitializationProvider.onCreate
  → 反射 new WorkManagerInitializer → WorkManager.getInstance()
  → Room 打开 WorkDatabase → Class.forName("...WorkDatabase_Impl")
  → getDeclaredConstructor() → NoSuchMethodException: <init> []
  → Provider 启动异常 → 进程秒死（启动闪退，模拟器 API 28 覆盖升级必现）
```

## 排查用词对照

| 场景说法 | 准确术语 |
|----------|---------|
| "启动就崩" | 启动闪退（进程级死亡，先于启动屏） |
| "R8 把类删了" | R8 收缩了**反射实例化面**上的成员（类名常仍在，成员被剥离→类残骸） |
| "加个 keep 就好" | 补充带**成员规格**的 keep 规则（无规格的 `-keep class X` 不保成员） |
| "升级依赖修了" | 依赖巧合修复（显式声明 vs 隐式巧合，选型时需说明） |
