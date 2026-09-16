package io.pictelio.app.engine;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.webkit.WebView;

import io.pictelio.app.config.OAuthConfig;

/**
 * WebView 引擎可用性探测（framework API，可入 main 源集——ADR-0164 决策 3）。
 *
 * <p>逐字移植自 full 包 {@code MainActivity.getWebViewMajorVersion/isWebViewVersionOk}
 * （fail-open 口径不变，oracle: docs/platform-compatibility.md 既有口径——检测失败保守放行）。
 * T2 起成为唯一实现地：MainActivity 与 MainActivityWebview 逐字重复的两份探测删除并移交本类。
 *
 * <p>Context 形参当前未参与计算（{@link WebView#getCurrentWebViewPackage()} 为静态查询），
 * 保留以对齐 {@link EngineProbe} 探针签名并为 per-profile 查询预留。
 */
public final class WebViewAvailability {

    private WebViewAvailability() {}

    /**
     * WebView 版本是否满足最低要求（{@link OAuthConfig#MIN_WEBVIEW_VERSION}）。
     *
     * <p>无法检测到版本时保守放行（fail-open，避免误杀非标准实现）。
     */
    public static boolean isOk(Context context) {
        int major = majorVersion(context);
        if (major < 0) return true;     // 检测失败 → 放行，让应用自己处理
        return major >= OAuthConfig.MIN_WEBVIEW_VERSION;
    }

    /**
     * 提取当前设备 WebView 的主版本号。
     *
     * @return 主版本号（如 85）；无法获取时返回 -1。
     */
    public static int majorVersion(Context context) {
        try {
            PackageInfo pi = WebView.getCurrentWebViewPackage();
            if (pi == null || pi.versionName == null) return -1;
            int dotIdx = pi.versionName.indexOf('.');
            if (dotIdx > 0) {
                return Integer.parseInt(pi.versionName.substring(0, dotIdx));
            }
            return -1;
        } catch (Exception e) {
            return -1;
        }
    }
}
