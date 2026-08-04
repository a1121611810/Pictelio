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
