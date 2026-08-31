package io.pictelio.app;

import io.pictelio.app.config.OAuthConfig;

import android.content.Context;
import android.util.Base64;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Arrays;
import java.util.Comparator;
import java.util.concurrent.ConcurrentHashMap;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/**
 * 图片流水线公共核心（#57）——webview 拦截层与 Lynx 图片服务共用，单一事实源。
 *
 * <p>职责（均为唯一实现）：
 * <ul>
 *   <li>URL 重写：{@code /pixiv-img/{path}} → {@code OAuthConfig.IMAGE_CDN_URL + "/" + path}</li>
 *   <li>OkHttp 下载：注入 {@code Referer}/{@code User-Agent}（i.pximg.net 防盗链必需），
 *       复用 {@link PixivApiCore#getSharedClient()} 共享连接池</li>
 *   <li>磁盘缓存读写 + 淘汰：目录/文件名/上限沿用现有约定（{@code OAuthConfig.CACHE_DIR}、
 *       Base64 URL-safe no-padding 文件名、{@code CACHE_MAX_BYTES}），与
 *       {@code ImageCachePlugin}/{@code PixivApiPlugin.prefetchImage} 同规则 → 双 client 共享缓存</li>
 * </ul>
 *
 * <p>消费方（薄适配，不复制逻辑）：{@code MainActivity.interceptImage}（webview 流形态）、
 * {@code PictelioImageService}（Lynx Bitmap 形态，见 #58/#59）。
 */
public final class PixivImageLoader {

    private static final String TAG = "PixivImageLoader";
    /** 缓存目录名（对齐 OAuthConfig.CACHE_DIR / PixivApiPlugin.CACHE_DIR_NAME） */
    private static final String CACHE_DIR_NAME = "pictelio-images";

    private final Context context;
    private final OkHttpClient client;
    private final long maxCacheBytes;
    /** per-URL 锁：并发同 URL 加载时避免截断写同一缓存文件（webview 拦截为多线程） */
    private final ConcurrentHashMap<String, Object> urlLocks = new ConcurrentHashMap<>();

    public PixivImageLoader(Context context) {
        this(context, PixivApiCore.getSharedClient(), OAuthConfig.CACHE_MAX_BYTES);
    }

    /** 包可见注入构造（测试注入 mock 网络与可触发淘汰的小缓存上限） */
    PixivImageLoader(Context context, OkHttpClient client, long maxCacheBytes) {
        this.context = context.getApplicationContext();
        this.client = client;
        this.maxCacheBytes = maxCacheBytes;
    }

    // ── URL 重写（/pixiv-img/ → i.pximg.net） ─────────────────

    /** 代理路径重写为 CDN 绝对 URL（含 dot-segment normalize，对齐 MainActivity 既有行为）；非代理 URL 原样返回；null 返回 null */
    public static String rewriteUrl(String url) {
        if (url == null || !url.contains("/pixiv-img/")) {
            return url;
        }
        int idx = url.indexOf("/pixiv-img/");
        String path = url.substring(idx + "/pixiv-img/".length());
        String cdnUrl = OAuthConfig.IMAGE_CDN_URL + "/" + path;
        try {
            return new URI(cdnUrl).normalize().toString();
        } catch (URISyntaxException e) {
            // 非法 URI 字符（如未编码空格）：回退原始拼接，与既有 interceptImage 行为一致
            return cdnUrl;
        }
    }

    // ── 磁盘缓存（对齐 ImageCachePlugin/PixivApiPlugin 同规则） ─

    /** URL → 缓存文件名（Base64 URL-safe no-padding；同 keyToFilename 契约） */
    public static String keyToFilename(String url) {
        return Base64.encodeToString(url.getBytes(), Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    }

    public File getCacheDir() {
        File dir = new File(context.getCacheDir(), CACHE_DIR_NAME);
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    /** 缓存命中返回文件（非空）；未命中返回 null */
    public File cachedFile(String url) {
        File f = new File(getCacheDir(), keyToFilename(url));
        return f.exists() && f.length() > 0 ? f : null;
    }

    // ── 下载（Referer/UA 注入，防盗链契约） ───────────────────

    /** 下载图片字节；非 2xx 或空 body 抛 IOException */
    public byte[] download(String url) throws IOException {
        Request request = new Request.Builder()
                .url(url)
                .addHeader("Referer", OAuthConfig.REFERER)
                .addHeader("User-Agent", OAuthConfig.USER_AGENT)
                .build();
        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("图片下载失败 (HTTP " + response.code() + "): " + url);
            }
            if (response.body() == null) {
                throw new IOException("图片响应无 body: " + url);
            }
            byte[] bytes = response.body().bytes();
            if (bytes.length == 0) {
                throw new IOException("图片响应为空 body: " + url);
            }
            return bytes;
        }
    }

    // ── 加载（缓存优先；未命中下载 + 写盘 + 淘汰） ────────────

    /** 返回图片文件：缓存命中直接返回；未命中下载写盘并淘汰后返回；失败抛 IOException */
    public File loadFile(String url) throws IOException {
        File cached = cachedFile(url);
        if (cached != null) {
            return cached;
        }
        // per-URL 锁 + double-check：并发同 URL 只下载一次，避免截断写同一缓存文件
        Object lock = urlLocks.computeIfAbsent(url, k -> new Object());
        synchronized (lock) {
            cached = cachedFile(url);
            if (cached != null) {
                return cached;
            }
            byte[] bytes = download(url);
            File file = new File(getCacheDir(), keyToFilename(url));
            writeFile(file, bytes);
            enforceCacheLimit();
            return file;
        }
    }

    /** {@link #loadFile} 的字节形态（缓存命中读文件；未命中下载后直接返回字节并写盘） */
    public byte[] loadBytes(String url) throws IOException {
        File cached = cachedFile(url);
        if (cached != null) {
            return readAll(cached);
        }
        Object lock = urlLocks.computeIfAbsent(url, k -> new Object());
        synchronized (lock) {
            cached = cachedFile(url);
            if (cached != null) {
                return readAll(cached);
            }
            byte[] bytes = download(url);
            writeFile(new File(getCacheDir(), keyToFilename(url)), bytes);
            enforceCacheLimit();
            return bytes;
        }
    }

    // ── 淘汰（对齐 ImageCachePlugin.enforceCacheLimit） ────────

    private static void writeFile(File file, byte[] bytes) throws IOException {
        try (FileOutputStream fos = new FileOutputStream(file)) {
            fos.write(bytes);
            fos.flush();
        }
    }

    private void enforceCacheLimit() {
        File cacheDir = getCacheDir();
        File[] files = cacheDir.listFiles();
        if (files == null) {
            return;
        }
        long total = 0;
        for (File f : files) {
            total += f.length();
        }
        if (total <= maxCacheBytes) {
            return;
        }
        // 按最后修改时间升序（最旧在前），逐个删除直到低于上限
        Arrays.sort(files, Comparator.comparingLong(File::lastModified));
        for (File f : files) {
            if (total <= maxCacheBytes) {
                break;
            }
            total -= f.length();
            if (!f.delete()) {
                Log.w(TAG, "淘汰缓存文件失败: " + f.getName());
            }
        }
    }

    // ── Range/HEAD（ugoira range 流式取帧支撑，research 文档 §5 既定路径） ──

    /** Range 请求结果：字节 + 服务端总长（Content-Range "/总长" 解析；未知为 -1） */
    public static final class RangeResult {
        public final byte[] bytes;
        public final long total;

        RangeResult(byte[] bytes, long total) {
            this.bytes = bytes;
            this.total = total;
        }
    }

    /** HEAD 获取资源总长（Content-Length）；非 2xx / 无长度返回 -1（调用方降级） */
    public long downloadHeadLength(String url) throws IOException {
        Request request = new Request.Builder()
                .url(url)
                .head()
                .addHeader("Referer", OAuthConfig.REFERER)
                .addHeader("User-Agent", OAuthConfig.USER_AGENT)
                .build();
        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                return -1;
            }
            return parseContentLength(response.header("Content-Length"));
        }
    }

    /** Content-Length 头解析；缺失/非数字返回 -1（可测纯函数） */
    static long parseContentLength(String len) {
        if (len == null) {
            return -1;
        }
        try {
            return Long.parseLong(len);
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    /** GET + Range 头取闭区间 [start, end] 字节；要求 206 且字节数与请求一致；不写磁盘缓存 */
    public RangeResult downloadRange(String url, long start, long end) throws IOException {
        if (start < 0 || end < start) {
            throw new IOException("非法 Range 参数: " + start + "-" + end);
        }
        Request request = new Request.Builder()
                .url(url)
                .addHeader("Referer", OAuthConfig.REFERER)
                .addHeader("User-Agent", OAuthConfig.USER_AGENT)
                .addHeader("Range", "bytes=" + start + "-" + end)
                .build();
        try (Response response = client.newCall(request).execute()) {
            if (response.code() != 206) {
                throw new IOException("Range 请求失败 (HTTP " + response.code() + "): " + url);
            }
            if (response.body() == null) {
                throw new IOException("Range 响应无 body: " + url);
            }
            byte[] bytes = response.body().bytes();
            long expected = end - start + 1;
            if (bytes.length != expected) {
                throw new IOException("Range 字节数不符 (" + bytes.length + "/" + expected + "): " + url);
            }
            return new RangeResult(bytes, parseContentRangeTotal(response.header("Content-Range")));
        }
    }

    /** 解析 Content-Range "bytes s-e/总长" 的 / 总长；未知返回 -1 */
    private static long parseContentRangeTotal(String contentRange) {
        if (contentRange == null) {
            return -1;
        }
        int slash = contentRange.lastIndexOf('/');
        if (slash < 0) {
            return -1;
        }
        try {
            return Long.parseLong(contentRange.substring(slash + 1).trim());
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    /** 缓存文件闭区间 [start, end] 切片（Range 命中磁盘缓存用）；越界抛 IOException */
    public static byte[] sliceFile(File file, long start, long end) throws IOException {
        long len = file.length();
        if (start < 0 || end < start || end >= len) {
            throw new IOException("切片越界: " + start + "-" + end + " (len=" + len + ")");
        }
        long size = end - start + 1;
        if (size > Integer.MAX_VALUE) {
            throw new IOException("切片过大: " + size);
        }
        byte[] buf = new byte[(int) size];
        try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
            raf.seek(start);
            raf.readFully(buf);
        }
        return buf;
    }

    /** 解析 Range 头单段 "bytes=start-end" / "bytes=start-"；非单段/畸形/负偏移返回 null */
    public static long[] parseRangeHeader(String range) {
        if (range == null || !range.startsWith("bytes=")) {
            return null;
        }
        try {
            String spec = range.substring("bytes=".length());
            if (spec.contains(",")) {
                return null;
            }
            int dash = spec.indexOf('-');
            if (dash < 0) {
                return null;
            }
            long start = Long.parseLong(spec.substring(0, dash).trim());
            if (start < 0) {
                return null;
            }
            String endStr = spec.substring(dash + 1).trim();
            long end = endStr.isEmpty() ? -1 : Long.parseLong(endStr);
            return new long[] { start, end };
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static byte[] readAll(File file) throws IOException {
        try (FileInputStream fis = new FileInputStream(file);
             ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = fis.read(buf)) != -1) {
                bos.write(buf, 0, n);
            }
            return bos.toByteArray();
        }
    }
}
