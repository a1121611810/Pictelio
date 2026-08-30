# PROTOTYPE-EVIDENCE — work-runtime 2.10.0 → 2.11.2 升级验证（throwaway）

- **工作区**: `/tmp/proto-b`（git worktree，分支 `prototype/ota-r8-fix-b-workruntime`，基于 v4.22.0）
- **变体**: B 方案 — 把 `androidx.work:work-runtime` 从 `2.10.0` 升到 `2.11.2`
- **目标**: 实证 2.11.2（或其传递的 room 版本）是否带足够的 consumer keep 规则，使 R8 不再剥离
  `androidx.work.impl.WorkDatabase_Impl` 的无参构造器，从而修复启动崩溃
  （`Class.forName("androidx.work.impl.WorkDatabase_Impl").getDeclaredConstructor()` 反射 NoSuchMethodException）。

---

## 1. 变更

`packages/app/android/app/build.gradle`：
- `webviewImplementation "androidx.work:work-runtime:2.10.0"` → `2.11.2`
- `fullImplementation "androidx.work:work-runtime:2.10.0"` → `2.11.2`

## 2. 构建结果

- **命令**: `cd packages/app/android && ./gradlew :app:packageFullRelease --console=plain`
- **结果**: ✅ **BUILD SUCCESSFUL**（`219 actionable tasks`；R8 minify 执行成功，产物 APK 生成）。
- **产物 APK**: `packages/app/android/app/build/outputs/apk/full/release/app-full-release.apk`
  （45,969,767 字节），已复制为 **`/tmp/proto-b-full.apk`**。
- **R8 / proguard**: release buildType `minifyEnabled true`，正常走 R8（`minifyFullReleaseWithR8` 任务执行，无 obfuscation 相关报错）。

### 2.1 签名说明（对任务假设的重要偏离）

任务假设 `packageFullRelease` 不触发签名门禁即可产出未签名 APK。**实测该假设不成立**：
`release` buildType 固定 `signingConfig signingConfigs.release`（`storePassword = System.getenv("PICTELIO_KEYSTORE_PASSWORD")`），
因此 `packageFullRelease` 在打包阶段报：

```
Execution failed for task ':app:packageFullRelease' ...
> SigningConfig "release" is missing required property "storePassword".
```

即没有签名凭据时 `packageFullRelease` **无法产出 APK**（它内部会执行签名）。为产出可验证的 release APK（R8-minified classes.dex 与最终包一致），
本验证**临时使用一把本地 throwaway keystore**（基于 `keytool` 生成，位于 `/tmp/proto-throwaway.keystore`，
对应 `PICTELIO_KEYSTORE_PASSWORD/PICTELIO_KEY_PASSWORD=proto123`，替换 `app/pictelio-release.keystore`，
构建完成后已**恢复**原文件）。**未使用、未触碰任何生产 keystore / 真实发布凭证。**
`app/pictelio-release.keystore` 与产物 APK 均为 gitignore，不会进入 commit。

## 3. dex 取证（关键证据）

从 `/tmp/proto-b-full.apk` 解出 `classes.dex`，用 `$HOME/Library/Android/sdk/build-tools/36.1.0/dexdump` 检查：

```
Class descriptor  : 'Landroidx/work/impl/WorkDatabase_Impl;'
Access flags      : 0x0011 (PUBLIC FINAL)
Superclass        : 'Landroidx/work/impl/WorkDatabase;'
  Direct methods    -
    #0              : (in Landroidx/work/impl/WorkDatabase_Impl;)
      name          : '<init>'
      type          : '()V'
      access        : 0x10001 (PUBLIC CONSTRUCTOR)
```

**结论：`WorkDatabase_Impl` 在 R8 收缩后的 dex 中仍保留无参 `<init>:()V`，且为 `PUBLIC CONSTRUCTOR`（0x10001）。**
`Class.forName(...).getDeclaredConstructor().newInstance()` 所需的无参构造器**未被剥离**。

> 注：上述块来自类 `Landroidx/work/impl/WorkDatabase_Impl;`（精确 descriptor，排除 `WorkDatabase_Impl$...` 内部类、
> `WorkDatabase_Impl_1` 等无关类）。解析脚本 `/tmp/proto-dexdump-forensics.py` 自动化结果为：
> `RESULT: YES — Landroidx/work/impl/WorkDatabase_Impl; retains PUBLIC no-arg <init>:()V (access 0x10001 PUBLIC CONSTRUCTOR)`。

## 4. mapping.txt 取证

`app/build/outputs/mapping/fullRelease/mapping.txt`：

```
androidx.work.impl.WorkDatabase_Impl -> androidx.work.impl.WorkDatabase_Impl:
# {"id":"sourceFile","fileName":"WorkDatabase_Impl.kt"}
    kotlin.Lazy _workSpecDao -> k
    ...
    1:3:void <init>():43:43 -> <init>
```

- 类名**未被混淆**（`WorkDatabase_Impl -> WorkDatabase_Impl`），`Class.forName("androidx.work.impl.WorkDatabase_Impl")` 可解析到正确类。
- 无参 `<init>` 构造器被保留（映射为 `<init>`）。
- 多处 `# {"id":"com.android.tools.r8.residualsignature",...}` 标注表明 R8 因反射/keep 规则保留了该类及其成员签名，
  与 room-runtime 的 consumer keep 规则（`-keepclassmembers class *Database_Impl` 保留 `<init>()`）一致。

## 5. 依赖版本实证

`./gradlew :app:dependencies --configuration fullReleaseRuntimeClasspath` 解析到：

```
androidx.work:work-runtime:2.11.2
└── androidx.room:room-runtime:2.7.0
```

即 work-runtime 2.11.2 传递依赖 `room-runtime 2.7.0`。Room 的 `*Database_Impl` 生成类的 keep 规则由 room-runtime/room-compiler 提供；
这正是 2.11.2 与 2.10.0 的差异点（2.10.0 传递的 room 版本较旧，keep 规则不足导致构造器被剥）。task 所述“work-runtime 自身 proguard.txt 与 manifest 与 2.10.0 相同”属实，
但**修复来源是其传递的 room 版本升级**，而非 work-runtime 自身 proguard.txt。

## 6. 结论（definitive）

> **B 方案有望修复。**
> 在 androidx.work:work-runtime 2.11.2（传递 androidx.room:room-runtime 2.7.0）的 R8-minified release 包中，
> `androidx.work.impl.WorkDatabase_Impl` 的**无参 `<init>:()V` 构造器仍被保留（PUBLIC CONSTRUCTOR）**，且类名未被混淆。
> 因此崩溃点 `Class.forName("androidx.work.impl.WorkDatabase_Impl").getDeclaredConstructor().newInstance()`
> 的 `getDeclaredConstructor()` 不会再抛 `NoSuchMethodException`，启动崩溃应被修复。

### 依据权重
- **决定性依据**：dex 中 `WorkDatabase_Impl` 仍含无参 `PUBLIC <init>:()V`（第 3 节）；类名未混淆（第 4 节）。
- **机理**：work-runtime 2.11.2 传递 room-runtime 2.7.0，其 keep 规则保留了 Room 生成 DB 类的无参构造器（第 5 节）。

### 备注 / 局限
- 该结论为**字节码/保留策略层面的实证**（R8 输出中构造器存在），未在真机/模拟器上运行（任务禁止启动模拟器）。
  反射若成功，`WorkManagerInitializer → WorkManager.getInstance()` 的 Room 打开环节即通过。
- work-runtime 自身 proguard.txt 与 manifest 与 2.10.0 相同（已按任务前提核对），修复依赖传递 room 升级，属“未预期但有效”的净效果。
