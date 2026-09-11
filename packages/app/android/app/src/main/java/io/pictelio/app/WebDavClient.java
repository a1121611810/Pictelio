package io.pictelio.app;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import okhttp3.Credentials;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * WebDAV 协议子集客户端（ADR-0156 D1：Java 单一核心，双引擎共用）。
 *
 * <p>只实现备份场景所需的最小协议面（spec docs/specs/webdav-backup.md §4）：
 * MKCOL（幂等，409 视为成功）/ PUT / GET / PROPFIND Depth 0&1 / DELETE。
 * 刻意不实现：LOCK（时间戳文件名天然免冲突）、MOVE、ETag/If-Match
 * （KOReader 弱 ETag 412 死循环坑，见 research/webdav-backup-patterns.md）。
 *
 * <p>纯 Java（无 Android 依赖），PROPFIND multistatus 用宽松的正则解析
 * （只取 href / resourcetype:collection / getcontentlength；服务器命名空间
 * 前缀各异，Joplin 驱动先例——自托管服务器差异是第一大错误来源）。
 *
 * <p>错误分类映射（spec §5）：401 认证 / 403 拒绝 / 404 路径 / 507 配额 /
 * 412 冲突 / 网络中断 / 其他（含原始状态码）。
 */
public class WebDavClient {

    /** 错误分类（用户可读文案由调用层映射） */
    public enum Kind {
        AUTH_FAILED,    // 401
        FORBIDDEN,      // 403
        NOT_FOUND,      // 404
        QUOTA_EXCEEDED, // 507
        CONFLICT,       // 412
        NETWORK,        // 连接/超时/IO
        SERVER          // 其他 4xx/5xx
    }

    /** 分类后的 WebDAV 异常 */
    public static class DavException extends IOException {
        public final Kind kind;
        public final int statusCode;

        public DavException(Kind kind, int statusCode, String message) {
            super(message);
            this.kind = kind;
            this.statusCode = statusCode;
        }
    }

    /** PROPFIND 返回的单个资源条目 */
    public static final class DavEntry {
        public final String href;           // 原始 href（URL 编码）
        public final boolean isCollection;  // resourcetype 含 collection
        public final Long contentLength;    // getcontentlength，缺省 null

        public DavEntry(String href, boolean isCollection, Long contentLength) {
            this.href = href;
            this.isCollection = isCollection;
            this.contentLength = contentLength;
        }
    }

    private static final MediaType XML_MEDIA_TYPE =
            MediaType.parse("application/xml; charset=utf-8");
    private static final MediaType OCTET_STREAM =
            MediaType.parse("application/octet-stream");

    private static final Pattern HREF = Pattern.compile(
            "(?is)<(?:[a-z0-9_-]+:)?href\\s*>([^<]*)</(?:[a-z0-9_-]+:)?href\\s*>");
    private static final Pattern COLLECTION = Pattern.compile(
            "(?is)<(?:[a-z0-9_-]+:)?collection\\s*/?\\s*>");
    private static final Pattern GETCONTENTLENGTH = Pattern.compile(
            "(?is)<(?:[a-z0-9_-]+:)?getcontentlength\\s*>(\\d+)</(?:[a-z0-9_-]+:)?getcontentlength\\s*>");
    /** 一个 <D:response> 块 */
    private static final Pattern RESPONSE_BLOCK = Pattern.compile(
            "(?is)<(?:[a-z0-9_-]+:)?response\\s*>(.*?)</(?:[a-z0-9_-]+:)?response\\s*>");

    private final OkHttpClient http;
    private final String user;
    private final String password;

    public WebDavClient(String user, String password) {
        this(user, password, 15_000);
    }

    WebDavClient(String user, String password, int timeoutMs) {
        this.user = user;
        this.password = password;
        this.http = new OkHttpClient.Builder()
                .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .build();
    }

    /** MKCOL 建目录：2xx 成功；409（已存在）视为成功（幂等语义） */
    public void ensureDir(String url) throws IOException {
        Request req = authed(new Request.Builder().url(url).method("MKCOL", null).build());
        try (Response res = execute(req)) {
            if (res.code() == 409) return;
            if (res.isSuccessful()) return;
            throw classify(res.code(), "MKCOL " + url);
        }
    }

    /** PUT 上传字节 */
    public void upload(String url, byte[] body) throws IOException {
        Request req = authed(new Request.Builder().url(url)
                .method("PUT", RequestBody.create(body, OCTET_STREAM))
                .build());
        try (Response res = execute(req)) {
            if (res.isSuccessful()) return;
            throw classify(res.code(), "PUT " + url);
        }
    }

    /**
     * 带写后校验的上传（spec §5 原子性）：PUT → PROPFIND Depth 0 校验
     * getcontentlength 与本地字节数相等；不等重试，最多 {@code maxAttempts} 次。
     * 仍失败抛 DavException（kind=SERVER），旧档由调用层保留。
     */
    public void uploadWithVerify(String url, byte[] body, int maxAttempts) throws IOException {
        IOException last = null;
        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                upload(url, body);
                DavEntry stat = stat(url);
                if (stat.contentLength != null && stat.contentLength == body.length) return;
                last = new DavException(Kind.SERVER, -1,
                        "写后校验失败（第 " + attempt + " 次，远端大小不一致）");
            } catch (IOException e) {
                last = e;
            }
        }
        throw last != null ? last : new DavException(Kind.SERVER, -1, "uploadWithVerify 失败");
    }

    /** GET 下载字节 */
    public byte[] download(String url) throws IOException {
        Request req = authed(new Request.Builder().url(url).get().build());
        try (Response res = execute(req)) {
            if (!res.isSuccessful()) throw classify(res.code(), "GET " + url);
            ResponseBody resBody = res.body();
            return resBody != null ? resBody.bytes() : new byte[0];
        }
    }

    /** PROPFIND Depth 0：单资源 stat */
    public DavEntry stat(String url) throws IOException {
        List<DavEntry> entries = propfind(url, 0);
        if (entries.isEmpty()) {
            throw new DavException(Kind.NOT_FOUND, 404, "PROPFIND 无返回条目: " + url);
        }
        return entries.get(0);
    }

    /** PROPFIND Depth 1：列目录 */
    public List<DavEntry> list(String url) throws IOException {
        return propfind(url, 1);
    }

    /** DELETE 删除资源 */
    public void delete(String url) throws IOException {
        Request req = authed(new Request.Builder().url(url).delete().build());
        try (Response res = execute(req)) {
            if (res.isSuccessful() || res.code() == 404) return; // 404 视为已删除（旋转幂等）
            throw classify(res.code(), "DELETE " + url);
        }
    }

    /**
     * 旋转（spec §5）：列目录后按文件名升序保留最近 {@code keep} 个匹配
     * {@code prefix} 的文件，删除超额旧档。删除失败仅记日志不阻塞（调用层
     * 聚合 warn）。返回删除的文件 href 列表。
     */
    public List<String> prune(String dirUrl, String prefix, int keep) throws IOException {
        List<DavEntry> entries = list(dirUrl);
        List<String> candidates = new ArrayList<>();
        for (DavEntry e : entries) {
            String name = lastSegment(e.href);
            if (!e.isCollection && name.startsWith(prefix)) candidates.add(e.href);
        }
        candidates.sort(String::compareTo);
        List<String> deleted = new ArrayList<>();
        while (candidates.size() > keep) {
            String href = candidates.remove(0);
            try {
                delete(absolute(dirUrl, href));
                deleted.add(href);
            } catch (IOException e) {
                System.err.println("[WebDavClient] prune 删除失败（不阻塞）: " + href + " - " + e.getMessage());
            }
        }
        return deleted;
    }

    // ── 内部 ──

    private List<DavEntry> propfind(String url, int depth) throws IOException {
        RequestBody body = RequestBody.create(
                "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
                        + "<propfind xmlns=\"DAV:\"><prop>"
                        + "<resourcetype/><getcontentlength/>"
                        + "</prop></propfind>",
                XML_MEDIA_TYPE);
        Request req = authed(new Request.Builder().url(url)
                .method("PROPFIND", body)
                .header("Depth", String.valueOf(depth))
                .build());
        try (Response res = execute(req)) {
            if (res.code() == 404) throw classify(404, "PROPFIND " + url);
            if (!res.isSuccessful()) throw classify(res.code(), "PROPFIND " + url);
            ResponseBody resBody = res.body();
            return parseMultistatus(resBody != null ? resBody.string() : "");
        }
    }

    /** 宽松解析 multistatus：按 response 块切分，块内取 href/collection/getcontentlength */
    static List<DavEntry> parseMultistatus(String xml) {
        List<DavEntry> out = new ArrayList<>();
        Matcher block = RESPONSE_BLOCK.matcher(xml);
        while (block.find()) {
            String chunk = block.group(1);
            Matcher href = HREF.matcher(chunk);
            if (!href.find()) continue;
            boolean isCollection = COLLECTION.matcher(chunk).find();
            Long length = null;
            Matcher len = GETCONTENTLENGTH.matcher(chunk);
            if (len.find()) {
                try {
                    length = Long.parseLong(len.group(1));
                } catch (NumberFormatException ignored) {
                    length = null; // 非标准返回（Joplin 逐服务器兼容先例），降级为未知
                }
            }
            out.add(new DavEntry(href.group(1).trim(), isCollection, length));
        }
        return out;
    }

    /**
     * href 转绝对 URL（RFC 4918：href 可为完整 URL、绝对路径或相对路径——
     * 自托管服务器三种都常见，Nextcloud 返回绝对路径）：
     * 完整 URL 原样返回；绝对路径继承 dirUrl 的 scheme+host；
     * 相对路径拼到目录 URL 上。
     */
    static String absolute(String dirUrl, String href) {
        if (href.startsWith("http://") || href.startsWith("https://")) return href;
        if (href.startsWith("/")) {
            int schemeEnd = dirUrl.indexOf("://");
            int pathStart = schemeEnd >= 0 ? dirUrl.indexOf('/', schemeEnd + 3) : -1;
            String origin = pathStart >= 0 ? dirUrl.substring(0, pathStart) : dirUrl;
            return origin + href;
        }
        String base = dirUrl.endsWith("/") ? dirUrl : dirUrl + "/";
        return base + href;
    }

    private static String lastSegment(String href) {
        String trimmed = href.endsWith("/") ? href.substring(0, href.length() - 1) : href;
        int idx = trimmed.lastIndexOf('/');
        return idx >= 0 ? trimmed.substring(idx + 1) : trimmed;
    }

    private Request authed(Request req) {
        if (user == null || user.isEmpty()) return req;
        return req.newBuilder()
                .header("Authorization", Credentials.basic(user, password != null ? password : ""))
                .build();
    }

    private Response execute(Request req) throws IOException {
        try {
            return http.newCall(req).execute();
        } catch (IOException e) {
            throw new DavException(Kind.NETWORK, -1, "网络错误: " + e.getMessage());
        }
    }

    private static DavException classify(int code, String op) {
        Kind kind;
        switch (code) {
            case 401: kind = Kind.AUTH_FAILED; break;
            case 403: kind = Kind.FORBIDDEN; break;
            case 404: kind = Kind.NOT_FOUND; break;
            case 412: kind = Kind.CONFLICT; break;
            case 507: kind = Kind.QUOTA_EXCEEDED; break;
            default:  kind = Kind.SERVER; break;
        }
        return new DavException(kind, code, op + " → HTTP " + code);
    }

    /** 大小写无关的后缀匹配（旋转/选档筛选用） */
    static boolean hasExtension(String name, String ext) {
        return name.toLowerCase(Locale.ROOT).endsWith(ext.toLowerCase(Locale.ROOT));
    }
}
