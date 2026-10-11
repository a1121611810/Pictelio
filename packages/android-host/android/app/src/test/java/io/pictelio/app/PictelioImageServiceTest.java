package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNotSame;
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

import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;

/**
 * PictelioImageService（自研 ILynxImageService）IO 边界测试（#59）。
 *
 * <p>覆盖：fetchImage 成功（Bitmap 回调）/ 失败（onFailure）/ URL 重写透传、
 * canParseUrl、动画 4 件套返回 false。下载走 MockWebServer（绝对 URL 原样透传；
 * /pixiv-img/ 重写逻辑已由 PixivImageLoaderTest 覆盖）。
 *
 * <h3>两层缓存分别可证（#977）</h3>
 * 服务是「内存层（{@link ImageMemoryCache}）→ 磁盘层（{@link PixivImageLoader} 缓存文件）→
 * 网络」三级命中链。{@code #977} 之前本类复用静态单例、且内存层从无清理点，
 * 「第二次不再请求网络」这条断言的第二次命中极可能来自内存层残留，
 * <b>等于没有证明磁盘层在 Lynx 路径上接通</b>。现改为每例构造干净实例
 * （包可见注入构造），并用<b>两条互斥的排除法</b>分别钉死两层：
 * <ul>
 *   <li><b>内存层命中</b>：删掉该 URL 的磁盘条目后第二次加载，网络请求数仍为 1
 *       ——此时磁盘已不可能供给，命中只能来自内存层；</li>
 *   <li><b>磁盘层命中</b>：清空内存层后第二次加载，网络请求数仍为 1
 *       ——此时内存已不可能供给，命中只能来自磁盘层。</li>
 * </ul>
 *
 * <p><b>oracle 溯源</b>：期望值只取两类外部可观察事实——① MockWebServer 的
 * {@code getRequestCount()}（真实网络请求次数）；② {@link ImageContent#getBitmap()} 回调载荷
 * （尺寸来自用例内置的 1×1 PNG 字面量，非被测实现反推）。实例同一性用于区分
 * 「交付缓存原实例（内存层）」与「重新解码出新实例（磁盘层）」——这是本类注释里
 * 显式写明的生产语义（#147 副本已撤，见类的「交付副本为何可以撤掉」），
 * 故可作观察点。断言不触任何私有字段或私有方法。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class PictelioImageServiceTest {

    /** 1x1 透明 PNG */
    private static final byte[] PNG_1PX = Base64.decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            Base64.DEFAULT);

    private MockWebServer server;
    private Context ctx;
    /**
     * 本例私有的内存层实例（包可见注入构造）——测试持有引用，用其<b>公开</b>
     * {@code clear()} 制造「内存层不可能供给」的磁盘层专用场景。
     */
    private ImageMemoryCache memoryCache;
    private PictelioImageService service;
    /** 磁盘层探针：只借公开 {@code getCacheDir()/cachedFile()} 观测并清理磁盘条目 */
    private PixivImageLoader diskProbe;

    @Before
    public void setUp() throws Exception {
        server = new MockWebServer();
        server.start();
        ctx = ApplicationProvider.getApplicationContext();
        // 干净实例：内存层与磁盘层均从零开始，不依赖静态单例的残留状态（#977）
        // 容量显式给足（#979 起无参默认容量已移除，生产走按设备算的预算）
        memoryCache = new ImageMemoryCache(64L * 1024 * 1024);
        clearDiskCache();
        service = new PictelioImageService(memoryCache);
        service.onInitialize(ctx);
        diskProbe = new PixivImageLoader(ctx);
    }

    @After
    public void tearDown() throws Exception {
        server.shutdown();
    }

    /** 清空磁盘缓存目录（用例隔离：磁盘层不得跨例残留，否则「首次加载」名不副实） */
    private void clearDiskCache() {
        File[] files = diskProbeDir().listFiles();
        if (files == null) {
            return;
        }
        for (File f : files) {
            if (!f.delete()) {
                throw new IllegalStateException("磁盘缓存清理失败: " + f);
            }
        }
    }

    private File diskProbeDir() {
        // 目录路径只依赖 context.getCacheDir()，与被测服务内部持有的 loader 同源
        return new PixivImageLoader(ctx).getCacheDir();
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

    /** 触发一次加载并等待回调落地，返回收到的 Bitmap 载荷 */
    private Bitmap loadAndAwaitBitmap(String url) throws Exception {
        RecordingListener listener = new RecordingListener();
        service.fetchImage(request(url), listener, null, ctx);
        assertTrue("onSuccess 应在超时内回调: " + url, listener.done.await(5, TimeUnit.SECONDS));
        assertNull("不应失败: " + url, listener.failure.get());
        ImageContent content = listener.success.get();
        assertNotNull("应收到 ImageContent: " + url, content);
        // 1×1 来自用例内置 PNG 字面量（独立来源），不是被测实现的反推
        assertEquals("载荷宽度应为 1: " + url, 1, content.getIntrinsicWidth());
        assertEquals("载荷高度应为 1: " + url, 1, content.getIntrinsicHeight());
        return content.getBitmap();
    }

    private void enqueuePng() {
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(PNG_1PX)));
    }

    /**
     * 删除该 URL 的磁盘条目，并把「确实删掉了」钉成前置断言——
     * 否则删除动作静默失败会让下面的排除法失真（磁盘其实还在供给）。
     */
    private void deleteDiskEntry(String url) {
        File entry = diskProbe.cachedFile(url);
        assertNotNull("首次加载应写入磁盘条目: " + url, entry);
        assertTrue("磁盘条目应可删除: " + url, entry.delete());
        assertNull("磁盘条目应已消失: " + url, diskProbe.cachedFile(url));
    }

    // ── 两层缓存分别可证（#977） ──────────────────────────────

    @Test
    public void fetchImage_secondLoad_servedFromDiskLayer_whenMemoryCleared() throws Exception {
        // 本条是 #977 缺的那条断言：内存层被清空后，同一 URL 连续两次加载网络请求数仍为 1。
        // 内存层此刻为空，命中只可能来自磁盘层 → 证明磁盘缓存确在 Lynx 路径上接通。
        enqueuePng();
        String url = server.url("/img/disk-layer.png").toString();

        Bitmap first = loadAndAwaitBitmap(url);
        assertEquals("首次加载应恰好一次网络请求", 1, server.getRequestCount());

        memoryCache.clear(); // 排除内存层：此后命中只可能来自磁盘层
        Bitmap second = loadAndAwaitBitmap(url);

        assertEquals("内存层清空后第二次加载仍不应请求网络（磁盘层命中）", 1, server.getRequestCount());
        assertNotNull("第二次应有载荷", second);
        // 磁盘层命中 = 读文件后重新解码出新实例，故与首次不是同一实例
        assertNotSame("磁盘层命中应重新解码出新 Bitmap 实例", first, second);
    }

    @Test
    public void fetchImage_secondLoad_servedFromMemoryLayer_whenDiskEntryRemoved() throws Exception {
        // 排除法对侧：磁盘条目删掉后第二次加载，网络请求数仍为 1。
        // 磁盘此刻已无该条目，命中只可能来自内存层 → 证明内存层确在 Lynx 路径上接通。
        enqueuePng();
        String url = server.url("/img/memory-layer.png").toString();

        Bitmap first = loadAndAwaitBitmap(url);
        assertEquals("首次加载应恰好一次网络请求", 1, server.getRequestCount());

        deleteDiskEntry(url); // 排除磁盘层：此后命中只可能来自内存层
        Bitmap second = loadAndAwaitBitmap(url);

        assertEquals("磁盘条目删除后第二次加载仍不应请求网络（内存层命中）", 1, server.getRequestCount());
        assertNotNull("第二次应有载荷", second);
        // 内存层命中 = 直接交付缓存原实例（副本已撤，见被测类注释），故与首次同一实例
        assertSame("内存层命中应交付同一缓存 Bitmap 实例", first, second);
    }

    // ── 既有 IO 边界用例 ────────────────────────────────────

    @Test
    public void fetchImage_success_deliversBitmap() throws Exception {
        enqueuePng();
        RecordingListener listener = new RecordingListener();

        service.fetchImage(request(server.url("/img/ok.png").toString()), listener, null, ctx);

        assertTrue("onSuccess 应在超时内回调", listener.done.await(5, TimeUnit.SECONDS));
        assertNull("不应失败", listener.failure.get());
        ImageContent content = listener.success.get();
        assertNotNull("应收到 ImageContent", content);
        assertEquals(1, content.getIntrinsicWidth());
        assertEquals(1, content.getIntrinsicHeight());
        assertEquals(1, server.getRequestCount());
    }

    @Test
    public void fetchImage_httpError_deliversFailure() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(403));
        RecordingListener listener = new RecordingListener();

        service.fetchImage(request(server.url("/img/forbidden.png").toString()), listener, null, ctx);

        assertTrue(listener.done.await(5, TimeUnit.SECONDS));
        assertNull("不应成功", listener.success.get());
        assertNotNull("应收到失败", listener.failure.get());
    }

    @Test
    public void fetchImage_nullUrl_deliversFailureImmediately() throws Exception {
        RecordingListener listener = new RecordingListener();
        service.fetchImage(request(null), listener, null, ctx);
        assertTrue(listener.done.await(5, TimeUnit.SECONDS));
        assertNotNull(listener.failure.get());
        assertEquals(0, server.getRequestCount());
    }

    @Test
    public void fetchImage_cachesAcrossCalls() throws Exception {
        // 第一次下载写盘；第二次命中缓存（MockWebServer 无新请求）。
        // 依赖 setUp 的干净实例（内存层与磁盘层均已清零），不复用单例残留状态（#977）。
        enqueuePng();
        String url = server.url("/img/cached.png").toString();
        RecordingListener first = new RecordingListener();
        service.fetchImage(request(url), first, null, ctx);
        assertTrue(first.done.await(5, TimeUnit.SECONDS));
        assertNotNull(first.success.get());

        RecordingListener second = new RecordingListener();
        service.fetchImage(request(url), second, null, ctx);
        assertTrue(second.done.await(5, TimeUnit.SECONDS));
        assertNotNull(second.success.get());
        assertEquals("第二次应命中缓存，不再请求网络", 1, server.getRequestCount());
    }

    @Test
    public void animationMethods_returnFalse() {
        assertFalse(service.startAnimation(null));
        assertFalse(service.resumeAnimation(null));
        assertFalse(service.pauseAnimation(null));
        assertFalse(service.stopAnimation(null));
    }

    @Test
    public void fetchImage_emptyBody_deliversFailure() throws Exception {
        // 200 但空 body → PixivImageLoader 拒绝（空 body 不缓存）→ onFailure
        // 注（2026-10-11 订正）：Bitmap 解码失败路径（decode 返回 null）此前记为「Robolectric 下
        // shadow 过于宽容不可靠，归真机验证点」——该结论是在默认 LEGACY 图形模式下得出的，是错的。
        // 切到 @GraphicsMode(NATIVE) 后实测该分支在单测里可观测，现由
        // PictelioImageServiceDecodeFailureTest 钉住。本类不开 NATIVE 是刻意的（见该类 javadoc）。
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer()));
        RecordingListener listener = new RecordingListener();

        service.fetchImage(request(server.url("/img/empty.bin").toString()), listener, null, ctx);

        assertTrue(listener.done.await(5, TimeUnit.SECONDS));
        assertNull("不应成功", listener.success.get());
        assertNotNull("应收到失败", listener.failure.get());
    }

    @Test
    public void canParseUrl_returnsTrue() {
        assertTrue(service.canParseUrl("/pixiv-img/x.jpg"));
        assertTrue(service.canParseUrl("https://i.pximg.net/x.jpg"));
    }

    /** 单例注册路径仍可用（生产语义未被包可见构造改动影响） */
    @Test
    public void getInstance_returnsInitializedSingleton() {
        PictelioImageService singleton = PictelioImageService.getInstance();
        assertNotNull("单例应存在", singleton);
        assertSame("单例应恒定", singleton, PictelioImageService.getInstance());
    }
}
