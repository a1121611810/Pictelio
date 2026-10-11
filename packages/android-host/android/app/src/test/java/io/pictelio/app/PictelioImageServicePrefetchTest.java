package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

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
import org.robolectric.shadows.ShadowLog;

import java.io.File;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;

/**
 * 预取补齐内存层（#982）——{@code prefetchImage} 不应只喂磁盘层。
 *
 * <h3>改动前后的差别（可证伪的那种）</h3>
 * 改动前预取只调 {@code loadBytesCachedFirst} 落盘，内存层始终为空 ⇒ 预取过的图在首屏第一次
 * 显示时<b>仍要走磁盘读 + 解码</b>，用户感知不到预取收益。本类用排除法把「内存层已填」钉成
 * 可观察事实：预取完成后<b>删掉该 URL 的磁盘条目</b>，随后的加载若还能成功且交付<b>同一 Bitmap
 * 实例</b>，则命中只可能来自内存层（磁盘此刻已无条目，命中不可能来自磁盘）。
 *
 * <h3>oracle 溯源（测试硬约束 #6）</h3>
 * 断言的期望值只取四类独立事实：
 * <ol>
 *   <li><b>网络请求次数</b>：MockWebServer 的 {@code getRequestCount()}（真实发生过的请求数）；</li>
 *   <li><b>图片尺寸</b>：用例内置的 PNG 字面量（1×1 / 8×8），非被测实现反推；</li>
 *   <li><b>缓存层状态</b>：通过<b>公开</b> {@link ImageMemoryCache#get/size} 与
 *       {@link PixivImageLoader#cachedFile} 正反两面探测，不触任何私有字段；</li>
 *   <li><b>告警</b>：{@link ShadowLog} 抓到的真实 {@code Log.w}（禁静默降级的证据）。</li>
 * </ol>
 * 「交付同一实例」用于区分「内存层命中（交付缓存原实例，见被测类 #147 注释）」与
 * 「重新解码出新实例」——这是被测类显式写明的生产语义，故可作观察点。
 *
 * <h3>异步确定性（测试约定 #6）</h3>
 * 预取是 fire-and-forget（引擎侧 {@code prefetchImage} 不等回调），没有可 await 的完成信号，
 * 故一律<b>等条件不等时间</b>：轮询到「内存层出现该键的条目」或「出现指定告警」即继续，
 * 超时则带描述失败。禁固定墙钟等待；禁用「睡一觉再断言」。
 *
 * <p><b>未覆盖</b>：①「重复预取不重复解码」——短路后不产生任何可观察变化，fire-and-forget
 * 又无可等待的完成信号，硬写断言只会得到恒真的假防线。
 *
 * <p><b>已订正（2026-10-11）</b>：本类初稿曾把②「字节拿到但解码不出 Bitmap」的告警分支也列为未覆盖，
 * 理由是「本轮实测（Robolectric 4.14.1）影子库对非图片字节解码过于宽容，该分支在单测里不可观测，
 * 归真机走查」，并称与 {@link PictelioImageServiceTest} 的同类备注一致。
 * <b>该结论是错的</b>——它是在 Robolectric 默认（LEGACY）图形模式下得出的。切到
 * {@code @GraphicsMode(NATIVE)}（真实原生解码）后实测：非图片字节的 bounds 为
 * {@code outWidth=-1}、{@code decodeByteArray} 返回 {@code null}，该分支<b>在单测里可观测</b>。
 * 现由 {@link PictelioImageServiceDecodeFailureTest} 钉住，<b>不再归真机走查</b>。
 * 本类<b>不开</b> NATIVE 图形模式是刻意的：避免改变既有用例的影子行为。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class PictelioImageServicePrefetchTest {

    /** 1×1 透明 PNG（用例内置字面量，非被测实现反推） */
    private static final byte[] PNG_1PX = Base64.decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            Base64.DEFAULT);

    /** 8×8 PNG（用例内置字面量；用于「单图超过内存层预算」的档位） */
    private static final byte[] PNG_8PX = Base64.decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAbElEQVR4nA3JQQEAMAgDMZSgpEqqhOepQAlKqmjLN1VFFypcTLHFFSmqmm7UuJlmm2vSP0QLCYsRK05EP0wbGZsxa87EP4YeNHiYYYcbMj+WXrR4mWWXW7I/jj50+JhjjztyP0IHBYcJGy4kPLAsVIExyOP/AAAAAElFTkSuQmCC",
            Base64.DEFAULT);

    private MockWebServer server;
    private Context ctx;
    private ImageMemoryCache memoryCache;
    private PictelioImageService service;
    /** 磁盘层探针：只借公开 {@code getCacheDir()/cachedFile()} 观测并清理磁盘条目 */
    private PixivImageLoader diskProbe;

    @Before
    public void setUp() throws Exception {
        server = new MockWebServer();
        server.start();
        ctx = ApplicationProvider.getApplicationContext();
        diskProbe = new PixivImageLoader(ctx);
        clearDiskCache();
        // 干净实例（#977 测试缝）：容量显式给足（#979 起无默认容量）
        newService(64L * 1024 * 1024);
    }

    @After
    public void tearDown() throws Exception {
        server.shutdown();
    }

    /** 造一个内存层容量为 {@code budgetBytes} 的干净服务实例（供「单图超预算」档位用） */
    private void newService(long budgetBytes) {
        memoryCache = new ImageMemoryCache(budgetBytes);
        service = new PictelioImageService(memoryCache);
        service.onInitialize(ctx);
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

    /** 键：与被测实现同源的生产取键入口（#980 的唯一产出点） */
    private static String key(String url) {
        return PixivImageLoader.cacheKey(url);
    }

    // ── 等条件（禁固定墙钟等待） ────────────────────────────────

    /** 轮询到条件成立即返回；超时带描述失败（不用 sleep 睡一觉再断言） */
    private static void awaitUntil(String desc, BooleanSupplier condition) {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            if (condition.getAsBoolean()) {
                return;
            }
            try {
                Thread.sleep(5);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new AssertionError("等待条件时被中断: " + desc, e);
            }
        }
        fail("超时：未等到条件 —— " + desc);
    }

    /** 等预取把内存层填上，返回填入的 Bitmap（空表示条件从未成立） */
    private Bitmap awaitMemoryEntry(String cacheKey, String desc) {
        awaitUntil(desc, () -> memoryCache.get(cacheKey) != null);
        return memoryCache.get(cacheKey);
    }

    /** 等指定告警出现在真实日志里（禁静默降级的证据） */
    private void awaitWarning(String fragment) {
        awaitUntil("应出现告警 \"" + fragment + "\"", () -> warningSeen(fragment));
    }

    private static boolean warningSeen(String fragment) {
        for (ShadowLog.LogItem item : ShadowLog.getLogs()) {
            if (item.type == android.util.Log.WARN && item.msg != null && item.msg.contains(fragment)) {
                return true;
            }
        }
        return false;
    }

    // ── 加载侧夹具 ────────────────────────────────────────────

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
        assertTrue("onSuccess 应在超时内回调: " + url, listener.done.await(10, TimeUnit.SECONDS));
        assertNull("不应失败: " + url + " / " + listener.failure.get(), listener.failure.get());
        ImageContent content = listener.success.get();
        assertNotNull("应收到 ImageContent: " + url, content);
        return content.getBitmap();
    }

    private void enqueue(byte[] png) {
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(png)));
    }

    /**
     * 删除该 URL 的磁盘条目，并把「确实删掉了」钉成前置断言——否则删除静默失败会让
     * 下面的排除法失真（磁盘其实还在供给，内存层命中就得不到证明）。
     */
    private void deleteDiskEntry(String cacheKey) {
        File entry = diskProbe.cachedFile(cacheKey);
        assertNotNull("预取应写入磁盘条目: " + cacheKey, entry);
        assertTrue("磁盘条目应可删除: " + cacheKey, entry.delete());
        assertNull("磁盘条目应已消失: " + cacheKey, diskProbe.cachedFile(cacheKey));
    }

    // ── AC1：预取后首屏首次显示不新增网络请求 ────────────────────

    @Test
    public void prefetchImage_thenFirstDisplay_addsNoNetworkRequest() throws Exception {
        enqueue(PNG_1PX);
        String url = server.url("/img/prefetched.png").toString();

        service.prefetchImage(url, null, null);
        Bitmap warmed = awaitMemoryEntry(key(url), "预取完成后内存层应有条目");
        assertEquals("预取自身只应下载一次", 1, server.getRequestCount());
        assertNotNull("预取也应落磁盘层", diskProbe.cachedFile(key(url)));

        Bitmap displayed = loadAndAwaitBitmap(url);

        // 本条即票面 AC#5：预取完成后触发的加载，网络请求数<b>不因预取而增加</b>
        assertEquals("预取后首次显示不应新增网络请求（应命中内存层）", 1, server.getRequestCount());
        assertSame("首屏应直接拿到预取填入的同一 Bitmap 实例（免磁盘读 + 解码）", warmed, displayed);
    }

    @Test
    public void prefetchImage_firstDisplay_servedFromMemoryLayer_whenDiskEntryRemoved() throws Exception {
        // 排除法钉死「内存层可直接命中」：磁盘条目删掉后，显示仍成功且交付同一实例。
        // 此刻磁盘已不可能供给 ⇒ 命中只可能来自预取新填的内存层。
        // 改动前本条会失败（预取不填内存层 → 显示退化为「下载」或「重新解码磁盘条目」）。
        enqueue(PNG_1PX);
        String url = server.url("/img/no-disk.png").toString();

        service.prefetchImage(url, null, null);
        Bitmap warmed = awaitMemoryEntry(key(url), "预取完成后内存层应有条目");

        deleteDiskEntry(key(url)); // 排除磁盘层
        Bitmap displayed = loadAndAwaitBitmap(url);

        assertEquals("磁盘条目已删，显示不得新增网络请求", 1, server.getRequestCount());
        assertSame("内存层命中应交付缓存原实例（被测类 #147 语义：副本已撤）", warmed, displayed);
        assertNull("显示后磁盘层仍无该条目（未回退到磁盘/网络重取）", diskProbe.cachedFile(key(url)));
    }

    @Test
    public void prefetchImage_decodedEntry_matchesSourceImage() throws Exception {
        // 期望值来自用例内置的 8×8 PNG 字面量（非被测实现反推）：预取填入内存层的
        // 必须是<b>解码后的原图</b>，而不是字节、也不是别的尺寸。
        enqueue(PNG_8PX);
        String url = server.url("/img/eight.png").toString();

        service.prefetchImage(url, null, null);
        Bitmap warmed = awaitMemoryEntry(key(url), "预取完成后内存层应有条目");

        assertEquals("内存层条目宽度应为 8（用例内置 8×8 PNG）", 8, warmed.getWidth());
        assertEquals("内存层条目高度应为 8（用例内置 8×8 PNG）", 8, warmed.getHeight());
        assertEquals("预取只应下载一次", 1, server.getRequestCount());
    }

    // ── AC2：预取不绕过图床决策与防盗链契约 ──────────────────────

    @Test
    public void prefetchImage_download_goesThroughCoreLoader_withAntiHotlinkHeaders() throws Exception {
        // 期望值取自 OAuthConfig 常量（与被测实现不同的独立事实源）：预取既然走
        // PixivImageLoader 公共核心，其请求就必须带 Referer/UA（i.pximg.net 防盗链契约），
        // 且缓存键恒官方 URL。改动前预取虽也走核心，但本条一并钉住「没有另发裸请求」。
        enqueue(PNG_1PX);
        String url = server.url("/img/anti-hotlink.png").toString();

        service.prefetchImage(url, null, null);
        awaitMemoryEntry(key(url), "预取完成后内存层应有条目");

        RecordedRequest req = server.takeRequest(10, TimeUnit.SECONDS);
        assertNotNull("预取应发出一次请求", req);
        assertEquals("防盗链契约：Referer 头缺失即预取绕过了加载核心",
                io.pictelio.app.config.OAuthConfig.REFERER, req.getHeader("Referer"));
        assertEquals("UA 头缺失即预取绕过了加载核心",
                io.pictelio.app.config.OAuthConfig.USER_AGENT, req.getHeader("User-Agent"));
        // 请求的就是该 URL 本身（预取不自发别的请求、也不换源）
        assertEquals("预取不应改写请求地址", java.net.URI.create(url).getPath(), req.getPath());
        assertNotNull("磁盘层应已落条目", diskProbe.cachedFile(key(url)));
    }

    // ── AC3：失败必须留显式告警，不静默吞掉 ──────────────────────

    @Test
    public void prefetchImage_httpError_warmsNeitherLayer_andWarns() throws Exception {
        ShadowLog.clear();
        server.enqueue(new MockResponse().setResponseCode(403));
        String url = server.url("/img/forbidden.png").toString();

        service.prefetchImage(url, null, null);
        awaitWarning("prefetchImage 失败");

        assertNull("下载失败时内存层不得有条目", memoryCache.get(key(url)));
        assertEquals("下载失败时内存层应为空", 0, memoryCache.size());
        assertNull("下载失败时磁盘层不得有条目（403 不写盘）", diskProbe.cachedFile(key(url)));
        assertTrue("应确实发出过一次请求", server.getRequestCount() >= 1);
    }

    @Test
    public void prefetchImage_blankUri_warnsInsteadOfSilentlyReturning() throws Exception {
        ShadowLog.clear();

        service.prefetchImage("", null, null);
        service.prefetchImage(null, null, null);

        awaitWarning("prefetchImage 跳过：uri 为空");
        assertEquals("空 uri 不应发起任何请求", 0, server.getRequestCount());
    }

    @Test
    public void prefetchImage_singleImageExceedingMemoryBudget_skipsMemoryButWarmsDisk_andWarns() throws Exception {
        // 单图预算 64B，8×8 解码后 256B > 64B：写入会把整层逐出（ImageMemoryCache 的 LRU 语义），
        // 对「可能永不上屏」的预取是净损失。故跳内存层、保磁盘层，且必须告警（不静默降级）。
        newService(64L);
        ShadowLog.clear();
        enqueue(PNG_8PX);
        String url = server.url("/img/oversized.png").toString();

        service.prefetchImage(url, null, null);
        awaitWarning("超过内存层预算");

        assertNull("超预算的单图不应进内存层", memoryCache.get(key(url)));
        assertEquals("内存层应为空（预取不得撑爆预算）", 0, memoryCache.size());
        assertTrue("内存层占用不得超过预算", memoryCache.totalBytes() <= memoryCache.maxBytes());
        assertNotNull("磁盘层仍应兜底", diskProbe.cachedFile(key(url)));
    }

    // ── AC4：预取条目计入同一内存层（#983 统计口径的接入点） ────────

    @Test
    public void prefetchImage_entries_areVisibleThroughTheSameMemoryLayerApi() throws Exception {
        // #983 的占用与命中率口径将读内存层的公开 API。本条证明<b>预取写的就是这一层</b>：
        // 键与显示链路同源（同一 cacheKey 产出点）、条目可被公开 API 读到并计入 size/字节占用。
        // 故 #983 的统计钩子只要落在这层，预取条目天然被计入，无需在预取侧另开口径。
        enqueue(PNG_1PX);
        String url = server.url("/img/stats-seam.png").toString();

        service.prefetchImage(url, null, null);
        awaitMemoryEntry(key(url), "预取完成后内存层应有条目");

        assertEquals("预取条目应计入内存层条目数（占用口径的接入点）", 1, memoryCache.size());
        assertEquals("预取条目应计入内存层字节占用（1×1×4B）", 4L, memoryCache.totalBytes());
        assertEquals("预算读数与容量一致（压力/占用口径的接入点）", 64L * 1024 * 1024, memoryCache.maxBytes());
    }
}
