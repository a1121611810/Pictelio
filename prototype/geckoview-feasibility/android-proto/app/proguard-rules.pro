# GVProto release（throwaway 原型）—— GeckoView AAR 自带 consumer rules，
# 这里只兜底 JNI/JNI 反射引用与缺失告警
-dontwarn javax.annotation.**
-dontwarn org.mozilla.geckoview.**
-keep class org.mozilla.geckoview.** { *; }
-keep class io.pictelio.geckoproto.** { *; }

# snakeyaml：DebugConfig.fromFile 解析 config YAML 用，R8 裁剪会破坏其静态初始化
-keep class org.yaml.snakeyaml.** { *; }
-dontwarn org.yaml.**
