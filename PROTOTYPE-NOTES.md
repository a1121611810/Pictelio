# PROTOTYPE — 方案 A：R8 keep 规则（throwaway）

> 一次性原型，验证后不合并，答案记入实现 issue。

**问题**：v4.22.0 Release 包点击图标瞬闪退（androidx.startup → WorkManagerInitializer → Room 反射 NoSuchMethodException `<init> []`）。

**变体**：`packages/app/android/app/proguard-rules.pro` 增加 Room 生成类 keep 规则（含 `<init>()` 成员规格），不改任何业务代码与依赖。

**验证方式**：`./gradlew :app:packageFullRelease` → dex 检查 `WorkDatabase_Impl` 无参构造器存活 → 临时密钥签名 → API 28 模拟器安装启动 → 进程存活。
