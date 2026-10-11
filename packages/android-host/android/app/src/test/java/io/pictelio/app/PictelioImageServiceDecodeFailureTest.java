package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.content.Context;
import android.util.Log;

import androidx.test.core.app.ApplicationProvider;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.shadows.ShadowLog;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okio.Buffer;

/**
 * 预取解码失败分支（#982 的降级契约，#988 走查项改为 CI 内钉住）。
 *
 * <h3>为什么需要 {@code @GraphicsMode(NATIVE)}</h3>
 * 本仓此前把「字节拿到但解不出 Bitmap」的分支判为<b>单测不可观测、归真机走查</b>
 * （见 {@code PictelioImageServiceTest} 与 {@code PictelioImageServicePrefetchTest} 的旧注）。
 * 该结论<b>是错的</b>：它在 Robolectric <b>默认（LEGACY）</b>图形模式下得出——那时影子库对
 * 非图片字节解码过于宽容。切到 {@link GraphicsMode.Mode#NATIVE} 后走真实原生解码，
 * 实测（Robolectric 4.14.1 / SDK 28）：非图片字节的 bounds 为 {@code outWidth=-1, outHeight=-1}，
 * {@code decodeByteArray} 返回 {@code null} —— 分支在 JVM 单测里<b>可观测</b>。
 * 故 #988 的该项走查由本类代替，不再需要真机。
 *
 * <h3>本类钉的降级契约（三条缺一不可）</h3>
 * <ol>
 *   <li><b>告警可见</b>：解码失败必须 {@code Log.w}（禁静默降级）——预取是 fire-and-forget，
 *       异常若被吞，日志里什么都不留；</li>
 *   <li><b>内存层不填</b>：解不出 Bitmap 却塞进内存层，等于把坏图当好图交付；</li>
 *   <li><b>磁盘层保留</b>：字节已落盘，展示时照常命中磁盘——<b>降级不等于丢下载</b>。
 *       这条最容易被实现顺手改掉（异常路径顺手把磁盘条目也清了），故显式钉住。</li>
 * </ol>
 *
 * <h3>oracle 溯源（测试硬约束 #6）</h3>
 * 期望值只取四类独立事实：网络请求次数（MockWebServer 真实计数）、真实 {@code Log.w}
 * （{@link ShadowLog}）、内存层/磁盘层的<b>公开</b>探测面、载荷本身（用例内置的非图片字节）。
 * 不从被测实现反推任何期望值。
 *
 * <h3>异步确定性</h3>
 * 预取无完成回调，一律<b>等条件不等时间</b>：轮询到指定告警出现即继续，超时带描述失败。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class PictelioImageServiceDecodeFailureTest {

    /** 非图片字节（用例内置）：真实原生解码下 bounds 为 -1、解码返回 null */
    private static final byte[] NON_IMAGE_BYTES =
            "not-an-image-at-all".getBytes(StandardCharsets.UTF_8);

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
        ShadowLog.clear();
        memoryCache = new ImageMemoryCache(64L * 1024 * 1024);
        service = new PictelioImageService(memoryCache);
        service.onInitialize(ctx);
    }

    @After
    public void tearDown() throws Exception {
        server.shutdown();
    }

    @Test
    public void prefetchImage_nonImageBytes_warnsSkipsMemoryLayer_keepsDiskEntry() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(200)
                .setBody(new Buffer().write(NON_IMAGE_BYTES)));
        String url = server.url("/img/broken.png").toString();

        service.prefetchImage(url, null, null);

        // ① 禁静默降级：必须留下可排查的告警
        awaitWarning("prefetchImage 解码失败");

        String key = PixivImageLoader.cacheKey(url);
        // ② 解不出 Bitmap 就不该进内存层（否则坏图会被当好图交付）
        assertNull("解码失败时内存层不得有条目", memoryCache.probe(key));
        // ③ 降级不等于丢下载：字节已落盘，展示时照常命中磁盘
        assertNotNull("解码失败仍应保留磁盘条目（展示时照常命中磁盘）", diskProbe.cachedFile(key));
        assertEquals("解码失败不应触发重复下载", 1, server.getRequestCount());
    }

    // ── 辅助 ──────────────────────────────────────────────────

    private void clearDiskCache() {
        File[] files = diskProbe.getCacheDir().listFiles();
        if (files == null) {
            return;
        }
        for (File f : files) {
            assertTrue("磁盘缓存清理失败: " + f, f.delete());
        }
    }

    /** 轮询到条件成立即返回；超时带描述失败（禁固定墙钟等待） */
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

    /** 等指定告警出现在真实日志里（禁静默降级的证据） */
    private void awaitWarning(String fragment) {
        awaitUntil("应出现告警 \"" + fragment + "\"", () -> {
            for (ShadowLog.LogItem item : ShadowLog.getLogs()) {
                if (item.type == Log.WARN && item.msg != null && item.msg.contains(fragment)) {
                    return true;
                }
            }
            return false;
        });
    }
}
