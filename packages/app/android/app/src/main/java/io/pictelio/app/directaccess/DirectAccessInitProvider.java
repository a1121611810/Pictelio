package io.pictelio.app.directaccess;

import android.content.Context;
/**
 * 直连自装配（spec #385 / ticket #390 T5）：main 源集 ContentProvider，manifest 一条声明
 * （authorities {@code ${applicationId}.directaccessinit}，exported=false），full/webview/lynx
 * 三 flavor 的 Application/Activity <b>零 Java 装配代码</b>——系统在 Application.onCreate
 * 之前自动回调 {@link android.content.ContentProvider#onCreate}（androidx.startup
 * InitializationProvider 同类先例）。
 *
 * <p><b>装配动作</b>：预热 {@link DirectAccessConfig#get(Context)}（Context 键控单例）。
 * 直连路由的真正接线点在 {@code PixivApiCore.getClient()}（对共享 client builder 调
 * {@link DirectAccessTransport#install}），不在本类——本类只保证「任何请求发生前，
 * Config 单例与其熔断器已就绪」。
 *
 * <p><b>装配缺失语义</b>（JVM 单测 / provider 被裁剪的假想环境）：{@code DirectAccessConfig.get}
 * 从未被调用 → Config 单例不存在 → PixivApiCore 的 install 以 null config 调用即
 * no-op → <b>纯系统路线零异常</b>（spec 拍板的降级契约，T4 测试已把守）。
 *
 * <p><b>可发现性补偿</b>：manifest 声明是本类唯一入口（无显式调用方，IDE「查找用法」
 * 只能找到本 javadoc 与 manifest 条目）——改动装配语义先读本文件。
 */
public final class DirectAccessInitProvider extends android.content.ContentProvider {

    @Override
    public boolean onCreate() {
        // 预热 Config 单例（Context 键控；异常吞并 warn——装配失败不得阻断应用启动，
        // 直连退化为系统路线即既有降级契约）。
        // 注意用 getContext()（全 API 级可用）：requireContext() 是 API 30+ 方法，
        // minSdk 28 设备上抛 NoSuchMethodError（#392 真机验收实测，Robolectric 未拦）。
        try {
            Context app = getContext();
            if (app != null) {
                DirectAccessConfig.get(app.getApplicationContext());
            }
        } catch (Exception e) {
            android.util.Log.w("[DirectAccessInit]", "直连配置预热失败（退化系统路线）", e);
        }
        return true;
    }

    // ── 以下为 ContentProvider 抽象方法的必填空实现（本 provider 不提供任何数据） ──

    @Override
    public android.database.Cursor query(android.net.Uri uri, String[] projection,
            String selection, String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public String getType(android.net.Uri uri) {
        return null;
    }

    @Override
    public android.net.Uri insert(android.net.Uri uri, android.content.ContentValues values) {
        return null;
    }

    @Override
    public int delete(android.net.Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(android.net.Uri uri, android.content.ContentValues values,
            String selection, String[] selectionArgs) {
        return 0;
    }
}
