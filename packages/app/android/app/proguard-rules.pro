# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# ── Capacitor 插件 keep 规则 ──
# Capacitor 通过 @CapacitorPlugin 注解反射发现插件类。
# R8 全优化模式下会移除未直接引用的类，此规则保留所有带该注解的类。
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }

# ── OkHttp ──
# OkHttp 4.12.0 AAR 内自带 consumer-rules.pro，R8 会自动合并。
# DohDns 通过 new DohDns() 直接实例化，R8 能追踪调用链自动保留。
# 无需额外规则。

# ── Lynx 可选依赖缺失类 ──
# xelement-svg / xelement-markdown 内部静态引用 Fresco 图片库与 Lynx Markdown
# 组件，lynx 主库 LynxEnv 引用 Gson（debug 环境描述）；本项目刻意不引入
# Fresco（自研 ILynxImageService，#54）与 Markdown 组件，这些类仅存在于
# 静态引用路径、运行时不可达（未注册对应 behaviors），Release 构建
# minifyReleaseWithR8 的全量类引用检查会误报 Missing class，故 -dontwarn 抑制。
-dontwarn com.facebook.common.**
-dontwarn com.facebook.datasource.**
-dontwarn com.facebook.drawee.**
-dontwarn com.facebook.imagepipeline.**
-dontwarn com.google.gson.**
-dontwarn com.lynx.markdown.**

# ── Lynx JNI 动态调用 keep（真机 release 实测崩溃，issue #120/#121）──
# lynxbase.so 通过 JNI GetStaticMethodID 按方法名字符串动态查找这两个类的静态方法
#（无 @CalledByNative 注解，R8 无法感知）。混淆后方法名被改写，ART 抛
# "Failed to find staticlog(...)" 直接 SIGABRT（dropbox tombstone 实证，
# 4.2.2 装后连崩 3 次；模拟器 debug 包无混淆故不复现）。
-keep class com.lynx.base.LynxBaseTrace { *; }
-keep class com.lynx.base.log.LynxLog { *; }
# 防御性：PictelioImageService 经 LynxServiceCenter 按接口注册，R8 重命名类名
#（dex 实测仍 implements ILynxImageService，按接口注册不受影响）；
# 保留原名，防 lynx 侧按类名反射的潜在分支。
-keep class io.pictelio.app.PictelioImageService { *; }

# ── Lynx $$PropsSetter / $$PropsHolder keep（真机 release 白屏 error 990200）──
# 根因：Lynx SDK 4.0.1 AAR 内 38 个注解生成类（com.lynx.tasm.behavior.ui.* 与
# shadow.* 下的 UIView$$PropsSetter、TextShadowNode$$PropsSetter 等）由运行时通过
# 反射 Class.newInstance() 实例化，把 JS 侧更新的 UI 属性写入原生节点。
# R8 优化阶段静态分析看不到反射调用链，会移除这些类的无参构造器；真机切换引擎后
# 每帧抛 InstantiationException（lynx 错误码 990200）导致白屏。
#
# 为何 SDK 自带规则不够：
# 1. SDK consumer 规则是 `-keep class * implements Settable / LynxUISetter`，
#    但 $$PropsSetter 走纯继承链、不 implements 这两个接口，匹配不到；
# 2. 即使能匹配到类，R8 语义下 `-keep class X` 只保留类名、不保留成员，
#    无参构造器仍会被优化移除。
# 故需用 -keepclasseswithmembers 连构造器带成员一并保留（未命中成员模式的类不受影响）。
# 注意通配符：`**` 才匹配含包名的完整类名（`*` 不匹配 `.`，匹配不到 com.lynx.tasm 下的类）。
-keepclasseswithmembers class **$$PropsSetter { <init>(); <methods>; }
-keepclasseswithmembers class **$$PropsHolder { <init>(); <methods>; }
