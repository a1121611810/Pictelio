package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.Context;

import androidx.test.core.app.ApplicationProvider;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.concurrent.atomic.AtomicLong;

import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;

/**
 * 图片磁盘缓存预算接线单测（#986）——上限随可用存储浮动后，淘汰路径的接线是否正确。
 *
 * <p>被测缝：{@link PixivImageLoader} 包可见构造（注入可变预算，等价于设备可用存储变化）
 * + 公开面（{@code loadFileCachedFirst} / {@code trimAtStartup}）。
 *
 * <p><b>本票不新写删除逻辑</b>：上限只是换了来源，淘汰仍走 #978 建立的同一条路径
 * （按<b>访问</b>时间升序删除 + 启动清理触发点）。故用例钉的是<b>接线</b>不变量：
 * <ol>
 *   <li>上限<b>收缩</b>后，下一次写入按访问时间序回收（最久未用者先死）；</li>
 *   <li>启动清理同样按<b>当期</b>预算回收存量超限条目（与 #978 协同，非另起一套）；</li>
 *   <li>生产构造不再取写死常量，上限落在钳制区间内。</li>
 * </ol>
 *
 * <p><b>期望值出处（强制约束 #5 oracle 溯源）</b>：淘汰顺序取自「LRU = 按最近访问时间序淘汰」
 * 这一外部定义（Fresco {@code imagepipeline-base} 同款，见 ADR-0222 §2.4）；钳制区间取自
 * Coil 3.6.3 {@code DiskCache.kt}（详见 {@link DiskCacheBudgetTest} 类注释）。
 * mtime 用字面量刻度（{@link #T0} = 2020-01-01，与墙钟解耦），不用固定墙钟等待
 * （conventions 强制约束 #6：等条件，不等时间）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class PixivImageLoaderBudgetTest {

    /** 固定基准刻度（2020-01-01T00:00:00Z）：与墙钟解耦的 mtime 排序字面量 */
    private static final long T0 = 1577836800000L;
    private static final long ONE_HOUR_MS = 3600_000L;
    private static final String CDN = "https://i.pximg.net/img-master/2020/01/01/";

    /** 250MB 上界（Coil {@code maximumMaxSizeBytes}）；旧写死常量为 300MB（314_572_800） */
    private static final long MAX = 250L * 1024 * 1024;

    private MockWebServer server;
    private PixivImageLoader loader;
    /** 当前生效的磁盘上限（测试以「可用存储变化」驱动其收缩） */
    private AtomicLong budget;

    @Before
    public void setUp() throws IOException {
        server = new MockWebServer();
        server.start();
        Context ctx = ApplicationProvider.getApplicationContext();
        budget = new AtomicLong(4096L);
        loader = new PixivImageLoader(ctx, new OkHttpClient.Builder().build(), budget::get);
        // 计数类断言要求目录态确定：清空上一个用例的残留（Robolectric 应用 cacheDir 可能复用）
        File[] leftovers = loader.getCacheDir().listFiles();
        if (leftovers != null) {
            for (File f : leftovers) {
                assertTrue("前置清理失败: " + f, f.delete());
            }
        }
    }

    @After
    public void tearDown() throws IOException {
        server.shutdown();
    }

    /** 确定性 body：逐行递增字节 */
    private static byte[] bodyBytes(int sizeBytes, byte seed) {
        byte[] body = new byte[sizeBytes];
        for (int i = 0; i < sizeBytes; i++) body[i] = (byte) ((i + seed) % 251);
        return body;
    }

    /** 放一个「既有存量条目」：真实缓存键命名 + 确定 mtime；直落盘、不触网络 */
    private File seedEntry(String url, int sizeBytes, long lastModified) throws IOException {
        File f = new File(loader.getCacheDir(), PixivImageLoader.keyToFilename(url));
        Files.write(f.toPath(), bodyBytes(sizeBytes, (byte) 0x11));
        assertTrue("测试前置：setLastModified 应生效: " + url, f.setLastModified(lastModified));
        return f;
    }

    /** 入队一次可下载的图片，返回其 URL */
    private String enqueueImage(int sizeBytes) {
        server.enqueue(new MockResponse().setResponseCode(200)
                .setBody(new okio.Buffer().write(bodyBytes(sizeBytes, (byte) 0x22))));
        return server.url("/pixiv-img/downloaded-" + server.getRequestCount() + ".jpg").toString();
    }

    /**
     * 上限收缩 ⇒ 写入路径按访问时间序回收（复用 #978 淘汰路径，未另起删除逻辑）。
     *
     * <p>三个存量条目各 1000B（合计 3000B）：A 写入最早但被<b>反复命中</b>，C 写入最晚；
     * 上限从 4096B 收缩到 2048B 后再写一条 1000B ⇒ 合计 4000B 超限。
     * 访问时间序为 B &lt; C &lt; A ⇒ 淘汰应先删 B、再删 C，A 留存。
     */
    @Test
    public void writeAfterBudgetShrink_evictsByAccessOrder_keepingRecentlyHitEntry() throws Exception {
        String urlA = CDN + "shrink-a.jpg";
        String urlB = CDN + "shrink-b.jpg";
        String urlC = CDN + "shrink-c.jpg";
        File a = seedEntry(urlA, 1000, T0);
        File b = seedEntry(urlB, 1000, T0 + ONE_HOUR_MS);
        File c = seedEntry(urlC, 1000, T0 + 2 * ONE_HOUR_MS);

        // 命中 A 两次（零网络、零写盘），使其访问时间晚于 B/C
        assertTrue(loader.loadFileCachedFirst(urlA).exists());
        assertTrue(loader.loadFileCachedFirst(urlA).exists());
        assertEquals("命中不发网络请求", 0, server.getRequestCount());

        // 上限收缩：3000B 原本不超 4096B，收缩到 2048B 后再写入即触发回收
        budget.set(2048L);
        assertTrue(loader.loadFileCachedFirst(enqueueImage(1000)).exists());
        assertEquals("未命中只应发一次下载请求", 1, server.getRequestCount());

        assertTrue("被反复命中的条目应留存（访问时间最新）", a.exists());
        assertFalse("最久未访问的条目应先被回收", b.exists());
        assertFalse("次久未访问的条目应随之被回收", c.exists());
    }

    /**
     * 存量超限缓存在<b>启动清理</b>时按当期预算被回收（与 #978 的启动清理协同）。
     *
     * <p>先证预算生效点可区分：4096B 预算下启动清理<b>不</b>删任何条目（3×1000B 未超限）；
     * 预算收缩到 2048B 后再次启动清理，最旧的存量条目才被回收。
     */
    @Test
    public void trimAtStartup_afterBudgetShrink_reclaimsOverLimitStaleEntries() throws Exception {
        String urlOld = CDN + "startup-old.jpg";
        String urlMid = CDN + "startup-mid.jpg";
        String urlNew = CDN + "startup-new.jpg";
        seedEntry(urlOld, 1000, T0);
        seedEntry(urlMid, 1000, T0 + ONE_HOUR_MS);
        seedEntry(urlNew, 1000, T0 + 2 * ONE_HOUR_MS);

        loader.trimAtStartup();
        assertTrue("未超限时启动清理不得删除条目", loader.cachedFile(urlOld) != null);

        budget.set(2048L);
        loader.trimAtStartup();

        assertTrue("最旧的存量条目应被启动清理回收", loader.cachedFile(urlOld) == null);
        assertTrue("较新的存量条目应留存", loader.cachedFile(urlMid) != null);
        assertTrue("最新条目应留存", loader.cachedFile(urlNew) != null);
        assertEquals("启动清理全程零网络请求", 0, server.getRequestCount());
    }

    /**
     * 生产构造的上限落在钳制区间内 ⇒ 不再是写死常量。
     *
     * <p>若仍取 {@code OAuthConfig.CACHE_MAX_BYTES}（300MB = 314_572_800B），
     * 该值大于 250MB 上界 ⇒ 本用例红。
     */
    @Test
    public void productionConstructor_budgetWithinClampRange() {
        PixivImageLoader production = new PixivImageLoader(ApplicationProvider.getApplicationContext());
        long limit = production.currentMaxCacheBytes();
        assertTrue("生产上限应 ≥ 10MB 下界，实际 " + limit,
                limit >= 10L * 1024 * 1024);
        assertTrue("生产上限应 ≤ 250MB 上界（写死常量为 300MB），实际 " + limit, limit <= MAX);
    }
}
