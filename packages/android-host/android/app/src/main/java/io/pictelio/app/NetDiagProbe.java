package io.pictelio.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.SocketTimeoutException;
import java.util.List;
import java.util.concurrent.TimeUnit;

import io.pictelio.app.config.OAuthConfig;

import okhttp3.Call;
import okhttp3.EventListener;
import okhttp3.Handshake;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;

/**
 * 网络自检 Java 执行层（main 源集，webview / lynx 共用）。
 *
 * <p>设计依据：docs/specs/network-self-check.md + docs/research/network-selfcheck-java-capability-audit.md（#440）。
 * 产出与 @pictelio/net-diagnostics 的 ProbeOutcome[] 契约一致（id / ok / latencyMs / errorClass / httpStatus / rawError），
 * 判定与文案在共享包，Java 只负责「发包与测量」。
 *
 * <ul>
 *   <li>设备能力位：ConnectivityManager + NetworkCapabilities，只出 transports/validated/captivePortal/metered，
 *       绝不读 SSID/BSSID/用户 IP。</li>
 *   <li>主动探测：专用非路由 OkHttp client（独立连接池），EventListener 取 dns/connect/tls/ttfb 分阶段耗时。
 *       不复用 PixivApiCore 共享 client（连接复用会吞掉 dnsStart/connectStart —— #440 结论）。</li>
 *   <li>带鉴权 API 项走 PixivApiCore.executeRequest（真实 401 刷新链路），只取状态码。</li>
 * </ul>
 *
 * <p>网络直连（ADR-0144）已由 bf32620e 移除，故无 route 探测、无「去 SNI」对照路径。
 */
public final class NetDiagProbe {

    private NetDiagProbe() {}

    /** 探测失败阶段（由 EventListener 记录，用于分阶段归因）。 */
    static final class Timed {
        boolean reached;
        int status;
        String rawError;
        String failedStage;
        long dnsMs = -1;
        long connectMs = -1;
        long tlsMs = -1;
        long ttfbMs = -1;
        boolean dnsDone;
        boolean connectDone;
        boolean tlsDone;

        String errorClass() {
            String msg = rawError == null ? "" : rawError.toLowerCase();
            if (msg.contains("timeout") || msg.contains("timed out")) return "timeout";
            if (failedStage == null) return "unknown";
            if ("dns".equals(failedStage)) return "dns";
            if ("connect".equals(failedStage)) return "connect";
            if ("tls".equals(failedStage)) return "tls";
            return "unknown";
        }
    }

    private static final class TimingListener extends EventListener {
        private final Timed t;
        private long dnsStart = -1;
        private long connectStart = -1;
        private long tlsStart = -1;
        private long reqHeadersEnd = -1;

        TimingListener(Timed t) {
            this.t = t;
        }

        @Override
        public void dnsStart(Call call, String domainName) {
            t.failedStage = "dns";
            dnsStart = System.nanoTime();
        }

        @Override
        public void dnsEnd(Call call, String domainName, List<InetAddress> inetAddressList) {
            if (dnsStart > 0) {
                t.dnsMs = (System.nanoTime() - dnsStart) / 1_000_000L;
                t.dnsDone = true;
            }
        }

        @Override
        public void connectStart(Call call, InetSocketAddress inetSocketAddress, Proxy proxy) {
            t.failedStage = "connect";
            connectStart = System.nanoTime();
        }

        @Override
        public void connectEnd(Call call, InetSocketAddress inetSocketAddress, Proxy proxy, Protocol protocol) {
            if (connectStart > 0) {
                t.connectMs = (System.nanoTime() - connectStart) / 1_000_000L;
                t.connectDone = true;
            }
        }

        @Override
        public void secureConnectStart(Call call) {
            t.failedStage = "tls";
            tlsStart = System.nanoTime();
        }

        @Override
        public void secureConnectEnd(Call call, Handshake handshake) {
            if (tlsStart > 0) {
                t.tlsMs = (System.nanoTime() - tlsStart) / 1_000_000L;
                t.tlsDone = true;
            }
        }

        @Override
        public void requestHeadersEnd(Call call, Request request) {
            reqHeadersEnd = System.nanoTime();
        }

        @Override
        public void responseHeadersStart(Call call) {
            if (reqHeadersEnd > 0) t.ttfbMs = (System.nanoTime() - reqHeadersEnd) / 1_000_000L;
        }
    }

    /** 设备能力位（不含 SSID / 用户 IP）。 */
    static JSONObject deviceInfo(Context ctx) throws JSONException {
        JSONObject o = new JSONObject();
        JSONArray arr = new JSONArray();
        boolean validated = false;
        boolean captive = false;
        boolean metered = false;
        NetworkCapabilities caps = null;
        ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
            Network active = cm.getActiveNetwork();
            if (active != null) caps = cm.getNetworkCapabilities(active);
        }
        if (caps != null) {
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) arr.put("wifi");
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) arr.put("cellular");
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) arr.put("ethernet");
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) arr.put("vpn");
            if (arr.length() == 0) arr.put("other");
            validated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
            captive = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL);
            metered = !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED);
        } else {
            arr.put("none");
        }
        o.put("transports", arr);
        o.put("validated", validated);
        o.put("captivePortal", captive);
        o.put("metered", metered);
        return o;
    }

    static JSONObject okProbe(String id, long latencyMs) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("id", id);
        o.put("ok", true);
        if (latencyMs >= 0) o.put("latencyMs", latencyMs);
        return o;
    }

    static JSONObject failProbe(String id, String errorClass, int httpStatus, String raw) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("id", id);
        o.put("ok", false);
        o.put("errorClass", errorClass == null || errorClass.isEmpty() ? "unknown" : errorClass);
        if (httpStatus > 0) o.put("httpStatus", httpStatus);
        if (raw != null && !raw.isEmpty()) o.put("rawError", raw);
        return o;
    }

    /**
     * 由原始测量组装 ProbeOutcome[]（纯函数，无网络——单测的稳定接缝）。
     * 未跑到的层直接省略（共享包判定层把缺失项判为 skipped）。
     */
    static JSONArray assembleProbes(Timed net, Timed edge, JSONObject httpOutcome) throws JSONException {
        JSONArray probes = new JSONArray();
        if (net.dnsDone) {
            probes.put(okProbe("dns", net.dnsMs));
        } else {
            probes.put(failProbe("dns", net.errorClass(), 0, net.rawError));
        }
        if (net.dnsDone) {
            if (net.connectDone) probes.put(okProbe("tcp", net.connectMs));
            else probes.put(failProbe("tcp", net.errorClass(), 0, net.rawError));
        }
        if (net.connectDone) {
            if (net.tlsDone) probes.put(okProbe("tls", net.tlsMs));
            else probes.put(failProbe("tls", net.errorClass(), 0, net.rawError));
        }
        if (httpOutcome != null) probes.put(httpOutcome);
        if (edge.reached) {
            probes.put(okProbe("edge", edge.ttfbMs >= 0 ? edge.ttfbMs : edge.connectMs));
        } else {
            probes.put(failProbe("edge", edge.errorClass(), 0, edge.rawError));
        }
        return probes;
    }

    private static Timed timedProbe(OkHttpClient base, String url, String method, boolean withAuth, long timeoutMs) {
        Timed t = new Timed();
        Request.Builder rb = new Request.Builder()
                .url(url)
                .header("User-Agent", OAuthConfig.USER_AGENT)
                .header("Referer", OAuthConfig.REFERER);
        if (withAuth) {
            rb.header("Authorization", "Bearer " + (PixivApiCore.accessToken == null ? "" : PixivApiCore.accessToken));
        }
        if ("HEAD".equals(method)) rb.head();
        else rb.get();
        OkHttpClient c = base.newBuilder()
                .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .eventListener(new TimingListener(t))
                .build();
        try (Response resp = c.newCall(rb.build()).execute()) {
            t.reached = true;
            t.status = resp.code();
        } catch (IOException e) {
            t.rawError = e instanceof SocketTimeoutException ? "timeout" : e.getMessage();
        }
        return t;
    }

    /** 带鉴权 API 项：走真实 401 刷新链路，只取状态码。userId 缺失或未登录则返回 null（判 skipped）。 */
    static JSONObject authProbe(String userId) throws JSONException {
        if (userId == null || userId.isEmpty()) return null;
        if (PixivApiCore.accessToken == null || PixivApiCore.accessToken.isEmpty()) return null;
        String url = PixivApiCore.apiBase() + "/v1/user/detail?user_id=" + userId;
        try {
            long t0 = System.nanoTime();
            JSONObject r = PixivApiCore.executeRequest("GET", url, null, false, null);
            long ms = (System.nanoTime() - t0) / 1_000_000L;
            int st = r.optInt("status", 0);
            if (st >= 200 && st < 300) return okProbe("http", ms);
            if (st == 401 || st == 403) return failProbe("http", "auth", st, "HTTP " + st);
            return failProbe("http", "http_status", st, "HTTP " + st);
        } catch (IOException e) {
            return failProbe("http", e instanceof SocketTimeoutException ? "timeout" : "connect", 0, e.getMessage());
        }
    }

    /**
     * 执行一次完整自检，返回 { device, probes }。
     * 端点从 OAuthConfig 取（不在 Java 硬编码域）；边缘探测只要求可达，403/404 也算成功。
     */
    public static JSONObject run(Context ctx, String userId) throws JSONException {
        OkHttpClient base = new OkHttpClient.Builder()
                .connectTimeout(3, TimeUnit.SECONDS)
                .readTimeout(3, TimeUnit.SECONDS)
                .retryOnConnectionFailure(false)
                .build();

        Timed net = timedProbe(base, PixivApiCore.apiBase() + "/", "GET", false, 4000);
        Timed edge = timedProbe(base, OAuthConfig.IMAGE_CDN_URL + "/", "HEAD", false, 3000);
        JSONObject http = authProbe(userId);

        JSONObject out = new JSONObject();
        out.put("device", deviceInfo(ctx));
        out.put("probes", assembleProbes(net, edge, http));
        return out;
    }
}
