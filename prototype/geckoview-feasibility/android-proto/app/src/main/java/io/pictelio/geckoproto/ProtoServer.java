package io.pictelio.geckoproto;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 原型内嵌 HTTP 服务器（127.0.0.1:18080）：
 * - 静态资产：assets/public（SPA bundle），非文件路径回退 index.html（SPA history 路由）
 * - Pixiv 代理契约：与 Vite dev proxy 逐字对齐（/pixiv-img /pixiv-api /pixiv-oauth
 *   /pixiv-www /pixiv-re /pixiv-nl /github-api）——SPA（web 模式）零改动可运行
 * - 探针页：/__probe（webRequest 注入 PoC + 引擎直连实验 + TLS 校验实验）
 * - keep-alive：单连接循环读多请求（图片密集 feed 的基准质量依赖它）
 */
public final class ProtoServer {

    public static final int PORT = 18080;
    private static final String TAG = "GVPROTO";

    private final AssetManager assets;
    private final PixivGateway gateway;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private volatile ServerSocket serverSocket;

    /** webRequest 注入统计（由 ExtBridge 更新，供探针页展示） */
    public static final ConcurrentHashMap<String, Long> INJ_STATS = new ConcurrentHashMap<>();

    public ProtoServer(Context context) {
        this.assets = context.getAssets();
        this.gateway = new PixivGateway();
    }

    public void start() throws IOException {
        // 显式 IPv4：Android 的 getLoopbackAddress() 返回 ::1（IPv6），Gecko 访问
        // http://127.0.0.1 时按 IPv4 连接会被拒（实测 category=3 code=67）
        serverSocket = new ServerSocket(PORT, 64, InetAddress.getByName("127.0.0.1"));
        Thread acceptor = new Thread(this::acceptLoop, "gvproto-acceptor");
        acceptor.setDaemon(true);
        acceptor.start();
        Log.i(TAG, "[srv] listening on http://127.0.0.1:" + PORT);
    }

    public boolean isReady() {
        return serverSocket != null && serverSocket.isBound();
    }

    private void acceptLoop() {
        while (true) {
            try {
                Socket socket = serverSocket.accept();
                socket.setTcpNoDelay(true);
                pool.execute(() -> handleConnection(socket));
            } catch (IOException e) {
                Log.w(TAG, "[srv] accept 失败（退出接受循环）: " + e);
                return;
            }
        }
    }

    // ── 连接处理（keep-alive 循环） ──

    private void handleConnection(Socket socket) {
        try (Socket s = socket) {
            InputStream in = s.getInputStream();
            OutputStream out = s.getOutputStream();
            while (!s.isClosed()) {
                Request req = readRequest(in);
                if (req == null) return;
                long t0 = System.nanoTime();
                Log.d(TAG, "[req] " + req.method + " " + req.path + req.query
                        + (req.body.length > 0 ? " body=" + req.body.length + "B" : ""));
                Response resp = route(req);
                long ms = (System.nanoTime() - t0) / 1_000_000;
                writeResponse(out, resp, req.keepAlive);
                if (resp.logTag != null) {
                    Log.i(TAG, resp.logTag + " ms=" + ms + " st=" + resp.status + " bytes=" + resp.body.length);
                }
                if (!req.keepAlive) return;
            }
        } catch (IOException e) {
            // 客户端断开等：原型静默
        }
    }

    static final class Request {
        String method;
        String path;      // 不含 query
        String query;     // 含 '?' 原文，或空
        PixivGateway.Headers headers = new PixivGateway.Headers();
        byte[] body = new byte[0];
        boolean keepAlive = true;
    }

    static final class Response {
        final int status;
        final byte[] body;
        final String contentType;
        final Map<String, String> extraHeaders = new HashMap<>();
        String logTag; // 非空则打点

        Response(int status, byte[] body, String contentType) {
            this.status = status;
            this.body = body;
            this.contentType = contentType;
        }
    }

    private Response route(Request req) {
        try {
            if (req.path.startsWith("/pixiv-img/")) {
                byte[] img = gateway.image(req.path.substring("/pixiv-img".length()));
                Response r = new Response(200, img, mimeFor(req.path));
                r.extraHeaders.put("Cache-Control", "public, max-age=31536000, immutable");
                r.logTag = "[gw][img-proxy]";
                return r;
            }
            if (req.path.startsWith("/pixiv-api/")) {
                PixivGateway.Result res = gateway.api(req.method,
                        req.path.substring("/pixiv-api".length()) + req.query, req.body, req.headers);
                Response r = new Response(res.status, res.body, res.contentType);
                r.logTag = "[gw][api] ch=" + res.channel + " path=" + req.path;
                return r;
            }
            if (req.path.startsWith("/pixiv-oauth/")) {
                PixivGateway.Result res = gateway.oauth(
                        req.path.substring("/pixiv-oauth".length()) + req.query, req.body, req.headers);
                Response r = new Response(res.status, res.body, res.contentType);
                r.logTag = "[gw][oauth] ch=" + res.channel;
                return r;
            }
            if (req.path.startsWith("/pixiv-www/")) {
                PixivGateway.Result res = gateway.generic(PixivGateway.WWW_BASE,
                        req.path.substring("/pixiv-www".length()) + req.query, req.body, req.headers, "www");
                return new Response(res.status, res.body, res.contentType);
            }
            if (req.path.startsWith("/pixiv-re/")) {
                PixivGateway.Result res = gateway.generic("https://i.pixiv.re",
                        req.path.substring("/pixiv-re".length()) + req.query, req.body, req.headers, "re");
                return new Response(res.status, res.body, res.contentType);
            }
            if (req.path.startsWith("/pixiv-nl/")) {
                PixivGateway.Result res = gateway.generic("https://i.pixiv.nl",
                        req.path.substring("/pixiv-nl".length()) + req.query, req.body, req.headers, "nl");
                return new Response(res.status, res.body, res.contentType);
            }
            if (req.path.startsWith("/github-api/")) {
                PixivGateway.Result res = gateway.generic(PixivGateway.GITHUB_API,
                        req.path.substring("/github-api".length()) + req.query, req.body, req.headers, "gh");
                return new Response(res.status, res.body, res.contentType);
            }
            return serveStatic(req);
        } catch (IOException e) {
            Log.w(TAG, "[srv] 代理失败 " + req.path + ": " + e);
            Response r = new Response(502,
                    ("{\"error\":\"proxy_error\",\"message\":\"" + e + "\"}").getBytes(StandardCharsets.UTF_8),
                    "application/json");
            return r;
        }
    }

    // ── 静态资产 ──

    private Response serveStatic(Request req) throws IOException {
        String path = req.path.equals("/") ? "/index.html" : req.path;
        byte[] bytes = readAssetSafely("public" + path);
        if (bytes == null) {
            // SPA history 路由回退（资源类后缀不回退，避免 404 资源被 index.html 掩盖）
            if (path.lastIndexOf('.') < path.lastIndexOf('/')) {
                bytes = readAssetSafely("public/index.html");
            }
        }
        if (bytes == null) {
            return new Response(404, "not found".getBytes(StandardCharsets.UTF_8), "text/plain");
        }
        Response r = new Response(200, bytes, mimeFor(path));
        r.extraHeaders.put("Cache-Control", "no-cache");
        return r;
    }

    private byte[] readAssetSafely(String assetPath) throws IOException {
        try (InputStream in = assets.open(assetPath)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[16 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toByteArray();
        } catch (IOException notFound) {
            return null;
        }
    }

    private static String mimeFor(String path) {
        String p = path.toLowerCase(Locale.US);
        int dot = p.lastIndexOf('.');
        String ext = dot >= 0 ? p.substring(dot + 1) : "";
        switch (ext) {
            case "html": return "text/html; charset=utf-8";
            case "js":
            case "mjs": return "application/javascript; charset=utf-8";
            case "css": return "text/css; charset=utf-8";
            case "json":
            case "map": return "application/json";
            case "png": return "image/png";
            case "jpg":
            case "jpeg": return "image/jpeg";
            case "webp": return "image/webp";
            case "gif": return "image/gif";
            case "svg": return "image/svg+xml";
            case "ico": return "image/x-icon";
            case "woff": return "font/woff";
            case "woff2": return "font/woff2";
            case "ttf": return "font/ttf";
            case "wasm": return "application/wasm";
            case "zip": return "application/zip";
            case "txt": return "text/plain; charset=utf-8";
            default: return "application/octet-stream";
        }
    }

    // ── HTTP 解析与序列化 ──

    private Request readRequest(InputStream in) throws IOException {
        String requestLine = readLine(in);
        if (requestLine == null || requestLine.isEmpty()) return null;
        String[] parts = requestLine.split(" ");
        if (parts.length < 2) return null;
        Request req = new Request();
        req.method = parts[0];
        String target = parts[1];
        int q = target.indexOf('?');
        if (q >= 0) {
            req.path = target.substring(0, q);
            req.query = target.substring(q);
        } else {
            req.path = target;
            req.query = "";
        }
        int contentLength = 0;
        String line;
        while ((line = readLine(in)) != null && !line.isEmpty()) {
            int colon = line.indexOf(':');
            if (colon <= 0) continue;
            String name = line.substring(0, colon).trim();
            String value = line.substring(colon + 1).trim();
            req.headers.add(name, value);
            if ("content-length".equalsIgnoreCase(name)) {
                contentLength = Integer.parseInt(value);
            } else if ("connection".equalsIgnoreCase(name)) {
                req.keepAlive = !value.equalsIgnoreCase("close");
            }
        }
        if (contentLength > 0) {
            byte[] body = new byte[contentLength];
            int read = 0;
            while (read < contentLength) {
                int n = in.read(body, read, contentLength - read);
                if (n < 0) return null;
                read += n;
            }
            req.body = body;
        }
        return req;
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream(64);
        int prev = -1;
        int c;
        while ((c = in.read()) != -1) {
            if (prev == '\r' && c == '\n') {
                byte[] bytes = bos.toByteArray();
                return new String(bytes, 0, bytes.length - 1, StandardCharsets.US_ASCII);
            }
            bos.write(c);
            prev = c;
        }
        return null;
    }

    private void writeResponse(OutputStream out, Response resp, boolean keepAlive) throws IOException {
        String head = "HTTP/1.1 " + resp.status + " " + statusText(resp.status) + "\r\n"
                + "Content-Type: " + resp.contentType + "\r\n"
                + "Content-Length: " + resp.body.length + "\r\n"
                + "Connection: " + (keepAlive ? "keep-alive" : "close") + "\r\n";
        StringBuilder sb = new StringBuilder(head);
        for (Map.Entry<String, String> e : resp.extraHeaders.entrySet()) {
            sb.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");
        }
        sb.append("\r\n");
        out.write(sb.toString().getBytes(StandardCharsets.US_ASCII));
        out.write(resp.body);
        out.flush();
    }

    private static String statusText(int status) {
        switch (status) {
            case 200: return "OK";
            case 204: return "No Content";
            case 301: return "Moved Permanently";
            case 302: return "Found";
            case 304: return "Not Modified";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 429: return "Too Many Requests";
            case 502: return "Bad Gateway";
            default: return "Status";
        }
    }
}
