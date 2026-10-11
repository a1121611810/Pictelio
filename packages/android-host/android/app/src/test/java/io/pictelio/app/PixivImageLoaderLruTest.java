package io.pictelio.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
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

import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;

/**
 * 磁盘缓存「真 LRU」单测（#978）——命中刷新访问时间戳 + 启动清理两个淘汰触发点。
 *
 * <p>被测缝：{@link PixivImageLoader} 公开面（{@code loadFileCachedFirst} /
 * {@code loadBytesCachedFirst} / {@code trimAtStartup}）——均为调用方与启动路径真实使用的入口，
 * 不打私有方法。
 *
 * <p><b>期望值出处（测试硬约束 #6 oracle 溯源）</b>：淘汰顺序取自「LRU = 按最近<b>访问</b>时间序淘汰」
 * 这一外部定义本身（Fresco {@code imagepipeline-base} 磁盘缓存同款：读取路径对内容文件
 * {@code setLastModified} 刷新时间戳，淘汰比较器按该时间戳升序删除），
 * <b>不</b>从被测实现反推。用例只钉两条不变量：
 * <ol>
 *   <li>被命中过的条目，末次访问时间晚于「写入更晚但此后未被访问」的条目 ⇒ 淘汰时后者先死；</li>
 *   <li>启动清理在「全程零写入」前提下即可回收超限存量。</li>
 * </ol>
 * 区分手段：显式设定 mtime 字面量刻度（{@link #T0} 为 2020-01-01，与墙钟解耦），
 * <b>不</b>用固定墙钟等待（docs/testing/conventions.md 强制约束 #6：等条件，不等时间）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class PixivImageLoaderLruTest {

    /** 固定基准刻度（2020-01-01T00:00:00Z）：与墙钟解耦的 mtime 排序字面量 */
    private static final long T0 = 1577836800000L;
    private static final long ONE_HOUR_MS = 3600_000L;
    private static final String CDN = "https://i.pximg.net/img-master/2020/01/01/";

    /** 上限 2048B：两个 1000B 条目即超限，超限必然删一个（留一个即达标） */
    private static final long LIMIT = 2048L;

    private MockWebServer server;
    private PixivImageLoader loader;

    @Before
    public void setUp() throws IOException {
        server = new MockWebServer();
        server.start();
        Context ctx = ApplicationProvider.getApplicationContext();
        loader = new PixivImageLoader(ctx, new OkHttpClient.Builder().build(), LIMIT);
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

    /**
     * 放一个「既有存量条目」：按真实缓存键命名（{@code keyToFilename}），并赋予确定的 mtime。
     * 直接落盘、不触网络——构造「上一会话遗留缓存」的前置态。
     */
    private File seedEntry(String url, int sizeBytes, long lastModified) throws IOException {
        File f = new File(loader.getCacheDir(), PixivImageLoader.keyToFilename(url));
        Files.write(f.toPath(), bodyBytes(sizeBytes, (byte) 0x11));
        assertTrue("测试前置：setLastModified 应生效: " + url, f.setLastModified(lastModified));
        return f;
    }

    /** 入队一次可下载的图片，返回其官方 URL */
    private String enqueueImage(int sizeBytes) {
        server.enqueue(new MockResponse().setResponseCode(200)
                .setBody(new okio.Buffer().write(bodyBytes(sizeBytes, (byte) 0x22))));
        return server.url("/pixiv-img/downloaded-" + server.getRequestCount() + ".jpg").toString();
    }

    // ── 触发点一：命中刷新访问时间戳 ─────────────────────────────

    /**
     * 核心断言（LRU 定义）：A 写入最早但被<b>反复命中</b>，B 写入更晚却<b>此后未被访问</b>；
     * 超限淘汰时 B 先死、A 留存。
     *
     * <p>若实现仍按「最后修改时间 = 写入时间」淘汰（本票修掉的缺陷），A 因写入最早会被删 ⇒ 红。
     */
    @Test
    public void loadFileCachedFirst_repeatedlyAccessedEntry_survivesEvictionOverNeverRevisitedEntry() throws Exception {
        String urlA = CDN + "a.jpg";
        String urlB = CDN + "b.jpg";
        File a = seedEntry(urlA, 1000, T0);
        File b = seedEntry(urlB, 1000, T0 + ONE_HOUR_MS);
        assertTrue("前置：A 写入时间应早于 B", a.lastModified() < b.lastModified());

        // 命中 A 两次（缓存命中路径：零网络请求、零写盘）
        long requestsBefore = server.getRequestCount();
        assertNotNull(loader.loadFileCachedFirst(urlA));
        assertNotNull(loader.loadFileCachedFirst(urlA));
        assertEqualsLong("命中不应发网络请求", requestsBefore, server.getRequestCount());

        assertTrue("命中后 A 的访问时间戳应晚于此后未被访问的 B",
                a.lastModified() > b.lastModified());

        // 触发写入路径淘汰：再写一个 1000B → 总 3000 > 2048，必删一个（删最旧的）
        loader.loadFileCachedFirst(enqueueImage(1000));

        assertTrue("被反复命中的条目应优先保留", a.exists());
        assertFalse("写入更晚但此后未被访问的条目应先被淘汰", b.exists());
    }

    /** loadBytesCachedFirst 形态同样刷新访问时间戳（另一入口，与 loadFileCachedFirst 同纪律） */
    @Test
    public void loadBytesCachedFirst_hit_refreshesAccessTimestamp() throws Exception {
        String urlA = CDN + "bytes-a.jpg";
        File a = seedEntry(urlA, 512, T0);
        long before = a.lastModified();

        assertArrayEquals("命中应返回缓存内容", bodyBytes(512, (byte) 0x11),
                loader.loadBytesCachedFirst(urlA));

        assertTrue("loadBytesCachedFirst 命中应刷新访问时间戳", a.lastModified() > before);
        assertEqualsLong("命中不发网络请求", 0, server.getRequestCount());
    }

    /** 命中刷新不得破坏条目内容（touch 只改时间戳，不改字节） */
    @Test
    public void loadFileCachedFirst_hit_touchDoesNotCorruptContent() throws Exception {
        String urlA = CDN + "intact.jpg";
        byte[] expected = bodyBytes(777, (byte) 0x33);
        File a = new File(loader.getCacheDir(), PixivImageLoader.keyToFilename(urlA));
        Files.write(a.toPath(), expected);
        assertTrue(a.setLastModified(T0));

        assertNotNull(loader.loadFileCachedFirst(urlA));

        assertArrayEquals("touch 后内容应逐字节不变", expected, Files.readAllBytes(a.toPath()));
    }

    // ── 触发点二：启动清理（长期不写入也能回收） ────────────────

    /**
     * 启动清理触发点：三个存量条目（mtime 全停在过去，<b>全程零写入</b>），
     * 超限时按访问时间升序回收，最旧的先死。
     *
     * <p>若淘汰仅在写入后触发（本票修掉的缺陷），此用例零写入 ⇒ 无人触发 ⇒ 条目应全存 ⇒ 红。
     */
    @Test
    public void trimAtStartup_reclaimsOverLimitStaleEntries_withZeroWrites() throws Exception {
        File oldest = seedEntry(CDN + "stale-1.jpg", 1000, T0);
        File middle = seedEntry(CDN + "stale-2.jpg", 1000, T0 + ONE_HOUR_MS);
        File newest = seedEntry(CDN + "stale-3.jpg", 1000, T0 + 2 * ONE_HOUR_MS);
        assertEqualsLong("启动清理不得发网络请求", 0, server.getRequestCount());

        loader.trimAtStartup();

        assertFalse("最旧的存量条目应被启动清理回收", oldest.exists());
        assertTrue("较新的存量条目应保留", middle.exists());
        assertTrue("最新条目应保留", newest.exists());
    }

    /** 启动清理在未超限时不得删任何条目（清理不得误伤） */
    @Test
    public void trimAtStartup_underLimit_keepsAllEntries() throws Exception {
        File only = seedEntry(CDN + "fresh.jpg", 100, T0);

        loader.trimAtStartup();

        assertTrue("未超限时启动清理不得删除条目", only.exists());
    }

    /** 启动清理后残留条目仍可命中（清理不得破坏缓存可读性） */
    @Test
    public void trimAtStartup_afterTrim_survivingEntryStillReadable() throws Exception {
        String urlOld = CDN + "survive-old.jpg";
        String urlMid = CDN + "survive-mid.jpg";
        String urlNew = CDN + "survive-new.jpg";
        // 3×1000B = 3000B > 2048B 上限 ⇒ 清理删掉最旧的 urlOld，urlMid/urlNew 留存
        seedEntry(urlOld, 1000, T0);
        seedEntry(urlMid, 1000, T0 + ONE_HOUR_MS);
        seedEntry(urlNew, 1000, T0 + 2 * ONE_HOUR_MS);

        loader.trimAtStartup();

        assertNull("最旧条目应已回收", loader.cachedFile(urlOld));
        assertNotNull("较新条目应留存且可命中", loader.cachedFile(urlMid));
        assertNotNull("最新条目应留存且可命中", loader.cachedFile(urlNew));
        assertEqualsLong("清理与命中均不发网络请求", 0, server.getRequestCount());
    }

    private static void assertEqualsLong(String msg, long expected, long actual) {
        org.junit.Assert.assertEquals(msg, expected, actual);
    }
}