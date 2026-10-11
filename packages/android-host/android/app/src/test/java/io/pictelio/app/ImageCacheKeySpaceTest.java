package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
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

import okhttp3.mockwebserver.MockWebServer;

/**
 * 两层缓存键空间统一（#980）——「缓存键恒官方 CDN URL」不变量在<b>内存层</b>的防线。
 *
 * <h3>本类要钉死的洞</h3>
 * 磁盘层以 rewrite 后的官方 CDN URL 为键，内存层此前以<b>未 rewrite 的原始 url</b> 为键。
 * 于是同一张图若以 {@code /pixiv-img/xxx} 与 {@code https://i.pximg.net/xxx} 两种形态请求，
 * 磁盘共享一条目、内存却记两份：内存预算被双份占用，命中率统计随之失真。
 *
 * <h3>为何既有测试天然覆盖不到（改动前的实测缺口）</h3>
 * {@link PictelioImageServiceTest} 全部走 MockWebServer 的<b>绝对 URL</b>
 * （如 {@code http://localhost:PORT/img/x.png}），其中<b>不含</b> {@code /pixiv-img/}，
 * 故 {@code rewriteUrl} 对它们是<b>恒等映射</b>——代理路径形态与绝对地址形态在那种 fixture
 * 下根本不是同一个键空间，「两种形态是否归一」无从观察。本类因此<b>专门构造两种形态</b>：
 * 代理路径 {@code /pixiv-img/img-master/...} 与其 rewrite 产物 {@code https://i.pximg.net/img-master/...}。
 *
 * <h3>oracle 溯源（测试硬约束 #6）</h3>
 * 期望值只取两类独立事实：
 * <ol>
 *   <li><b>官方 CDN URL 字面量</b>（{@link #OFFICIAL_FORM}）——与被测实现是两条独立路径，
 *       断言「rewrite 产物 = 字面量」而非「rewrite 产物 = rewrite 产物」；</li>
 *   <li>MockWebServer 的 {@code getRequestCount()}（真实网络请求次数）。</li>
 * </ol>
 * 内存层键则通过<b>公开</b> {@link ImageMemoryCache#get(String)} 正反两面探测：
 * 键空间内可取到、键空间外取不到——不触任何私有字段或反射。
 *
 * <h3>为何不用网络取图</h3>
 * rewrite 产物指向真实 CDN（{@code https://i.pximg.net}），单测里不可达。故本类
 * <b>预置磁盘条目</b>（{@link PixivImageLoader#writeFile}，包可见测试缝）后走缓存命中路径：
 * 这让断言同时多出一条强证据——<b>两种形态合计零网络请求</b>，即第二次加载确实命中了
 * 第一次的条目，而非各自重新下载。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class ImageCacheKeySpaceTest {

    /** 1×1 透明 PNG（用例内置字面量，非被测实现反推） */
    private static final byte[] PNG_1PX = Base64.decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            Base64.DEFAULT);

    /** 官方 CDN URL 字面量：图片的唯一真实形态 */
    private static final String OFFICIAL_FORM =
            "https://i.pximg.net/img-master/2020/01/01/abc.png";
    /** 同一张图的代理路径形态（Lynx 侧 <image src> 实际拿到的形态） */
    private static final String PROXY_FORM =
            "/pixiv-img/img-master/2020/01/01/abc.png";

    private MockWebServer server;
    private Context ctx;
    private ImageMemoryCache memoryCache;
    private PictelioImageService service;
    private PixivImageLoader diskProbe;

    @Before
    public void setUp() throws Exception {
        server = new MockWebServer();
        server.start();
        ctx = ApplicationProvider.getApplicationContext();
        // 干净实例（#977 测试缝）：容量显式给足（#979 起无默认容量）
        memoryCache = new ImageMemoryCache(64L * 1024 * 1024);
        diskProbe = new PixivImageLoader(ctx);
        clearDiskCache();
        service = new PictelioImageService(memoryCache);
        service.onInitialize(ctx);
    }

    @After
    public void tearDown() throws Exception {
        server.shutdown();
    }

    private void clearDiskCache() {
        File[] files = diskProbe.getCacheDir().listFiles();
        if (files == null) {
            return;
        }
        for (File f : files) {
            assertTrue("磁盘缓存清理失败: " + f, f.delete());
        }
    }

    /** 磁盘层条目数（#980「各只有一条目」的量化观察点） */
    private int diskEntryCount() {
        File[] files = diskProbe.getCacheDir().listFiles();
        return files == null ? 0 : files.length;
    }

    /**
     * 预置磁盘条目：按<b>键空间内的键</b>落盘，使后续加载走磁盘命中、零网络。
     * 用 {@code writeFile}（包可见）而非发起下载，避免触及真实 CDN。
     */
    private void seedDiskEntry(String key) throws Exception {
        File dir = diskProbe.getCacheDir();
        PixivImageLoader.writeFile(new File(dir, PixivImageLoader.keyToFilename(key)), PNG_1PX);
    }

    private static ImageRequestInfo request(String url) {
        return new ImageRequestInfoBuilder().setUrl(url).build();
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

    private Bitmap loadAndAwaitBitmap(String url) throws Exception {
        RecordingListener listener = new RecordingListener();
        service.fetchImage(request(url), listener, null, ctx);
        assertTrue("onSuccess 应在超时内回调: " + url, listener.done.await(5, TimeUnit.SECONDS));
        assertNull("不应失败: " + url + " / " + listener.failure.get(), listener.failure.get());
        ImageContent content = listener.success.get();
        assertNotNull("应收到 ImageContent: " + url, content);
        // 1×1 来自用例内置 PNG 字面量（独立来源），不是被测实现的反推
        assertEquals("载荷宽度应为 1: " + url, 1, content.getIntrinsicWidth());
        assertEquals("载荷高度应为 1: " + url, 1, content.getIntrinsicHeight());
        return content.getBitmap();
    }

    // ── 键的唯一产出点 ───────────────────────────────────

    @Test
    public void cacheKey_proxyPath_equalsOfficialUrlLiteral() {
        // anti-drift 防线（#980）：内存层与磁盘层的键恒等于 rewrite 产物，
        // 而 rewrite 产物恒等于官方 CDN URL 字面量。两条独立路径，非自洽反推。
        assertEquals(OFFICIAL_FORM, PixivImageLoader.cacheKey(PROXY_FORM));
        assertEquals(OFFICIAL_FORM, PixivImageLoader.cacheKey(OFFICIAL_FORM));
    }

    @Test
    public void cacheKey_isIdempotent_onOfficialUrl() {
        // 幂等：磁盘层入参契约是「调用方已给官方 URL」，重复取键不得改变结果
        // （否则「先 rewrite 再进缓存路径」的双重调用会把条目写到别处）。
        String once = PixivImageLoader.cacheKey(PROXY_FORM);
        assertEquals(once, PixivImageLoader.cacheKey(once));
        assertEquals(once, PixivImageLoader.cacheKey(PixivImageLoader.cacheKey(PROXY_FORM)));
    }

    @Test
    public void cacheKey_nonProxyAndNull_unchanged() {
        // 非代理 URL 不属本票归一范围，须原样透传（免得把第三方 URL 误改写）
        String plain = "https://other.example.com/a.png";
        assertEquals(plain, PixivImageLoader.cacheKey(plain));
        assertNull(PixivImageLoader.cacheKey(null));
    }

    @Test
    public void bothUrlForms_mapToSameDiskKey() {
        // 磁盘层：两种形态 → 同一文件名（既有行为，本条为不回归的显式钉死）
        assertEquals(PixivImageLoader.keyToFilename(PixivImageLoader.cacheKey(PROXY_FORM)),
                PixivImageLoader.keyToFilename(PixivImageLoader.cacheKey(OFFICIAL_FORM)));
    }

    // ── 反漂移防线扩展到内存层 ─────────────────────────────

    @Test
    public void fetchImage_memoryKey_equalsRewriteProduct_notRawProxyPath() throws Exception {
        seedDiskEntry(PixivImageLoader.cacheKey(PROXY_FORM));

        loadAndAwaitBitmap(PROXY_FORM);

        // 键空间内：以 rewrite 产物为键可取到条目
        assertNotNull("内存层键应恒等于 rewrite 产物（官方 CDN URL）",
                memoryCache.get(OFFICIAL_FORM));
        // 键空间外：以未 rewrite 的原始代理路径为键取不到——即内存层<b>没有</b>用原始 url 当键。
        // 这一条是本票的核心断言：改动前它会拿到非 null（内存层按原始 url 记了第二条）。
        assertNull("内存层不应以未 rewrite 的原始 url 为键",
                memoryCache.get(PROXY_FORM));
        assertEquals("内存层应只有一条目", 1, memoryCache.size());
    }

    // ── 两种形态各只有一条目 ───────────────────────────────

    @Test
    public void fetchImage_twoUrlForms_shareSingleMemoryAndDiskEntry() throws Exception {
        seedDiskEntry(PixivImageLoader.cacheKey(PROXY_FORM));

        Bitmap viaProxy = loadAndAwaitBitmap(PROXY_FORM);
        Bitmap viaOfficial = loadAndAwaitBitmap(OFFICIAL_FORM);

        // 内存层：两形态合一 —— 第二次命中首次条目，故交付同一 Bitmap 实例
        assertSame("绝对地址形态应命中代理路径形态已缓存的同一条目（内存层归一）",
                viaProxy, viaOfficial);
        assertEquals("内存层应只有一条目", 1, memoryCache.size());

        // 磁盘层：两形态合一 —— 预置 1 条，全程零新增
        assertEquals("磁盘层应只有一条目", 1, diskEntryCount());

        // 合计零网络请求：两种形态都由预置条目供给（改动前后都应为 0，
        // 但它同时证明「第二次命中」不是靠重新下载伪造的）
        assertEquals("全程不应发起网络请求", 0, server.getRequestCount());
    }

    @Test
    public void fetchImage_absoluteFormFirst_thenProxyForm_sharesEntry() throws Exception {
        seedDiskEntry(PixivImageLoader.cacheKey(OFFICIAL_FORM));

        Bitmap viaOfficial = loadAndAwaitBitmap(OFFICIAL_FORM);
        Bitmap viaProxy = loadAndAwaitBitmap(PROXY_FORM);

        // 反向顺序同样归一 —— 归一性不得依赖「谁先来」
        assertSame("代理路径形态应命中绝对地址形态已缓存的同一条目（内存层归一）",
                viaOfficial, viaProxy);
        assertEquals("内存层应只有一条目", 1, memoryCache.size());
        assertEquals("磁盘层应只有一条目", 1, diskEntryCount());
        assertEquals("全程不应发起网络请求", 0, server.getRequestCount());
    }

    @Test
    public void fetchImage_differentImages_keepSeparateEntries() throws Exception {
        // 反向防线：归一不得过度——两张<b>不同</b>的图必须各占一条，否则是合并键的缺陷。
        String otherOfficial = "https://i.pximg.net/img-master/2020/01/01/other.png";
        seedDiskEntry(PixivImageLoader.cacheKey(PROXY_FORM));
        seedDiskEntry(PixivImageLoader.cacheKey(otherOfficial));

        Bitmap first = loadAndAwaitBitmap(PROXY_FORM);
        Bitmap second = loadAndAwaitBitmap(otherOfficial);

        assertEquals("两张不同图片应各占一条内存条目", 2, memoryCache.size());
        assertEquals("两张不同图片应各占一条磁盘条目", 2, diskEntryCount());
        // 实例不同即证明未被合并成同一条（合并会让第二次直接交付第一次的实例）
        org.junit.Assert.assertNotSame("不同图片不应共享同一 Bitmap 实例", first, second);
    }

    // ── 缓存键与下载源解耦（图床镜像切换不使已缓存条目失效） ──

    @Test
    public void cacheKey_isIndependentOfImageHostResolution() {
        // 缓存键只由 URL 决定，绝不消费 ImageHostConfig.resolve 的返回值（ADR-0143 D2）。
        // 本条以「键空间与镜像 host 无关」的形式钉死：镜像 URL 不在键空间内，
        // 故镜像开关/换源都不可能改变或作废已缓存条目的键。
        assertNotNull("镜像 host 的 URL 不应落进官方键空间",
                PixivImageLoader.cacheKey("https://mirror.example.com/img-master/2020/01/01/abc.png"));
        assertEquals(OFFICIAL_FORM, PixivImageLoader.cacheKey(PROXY_FORM));
        assertNull("镜像 URL 不应等于官方键",
                memoryCache.get("https://mirror.example.com/img-master/2020/01/01/abc.png"));
    }
}