package io.pictelio.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import java.util.Objects;

/**
 * 官方域名端点提供者（ADR-0146 D3）——「API 反代地址」设置的 Java 读取面。
 *
 * <p><b>语义</b>：设置键 {@code api_proxy_base}（CapacitorStorage，JS 设置卡写入；形如
 * {@code https://x.y.workers.dev/p}）。非空且合法时：API 基址 = {@code <base>/api}
 * （上游 app-api.pixiv.net）、OAuth 令牌交换 = {@code <base>/oauth/auth/token}
 * （上游 oauth.secure.pixiv.net）；空/缺失/非法 → 回退官方域名。
 *
 * <p><b>读取纪律</b>：{@link #refresh()} 在各请求入口调用（raw equals 等值缓存，
 * 热路径零解析零分配；SharedPreferences 首读后为内存查询）。Context 由
 * {@code DirectAccessInitProvider.onCreate} 的 {@link #bind} 预绑定（三 flavor 通用，
 * 任何请求发生前必已执行——ContentProvider 先于 Application.onCreate）。
 *
 * <p><b>禁静默降级</b>：非法输入（非 https / 空白 host）→ Log.w 可见 + 回退官方域名。
 * 未绑定（JVM 单测）→ 官方域名，零异常。
 *
 * <p><b>信任边界</b>（ADR-0146）：反代地址由用户自行部署的 Worker 提供——凭据经
 * 用户自己的基础设施，无第三方信任引入；明文 http 被拒收（防凭据泄漏面）。
 */
public final class ApiEndpoints {

    private static final String TAG = "[ApiEndpoints]";
    private static final String OFFICIAL_API = "https://app-api.pixiv.net";
    private static final String OFFICIAL_OAUTH_TOKEN = "https://oauth.secure.pixiv.net/auth/token";
    /** CapacitorStorage 键（JS apiProxyStore 写入侧同名，契约硬约束） */
    static final String PREF_KEY = "api_proxy_base";

    private static volatile Context appContext;
    private static volatile String cachedRaw;
    /** 归一化反代基址（无尾斜杠）或 null（未配置/非法回退） */
    private static volatile String proxyBase;

    private ApiEndpoints() {
    }

    /** DirectAccessInitProvider.onCreate 绑定应用上下文（全 flavor 通用、请求前必执行） */
    public static void bind(Context appCtx) {
        appContext = appCtx.getApplicationContext();
    }

    /** 请求入口调用：读设置（等值缓存）并刷新内存端点。未绑定 = no-op（官方回退） */
    public static void refresh() {
        Context ctx = appContext;
        if (ctx == null) {
            return;
        }
        try {
            SharedPreferences prefs =
                    ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
            String raw = prefs.getString(PREF_KEY, null);
            if (Objects.equals(raw, cachedRaw)) {
                return; // 等值缓存：热路径零解析
            }
            cachedRaw = raw;
            proxyBase = normalize(raw);
        } catch (Exception e) {
            // 存储读取异常：保持上次端点（首次则官方回退），warn 可见（禁静默）
            Log.w(TAG, "api_proxy_base 读取失败（保持上次端点）", e);
        }
    }

    /** API 基址（反代 {@code <base>/api} 或官方 {@code https://app-api.pixiv.net}） */
    public static String apiBase() {
        refresh();
        return proxyBase == null ? OFFICIAL_API : proxyBase + "/api";
    }

    /** OAuth 令牌交换 URL（反代 {@code <base>/oauth/auth/token} 或官方端点） */
    public static String oauthTokenUrl() {
        refresh();
        return proxyBase == null ? OFFICIAL_OAUTH_TOKEN : proxyBase + "/oauth/auth/token";
    }

    /**
     * 归一化：trim + 去尾斜杠；非 https 前缀 / 空白 host → null（回退官方）+ warn。
     * 反代基址必须 https（凭据面，明文拒收）。
     */
    static String normalize(String raw) {
        if (raw == null) {
            return null;
        }
        String v = raw.trim();
        if (v.isEmpty()) {
            return null;
        }
        if (!v.startsWith("https://")) {
            Log.w(TAG, "api_proxy_base 非法（必须 https://），回退官方域名: " + v);
            return null;
        }
        while (v.endsWith("/")) {
            v = v.substring(0, v.length() - 1);
        }
        if (v.equals("https://")) {
            Log.w(TAG, "api_proxy_base 非法（空 host），回退官方域名");
            return null;
        }
        return v;
    }
}
