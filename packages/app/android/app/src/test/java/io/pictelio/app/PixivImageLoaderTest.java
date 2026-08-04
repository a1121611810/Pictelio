package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.util.Base64;

import androidx.test.core.app.ApplicationProvider;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;

/**
 * PixivImageLoader 公共图片核心单测（#57）。
 *
 * <p>覆盖：URL 重写、缓存文件名契约（与 ImageCachePlugin/PixivApiPlugin 同规则）、
 * 缓存读写往返、淘汰策略、下载成功/失败路径。网络用 MockWebServer（testImplementation）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class PixivImageLoaderTest {

    private static final String CDN = "https://i.pximg.net";

    private MockWebServer server;
    private PixivImageLoader loader;
    private int requestCount;

    @Before
    public void setUp() throws IOException {
        server = new MockWebServer();
        server.start();
        requestCount = 0;
        // 注入 OkHttpClient（直连 MockWebServer）+ 小缓存上限（触发淘汰）
        Context ctx = ApplicationProvider.getApplicationContext();
        loader = new PixivImageLoader(ctx, new OkHttpClient.Builder().build(), 2048L);
    }

    @After
    public void tearDown() throws IOException {
        server.shutdown();
    }

    private String enqueueImage(int sizeBytes) {
        byte[] body = new byte[sizeBytes];
        for (int i = 0; i < sizeBytes; i++) body[i] = (byte) (i % 251);
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(body)));
        requestCount++;
        return server.url("/pixiv-img/" + requestCount + ".jpg").toString();
    }

    // ── URL 重写 ──

    @Test
    public void rewriteUrl_proxyPath_mapsToCdn() {
        assertEquals(CDN + "/123/456.jpg", PixivImageLoader.rewriteUrl("/pixiv-img/123/456.jpg"));
    }

    @Test
    public void rewriteUrl_absoluteProxyPath_mapsToCdn() {
        assertEquals(CDN + "/a/b.png", PixivImageLoader.rewriteUrl("https://host/pixiv-img/a/b.png"));
    }

    @Test
    public void rewriteUrl_nonProxyUrl_unchanged() {
        String plain = "https://other.example.com/img.jpg";
        assertEquals(plain, PixivImageLoader.rewriteUrl(plain));
        assertNull(PixivImageLoader.rewriteUrl(null));
    }

    @Test
    public void rewriteUrl_keepsQueryAndEncoding() {
        assertEquals(CDN + "/x.png?size=medium",
                PixivImageLoader.rewriteUrl("/pixiv-img/x.png?size=medium"));
    }

    @Test
    public void rewriteUrl_normalizesDotSegments() {
        // 对齐 MainActivity 既有 URI.normalize() 行为：dot-segment 折叠 → 单一缓存 key
        assertEquals(CDN + "/b.jpg", PixivImageLoader.rewriteUrl("/pixiv-img/a/../b.jpg"));
        assertEquals(CDN + "/x/y.jpg", PixivImageLoader.rewriteUrl("/pixiv-img/./x/y.jpg"));
    }

    // ── 缓存文件名契约（与 ImageCachePlugin keyToFilename 同规则） ──

    @Test
    public void keyToFilename_isUrlSafeNoPaddingAndRoundTrips() {
        String url = CDN + "/123/456.jpg?size=medium";
        String filename = PixivImageLoader.keyToFilename(url);
        // URL_SAFE + NO_PADDING + NO_WRAP：无 '+'、'/'、'='、换行
        assertFalse(filename.contains("+"));
        assertFalse(filename.contains("/"));
        assertFalse(filename.contains("="));
        assertFalse(filename.contains("\n"));
        // round-trip 还原原 URL
        String decoded = new String(Base64.decode(filename, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP),
                StandardCharsets.UTF_8);
        assertEquals(url, decoded);
    }

    @Test
    public void keyToFilename_isDeterministic() {
        String url = CDN + "/x.jpg";
        assertEquals(PixivImageLoader.keyToFilename(url), PixivImageLoader.keyToFilename(url));
    }

    // ── 缓存读写往返 ──

    @Test
    public void loadFile_downloadsThenCaches_secondCallHitsCache() throws Exception {
        String url = enqueueImage(100);
        File first = loader.loadFile(url);
        assertTrue(first.exists());

        // 第二次：缓存命中（MockWebServer 无新请求）
        File second = loader.loadFile(url);
        assertEquals(first.getAbsolutePath(), second.getAbsolutePath());
        assertEquals(1, server.getRequestCount()); // 只发过一次网络请求
    }

    @Test
    public void loadFile_writesIntoConfiguredCacheDir() throws Exception {
        String url = enqueueImage(50);
        File file = loader.loadFile(url);
        assertTrue(file.getParentFile().getName().equals("pictelio-images"));
        assertEquals(PixivImageLoader.keyToFilename(url), file.getName());
    }

    @Test
    public void loadBytes_returnsDownloadedContent() throws Exception {
        byte[] body = new byte[64];
        for (int i = 0; i < 64; i++) body[i] = (byte) i;
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(body)));
        byte[] loaded = loader.loadBytes(server.url("/pixiv-img/data.bin").toString());
        assertEquals(64, loaded.length);
        assertEquals(0, loaded[0]);
        assertEquals(63, loaded[63]);
    }

    @Test
    public void cachedFile_absentBeforeDownload_returnsNull() throws Exception {
        assertNull(loader.cachedFile("https://cdn.example.com/never-downloaded.jpg"));
    }

    // ── 淘汰策略（超限删最旧） ──

    @Test
    public void enforceCacheLimit_deletesOldestWhenOverLimit() throws Exception {
        // 上限 2048B：写 3 个 1000B → 第 3 个写入时触发淘汰，删最旧的（第 1 个）
        String url1 = enqueueImage(1000);
        String url2 = enqueueImage(1000);
        String url3 = enqueueImage(1000);

        loader.loadFile(url1);
        loader.loadFile(url2);
        File third = loader.loadFile(url3);

        assertFalse("最旧缓存应被淘汰", loader.cachedFile(url1) != null);
        assertNotNull("次新缓存保留", loader.cachedFile(url2));
        assertNotNull("最新缓存保留", loader.cachedFile(url3));
        assertTrue(third.exists());
    }

    // ── 下载失败路径 ──

    @Test
    public void download_http403_throwsIOException() {
        server.enqueue(new MockResponse().setResponseCode(403));
        String url = server.url("/pixiv-img/forbidden.jpg").toString();
        IOException ex = assertThrows(IOException.class, () -> loader.loadFile(url));
        assertTrue(ex.getMessage().contains("403"));
    }

    @Test
    public void download_http500_throwsIOException_andDoesNotCache() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(500));
        String url = server.url("/pixiv-img/error.jpg").toString();
        assertThrows(IOException.class, () -> loader.loadFile(url));
        assertNull("失败响应不得写缓存", loader.cachedFile(url));
    }

    @Test
    public void download_empty200Body_throwsIOException_andDoesNotCache() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer()));
        String url = server.url("/pixiv-img/empty.jpg").toString();
        assertThrows(IOException.class, () -> loader.loadFile(url));
        assertNull("空 body 不得写缓存", loader.cachedFile(url));
    }

    // ── 并发：同 URL 只下载一次（per-URL 锁 + double-check） ──

    @Test
    public void loadFile_concurrentSameUrl_downloadsOnce() throws Exception {
        byte[] body = new byte[80];
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(body)));
        String url = server.url("/pixiv-img/concurrent.jpg").toString();

        int threads = 8;
        Thread[] workers = new Thread[threads];
        java.util.concurrent.atomic.AtomicReference<Exception> failure = new java.util.concurrent.atomic.AtomicReference<>();
        java.util.concurrent.CountDownLatch start = new java.util.concurrent.CountDownLatch(1);
        for (int i = 0; i < threads; i++) {
            workers[i] = new Thread(() -> {
                try {
                    start.await();
                    loader.loadFile(url);
                } catch (Exception e) {
                    failure.set(e);
                }
            });
            workers[i].start();
        }
        start.countDown();
        for (Thread t : workers) {
            t.join(5000);
        }
        assertNull("并发加载不应抛错", failure.get());
        assertEquals("同 URL 并发应只发一次网络请求", 1, server.getRequestCount());
    }

    // ── 下载请求头（Referer/UA，防盗链契约） ──

    @Test
    public void download_sendsRefererAndUserAgent() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(new byte[]{1, 2, 3})));
        loader.loadFile(server.url("/pixiv-img/headers.jpg").toString());
        RecordedRequest req = server.takeRequest();
        assertEquals("https://app-api.pixiv.net/", req.getHeader("Referer"));
        assertTrue(req.getHeader("User-Agent") != null && !req.getHeader("User-Agent").isEmpty());
    }
}
