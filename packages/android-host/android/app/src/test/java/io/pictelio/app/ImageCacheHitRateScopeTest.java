package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
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
 * 命中率的<b>链路归属</b>（#984）——分母分子的口径收紧处，命中率契约的钉死处。
 *
 * <h3>本类钉死什么</h3>
 * 分子分母<b>同数显示链路</b>：预取 / zip / 保存链路的命中既不抬高分母（分母本就只数显示请求），
 * 也不抬高命中数（分子）。⇒ 命中率恒落在 0–100%。改造前分子含预取命中而分母不含，
 * 预取三次就能把命中率顶到 300%。
 *
 * <h3>oracle 溯源（测试硬约束 #6）</h3>
 * 期望值全部来自<b>独立于被测实现</b>的来源，没有一处反推：
 * <ol>
 *   <li><b>口径本身</b>——「显示链路 N 次请求、M 次命中 ⇒ M/N」，是票面写死的定义；</li>
 *   <li><b>MockWebServer {@code getRequestCount()}</b>——真实网络请求数，用来证明「非显示链路
 *       那几次<b>确实是磁盘命中</b>」，否则「分子没涨」可能只是「压根没命中」的假通过；</li>
 *   <li><b>清空内存层</b>作为互斥排除法（内存已不可能供给 ⇒ 未触网的加载只可能是磁盘命中），
 *       与 {@link ImageCacheStatsTest} 同款，不依赖实现内部状态。</li>
 * </ol>
 *
 * <h3>为什么每次预取前都要清空内存层</h3>
 * #982 起预取会顺带把字节解码写入内存层，故<b>第二次预取会在内存探测处短路</b>、
 * 根本不碰磁盘层。想制造「预取的磁盘命中」就必须先清空内存层——否则本类的前置断言
 * （网络请求数不增长）会因为压根没走磁盘而失去意义。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class ImageCacheHitRateScopeTest {

    /** 1×1 透明 PNG（用例内置字面量，非被测实现反推） */
    private static final byte[] PNG_1PX = Base64.decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            Base64.DEFAULT);

    private MockWebServer server;
    private Context ctx;
    private ImageMemoryCache memoryCache;
    private PictelioImageService service;

    @Before
    public void setUp() throws Exception {
        server = new MockWebServer();
        server.start();
        ctx = ApplicationProvider.getApplicationContext();
        ctx.getSharedPreferences(ImageCacheStatsStore.PREFS_NAME, Context.MODE_PRIVATE)
                .edit().clear().commit();
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

    // ── 原语层：probe 不计入容器内建计数（#984 新增的探测语义）──

    /**
     * {@link ImageMemoryCache#probe} 不计命中/未命中，而 {@link ImageMemoryCache#get} 照旧计。
     *
     * <p>这是「预取探测不计入分子」的<b>直接</b>证据：内存命中分子取自 LRU 容器内建计数
     * （#983 的设计，见 {@link ImageCacheStatsStore#syncMemoryHits}），探测若计数就会抬高分子。
     */
    @Test
    public void probe_doesNotCountAsHit_butGetStillDoes() {
        ImageMemoryCache cache = new ImageMemoryCache(64L * 1024L);
        cache.put("a", bitmapOf(4, 4));

        cache.probe("a");
        cache.probe("absent");
        assertEquals("探测不得计入命中", 0L, cache.memoryHits());
        assertEquals("探测不得计入未命中", 0L, cache.memoryMisses());

        cache.get("a");
        assertEquals("显示链路的 get 仍照常计入命中", 1L, cache.memoryHits());
        assertNotNull("get 仍须返回条目", cache.get("a"));
    }

    // ── 链路层：非显示链路的命中不计入分子 ──────────────────

    /**
     * 预取连打三次（每次先清空内存层以确保真的走磁盘），统计须<b>纹丝不动</b>。
     *
     * <p>本票最关键的一条：改造前 {@code diskHits} 在磁盘层自计、预取也经同一个
     * {@code loadBytesCachedFirst}，这三次预取会把分子抬到 3 而分母仍是 0。
     */
    @Test
    public void prefetchDiskHits_inflateNeitherNumeratorNorDenominator() throws Exception {
        String url = server.url("/img/prefetch-scope.png").toString();
        enqueuePng();
        prefetchAndAwait(url);                 // 未命中 → 下载并落盘
        for (int i = 0; i < 2; i++) {
            memoryCache.clear();               // 内存已空 ⇒ 下一次预取必然落到磁盘
            prefetchAndAwait(url);             // 磁盘命中（未触网）
        }

        // 前置条件：确实产出了 2 次磁盘命中，否则下面「分子没涨」是假通过
        assertEquals("3 次预取仅触网 1 次 ⇒ 后两次确为磁盘命中", 1, server.getRequestCount());

        ImageCacheStats stats = service.cacheStats();
        assertEquals("预取不计入分母（分母只数显示链路请求）", 0L, stats.requests());
        assertEquals("预取的磁盘命中不计入分子", 0L, stats.diskHits());
        assertEquals("分子恒为 0", 0L, stats.hits());
        assertEquals("无样本时命中率取 0 而非 NaN/Infinity",
                ImageCacheStats.NO_SAMPLE_RATE, stats.hitRate(), 0d);
    }

    /**
     * 预取写入内存层后，随后的显示请求算一次内存命中，分子应为 1——
     * 不是 2（预取自己的内存探测那次不算）。
     */
    @Test
    public void prefetchThenDisplay_countsOneHitNotTwo() throws Exception {
        String url = server.url("/img/prefetch-then-display.png").toString();
        enqueuePng();
        prefetchAndAwait(url);        // 下载 + 落盘 + 写入内存层（#982）

        loadAndAwaitBitmap(url);      // 显示命中内存层
        ImageCacheStats stats = service.cacheStats();
        assertEquals("1 次显示请求", 1L, stats.requests());
        assertEquals("只有显示请求的那次命中计入分子", 1L, stats.memoryHits());
        assertEquals("分子不得把预取的内存探测算进来", 1L, stats.hits());
        assertEquals("命中率 = 1/1", 1.0d, stats.hitRate(), 1e-9d);
    }

    // ── 命中率恒落在 0–100% ──────────────────────────────────

    /**
     * 混跑非显示链路与显示链路后命中率仍须 ≤ 100%。
     *
     * <p>本用例即改造前会算出 <b>300%</b> 的场景：预取制造 3 次磁盘命中，
     * 显示链路只有 1 次请求且该请求未命中。
     */
    @Test
    public void hitRate_neverExceedsOne_whenBackgroundHitsOutnumberDisplayRequests() throws Exception {
        String prefetched = server.url("/img/bg.png").toString();
        enqueuePng();
        prefetchAndAwait(prefetched);
        for (int i = 0; i < 2; i++) {
            memoryCache.clear();
            prefetchAndAwait(prefetched);      // 3 次预取：1 次下载 + 2 次磁盘命中
        }
        assertEquals("预取侧确实产出 3 次加载、仅 1 次触网", 1, server.getRequestCount());

        String displayed = server.url("/img/fg.png").toString();
        enqueuePng();
        loadAndAwaitBitmap(displayed);          // 显示侧 1 次请求，网络未命中

        ImageCacheStats stats = service.cacheStats();
        assertEquals("分母只数显示链路：1 次请求", 1L, stats.requests());
        assertEquals("分子只数显示链路：0 次命中", 0L, stats.hits());
        assertTrue("命中率不得 > 1（改造前此处为 3.0）", stats.hitRate() <= 1.0d);
        assertEquals("命中率 = 0/1", 0.0d, stats.hitRate(), 0d);
    }

    /** 显示链路的磁盘命中照常计入分子（口径收紧不得把显示链路也误伤） */
    @Test
    public void displayChainDiskHit_stillCounts() throws Exception {
        String url = server.url("/img/fg-disk.png").toString();
        enqueuePng();
        loadAndAwaitBitmap(url);                 // 网络未命中
        memoryCache.clear();                     // 内存已不可能供给
        loadAndAwaitBitmap(url);                 // ⇒ 磁盘命中

        ImageCacheStats stats = service.cacheStats();
        assertEquals("2 次显示请求", 2L, stats.requests());
        assertEquals("1 次磁盘命中计入分子", 1L, stats.diskHits());
        assertEquals("命中率 = 1/2", 0.5d, stats.hitRate(), 1e-9d);
    }

    /** 默认重载等价于 NON_DISPLAY：漏传时只能低估命中率，不可高估 */
    @Test
    public void defaultOverload_doesNotCountTowardsHitRate() throws Exception {
        PixivImageLoader loader = new PixivImageLoader(ctx, client(), 1024L * 1024L);
        String url = server.url("/img/default-overload.png").toString();
        enqueuePng();
        loader.loadBytesCachedFirst(url);        // 默认重载：NON_DISPLAY
        loader.loadBytesCachedFirst(url);

        ImageCacheStats stats = service.cacheStats();
        assertEquals("默认重载不得把命中计入分子", 0L, stats.hits());
        assertEquals("默认重载亦不计入分母", 0L, stats.requests());
        assertEquals(0.0d, stats.hitRate(), 0d);
    }

    // ── fixture ────────────────────────────────────────────

    private okhttp3.OkHttpClient client() {
        return new okhttp3.OkHttpClient.Builder()
                .callTimeout(10, TimeUnit.SECONDS)
                .build();
    }

    private void enqueuePng() {
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(PNG_1PX)));
    }

    private Bitmap bitmapOf(int width, int height) {
        return Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
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

    private static ImageRequestInfo request(String url) {
        return new ImageRequestInfoBuilder().setUrl(url).build();
    }

    /** 走显示链路并等到回调（等待方式与 {@link ImageCacheStatsTest} 同款） */
    private void loadAndAwaitBitmap(String url) throws Exception {
        RecordingListener listener = new RecordingListener();
        service.fetchImage(request(url), listener, null, ctx);
        assertTrue("onSuccess 应在超时内回调: " + url, listener.done.await(5, TimeUnit.SECONDS));
        assertNull("不应失败: " + url, listener.failure.get());
        ImageContent content = listener.success.get();
        assertNotNull("应收到 ImageContent: " + url, content);
    }

    /**
     * 走预取链路并等它落定。
     *
     * <p>预取是 fire-and-forget，用「内存层已出现该条目」作为完成信号——#982 起预取解码后
     * 必定写入内存层（解码失败会 Log.w 告警并跳过，此时超时断言会如实失败，不会假通过）。
     * 用 probe 而非 get 读，避免观察动作自己污染命中计数。
     */
    private void prefetchAndAwait(String url) throws Exception {
        String key = PixivImageLoader.cacheKey(url);
        service.prefetchImage(url, null, null);
        long deadline = System.currentTimeMillis() + 5000L;
        while (System.currentTimeMillis() < deadline) {
            if (memoryCache.probe(key) != null) {
                return;
            }
            Thread.sleep(20L);
        }
        throw new AssertionError("预取未在超时内完成: " + url);
    }

    private static final class RecordingListener implements ImageLoadListener {
        final CountDownLatch done = new CountDownLatch(1);
        final AtomicReference<ImageContent> success = new AtomicReference<>();
        final AtomicReference<Throwable> failure = new AtomicReference<>();

        @Override
        public void onRequestSubmit(ImageRequestInfo requestInfo) {
        }

        @Override
        public void onSuccess(ImageContent content, ImageRequestInfo requestInfo, ImageInfo imageInfo) {
            success.set(content);
            done.countDown();
        }

        @Override
        public void onFailure(int code, Throwable error) {
            failure.set(error);
            done.countDown();
        }

        @Override
        public void onImageMonitorInfo(org.json.JSONObject monitorInfo) {
        }
    }
}