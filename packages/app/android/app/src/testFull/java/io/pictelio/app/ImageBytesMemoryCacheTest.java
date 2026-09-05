package io.pictelio.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicReference;

/**
 * {@link ImageBytesMemoryCache} 单测（X1）。
 *
 * <p>可测性：包可见构造注入小上限 + 同步 executor（{@code Runnable::run}，
 * backfill 在调用线程内直接执行，测试确定性无 latch 轮询）。
 *
 * <p>oracle 溯源（AGENTS.md 测试硬约束 6）：
 * - 上限/单条/淘汰语义 = docs/specs/webview-perf-round2.md §3 第 3 条（32MB/512KB/putBounded
 *   超限 no-op/backfill 单线程 daemon + 去重/失败不入缓存）；
 * - LRU 淘汰与 totalBytes 不变量 = 独立语义来源 {@link LruCache} 契约
 *   （put 后总字节超限从最旧逐出，单条超限逐出至空）；
 * - backfill 三路径期望值 = spec 列明的行为（成功入缓存 / 缺失不抛 / 超限拒绝）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class ImageBytesMemoryCacheTest {

    /** 同步 executor：execute 直接在调用线程运行（backfill 测试确定性） */
    private static final Executor DIRECT = Runnable::run;

    private static byte[] payload(int size, int seed) {
        byte[] bytes = new byte[size];
        for (int i = 0; i < size; i++) bytes[i] = (byte) (seed + i);
        return bytes;
    }

    private ImageBytesMemoryCache newCache(long maxBytes, long maxEntryBytes) {
        return new ImageBytesMemoryCache(maxBytes, maxEntryBytes, DIRECT);
    }

    // ── 基础读写 ──

    @Test
    public void putBounded_thenGet_roundTrips() {
        ImageBytesMemoryCache cache = newCache(1024, 512);
        byte[] bytes = payload(64, 0);
        cache.putBounded("k1", bytes);
        assertArrayEquals(bytes, cache.get("k1"));
        assertEquals(64, cache.totalBytes());
        assertEquals(1, cache.size());
    }

    @Test
    public void get_missingKey_returnsNull() {
        ImageBytesMemoryCache cache = newCache(1024, 512);
        assertNull(cache.get("absent"));
        assertEquals(0, cache.totalBytes());
    }

    // ── LRU 淘汰（不变量：totalBytes ≤ maxBytes） ──

    @Test
    public void lruEviction_oldestEvicted_totalStaysWithinMax() {
        ImageBytesMemoryCache cache = newCache(100, 512);
        byte[] a = payload(60, 0);
        byte[] b = payload(60, 1);
        cache.putBounded("a", a);
        assertTrue("put 后总字节不得超上限", cache.totalBytes() <= 100);
        cache.putBounded("b", b);
        assertTrue("put 后总字节不得超上限", cache.totalBytes() <= 100);
        // a 最旧 → 被逐出；b 保留
        assertNull("最旧条目应被逐出", cache.get("a"));
        assertArrayEquals(b, cache.get("b"));
        assertEquals(60, cache.totalBytes());
    }

    @Test
    public void lruAccessRefresh_recentlyUsedSurvives() {
        ImageBytesMemoryCache cache = newCache(150, 512);
        byte[] a = payload(60, 0);
        byte[] b = payload(60, 1);
        byte[] c = payload(60, 2);
        cache.putBounded("a", a);
        cache.putBounded("b", b);
        cache.get("a"); // 访问刷新：a 变为最近使用，b 成为最旧
        cache.putBounded("c", c); // 总 180 > 150 → 逐出 b
        assertNull("最久未使用（b）应被逐出", cache.get("b"));
        assertArrayEquals(a, cache.get("a"));
        assertArrayEquals(c, cache.get("c"));
        assertTrue(cache.totalBytes() <= 150);
    }

    // ── putBounded 有界写入 ──

    @Test
    public void putBounded_overEntryLimit_nullAndEmpty_rejected() {
        ImageBytesMemoryCache cache = newCache(1024, 64);
        cache.putBounded("big", payload(65, 0)); // 超单条上限 → no-op
        assertNull(cache.get("big"));
        cache.putBounded("null", null); // null → no-op
        assertNull(cache.get("null"));
        cache.putBounded("empty", new byte[0]); // 空字节 → no-op
        assertNull(cache.get("empty"));
        assertEquals("拒绝路径不得改变缓存状态", 0, cache.totalBytes());
        assertEquals(0, cache.size());
    }

    // ── 并发安全（8 线程） ──

    @Test
    public void concurrentPut_8threads_invariantsHold() throws Exception {
        // 上限 400B（恰容 4 条 100B）：并发写入必然触发并发淘汰，考察不变量
        ImageBytesMemoryCache cache = newCache(400, 512);
        int threads = 8;
        CountDownLatch start = new CountDownLatch(1);
        AtomicReference<Exception> failure = new AtomicReference<>();
        Thread[] workers = new Thread[threads];
        for (int i = 0; i < threads; i++) {
            final int seed = i;
            workers[i] = new Thread(() -> {
                try {
                    start.await();
                    cache.putBounded("k" + seed, payload(100, seed));
                } catch (Exception e) {
                    failure.set(e);
                }
            });
            workers[i].start();
        }
        start.countDown();
        for (Thread t : workers) t.join(5000);
        assertNull("并发写入不应抛错", failure.get());
        // 不变量 1：总字节恒不超上限
        assertTrue("并发下 totalBytes 不得超上限", cache.totalBytes() <= 400);
        // 不变量 2：条目数与总字节一致，且存留条目内容完整（无截断/串写）
        assertEquals(cache.totalBytes(), cache.size() * 100L);
        for (int i = 0; i < threads; i++) {
            byte[] got = cache.get("k" + i);
            if (got != null) {
                assertArrayEquals(payload(100, i), got);
            }
        }
    }

    // ── backfillFromFile 三路径（DIRECT executor → 同步执行） ──

    private File writeTempFile(String name, byte[] bytes) throws Exception {
        Context ctx = ApplicationProvider.getApplicationContext();
        File file = new File(ctx.getCacheDir(), name);
        try (FileOutputStream fos = new FileOutputStream(file)) {
            fos.write(bytes);
        }
        file.deleteOnExit();
        return file;
    }

    @Test
    public void backfill_success_cachesFileBytes() throws Exception {
        ImageBytesMemoryCache cache = newCache(1024, 512);
        byte[] content = payload(200, 7);
        File file = writeTempFile("bf-ok.bin", content);
        cache.backfillFromFile("k", file);
        assertArrayEquals(content, cache.get("k"));
        assertEquals(200, cache.totalBytes());
    }

    @Test
    public void backfill_missingFile_notCachedAndNoThrow() {
        ImageBytesMemoryCache cache = newCache(1024, 512);
        Context ctx = ApplicationProvider.getApplicationContext();
        File absent = new File(ctx.getCacheDir(), "bf-absent-does-not-exist.bin");
        cache.backfillFromFile("k", absent); // 不抛
        assertNull(cache.get("k"));
        assertEquals(0, cache.totalBytes());
        cache.backfillFromFile("k2", null); // null file 同样安全
        assertNull(cache.get("k2"));
    }

    @Test
    public void backfill_overLimitFile_notCached() throws Exception {
        // 单条上限 64B：100B 文件提前短路（连磁盘读都省），不入缓存
        ImageBytesMemoryCache cache = newCache(1024, 64);
        File file = writeTempFile("bf-big.bin", payload(100, 3));
        cache.backfillFromFile("k", file);
        assertNull(cache.get("k"));
        assertEquals(0, cache.totalBytes());
    }

    // ── clear ──

    @Test
    public void clear_emptiesCacheAndPending() throws Exception {
        ImageBytesMemoryCache cache = newCache(1024, 512);
        cache.putBounded("a", payload(50, 0));
        cache.putBounded("b", payload(50, 1));
        File file = writeTempFile("bf-clear.bin", payload(50, 2));
        cache.backfillFromFile("c", file);
        assertEquals(3, cache.size());

        cache.clear();
        assertNull(cache.get("a"));
        assertNull(cache.get("b"));
        assertNull(cache.get("c"));
        assertEquals(0, cache.totalBytes());
        assertEquals(0, cache.size());
    }
}
