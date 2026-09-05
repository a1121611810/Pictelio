package io.pictelio.app;

import android.util.Log;

/**
 * 拦截链路性能日志（X1 telemetry，spec webview-perf-round2 §3 第 2 条）。
 *
 * <p>仅 debug 构建产出日志（tag {@link #TAG}，单行 Log.i）；release 侧调用方连计时都
 * 不执行（计时包进 BuildConfig.DEBUG 分支），本类零开销。
 *
 * <p>格式（oracle = spec §3 字面量，PerfLogTest 逐字锚定）：
 * <pre>
 *   intercept url8=&lt;8字符&gt; phase=hit src=mem|disk durationMs=&lt;n&gt; bytes=&lt;n&gt;
 *   intercept url8=&lt;8字符&gt; phase=miss durationMs=&lt;n&gt; bytes=&lt;n&gt;
 *   intercept url8=&lt;8字符&gt; phase=err durationMs=&lt;n&gt; bytes=-1
 * </pre>
 */
public final class PerfLog {

    static final String TAG = "PictelioPerf";

    private PerfLog() {}

    /**
     * 纯格式化（不门控，包可见供单测精确断言）。
     *
     * <p>hit 必须带 src（mem|disk）；miss/err 无 src；err 的 bytes 按 spec 固定为 -1
     * （调用方传入值不采纳，防止未来误传产生 off-spec 行）。
     */
    static String interceptLine(String url8, String phase, String src, long durationMs, long bytes) {
        if ("hit".equals(phase)) {
            return "intercept url8=" + url8 + " phase=hit src=" + src
                    + " durationMs=" + durationMs + " bytes=" + bytes;
        }
        if ("miss".equals(phase)) {
            return "intercept url8=" + url8 + " phase=miss"
                    + " durationMs=" + durationMs + " bytes=" + bytes;
        }
        return "intercept url8=" + url8 + " phase=err"
                + " durationMs=" + durationMs + " bytes=-1";
    }

    /**
     * DEBUG 门控日志入口（release 直接返回；计时由调用方包在 DEBUG 分支内，本类不负责）。
     *
     * @param pixivUrl 重写后的 CDN URL（url8 取其缓存 key 前 8 字符）
     */
    static void logIntercept(String pixivUrl, String phase, String src, long durationMs, long bytes) {
        if (!BuildConfig.DEBUG) return;
        Log.i(TAG, interceptLine(url8(pixivUrl), phase, src, durationMs, bytes));
    }

    /**
     * pixivUrl → url8（缓存 key = Base64 URL-safe，取前 8 字符；spec §3 埋点口径）。
     * 防御：极短 URL 的 Base64 可能不足 8 字符，直接 substring(0,8) 会越界——
     * 拦截线程里抛异常不可接受，短 key 原样返回。
     */
    static String url8(String pixivUrl) {
        String key = PixivImageLoader.keyToFilename(pixivUrl);
        return key.length() >= 8 ? key.substring(0, 8) : key;
    }
}
