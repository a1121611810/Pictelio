package io.pictelio.app;

import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

/**
 * 图片字节内存 LRU（X1，spec webview-perf-round2 §3 第 3 条）——进程级静态单例，
 * 缓存 ≤{@link #MAX_ENTRY_BYTES} 的图片字节（缩略图/卡片图），供 /pixiv-img/ 拦截器
 * 内存命中快路径（零磁盘 IO、零网络）。
 *
 * <p>设计约束（spec 定死，实施不改）：
 * <ul>
 *   <li>零 Context 引用——进程单例随进程存活，不感知 Activity 生命周期；</li>
 *   <li>复用 main 源集泛型 {@link LruCache}（synchronized，多线程安全）；
 *       <b>不复用</b> Lynx 的 Bitmap LRU {@code ImageMemoryCache}（形态不同：byte[] vs Bitmap）；</li>
 *   <li>MAX_BYTES=32MB / 单条 ≤512KB——原图天然排除，Java Heap 增幅封顶（验收 ≤32MB）；</li>
 *   <li>{@link #backfillFromFile} 走单线程 daemon 低优先级线程 + pending 去重：
 *       拦截线程绝不回读磁盘。</li>
 * </ul>
 *
 * <p>填充点（spec §3）：① 拦截 miss 下载完成（字节已在手）
 * ② {@code PixivApiPlugin.prefetchImage} 写盘成功（详情页预取热路径，价值最高）
 * ③ 拦截磁盘命中异步回填。
 */
public final class ImageBytesMemoryCache {

    private static final String TAG = "ImageBytesMemoryCache";

    /** 总字节上限：32MB */
    public static final long MAX_BYTES = 32L * 1024 * 1024;
    /** 单条上限：512KB（缩略图/卡片图进，原图排除） */
    public static final long MAX_ENTRY_BYTES = 512L * 1024;

    private static final ImageBytesMemoryCache INSTANCE = new ImageBytesMemoryCache();

    public static ImageBytesMemoryCache getInstance() {
        return INSTANCE;
    }

    private final LruCache<String, byte[]> cache;
    private final long maxEntryBytes;
    private final Executor backfillExecutor;
    /** backfill 在飞去重：同 key 任务未完成前不重复排队（并发拦截下防任务堆积） */
    private final ConcurrentHashMap<String, Boolean> pending = new ConcurrentHashMap<>();

    /** 生产单例：32MB 上限 + 单线程 daemon 低优先级 backfill 线程（img-bytes-backfill） */
    private ImageBytesMemoryCache() {
        this(MAX_BYTES, MAX_ENTRY_BYTES, Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "img-bytes-backfill");
            t.setDaemon(true); // 纯缓存回填，不阻塞 JVM/进程退出
            t.setPriority(Thread.MIN_PRIORITY); // 后台搬运，让位渲染/网络线程
            return t;
        }));
    }

    /** 包可见注入构造（测试注入小上限与同步/可控 executor，保证可测性） */
    ImageBytesMemoryCache(long maxBytes, long maxEntryBytes, Executor backfillExecutor) {
        this.cache = new LruCache<>(maxBytes, (key, bytes) -> bytes.length);
        this.maxEntryBytes = maxEntryBytes;
        this.backfillExecutor = backfillExecutor;
    }

    /** 内存命中（并刷新 LRU 顺序）；未命中返回 null */
    public byte[] get(String key) {
        return cache.get(key);
    }

    /**
     * 有界写入：null/空字节或超单条上限时 no-op（原图 &gt;512KB 天然排除，
     * 避免单张原图挤穿 32MB 总上限）。
     */
    public void putBounded(String key, byte[] bytes) {
        if (bytes == null || bytes.length == 0) return;
        if (bytes.length > maxEntryBytes) return;
        cache.put(key, bytes);
    }

    /**
     * 磁盘命中后的异步回填（拦截线程绝不回读磁盘）：读盘放单线程 daemon 低优先级线程，
     * 同 key 在飞时去重跳过；读失败 Log.w 且不入缓存（禁止静默降级）；
     * 超单条上限的文件提前短路（连磁盘读都省掉），最终由 putBounded 双保险拒绝。
     */
    public void backfillFromFile(String key, File file) {
        if (file == null || !file.isFile() || file.length() <= 0) return;
        if (file.length() > maxEntryBytes) return;
        if (pending.putIfAbsent(key, Boolean.TRUE) != null) return;
        try {
            backfillExecutor.execute(() -> {
                try {
                    byte[] bytes = readAll(file);
                    if (bytes.length == 0) {
                        Log.w(TAG, "backfill 读到空文件，不入缓存: " + key);
                        return;
                    }
                    putBounded(key, bytes);
                } catch (Exception e) {
                    Log.w(TAG, "backfill 读盘失败，不入缓存: " + key, e);
                } finally {
                    pending.remove(key);
                }
            });
        } catch (RejectedExecutionException e) {
            // executor 已 shutdown（测试收尾/进程退出）：归还 pending 名额，
            // 避免该 key 在进程存活期内永远无法再回填
            pending.remove(key);
            Log.w(TAG, "backfill 任务被拒绝（executor 已关闭）: " + key, e);
        }
    }

    /** 清空（ImageCachePlugin.clearCache 联动：磁盘已删，内存必须同步失效） */
    public void clear() {
        cache.clear();
        pending.clear();
    }

    /** 当前总字节数（供测试不变量：恒 ≤ maxBytes） */
    public long totalBytes() {
        return cache.totalBytes();
    }

    /** 当前条目数（测试辅助） */
    public int size() {
        return cache.size();
    }

    private static byte[] readAll(File file) throws Exception {
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
