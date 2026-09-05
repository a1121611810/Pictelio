package io.pictelio.app;

import static org.junit.Assert.assertArrayEquals;
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
import java.nio.file.Files;

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

    // ── 写盘原子性（B5/诊断 F3：tmp+rename，防并发截断写坏缓存） ──

    @Test
    public void loadFile_persistsCompleteContent_andLeavesNoTmpFiles() throws Exception {
        byte[] body = new byte[1024];
        for (int i = 0; i < body.length; i++) body[i] = (byte) (i % 251);
        String url = server.url("/pixiv-img/roundtrip-atomic.jpg").toString();
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(body)));

        File file = loader.loadFile(url);

        // round-trip：磁盘内容与下载字节逐字节一致（目标文件完整，非截断）
        assertArrayEquals(body, Files.readAllBytes(file.toPath()));
        // 成功路径无 .tmp 残留（tmp 已被 rename 替换为目标）
        File[] tmpFiles = file.getParentFile().listFiles((d, name) -> name.endsWith(".tmp"));
        assertNotNull(tmpFiles);
        assertEquals(0, tmpFiles.length);
    }

    @Test
    public void writeFile_failureInReadOnlyDir_targetNotCorruptedAndNoTmpLeftover() throws Exception {
        // 可移植性守卫（review #358 P3）：root 下 setWritable(false) 不生效、
        // Windows 目录只读属性不阻止建文件——前置条件不成立则跳过，不产生假失败
        org.junit.Assume.assumeFalse("root 账户绕过目录写权限", isRunningAsRoot());
        String url = server.url("/pixiv-img/readonly-dir.jpg").toString();
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(new byte[512])));
        File dir = loader.getCacheDir();
        File target = new File(dir, PixivImageLoader.keyToFilename(url));
        assertTrue(target.createNewFile()); // 预置空目标：断言失败后仍为空、未被半截内容污染
        org.junit.Assume.assumeTrue("目录写权限未生效，前置条件不成立", dir.setWritable(false));
        try {
            // 临时文件创建失败（只读目录）→ IOException 上抛，目标不被截断写入
            assertThrows(IOException.class, () -> loader.loadFile(url));
            assertEquals("目标文件不得被写入半截内容", 0, target.length());
            File[] tmpFiles = dir.listFiles((d, name) -> name.endsWith(".tmp"));
            assertNotNull(tmpFiles);
            assertEquals("失败路径不得残留 .tmp", 0, tmpFiles.length);
        } finally {
            // 恢复可写，避免污染同 context 缓存目录的后续测试
            dir.setWritable(true);
        }
    }

    @Test
    public void writeFile_atomicReplace_succeedsEvenWhenExistingTargetReadOnly() throws Exception {
        // 可移植性守卫（review #358 P3）：Windows 的 rename 语义不同，POSIX 专属用例
        org.junit.Assume.assumeFalse(System.getProperty("os.name", "").startsWith("Windows"));
        byte[] body = new byte[256];
        java.util.Arrays.fill(body, (byte) 0x5A);
        String url = server.url("/pixiv-img/readonly-target.jpg").toString();
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(body)));
        File dir = loader.getCacheDir();
        File target = new File(dir, PixivImageLoader.keyToFilename(url));
        // 预置只读空目标（length=0 使 cachedFile 视为未命中，强制走写盘路径）
        assertTrue(target.createNewFile());
        assertTrue(target.setReadOnly());
        // 旧实现直接 FileOutputStream(只读目标) 抛 FileNotFoundException；
        // tmp+rename 后（POSIX rename 只看目录写权限）应成功替换且内容完整
        File file = loader.loadFile(url);
        assertEquals(target.getAbsolutePath(), file.getAbsolutePath());
        assertArrayEquals(body, Files.readAllBytes(file.toPath()));
    }

    /** root（uid=0）绕过文件权限检查，只读目录用例的前置条件不成立 */
    private static boolean isRunningAsRoot() {
        return "0".equals(System.getProperty("user.name"))
                || "root".equals(System.getenv("USER"))
                || "root".equals(System.getProperty("user.name"));
    }
}
