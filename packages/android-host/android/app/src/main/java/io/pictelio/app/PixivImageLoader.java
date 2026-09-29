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
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

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
 *   <li>下载源决策（ADR-0143 D1/D4）：{@link ImageHostConfig#resolve} 决定镜像/官方下载源，
 *       镜像失败回退官方一次；<b>缓存键恒官方 URL</b>（D2 源无关命中不变量，本类缓存路径
 *       只认官方入参，不消费 resolve 返回值）</li>
 * </ul>
 *
 * <p>消费方（薄适配，不复制逻辑）：{@code MainActivity.interceptImage}（webview 流形态）、
 * {@code PictelioImageService}（Lynx Bitmap 形态，见 #58/#59）。
 *
 * <p>非 final 是<b>测试缝</b>：{@link NovelExporter} 的取图注入要求测试可覆盖
 * {@link #loadBytes(String)} 提供确定性字节（生产调用方零影响，公开 API 不变）。
 */
public class PixivImageLoader {

    /** 下载进度回调（done/total 字节；total <= 0 表示长度未知） */
    public interface ProgressSink {
        void onProgress(long done, long total);
    }

    /** 取消信号（true = 请求取消，读取循环抛 IOException 中止） */
    public interface Cancellation {
        boolean isCancelled();
    }

    private static final String TAG = "PixivImageLoader";
    /** 缓存目录名（对齐 OAuthConfig.CACHE_DIR / PixivApiPlugin.CACHE_DIR_NAME） */
    private static final String CACHE_DIR_NAME = "pictelio-images";
    /** 镜像下载预算（实现定值：connect 5s / call 15s，低于官方 connect 15s / read 30s / call 45s
     *  ——ADR-0143 D4「低于官方」的具体化；劣化镜像快失败，不拖慢官方回退） */
    private static final int MIRROR_CONNECT_TIMEOUT_SECONDS = 5;
    private static final int MIRROR_CALL_TIMEOUT_SECONDS = 15;
    /** 流式进度上报粒度（字节）：约每 64KB 或收尾各一次，避免大文件回调风暴 */
    private static final long PROGRESS_REPORT_BYTES = 64 * 1024;

    private final Context context;
    private final OkHttpClient client;
    private final long maxCacheBytes;
    /** 图床下载源决策（ADR-0143 D1 深模块；resolve 不命中时行为与既有官方路径逐字节一致） */
    private final ImageHostConfig imageHostConfig;
    /** per-URL 锁：并发同 URL 加载时避免截断写同一缓存文件（webview 拦截为多线程） */
    private final ConcurrentHashMap<String, Object> urlLocks = new ConcurrentHashMap<>();

    public PixivImageLoader(Context context) {
        this(context, PixivApiCore.getSharedClient(), OAuthConfig.CACHE_MAX_BYTES);
    }

    /** 包可见注入构造（测试注入 mock 网络与可触发淘汰的小缓存上限）；图床配置默认走生产单例 */
    PixivImageLoader(Context context, OkHttpClient client, long maxCacheBytes) {
        this(context, client, maxCacheBytes, ImageHostConfig.get(context));
    }

    /** 全注入构造（包可见）：测试注入固定图床配置，不触生产单例与 SharedPreferences */
    PixivImageLoader(Context context, OkHttpClient client, long maxCacheBytes,
            ImageHostConfig imageHostConfig) {
        this.context = context.getApplicationContext();
        this.client = client;
        this.maxCacheBytes = maxCacheBytes;
        this.imageHostConfig = imageHostConfig;
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

    // ── 下载（Referer/UA 注入防盗链；下载源跟随图床，缓存键恒官方——ADR-0143 D1/D2/D4） ──

    /**
     * 下载图片字节；非 2xx 或空 body 抛 IOException。
     *
     * <p>下载源决策（ADR-0143 D1/D4）：{@link ImageHostConfig#resolve} 命中镜像时先走镜像
     * （专用预算 client：connect 5s / call 15s，newBuilder 复用共享连接池/线程池，不新建全局单例），
     * 失败（IOException/非 2xx）Log.w 后以官方 URL 重试一次；重试仍失败抛镜像原始异常
     * （ticket #378 申报语义——失败上下文已由 Log.w 记录，抛出侧保持首次失败现场）。
     * resolve 恒等（图床关/配置损坏/无可用 host）时与既有官方路径逐字节一致（回归保护）。
     * <b>缓存键恒官方 URL</b>（D2 源无关命中）：本方法不触缓存，调用方 loadFile/loadBytes
     * 继续以官方入参寻址——换源/开关图床/换镜像均不使已缓存条目失效。
     */
    public byte[] download(String url) throws IOException {
        String downloadUrl = imageHostConfig.resolve(url);
        if (!Objects.equals(downloadUrl, url)) {
            // 镜像生效：预算仅用于镜像请求（官方回退保持现有 client，避免镜像预算缩窄官方通路）
            OkHttpClient mirrorClient = client.newBuilder()
                    .connectTimeout(MIRROR_CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                    .callTimeout(MIRROR_CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                    .build();
            try {
                return fetch(mirrorClient, downloadUrl);
            } catch (IOException mirrorError) {
                Log.w(TAG, "镜像下载失败，回退官方: " + url, mirrorError);
                try {
                    return fetch(client, url);
                } catch (IOException officialError) {
                    throw mirrorError; // 申报语义：重试仍失败抛镜像原始异常（ticket #378）
                }
            }
        }
        return fetch(client, url);
    }

    /** 单次 HTTP 请求：Referer/UA 注入（i.pximg.net 防盗链契约，镜像站代理官方资源同样适用） */
    private static byte[] fetch(OkHttpClient client, String url) throws IOException {
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

    // ── 流式加载（下载队列：进度上报 + 可取消；字节直落缓存文件，不进 JS 堆） ──

    /**
     * 流式加载：缓存命中直接返回；未命中流式下载并原子写盘，全程按字节回调进度、响应取消。
     * 与 {@link #loadFile(String)} 同缓存键/下载源/镜像回退语义（ADR-0143 不偏离）。
     */
    public File loadFileWithProgress(String url, ProgressSink sink, Cancellation cancel)
            throws IOException {
        File cached = cachedFile(url);
        if (cached != null) {
            reportDone(sink, cached.length());
            return cached;
        }
        Object lock = urlLocks.computeIfAbsent(url, k -> new Object());
        synchronized (lock) {
            cached = cachedFile(url);
            if (cached != null) {
                reportDone(sink, cached.length());
                return cached;
            }
            File target = new File(getCacheDir(), keyToFilename(url));
            downloadToFile(url, target, sink, cancel);
            enforceCacheLimit();
            return target;
        }
    }

    private static void reportDone(ProgressSink sink, long len) {
        if (sink != null) {
            sink.onProgress(len, len);
        }
    }

    private void downloadToFile(String url, File target, ProgressSink sink, Cancellation cancel)
            throws IOException {
        String downloadUrl = imageHostConfig.resolve(url);
        File tmp = new File(target.getAbsolutePath() + ".tmp");
        try {
            if (!Objects.equals(downloadUrl, url)) {
                OkHttpClient mirrorClient = client.newBuilder()
                        .connectTimeout(MIRROR_CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                        .callTimeout(MIRROR_CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                        .build();
                try {
                    fetchToFile(mirrorClient, downloadUrl, tmp, sink, cancel);
                } catch (IOException mirrorError) {
                    Log.w(TAG, "镜像下载失败，回退官方: " + url, mirrorError);
                    try {
                        fetchToFile(client, url, tmp, sink, cancel);
                    } catch (IOException officialError) {
                        throw mirrorError;
                    }
                }
            } else {
                fetchToFile(client, url, tmp, sink, cancel);
            }
            atomicReplace(tmp, target);
        } catch (IOException e) {
            if (!tmp.delete()) {
                Log.w(TAG, "tmp 清理失败（留待容量淘汰/清空缓存回收）: " + tmp);
            }
            throw e;
        }
    }

    /** 单次流式 HTTP 请求：Referer/UA 注入 + 8KB 分块 + 进度节流 + 取消检查 */
    private static void fetchToFile(OkHttpClient client, String url, File tmp, ProgressSink sink,
            Cancellation cancel) throws IOException {
        if (cancel != null && cancel.isCancelled()) {
            throw new IOException("下载已取消: " + url);
        }
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
            long total = response.body().contentLength();
            long done = 0;
            long lastReported = 0;
            byte[] buf = new byte[8192];
            try (InputStream in = response.body().byteStream();
                 OutputStream out = new FileOutputStream(tmp)) {
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (cancel != null && cancel.isCancelled()) {
                        throw new IOException("下载已取消: " + url);
                    }
                    out.write(buf, 0, n);
                    done += n;
                    if (sink != null && (done - lastReported >= PROGRESS_REPORT_BYTES
                            || (total > 0 && done >= total))) {
                        lastReported = done;
                        sink.onProgress(done, total);
                    }
                }
            }
            if (done == 0) {
                throw new IOException("图片响应为空 body: " + url);
            }
            if (sink != null && lastReported < done) {
                sink.onProgress(done, total > 0 ? total : done);
            }
        }
    }

    /** 原子替换（与 {@link #writeFile} 同纪律）：rename 优先，失败删旧目标重试一次 */
    private static void atomicReplace(File tmp, File target) throws IOException {
        if (tmp.renameTo(target)) {
            return;
        }
        if (target.exists() && !target.delete()) {
            throw new IOException("无法删除旧缓存文件: " + target);
        }
        if (!tmp.renameTo(target)) {
            throw new IOException("rename 失败: " + tmp + " -> " + target);
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

    /**
     * 原子写盘（B5/诊断 F3）：先写同目录临时文件，成功后 rename 原子替换目标。
     * 直接 FileOutputStream(目标) 时，prefetchImage 与拦截链路并发写同一文件可能
     * 交错产生截断文件，而 cachedFile 仅查 exists+length>0，截断文件会被当命中
     * 持久返回坏图。失败路径清理 tmp 并上抛，目标保持原内容不被半截写入污染。
     * 包可见：prefetchImage（webview 源集）与拦截链路共享同一写盘纪律。
     */
    static void writeFile(File file, byte[] bytes) throws IOException {
        File tmp = new File(file.getAbsolutePath() + ".tmp");
        try {
            try (FileOutputStream fos = new FileOutputStream(tmp)) {
                fos.write(bytes);
                fos.flush();
            }
            if (!tmp.renameTo(file)) {
                // 个别文件系统的 rename 不覆盖已存在目标：先删旧目标再重试一次
                if (file.exists() && !file.delete()) {
                    throw new IOException("无法删除旧缓存文件: " + file);
                }
                if (!tmp.renameTo(file)) {
                    throw new IOException("rename 失败: " + tmp + " -> " + file);
                }
            }
        } catch (IOException e) {
            if (!tmp.delete()) {
                Log.w(TAG, "tmp 清理失败（留待容量淘汰/清空缓存回收）: " + tmp);
            }
            throw e;
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
