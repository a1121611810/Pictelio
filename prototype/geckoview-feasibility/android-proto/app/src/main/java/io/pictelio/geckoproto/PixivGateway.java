package io.pictelio.geckoproto;

import android.util.Log;

import androidx.annotation.NonNull;

import java.io.IOException;
import java.net.InetAddress;
import java.net.Socket;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.X509TrustManager;

import okhttp3.Dns;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * 原型网关：把本地 HTTP 服务器的 /pixiv-* 请求转发到 Pixiv。
 *
 * 两条通道（记录实测命中用于报告）：
 *  1. sniDirect —— 普通 OkHttp（Necko 式带 SNI 的 TLS）。2026-09-07 宿主网络实测可用；
 *     若 GFW 恢复 SNI 封锁则失败。
 *  2. noSniPinned —— 钉定 IP 字面量 + 剥 SNI（搬运自主工程 DirectAccessTransport 的
 *     已验证机制：字面量对端是唯一可靠剥离手段，JDK/Conscrypt 空 serverNames 列表
 *     在部分栈上 no-op，作双保险）。IP 来自 DirectIpTableDefaults 探针实测值：
 *     i.pximg.net → 210.140.139.131；app-api.pixiv.net / oauth.secure.pixiv.net → 210.140.139.155。
 *
 * 证书校验两通道都完整保留（TrustManager 默认；OkHttp 按 URL 域名做主机名校验，
 * 无 SNI 直连下边缘出示 *.pixiv.net 泛域名证书可直接通过——主工程已验证）。
 */
public final class PixivGateway {

    private static final String TAG = "GVPROTO";

    // ── 端点与伪装常量（对齐主工程 OAuthConfig，探针实测值） ──
    static final String API_BASE = "https://app-api.pixiv.net";
    static final String AUTH_URL = "https://oauth.secure.pixiv.net/auth/token";
    static final String IMAGE_CDN = "https://i.pximg.net";
    static final String WWW_BASE = "https://www.pixiv.net";
    static final String GITHUB_API = "https://api.github.com";
    static final String UA = "PixivIOSApp/7.18.3 (iOS 18.5; iPhone15,4)";
    static final String REFERER = "https://app-api.pixiv.net/";

    private static final String IP_IMAGE_EDGE = "210.140.139.131";
    private static final String IP_API_EDGE = "210.140.139.155";

    /** 一次代理响应的结果（状态 + body + content-type + 走的通道） */
    public static final class Result {
        public final int status;
        public final byte[] body;
        public final String contentType;
        public final String channel;

        Result(int status, byte[] body, String contentType, String channel) {
            this.status = status;
            this.body = body;
            this.contentType = contentType;
            this.channel = channel;
        }
    }

    private final OkHttpClient sniClient;
    private final OkHttpClient noSniClient;

    public PixivGateway() {
        sniClient = new OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(20, TimeUnit.SECONDS)
                .writeTimeout(20, TimeUnit.SECONDS)
                .build();
        noSniClient = buildNoSniClient();
    }

    // ── 无 SNI 客户端（钉定 IP 字面量 + 剥 SNI，搬运主工程已验证机制） ──

    private static String pinnedIpFor(String host) {
        if (host == null) return null;
        switch (host) {
            case "i.pximg.net": return IP_IMAGE_EDGE;
            case "app-api.pixiv.net": return IP_API_EDGE;
            case "oauth.secure.pixiv.net": return IP_API_EDGE;
            default: return null;
        }
    }

    private OkHttpClient buildNoSniClient() {
        SSLSocketFactory baseFactory;
        X509TrustManager trustManager;
        try {
            OkHttpClient probe = new OkHttpClient.Builder().build();
            baseFactory = probe.sslSocketFactory();
            trustManager = probe.x509TrustManager();
        } catch (RuntimeException e) {
            Log.w(TAG, "[gw] 平台默认 TLS 组件提取失败，无 SNI 通道停用: " + e);
            return sniClient;
        }
        return sniClient.newBuilder()
                .dns(hostname -> {
                    String pinned = pinnedIpFor(hostname);
                    Log.d(TAG, "[gw][dns] lookup " + hostname + " → " + (pinned != null ? pinned : "system"));
                    if (pinned == null) return Dns.SYSTEM.lookup(hostname);
                    // 纯字面量地址（getByAddress），零 DNS 查询、无主机名标签
                    return Collections.singletonList(
                            InetAddress.getByAddress(InetAddress.getByName(pinned).getAddress()));
                })
                .sslSocketFactory(new SniStripFactory(baseFactory), trustManager)
                .build();
    }

    /** 剥 SNI 的 SSL 工厂：对端 host 是 Pixiv 域名且底层 socket 已连到钉定 IP 时，改传 IP 字面量 */
    static final class SniStripFactory extends SSLSocketFactory {
        private final SSLSocketFactory delegate;

        SniStripFactory(SSLSocketFactory delegate) {
            this.delegate = delegate;
        }

        @Override
        public Socket createSocket(Socket s, String host, int port, boolean autoClose) throws IOException {
            String peerHost = host;
            String pinned = pinnedIpFor(host);
            InetAddress remote = s != null ? s.getInetAddress() : null;
            if (pinned != null && remote != null && pinned.equals(remote.getHostAddress())) {
                peerHost = pinned; // 字面量对端 → SNI 派生短路（主机制）
            }
            Socket socket = delegate.createSocket(s, peerHost, port, autoClose);
            if (peerHost.equals(pinned)) {
                try {
                    SSLParameters params = ((SSLSocket) socket).getSSLParameters();
                    params.setServerNames(Collections.emptyList()); // 副机制（部分栈 no-op，无害）
                    ((SSLSocket) socket).setSSLParameters(params);
                } catch (Exception ignore) {
                    // 降级可见性由调用方通道日志承担
                }
            }
            return socket;
        }

        @Override public Socket createSocket(String host, int port) throws IOException { return delegate.createSocket(host, port); }
        @Override public Socket createSocket(String host, int port, InetAddress localHost, int localPort) throws IOException { return delegate.createSocket(host, port, localHost, localPort); }
        @Override public Socket createSocket(InetAddress host, int port) throws IOException { return delegate.createSocket(host, port); }
        @Override public Socket createSocket(InetAddress address, int port, InetAddress localAddress, int localPort) throws IOException { return delegate.createSocket(address, port, localAddress, localPort); }
        @Override public String[] getDefaultCipherSuites() { return delegate.getDefaultCipherSuites(); }
        @Override public String[] getSupportedCipherSuites() { return delegate.getSupportedCipherSuites(); }
    }

    // ── 请求执行 ──

    /** 图片：GET i.pximg.net/<path>，注入 Referer/UA；pixiv 域优先无 SNI 钉定（DNS 污染下 SNI 直连被注入 404/伪响应，实测 2026-09-07） */
    public byte[] image(String path) throws IOException {
        String url = IMAGE_CDN + path;
        Request req = baseBuilder(url)
                .addHeader("Referer", REFERER)
                .addHeader("User-Agent", UA)
                .get().build();
        try {
            byte[] body = execForBody(noSniClient, req, url);
            Log.i(TAG, "[gw][img] channel=noSniPinned bytes=" + body.length + " path=" + path);
            return body;
        } catch (IOException pinnedError) {
            Log.w(TAG, "[gw][img] 无 SNI 钉定失败，回退 SNI 直连: " + pinnedError);
            byte[] body = execForBody(sniClient, req, url);
            Log.i(TAG, "[gw][img] channel=sniDirect bytes=" + body.length + " path=" + path);
            return body;
        }
    }

    private static byte[] execForBody(OkHttpClient client, Request req, String url) throws IOException {
        try (Response resp = client.newCall(req).execute()) {
            return requireBody(resp, url);
        }
    }


    /** API：透传 method/path/query/body，注入 UA/Referer，保留客户端 Authorization/X-Client-* */
    public Result api(String method, String pathWithQuery, byte[] body, Headers clientHeaders) throws IOException {
        return proxy(API_BASE + pathWithQuery, method, body, clientHeaders, true, "api");
    }

    /** OAuth：透传 POST body（SPA 的 DEV bundle 自带 client_id/secret/X-Client-*），注入 UA */
    public Result oauth(String pathWithQuery, byte[] body, Headers clientHeaders) throws IOException {
        // 注意：AUTH_URL 常量含 /auth/token，此处必须用裸 origin 拼 path（实测拼重返回 404）
        return proxy("https://oauth.secure.pixiv.net" + pathWithQuery, "POST", body, clientHeaders, false, "oauth");
    }

    /** 通用透传（pixiv-www / pixiv-re / pixiv-nl / github-api） */
    public Result generic(String base, String pathWithQuery, byte[] body, Headers clientHeaders, String tag) throws IOException {
        return proxy(base + pathWithQuery, "GET", body, clientHeaders, !GITHUB_API.equals(base), tag);
    }

    /** 最近一次客户端请求携带的 Bearer（__api 探针复用；throwaway 原型取巧，非生产模式） */
    private static volatile String lastBearer;

    private Result proxy(String url, String method, byte[] body, Headers clientHeaders,
                         boolean injectPixivHeaders, String tag) throws IOException {
        Request.Builder b = baseBuilder(url);
        if (injectPixivHeaders) {
            b.addHeader("User-Agent", UA).addHeader("Referer", REFERER);
            String auth = clientHeaders.get("authorization");
            if (auth != null && !auth.isEmpty()) {
                lastBearer = auth;
                b.addHeader("Authorization", auth);
            } else if (lastBearer != null) {
                b.addHeader("Authorization", lastBearer);
            }
        }
        // 客户端透传头（X-Client-* / App-OS* / Content-Type；Authorization 已在上方显式处理）
        for (String name : clientHeaders.names()) {
            if (isForwardable(name)) {
                b.addHeader(name, clientHeaders.get(name));
            }
        }
        if (body != null && body.length > 0) {
            String ct = clientHeaders.get("Content-Type");
            MediaType mt = ct != null ? MediaType.parse(ct) : MediaType.parse("application/x-www-form-urlencoded");
            b.method(method, RequestBody.create(mt, body));
        } else if ("POST".equals(method)) {
            b.method(method, RequestBody.create((MediaType) null, new byte[0]));
        } else {
            b.get();
        }
        Request req = b.build();
        // pixiv 域：无 SNI 钉定优先（DNS 污染 + SNI 注入，见 image() 注释）
        try {
            Result r = toResult(noSniClient.newCall(req).execute(), "noSniPinned");
            Log.i(TAG, "[gw][" + tag + "] ch=noSniPinned st=" + r.status + " bytes=" + r.body.length);
            return r;
        } catch (IOException pinnedError) {
            Log.w(TAG, "[gw][" + tag + "] 无 SNI 钉定失败，回退 SNI 直连: " + pinnedError);
            Result r = toResult(sniClient.newCall(req).execute(), "sniDirect");
            Log.i(TAG, "[gw][" + tag + "] ch=sniDirect st=" + r.status + " bytes=" + r.body.length);
            return r;
        }
    }

    private static Result toResult(Response resp, String channel) throws IOException {
        ResponseBody rb = resp.body();
        byte[] body = rb != null ? rb.bytes() : new byte[0];
        String ct = resp.header("Content-Type", "application/octet-stream");
        if (resp.code() >= 400) {
            Log.w(TAG, "[gw][dbg] st=" + resp.code() + " ch=" + channel
                    + " url=" + resp.request().url()
                    + " body=" + new String(body, 0, Math.min(body.length, 200), StandardCharsets.UTF_8));
        }
        return new Result(resp.code(), body, ct, channel);
    }

    private static byte[] requireBody(Response resp, String url) throws IOException {
        if (!resp.isSuccessful()) throw new IOException("HTTP " + resp.code() + ": " + url);
        ResponseBody rb = resp.body();
        byte[] body = rb != null ? rb.bytes() : new byte[0];
        if (body.length == 0) throw new IOException("empty body: " + url);
        return body;
    }

    private static Request.Builder baseBuilder(String url) {
        return new Request.Builder().url(url);
    }

    /** 可透传的客户端头白名单（UA/Referer/Host/Cookie 等由网关接管或剥离） */
    private static boolean isForwardable(String name) {
        String n = name.toLowerCase();
        switch (n) {
            case "user-agent":
            case "referer":
            case "host":
            case "content-length":
            case "accept-encoding":
            case "connection":
            case "cookie":
            case "authorization":
                return false;
            default:
                return true;
        }
    }

    /** 极简大小写不敏感头集合（避免引 servlet 依赖） */
    public static final class Headers {
        private final java.util.Map<String, String> map = new java.util.HashMap<>();

        public void add(String name, String value) {
            map.put(name.toLowerCase(), value);
        }

        public String get(String name) {
            return map.get(name.toLowerCase());
        }

        public java.util.Set<String> names() {
            return map.keySet();
        }
    }
}
