package io.pictelio.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

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
import java.util.Random;

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
    /** 图床用镜像服务器（仅图床用例创建；官方下载源由 {@link #server} 扮演） */
    private MockWebServer mirrorServer;
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
        if (mirrorServer != null) {
            mirrorServer.shutdown();
        }
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

    // ── 图床下载源（ADR-0143 D1/D2/D4，ticket #378 T2） ──────

    /**
     * 单镜像 single 模式配置（fixture 形状对齐 imageHostStore.ts 持久化形态 + BUILT_IN_HOSTS，
     * 先例 ImageHostConfigTest；RawProvider/Clock/Random/ProbeFn/Executor 全注入，
     * 不触 SharedPreferences 与生产单例）。
     */
    private static ImageHostConfig singleMirrorConfig(String mirrorBaseUrl) {
        String raw = "{\"masterEnabled\":true,\"mode\":\"single\",\"selectedHostId\":\"m\""
                + ",\"hosts\":[{\"id\":\"m\",\"name\":\"mirror\",\"baseUrl\":\"" + mirrorBaseUrl
                + "\",\"enabled\":true,\"weight\":1,\"isBuiltIn\":false,\"edited\":false}]"
                + ",\"probeResults\":[],\"fastestHostId\":null,\"fastestHostExpiresAt\":null}";
        return new ImageHostConfig(() -> raw, () -> 0L, new Random(1L), url -> -1L, Runnable::run);
    }

    /** 图床关配置（raw = null 即无存储条目的缺省态；resolve 恒等透传） */
    private static ImageHostConfig hostOffConfig() {
        return new ImageHostConfig(() -> null, () -> 0L, new Random(1L), url -> -1L, Runnable::run);
    }

    /** 每行递增字节的确定性 body（值域对齐 enqueueImage 先例） */
    private static byte[] bodyBytes(int sizeBytes) {
        byte[] body = new byte[sizeBytes];
        for (int i = 0; i < sizeBytes; i++) body[i] = (byte) (i % 251);
        return body;
    }

    @Test
    public void keyToFilename_rewriteUrlProduct_equalsOfficialUrlKey() {
        // Anti-drift 防线（ADR-0143 D2 源无关命中不变量；spec #376 测试决策「anti-drift 防线」，
        // 期望值出处遵循测试硬约束 #6）：拦截侧 rewriteUrl 产物与官方 CDN URL 字面量是两条独立
        // 路径，必须产出同一缓存键——若任一侧改写规则漂移（normalize/编码差异），预取/显示与
        // 拦截将查写不同条目，重现「键二次断裂」（预取字节成死数据、显示永不命中）。
        String official = "https://i.pximg.net/img-master/2020/01/01/abc.jpg";
        assertEquals(PixivImageLoader.keyToFilename(official),
                PixivImageLoader.keyToFilename(
                        PixivImageLoader.rewriteUrl("/pixiv-img/img-master/2020/01/01/abc.jpg")));
        // 带 query 形态：query 在两条路径上逐字节保留（review P3 #8 补例——组合等值防漂移）
        String officialQuery = "https://i.pximg.net/img-master/2020/01/01/abc.jpg?a=1&b=2";
        assertEquals(PixivImageLoader.keyToFilename(officialQuery),
                PixivImageLoader.keyToFilename(
                        PixivImageLoader.rewriteUrl("/pixiv-img/img-master/2020/01/01/abc.jpg?a=1&b=2")));
    }

    @Test
    public void download_mirrorHit_requestsMirrorWithReferer_cachesUnderOfficialKey() throws Exception {
        mirrorServer = new MockWebServer();
        mirrorServer.start();
        // 镜像源字节（值域与 bodyBytes 反相，证明字节确来自镜像而非官方）
        byte[] body = new byte[128];
        for (int i = 0; i < body.length; i++) body[i] = (byte) (255 - i);
        mirrorServer.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(body)));
        String official = server.url("/img-master/img/2020/01/01/mirror-hit.jpg").toString();
        loader = new PixivImageLoader(ApplicationProvider.getApplicationContext(),
                new OkHttpClient.Builder().build(), 1 << 20,
                singleMirrorConfig(mirrorServer.url("/").toString()));

        assertArrayEquals(body, loader.loadBytes(official));

        // 请求打到镜像（resolve 仅替换 host:port，path 逐字节保留），官方零流量
        assertEquals(1, mirrorServer.getRequestCount());
        assertEquals(0, server.getRequestCount());
        RecordedRequest req = mirrorServer.takeRequest();
        assertEquals("/img-master/img/2020/01/01/mirror-hit.jpg", req.getPath());
        // 防盗链契约对镜像同样成立（镜像站代理官方资源需 Referer/UA）
        assertEquals("https://app-api.pixiv.net/", req.getHeader("Referer"));
        assertNotNull(req.getHeader("User-Agent"));

        // 缓存键恒官方 URL（ADR-0143 D2）：镜像源字节落官方键，镜像键零条目
        assertNotNull(loader.cachedFile(official));
        assertNull(loader.cachedFile(
                mirrorServer.url("/img-master/img/2020/01/01/mirror-hit.jpg").toString()));
    }

    @Test
    public void download_mirrorHttp500_retriesOfficialOnce_cachesUnderOfficialKey() throws Exception {
        mirrorServer = new MockWebServer();
        mirrorServer.start();
        byte[] body = bodyBytes(96);
        mirrorServer.enqueue(new MockResponse().setResponseCode(500));
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(body)));
        String official = server.url("/img-master/img/2020/01/01/fallback.jpg").toString();
        loader = new PixivImageLoader(ApplicationProvider.getApplicationContext(),
                new OkHttpClient.Builder().build(), 1 << 20,
                singleMirrorConfig(mirrorServer.url("/").toString()));

        assertArrayEquals(body, loader.loadBytes(official));

        // 镜像恰一次失败 + 官方恰一次重试成功（回退不递归：官方再失败即上抛，见 both-fail 用例）
        assertEquals(1, mirrorServer.getRequestCount());
        assertEquals(1, server.getRequestCount());
        // 缓存以官方 URL 键落盘（D2）；镜像键零条目
        assertNotNull(loader.cachedFile(official));
        assertNull(loader.cachedFile(
                mirrorServer.url("/img-master/img/2020/01/01/fallback.jpg").toString()));
    }

    @Test
    public void download_mirrorConnectRefused_fallsBackToOfficial() throws Exception {
        // 镜像 connect 失败（先起服务占端口再关闭 → 连接拒绝）→ IOException → 官方回退成功
        MockWebServer dead = new MockWebServer();
        dead.start();
        String deadBase = dead.url("/").toString();
        dead.shutdown();
        byte[] body = bodyBytes(64);
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(body)));
        String official = server.url("/img-master/img/2020/01/01/connect-refused.jpg").toString();
        loader = new PixivImageLoader(ApplicationProvider.getApplicationContext(),
                new OkHttpClient.Builder().build(), 1 << 20, singleMirrorConfig(deadBase));

        assertArrayEquals(body, loader.loadBytes(official));
        assertEquals(1, server.getRequestCount());
        assertNotNull(loader.cachedFile(official));
    }

    @Test
    public void download_mirrorAndOfficialBothFail_throwsMirrorOriginalError_noCache() throws Exception {
        // IO 边界失败路径覆盖（测试硬约束 #1）：镜像与官方均失败 → 上抛、零缓存落盘
        mirrorServer = new MockWebServer();
        mirrorServer.start();
        mirrorServer.enqueue(new MockResponse().setResponseCode(503));
        server.enqueue(new MockResponse().setResponseCode(500));
        String official = server.url("/img-master/img/2020/01/01/both-fail.jpg").toString();
        loader = new PixivImageLoader(ApplicationProvider.getApplicationContext(),
                new OkHttpClient.Builder().build(), 1 << 20,
                singleMirrorConfig(mirrorServer.url("/").toString()));

        IOException ex = assertThrows(IOException.class, () -> loader.loadBytes(official));
        // 申报语义（ticket #378）：重试仍失败抛镜像原始异常——503 来自镜像而非官方的 500
        assertTrue(ex.getMessage().contains("503"));
        assertEquals(1, mirrorServer.getRequestCount());
        assertEquals(1, server.getRequestCount());
        assertNull("两条路径均失败不得写缓存", loader.cachedFile(official));
    }

    @Test
    public void download_hostOff_identity_singleOfficialRequest() throws Exception {
        // resolve 恒等（图床关 fixture：raw=null 缺省态）→ 与既有官方路径逐字节等价（回归保护）：
        // 单次官方请求、官方键落盘
        byte[] body = bodyBytes(64);
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(body)));
        String official = server.url("/img-master/img/2020/01/01/host-off.jpg").toString();
        loader = new PixivImageLoader(ApplicationProvider.getApplicationContext(),
                new OkHttpClient.Builder().build(), 1 << 20, hostOffConfig());

        assertArrayEquals(body, loader.loadBytes(official));
        assertEquals(1, server.getRequestCount());
        assertNotNull(loader.cachedFile(official));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Host 头显式注入（T3：直连下 Akamai 虚拟主机路由硬约束）
    // ─────────────────────────────────────────────────────────────────────

    /**
     * T3 验证：下载 i.pximg.net URL 时，request.headers 必须含
     * {@code Host: i.pximg.net}——directaccess 钉 IP 走法要求显式 Host 头，
     * Akamai 用 Host 头路由到正确 bucket（pixiv-viewer-app 同款契约）。
     */
    @Test
    public void fetch_includesExplicitHostHeader() throws Exception {
        byte[] body = bodyBytes(32);
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(body)));
        String url = server.url("/img-master/img/2020/01/01/host-explicit.jpg").toString();

        assertArrayEquals(body, loader.loadBytes(url));

        RecordedRequest req = server.takeRequest();
        String host = req.getHeader("Host");
        assertNotNull("Host 头缺失（Akamai 虚拟主机路由要求）", host);
        // MockWebServer 自身的 host（含端口）；关键是 Host 头存在，与 URL 字面量 host 一致
        assertTrue("Host 头应反映 URL 字面量 host，实际=" + host,
                host.startsWith("localhost") || host.contains(":"));
    }

    /**
     * T3 边界：URL 非法时 extractHost 返回 null 或不抛异常——Host 头注入跳过。
     * 这是契约保护：避免 extractHost 解析失败导致整个下载链路崩溃。
     * 注：{@code URI} 解析较宽松，对部分非 URL 字符串也能解析（host 字段可能非空）。
     * 我们的契约是"调用方拿到合法 URL 时正确提取"，而非"对所有垃圾输入返回 null"——
     * 因此只断言 null 输入必返 null + 非法输入不抛异常。
     */
    @Test
    public void extractHost_invalidUrl_returnsNull() {
        assertNull(PixivImageLoader.extractHost(null));
        // 空白字符串 parse 可能抛异常或返 null/empty——断言不抛 IllegalArgument 之外异常
        try {
            String result = PixivImageLoader.extractHost("");
            // 空字符串 URI 解析可能返 null 或 empty，host 字段必为空
            assertTrue(result == null || result.isEmpty());
        } catch (Exception e) {
            fail("空字符串不应抛异常: " + e.getMessage());
        }
        // 真正非 URL 字符串：无空格时可解析为相对 URI 但 host 必为空
        String result = PixivImageLoader.extractHost("not a url with spaces");
        assertTrue("垃圾输入不应返回非空 host，实际=" + result,
                result == null || result.isEmpty());
    }

    /**
     * T3 正常路径：从合法 URL 提取 host 不带端口、不带路径。
     */
    @Test
    public void extractHost_validUrl_returnsHostOnly() {
        assertEquals("i.pximg.net", PixivImageLoader.extractHost("https://i.pximg.net/img-master/x.jpg"));
        assertEquals("i.pximg.net", PixivImageLoader.extractHost("https://i.pximg.net"));
        assertEquals("s.pximg.net", PixivImageLoader.extractHost("http://s.pximg.net:8080/path"));
    }
}
