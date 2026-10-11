package io.pictelio.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
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
import java.util.Random;

import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import okio.Buffer;

/**
 * zip / 导出 / 保存三条链路的键纳入 {@code cacheKey()} 唯一产出点（#987）。
 *
 * <h3>本类要钉死的洞</h3>
 * #980 只把<b>预取与显示</b>两条链路收敛到 {@link PixivImageLoader#cacheKey(String)}。剩下的
 * zip / 导出 / 保存三条链路把 URL <b>直接</b>交给三个 {@code *CachedFirst} 入口，而这三个入口内部
 * 各自 {@code keyToFilename(url)}、<b>不</b>调 {@code cacheKey} ⇒ 磁盘键<b>结构上</b>不受
 * 「缓存键恒官方 CDN URL」不变量保护。修法是把键的产出收口到 loader 内部的唯一文件名产出点
 * {@code cacheFileName(url)}（读路径 {@code cachedFile} 与三个入口的写路径全部经它）。
 *
 * <h3>为何既有测试天然覆盖不到（改动前的实测缺口）</h3>
 * {@link PixivImageServiceTest} 全部走 MockWebServer 的<b>绝对 URL</b>，其中不含
 * {@code /pixiv-img/}，故 {@code rewriteUrl} 对它们是<b>恒等映射</b>——代理形态与官方形态在那类
 * fixture 下根本不是同一个键空间，「两种形态是否归一」无从观察。本类因此<b>专门构造代理形态</b>
 * 并断言它与官方形态<b>落到同一条目</b>。
 *
 * <h3>代理形态为何取<b>绝对</b> URL（刻意的用例设计）</h3>
 * 票面反事实是「某处将来传入代理路径形态的 URL」。取<b>相对</b>形态 {@code /pixiv-img/x} 时该情形
 * 在写路径上<b>不可达</b>：{@link PixivImageLoader#download} 把入参原样交给 OkHttp，相对 URL 会先被
 * {@code Request.Builder().url} 抛 {@code IllegalArgumentException}，条目根本写不出来。
 * 故本类取<b>绝对</b>代理形态——它含 {@code /pixiv-img/} 故被 {@code rewriteUrl} 精确归一，
 * 同时本身是合法可下载 URL ⇒ 写路径可被真实驱动，「产生第二条条目」得以按票面原话直接观测。
 *
 * <h3>不断网：下载打在 MockWebServer 上</h3>
 * {@code rewriteUrl} 恒产出官方 CDN URL，故无论传入哪种形态，真正的下载 URL 都被钉在
 * {@code https://i.pximg.net}。本类借 <b>图床镜像缝</b>（{@link ImageHostConfig}，
 * ADR-0143 D1）把下载源换成 MockWebServer——{@code transform()} 只替换 protocol/host/port、
 * path+query 逐字节保留。这条缝是<b>生产既有</b>的下载源决策机制，非测试专用后门；
 * 「缓存键恒官方 URL」（D2）正是它必须成立的前提，本类顺带把它钉住。
 *
 * <h3>oracle 溯源（测试硬约束 #6）</h3>
 * 期望值只取三类<b>独立</b>事实，无一从被测实现反推：
 * <ol>
 *   <li>官方 CDN URL 字面量 {@link #OFFICIAL_FORM}——断言「代理形态写入后落在 rewrite 产物的
 *       文件名上」，而非「落在自身产物上」；</li>
 *   <li>MockWebServer 回的固定载荷长度（本类自写，与实现无关）；</li>
 *   <li>缓存目录里的条目计数（两形态合一 ⇒ 恰一条）。</li>
 * </ol>
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class ImageCacheZipChainKeyTest {

    /** 官方 CDN URL 字面量：图片的唯一真实形态（与 {@link ImageCacheKeySpaceTest} 同一字面量） */
    private static final String OFFICIAL_FORM =
            "https://i.pximg.net/img-master/2020/01/01/abc.png";
    /**
     * 同一张图的<b>绝对</b>代理形态（含 {@code /pixiv-img/}，故被 {@code rewriteUrl} 精确归一为
     * {@link #OFFICIAL_FORM}；本身是合法可下载 URL，故写路径可被真实驱动）。
     */
    private static final String PROXY_FORM =
            "https://proxy-host.invalid/pixiv-img/img-master/2020/01/01/abc.png";

    /** 另一张图：用于「两形态合一不得把不同图也合并」的对照 */
    private static final String OTHER_OFFICIAL =
            "https://i.pximg.net/img-master/2020/01/01/other.png";

    /** 载荷（MockWebServer 无条件返回它）：其长度即「返回字节数」的独立出处 */
    private static final byte[] PAYLOAD = "zip-chain-payload".getBytes(java.nio.charset.StandardCharsets.UTF_8);

    private MockWebServer server;
    private Context ctx;
    private PixivImageLoader loader;

    @Before
    public void setUp() throws Exception {
        server = new MockWebServer();
        server.start();
        // 无条件应答：任意 path、任意次数都回同一载荷，测试不与请求条数耦合
        server.setDispatcher(new Dispatcher() {
            @Override
            public MockResponse dispatch(RecordedRequest request) {
                return new MockResponse().setResponseCode(200)
                        .setBody(new Buffer().write(PAYLOAD));
            }
        });

        ctx = ApplicationProvider.getApplicationContext();
        // 全注入构造（#986 起的测试缝）：图床打开并把下载源指向 MockWebServer，
        // 容量给足使淘汰不参与本类的观察面。
        ImageHostConfig mockHost = new ImageHostConfig(
                () -> mirrorSettingsJson(),
                System::currentTimeMillis,
                new Random(1),
                url -> -1L,   // ProbeFn：本类不触发探测
                Runnable::run);
        loader = new PixivImageLoader(ctx, new OkHttpClient(), 64L * 1024 * 1024, mockHost);
        clearDiskCache();
    }

    @After
    public void tearDown() throws Exception {
        clearDiskCache();
        server.shutdown();
    }

    /** 图床配置：master 开 + single 模式 + 唯一 host = 本地 MockWebServer */
    private String mirrorSettingsJson() {
        return "{\"masterEnabled\":true,\"mode\":\"single\",\"selectedHostId\":\"mock\","
                + "\"hosts\":[{\"id\":\"mock\",\"enabled\":true,\"weight\":1,\"baseUrl\":\"http://"
                + server.getHostName() + ":" + server.getPort() + "\"}]}";
    }

    // ── 锚点：两种形态的键空间必须重合 ────────────────────────

    /**
     * 锚点：代理形态与官方形态归一到<b>同一个官方 URL</b>，从而共用同一个磁盘文件名。
     * 这正是票面 AC「任一处传入代理形态 URL 不得产生第二条缓存条目」的前提。
     */
    @Test
    public void proxyForm_normalizesToTheSameOfficialUrlAsOfficialForm() {
        assertEquals("代理形态应被 rewriteUrl 精确归一为官方 CDN URL",
                OFFICIAL_FORM, PixivImageLoader.cacheKey(PROXY_FORM));
        assertEquals("两种形态必须映射到同一磁盘文件名，否则内存/磁盘会分叉",
                PixivImageLoader.keyToFilename(OFFICIAL_FORM),
                PixivImageLoader.keyToFilename(PixivImageLoader.cacheKey(PROXY_FORM)));
    }

    /**
     * 反漂移：归一不得过宽——两张<b>不同</b>图仍须各占一条条目（防止「把所有代理形态收进同一条」
     * 这类假修法也能让上面的锚点变绿）。
     */
    @Test
    public void distinctImages_stillGetDistinctEntries() throws Exception {
        loader.loadBytesCachedFirst(PROXY_FORM);
        loader.loadBytesCachedFirst(OTHER_OFFICIAL);
        assertEquals("不同图片应各占一条磁盘条目（归一不得过宽）", 2, diskEntryCount());
    }

    // ── 三条链路 × 两个方向：写入形态与读取形态交叉 ────────────
    //
    // 每个入口两个方向都要断言：只验一个方向时，另一个方向的退化不会被发现
    // （写侧退化 ⇒ 官方形态读不回；读侧退化 ⇒ 代理形态读不到、还会多下载出一条）。
    // 逐条点名三个入口而非共用一个参数化用例：回归的表现是「某条链路的某个入口退回旧行为」，
    // 点名能让失败信息直接指认是哪条链路。

    /** 链路一：zip 导出 / 小说导出 —— {@code loadBytesCachedFirst} 字节入口 */
    @Test
    public void zipExportChain_writeProxyThenReadOfficial_hitsOneEntry() throws Exception {
        assertArrayEquals(PAYLOAD, loader.loadBytesCachedFirst(PROXY_FORM));

        assertNotNull("代理形态写入后，官方形态必须读得回同一条目",
                loader.cachedFile(OFFICIAL_FORM));
        assertEquals("代理形态写入不得产生第二条条目", 1, diskEntryCount());
    }

    /** 同上，反方向：官方形态写入 → 代理形态读回（读侧退化时此处会多下载出一条） */
    @Test
    public void zipExportChain_writeOfficialThenReadProxy_hitsOneEntry() throws Exception {
        loader.loadBytesCachedFirst(OFFICIAL_FORM);

        assertNotNull("官方形态写入后，代理形态必须命中同一文件",
                loader.cachedFile(PROXY_FORM));
        assertEquals("代理形态读不得触发下载、不得产生第二条条目", 1, diskEntryCount());
    }

    /** 链路二：保存到相册 —— {@code loadFileCachedFirst} 文件入口 */
    @Test
    public void saveToGalleryChain_writeProxyThenReadOfficial_hitsOneEntry() throws Exception {
        File viaProxy = loader.loadFileCachedFirst(PROXY_FORM);
        assertEquals(PAYLOAD.length, viaProxy.length());

        assertNotNull("代理形态写入后，官方形态必须读得回同一条目",
                loader.cachedFile(OFFICIAL_FORM));
        assertEquals("代理形态写入不得产生第二条条目", 1, diskEntryCount());
    }

    /** 同上，反方向 */
    @Test
    public void saveToGalleryChain_writeOfficialThenReadProxy_hitsOneEntry() throws Exception {
        loader.loadFileCachedFirst(OFFICIAL_FORM);

        assertNotNull("官方形态写入后，代理形态必须命中同一文件",
                loader.cachedFile(PROXY_FORM));
        assertEquals("代理形态读不得触发下载、不得产生第二条条目", 1, diskEntryCount());
    }

    /** 链路三：作品保存 / zip 下载 —— {@code loadFileWithProgressCachedFirst} 流式入口 */
    @Test
    public void downloaderChain_writeProxyThenReadOfficial_hitsOneEntry() throws Exception {
        File viaProxy = loader.loadFileWithProgressCachedFirst(
                PROXY_FORM, (done, total) -> { }, () -> false);
        assertEquals(PAYLOAD.length, viaProxy.length());

        assertNotNull("代理形态写入后，官方形态必须读得回同一条目",
                loader.cachedFile(OFFICIAL_FORM));
        assertEquals("代理形态写入不得产生第二条条目", 1, diskEntryCount());
    }

    /** 同上，反方向 */
    @Test
    public void downloaderChain_writeOfficialThenReadProxy_hitsOneEntry() throws Exception {
        loader.loadFileWithProgressCachedFirst(
                OFFICIAL_FORM, (done, total) -> { }, () -> false);

        assertNotNull("官方形态写入后，代理形态必须命中同一文件",
                loader.cachedFile(PROXY_FORM));
        assertEquals("代理形态读不得触发下载、不得产生第二条条目", 1, diskEntryCount());
    }

    // ── 读路径与写路径必然同名（半吊子修法的防线） ────────────

    /**
     * 防「只改了 {@code cachedFile} 忘了改写路径」：按<b>官方形态</b>的文件名预置一条目，
     * 代理形态的读必须找到它。
     */
    @Test
    public void readPath_resolvesTheCanonicalOfficialFilename() throws Exception {
        File byOfficialName = new File(loader.getCacheDir(),
                PixivImageLoader.keyToFilename(OFFICIAL_FORM));
        PixivImageLoader.writeFile(byOfficialName, PAYLOAD);

        assertEquals("读路径必须解析到官方形态的文件名", byOfficialName, loader.cachedFile(PROXY_FORM));
        assertEquals("读命中不得触发下载", 1, diskEntryCount());
    }

    // ── 辅助 ──────────────────────────────────────────────────

    /** 磁盘层条目数（#980 起沿用「各只有一条目」的量化观察点） */
    private int diskEntryCount() {
        File[] files = loader.getCacheDir().listFiles();
        return files == null ? 0 : files.length;
    }

    private void clearDiskCache() {
        File[] files = loader.getCacheDir().listFiles();
        if (files == null) {
            return;
        }
        for (File f : files) {
            assertTrue("磁盘缓存清理失败: " + f, f.delete());
        }
    }
}
