package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.util.Base64;

import androidx.test.core.app.ApplicationProvider;

import com.lynx.tasm.image.ImageContent;
import com.lynx.tasm.image.model.ImageInfo;
import com.lynx.tasm.image.model.ImageLoadListener;
import com.lynx.tasm.image.model.ImageRequestInfo;
import com.lynx.tasm.image.model.ImageRequestInfoBuilder;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.File;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;

/**
 * 图片两层缓存可观测统计（#983）——<b>统计口径的钉死处</b>。
 *
 * <h3>本类钉死的口径（票面写死的三句）</h3>
 * <ol>
 *   <li>分母 = <b>图片加载请求总数</b>（每次进入内存层探测记 1）；</li>
 *   <li>分子 = <b>内存命中数 + 磁盘命中数</b>；</li>
 *   <li>累计量<b>跨进程重启累积</b>（不清零）。</li>
 * </ol>
 * 口径若可被实现悄悄改动，这三类断言（{@code hitRate_*}、{@code persistence_*}）即失效——
 * 而命中率正是后续优化决策的唯一依据（ADR-0222 §3.3：先能观测，再谈策略是否够用），
 * 故这些断言是本票的核心产物，不是附属检查。
 *
 * <h3>oracle 溯源（测试硬约束 #6）</h3>
 * 期望值只取四类独立来源，<b>没有一处从被测实现反推</b>：
 * <ol>
 *   <li><b>MockWebServer {@code getRequestCount()}</b>——真实网络请求次数，
 *       用来交叉验证「命中/未命中」的划分确实对应「是否触网」；</li>
 *   <li><b>用例内置的 1×1 PNG 字面量</b>（{@link #PNG_1PX}）——磁盘占用字节数的独立出处；</li>
 *   <li><b>口径本身</b>（票面写死的定义）——如 3 次请求 2 次命中 ⇒ 命中率 2/3；</li>
 *   <li><b>SharedPreferences 原始读数</b>（{@code getAll().isEmpty()}）——
 *       验证批量落盘时机，不依赖被测实现的私有字段。</li>
 * </ol>
 *
 * <h3>如何制造互斥的两层命中（不靠实现细节）</h3>
 * 内存命中与磁盘命中用<b>排除法</b>分开钉：内存命中场景下删掉磁盘条目（磁盘已不可能供给），
 * 磁盘命中场景下清空内存层（内存已不可能供给）。两者都伴随「网络请求数不增长」这一外部事实。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class ImageCacheStatsTest {

    /** 1×1 透明 PNG（用例内置字面量，非被测实现反推）；其字节长度即磁盘占用期望值 */
    private static final byte[] PNG_1PX = Base64.decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            Base64.DEFAULT);

    private MockWebServer server;
    private Context ctx;
    private ImageMemoryCache memoryCache;
    private PictelioImageService service;
    private SharedPreferences statsPrefs;

    @Before
    public void setUp() throws Exception {
        server = new MockWebServer();
        server.start();
        ctx = ApplicationProvider.getApplicationContext();
        // 统计介质与单例都要归零，否则累计量会跨例渗漏（口径断言最怕这种污染）
        statsPrefs = ctx.getSharedPreferences(ImageCacheStatsStore.PREFS_NAME, Context.MODE_PRIVATE);
        statsPrefs.edit().clear().commit();
        ImageCacheStatsStore.resetSingletonForTest();

        memoryCache = new ImageMemoryCache(64L * 1024 * 1024);
        clearDiskCache();
        service = new PictelioImageService(memoryCache);
        service.onInitialize(ctx);
    }

    @After
    public void tearDown() throws Exception {
        server.shutdown();
        ImageCacheStatsStore.resetSingletonForTest();
    }

    // ── 口径 1/2：分母 = 图片加载请求总数，分子 = 内存命中 + 磁盘命中 ──

    @Test
    public void hitRate_twoLayerHitsOverTotalRequests() throws Exception {
        String url = pngUrl("two-layer.png");
        enqueuePng();

        // 第 1 次：两级皆未命中 → 走网络
        loadAndAwaitBitmap(url);
        assertEquals("首次加载必须真的触网（否则下面的未命中计数不可信）", 1, server.getRequestCount());

        // 第 2 次：清空内存层 ⇒ 内存不可能供给，只能是磁盘命中（网络请求数不得增长）
        memoryCache.clear();
        loadAndAwaitBitmap(url);
        assertEquals("磁盘命中不得触网", 1, server.getRequestCount());

        // 第 3 次：内存层现已有该图 ⇒ 内存命中（网络请求数仍不得增长）
        loadAndAwaitBitmap(url);
        assertEquals("内存命中不得触网", 1, server.getRequestCount());

        ImageCacheStats stats = service.cacheStats();
        assertEquals("分母 = 3 次图片加载请求", 3L, stats.requests());
        assertEquals("内存命中 1 次", 1L, stats.memoryHits());
        assertEquals("磁盘命中 1 次", 1L, stats.diskHits());
        assertEquals("分子 = 内存命中 + 磁盘命中", 2L, stats.hits());
        assertEquals("命中率 = 2/3（口径写死）", 2.0d / 3.0d, stats.hitRate(), 1e-9d);
    }

    @Test
    public void requests_notCountedForEmptyUrl() throws Exception {
        // 空 URL 在进入内存层探测前即被拒 ⇒ 不产生有效加载请求，不进分母
        RecordingListener listener = new RecordingListener();
        service.fetchImage(request(""), listener, null, ctx);
        assertTrue(listener.done.await(5, TimeUnit.SECONDS));
        assertNotNull("空 URL 应走失败分支", listener.failure.get());

        ImageCacheStats stats = service.cacheStats();
        assertEquals("空 URL 不计入分母", 0L, stats.requests());
        assertEquals("无样本时命中率取 0 而非 NaN", ImageCacheStats.NO_SAMPLE_RATE, stats.hitRate(), 0d);
    }

    @Test
    public void hitRate_allMisses_isZero() throws Exception {
        for (int i = 0; i < 3; i++) {
            enqueuePng();
            loadAndAwaitBitmap(pngUrl("miss-" + i + ".png"));
        }
        ImageCacheStats stats = service.cacheStats();
        assertEquals(3L, stats.requests());
        assertEquals(0L, stats.hits());
        assertEquals(0.0d, stats.hitRate(), 0d);
    }

    // ── 口径 3：跨进程重启累积 ──────────────────────────────

    @Test
    public void persistence_accumulatesAcrossProcessRestart() {
        ImageCacheStatsStore firstProcess = ImageCacheStatsStore.get(ctx);
        for (int i = 0; i < 3; i++) {
            firstProcess.recordRequest();
        }
        firstProcess.recordDiskHit();
        firstProcess.recordDiskMiss();
        firstProcess.flush();

        // 第二个「进程」：同一份介质上的全新实例（构造即读存量）
        ImageCacheStatsStore secondProcess = new ImageCacheStatsStore(statsPrefs);
        ImageCacheStats restored = secondProcess.snapshot(null, null);
        assertEquals("请求数跨进程延续", 3L, restored.requests());
        assertEquals("磁盘命中数跨进程延续", 1L, restored.diskHits());
        assertEquals("磁盘未命中数跨进程延续", 1L, restored.diskMisses());

        // 继续累加（不是重置）
        secondProcess.recordRequest();
        ImageCacheStats afterNewRequest = secondProcess.snapshot(null, null);
        assertEquals("重启后继续累加而非归零", 4L, afterNewRequest.requests());
    }

    @Test
    public void persistence_memoryHits_accumulateFromBuiltInCounters() {
        ImageMemoryCache cache = new ImageMemoryCache(64L * 1024L);
        ImageCacheStatsStore store = ImageCacheStatsStore.get(ctx);
        // 装内存层取用口：阈值/显式 flush 在任何时机都要能读到最新的内建计数
        store.attachMemoryLayer(() -> cache);

        cache.put("a", bitmapOf(4, 4));
        cache.get("a");      // 命中
        cache.get("absent"); // 未命中
        ImageCacheStats first = store.snapshot(cache, null);
        assertEquals("内存命中取自 LruCache 内建计数", 1L, first.memoryHits());
        assertEquals("内存未命中取自 LruCache 内建计数", 1L, first.memoryMisses());

        cache.get("a");
        store.flush();
        // 新「进程」：内建计数归零（内存层易失），但累计量须延续
        ImageCacheStatsStore restarted = new ImageCacheStatsStore(statsPrefs);
        ImageCacheStats carried = restarted.snapshot(new ImageMemoryCache(64L * 1024L), null);
        assertEquals("内存命中跨进程累积", 2L, carried.memoryHits());
    }

    @Test
    public void persistence_countersSurviveCorruptedField() {
        statsPrefs.edit().putString("total_requests", "not-a-number").commit();
        ImageCacheStatsStore store = new ImageCacheStatsStore(statsPrefs);
        // 兜底不静默：按 0 起算而不是崩（降级路径由 Log.w 记录，见 ImageCacheStatsStore#readLong）
        assertEquals(0L, store.snapshot(null, null).requests());
    }

    // ── 热路径预算：攒批落盘，不是每次命中都写存储 ────────────

    @Test
    public void flushThreshold_doesNotWriteStorageBeforeThreshold() {
        SharedPreferences probe = ctx.getSharedPreferences("threshold-probe", Context.MODE_PRIVATE);
        probe.edit().clear().commit();
        ImageCacheStatsStore store = new ImageCacheStatsStore(probe);

        for (int i = 0; i < ImageCacheStatsStore.FLUSH_THRESHOLD - 1; i++) {
            store.recordRequest();
        }
        assertTrue("未达阈值不得落盘（热路径红线：不能每次命中都写存储）", probe.getAll().isEmpty());

        store.recordRequest();
        assertFalse("达到阈值即自动落盘", probe.getAll().isEmpty());
    }

    @Test
    public void snapshotFlushes_soReadStatsArePersisted() {
        SharedPreferences probe = ctx.getSharedPreferences("read-flush-probe", Context.MODE_PRIVATE);
        probe.edit().clear().commit();
        ImageCacheStatsStore store = new ImageCacheStatsStore(probe);

        store.recordRequest();
        store.snapshot(null, null);
        assertFalse("读快照后统计必须已持久（不依赖阈值凑批）", probe.getAll().isEmpty());
    }

    // ── 内存层计数取自 LruCache 内建（不被旁路漏记）──────────

    @Test
    public void memoryCounters_comeFromLruContainer_soClearDoesNotLoseHistory() {
        ImageMemoryCache cache = new ImageMemoryCache(64L * 1024L);
        ImageCacheStatsStore store = ImageCacheStatsStore.get(ctx);
        cache.put("a", bitmapOf(4, 4));
        cache.get("a");
        cache.get("a");
        assertEquals(2L, cache.memoryHits());
        assertEquals(0L, cache.memoryMisses());
        assertEquals(0L, cache.memoryEvictions());

        cache.clear();
        // 内建计数不受 clear 影响（影子计数器若挂在 clear 上就会漏记这段历史）
        assertEquals("clear 不得抹掉已发生的命中历史", 2L, cache.memoryHits());
        assertEquals(2L, store.snapshot(cache, null).memoryHits());
        assertEquals("清空后条目数归零（量表是实时的）", 0L, store.snapshot(cache, null).memoryEntries());
    }

    @Test
    public void memoryEvictions_surfaceCapacityPressure() {
        // 容量 10B、单条目 1×2 = 8B ⇒ 第二个 put 后 16B 超限，必然逐出第一个
        ImageMemoryCache cache = new ImageMemoryCache(10L);
        ImageCacheStatsStore store = ImageCacheStatsStore.get(ctx);
        Bitmap small = bitmapOf(1, 2);
        cache.put("a", small);
        cache.put("b", small);

        ImageCacheStats stats = store.snapshot(cache, null);
        assertEquals("逐出 1 次", 1L, stats.memoryEvictions());
        assertEquals("只剩 1 个条目", 1L, stats.memoryEntries());
        assertEquals("剩余占用 = 8 字节（1×2×4）", 8L, stats.memoryBytes());
    }

    // ── 磁盘层自计：命中/未命中 + 条目数/占用字节数 ───────────

    @Test
    public void diskCounters_splitHitFromMiss_andReportUsage() throws Exception {
        PixivImageLoader loader = new PixivImageLoader(ctx, client(), 1024L * 1024L);
        String url = pngUrl("disk.png");
        enqueuePng();

        loader.loadBytesCachedFirst(url); // 未命中 → 下载
        loader.loadBytesCachedFirst(url); // 命中
        loader.loadBytesCachedFirst(url); // 命中

        ImageCacheStats stats = service.cacheStats();
        assertEquals("磁盘层自计：1 次未命中 + 2 次命中", 1L, stats.diskMisses());
        assertEquals("磁盘层自计：2 次命中", 2L, stats.diskHits());

        DiskCacheUsage usage = loader.diskUsage();
        assertEquals("磁盘目录只有一条目", 1L, usage.entries());
        assertEquals("占用字节 = 内置 PNG 字面量长度（独立来源）",
                (long) PNG_1PX.length, usage.bytes());
        assertEquals("快照里的磁盘占用应与现算一致",
                (long) PNG_1PX.length, stats.diskBytes());
        assertEquals(1L, stats.diskEntries());
    }

    @Test
    public void diskUsage_unknownCapacity_reportsEmpty() {
        PixivImageLoader loader = new PixivImageLoader(ctx, client(), 1024L * 1024L);
        DiskCacheUsage usage = loader.diskUsage();
        assertNotNull(usage);
        assertEquals(0L, usage.entries());
        assertEquals(0L, usage.bytes());
    }

    // ── 内存层清理调用点（此前生产零调用点）───────────────────

    @Test
    public void clearMemoryCache_releasesBytes_andStopsMemoryServing() throws Exception {
        String url = pngUrl("clear.png");
        enqueuePng();
        loadAndAwaitBitmap(url);  // ① 内存未命中 → 网络
        loadAndAwaitBitmap(url);  // ② 内存命中（网络请求数不增长）
        assertEquals("① 触网、② 由内存供给", 1, server.getRequestCount());
        assertEquals("1×1 PNG 解码后占 1×1×4 = 4 字节", 4L, memoryCache.totalBytes());
        assertEquals("第 ② 次加载贡献 1 次内存命中", 1L, service.cacheStats().memoryHits());

        long freed = service.clearMemoryCache();

        assertEquals("清理返回的释放字节数应等于清理前占用", 4L, freed);
        assertEquals("清理后内存层为空", 0L, memoryCache.totalBytes());
        assertEquals(0L, service.cacheStats().memoryEntries());

        // 内存层既已清空 ⇒ 第 ③ 次加载不可能再由它供给。外部证据有二：
        // 内存命中计数不增长，且请求落到磁盘层（网络请求数仍为 1）。
        loadAndAwaitBitmap(url);
        ImageCacheStats after = service.cacheStats();
        assertEquals("内存层已清空，③ 不再由内存供给", 1L, after.memoryHits());
        assertTrue("③ 应记为磁盘命中", after.diskHits() >= 1L);
        assertEquals("网络请求数仍为 1（③ 由磁盘层供给）", 1, server.getRequestCount());
    }

    @Test
    public void clearMemoryCache_beforeAnyLoad_isNoOpReturningZero() {
        ImageMemoryCache cache = new ImageMemoryCache(1024L);
        PictelioImageService fresh = new PictelioImageService(cache);
        // 内存层尚未创建（还没加载过任何图）⇒ 无可清理，不是错误
        assertEquals(0L, fresh.clearMemoryCache());
        assertEquals(0L, fresh.cacheStats().memoryEntries());
    }

    // ── 统计清零 ───────────────────────────────────────────

    @Test
    public void resetCacheStats_zeroesCountersWithoutRewindingMemoryHistory() throws Exception {
        String url = pngUrl("reset.png");
        enqueuePng();
        loadAndAwaitBitmap(url);
        loadAndAwaitBitmap(url);
        assertEquals(2L, service.cacheStats().requests());
        assertEquals(1L, service.cacheStats().memoryHits());

        service.resetCacheStats();

        ImageCacheStats afterReset = service.cacheStats();
        assertEquals("请求数清零", 0L, afterReset.requests());
        assertEquals("磁盘计数清零", 0L, afterReset.diskHits());
        assertEquals("清零不得把本进程已累计的内存命中倒算回来", 0L, afterReset.memoryHits());

        // 清零后新发生的命中照常计入
        loadAndAwaitBitmap(url);
        assertEquals("清零后只统计新增请求", 1L, service.cacheStats().requests());
        assertEquals("清零后新增的内存命中计 1", 1L, service.cacheStats().memoryHits());
    }

    @Test
    public void diskUsage_rejectsNegativeReadings() {
        try {
            new DiskCacheUsage(-1L, 0L);
            throw new AssertionError("负读数必须抛错而非静默接受");
        } catch (IllegalArgumentException expected) {
            assertNotNull(expected.getMessage());
        }
    }

    @Test
    public void statsStore_get_rejectsNullContext() {
        try {
            ImageCacheStatsStore.get(null);
            throw new AssertionError("null Context 是调用点 bug，必须显式失败");
        } catch (NullPointerException expected) {
            assertNotNull(expected.getMessage());
        }
    }

    @Test
    public void prefsName_isIndependentFromLegacyStorageContract() {
        // ADR-0050 存量格式契约：一字不改。统计必须落在<b>独立</b>介质上，
        // 否则日后任何对该文件的遍历迁移都会误伤明文计数。
        assertFalse("不得复用安全存储的存量 SharedPreferences",
                ImageCacheStatsStore.PREFS_NAME.equals(SecureStorageCompat.PREFS_NAME));
        assertFalse("不得复用图床配置的 CapacitorStorage",
                ImageCacheStatsStore.PREFS_NAME.equals("CapacitorStorage"));
        // 两个存量文件的键空间（capacitor-storage_ 前缀）里不得出现统计键
        assertTrue(statsPrefs.getAll().keySet().stream()
                .noneMatch(k -> k.startsWith(SecureStorageCompat.PREFIX)));
    }

    // ── fixture ────────────────────────────────────────────

    private String pngUrl(String name) {
        return server.url("/img/" + name).toString();
    }

    private okhttp3.OkHttpClient client() {
        return new okhttp3.OkHttpClient.Builder()
                .callTimeout(10, TimeUnit.SECONDS)
                .build();
    }

    private void enqueuePng() {
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(PNG_1PX)));
    }

    private void clearDiskCache() {
        File dir = new PixivImageLoader(ctx).getCacheDir();
        File[] files = dir.listFiles();
        if (files == null) {
            return;
        }
        for (File f : files) {
            if (!f.delete()) {
                throw new IllegalStateException("磁盘缓存清理失败: " + f);
            }
        }
    }

    private Bitmap bitmapOf(int width, int height) {
        return Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
    }

    private static ImageRequestInfo request(String url) {
        return new ImageRequestInfoBuilder().setUrl(url).build();
    }

    private Bitmap loadAndAwaitBitmap(String url) throws Exception {
        RecordingListener listener = new RecordingListener();
        service.fetchImage(request(url), listener, null, ctx);
        assertTrue("onSuccess 应在超时内回调: " + url, listener.done.await(5, TimeUnit.SECONDS));
        assertNull("不应失败: " + url, listener.failure.get());
        ImageContent content = listener.success.get();
        assertNotNull("应收到 ImageContent: " + url, content);
        return content.getBitmap();
    }

    private static final class RecordingListener implements ImageLoadListener {
        final CountDownLatch done = new CountDownLatch(1);
        final AtomicReference<ImageContent> success = new AtomicReference<>();
        final AtomicReference<Throwable> failure = new AtomicReference<>();

        @Override
        public void onRequestSubmit(ImageRequestInfo requestInfo) {
        }

        @Override
        public void onSuccess(ImageContent content, ImageRequestInfo requestInfo, ImageInfo info) {
            success.set(content);
            done.countDown();
        }

        @Override
        public void onFailure(int code, Throwable throwable) {
            failure.set(throwable);
            done.countDown();
        }

        @Override
        public void onImageMonitorInfo(org.json.JSONObject monitorInfo) {
        }
    }
}