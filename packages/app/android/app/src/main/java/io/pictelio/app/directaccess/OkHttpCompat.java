package io.pictelio.app.directaccess;

import android.util.Log;

import okhttp3.OkHttpClient;

/**
 * OkHttp 版本与能力探测（pictelio-pure-client-direct-access T13）。
 *
 * <p><b>用途</b>：在直连装配时探测当前 OkHttp 版本，判断是否支持 ECH、QUIC 等高级特性。
 * 当前版本（4.12.0）<b>不支持</b> ECH（OkHttp 5.x 才支持）；不支持意味着：
 * <ul>
 *   <li>SNI 在 TLS ClientHello 中明文（GFW 可嗅探 *.pixiv.net）；</li>
 *   <li>本项目通过 <b>SNI 剥离 + 字面量对端</b>（{@link DirectAccessTransport}）规避
 *       嗅探，不依赖 ECH；</li>
 *   <li>未来若 OkHttp 5.x 升级到支持 ECH 的版本，可启用更强对抗。</li>
 * </ul>
 *
 * <p><b>升级决策依据</b>：logcat 输出当前版本 + 探测结果，开发者可在合并前确认
 * 是否需要升 OkHttp 或保持当前实现（剥 SNI + IP 钉死已实证有效）。
 *
 * <p><b>线程安全</b>：纯静态常量类，单次探测，结果缓存。
 */
public final class OkHttpCompat {

    private static final String TAG = "[OkHttpCompat]";

    private static final String OKHTTP_VERSION;
    private static final boolean SUPPORTS_ECH;
    private static final boolean SUPPORTS_QUIC;

    static {
        // 通过 Package.getImplementationVersion 拿 OkHttp manifest 版本（OkHttp 4.x 写法）
        String v = "unknown";
        try {
            java.util.jar.Manifest mf = new java.util.jar.Manifest();
            // OkHttp 类自身 manifest 不带 Implementation-Version，直接读 OkHttpClient 类的 package 信息
            Package pkg = OkHttpClient.class.getPackage();
            if (pkg != null) {
                String implVersion = pkg.getImplementationVersion();
                if (implVersion != null && !implVersion.isEmpty()) {
                    v = implVersion;
                }
            }
        } catch (Exception e) {
            // manifest 不可读（Robolectric 或 proguard 后场景）→ unknown
            Log.w(TAG, "OkHttp 版本探测失败，使用 unknown", e);
        }
        OKHTTP_VERSION = v;

        // ECH 支持：OkHttp 5.0+ 通过 .echConfig(...) 暴露；4.x 无此方法
        // 通过反射探测 OkHttpClient.Builder 是否有 echConfig 方法（最稳的运行时探测）
        boolean ech = false;
        try {
            // 反射探测 Builder 是否有 echConfig 单参数方法（OkHttp 5.x API）
            for (java.lang.reflect.Method m : okhttp3.OkHttpClient.Builder.class.getMethods()) {
                if (m.getName().equals("echConfig")) {
                    ech = true;
                    break;
                }
            }
        } catch (Exception e) {
            // 反射失败 → 保守判定为不支持（直连走 SNI 剥离兜底）
            Log.w(TAG, "OkHttp ECH 能力探测失败", e);
            ech = false;
        }
        SUPPORTS_ECH = ech;

        // QUIC 支持：OkHttp 4.x 可通过 protocol(List.of(Protocol.QUIC)) 配置，
        // 但实际底层依赖 Cronet/okhttp 的 QUIC 模块；当前 OkHttp 4.12.0 默认不含 QUIC
        SUPPORTS_QUIC = false;

        // 探测结果一次 logcat 输出（应用启动时一次性报告）
        Log.i(TAG, "OkHttp 版本=" + OKHTTP_VERSION
                + " ECH=" + SUPPORTS_ECH
                + " QUIC=" + SUPPORTS_QUIC
                + " 直连方案=" + (SUPPORTS_ECH ? "ECH 可选" : "SNI 剥离兜底（当前实现）"));
    }

    private OkHttpCompat() {
        // 静态工具类禁实例化
    }

    /** OkHttp 当前版本（如 "4.12.0"）；探测失败返回 "unknown" */
    public static String version() {
        return OKHTTP_VERSION;
    }

    /** 是否支持 ECH 加密 SNI 扩展（OkHttp 5.x+） */
    public static boolean supportsEch() {
        return SUPPORTS_ECH;
    }

    /** 是否支持 QUIC 协议（OkHttp 4.12 不含，需 Cronet 或 OkHttp 5.x+） */
    public static boolean supportsQuic() {
        return SUPPORTS_QUIC;
    }

    /**
     * 直连方案摘要（人类可读字符串）—— 用于 UI 展示 + 诊断输出。
     */
    public static String summary() {
        return "OkHttp " + OKHTTP_VERSION
                + " | ECH=" + (SUPPORTS_ECH ? "支持" : "不支持（当前依赖 SNI 剥离）")
                + " | QUIC=" + (SUPPORTS_QUIC ? "支持" : "不支持（默认 HTTP/1.1 + HTTP/2）");
    }
}