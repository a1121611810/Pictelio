package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;

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
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;

/**
 * 一键清理的作用域（#984）——<b>不可逆风险的钉死处</b>。
 *
 * <h3>为什么这组断言是红线</h3>
 * {@code context.getCacheDir()} 下有<b>五个同级目录</b>，其中<b>四个不是图片缓存</b>，
 * 删掉的代价不可逆：
 * <pre>
 *   pictelio-images            ← 图片缓存，清理目标
 *   pictelio_translate_cache   ← 用户的翻译成果：删除需重新翻译并可能重新计费
 *   ugoira/&lt;illustId&gt;/      ← 动图帧解压产物：删除需重新解压
 *   pictelio-novel-export      ← 可能正有用户进行中的作品导出
 *   pictelio-ugoira-export     ← 同上
 * </pre>
 * 因此本类<b>先在五个目录里各放文件，再执行清理，最后逐个核对那四个兄弟目录的内容与文件数
 * 分毫未变</b>——只断言「图片缓存目录空了」是不够的，那正是删掉父目录也能通过的断言。
 *
 * <h3>oracle 溯源（测试硬约束 #6）</h3>
 * <ol>
 *   <li><b>目录名取自票面实测</b>（issue #984 的不可逆风险实证）+ 本仓现有约定
 *       （{@code PictelioApiModule} 的 ugoira 解压目录、导出目录），不是从被测实现反推；</li>
 *   <li><b>图片缓存目录名</b>另经 {@link #anchor_isTheImageCacheDirItself()} 与
 *       {@code PixivImageLoader.getCacheDir()} 对照钉死，防止锚点哪天被改掉；</li>
 *   <li><b>释放字节数</b>取自本类自己写入的载荷长度，不是实现的私有读数。</li>
 * </ol>
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class ImageCacheClearScopeTest {

    /** 图片缓存目录名（票面写死的清理目标） */
    private static final String IMAGE_CACHE_DIR = "pictelio-images";

    /** 1×1 透明 PNG（用例内置字面量，非被测实现反推）；其长度即重建后占用字节数的期望值 */
    private static final byte[] PNG_1PX = android.util.Base64.decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            android.util.Base64.DEFAULT);

    /**
     * 四个兄弟目录名（票面实证，<b>逐字照录</b>）：每个都是不可逆的用户数据。
     * {@code ugoira} 下还有一层 {@code <illustId>}，故按两层建目录。
     */
    private static final String TRANSLATE_CACHE_DIR = "pictelio_translate_cache";
    private static final String UGOIRA_DIR = "ugoira";
    private static final String NOVEL_EXPORT_DIR = "pictelio-novel-export";
    private static final String UGOIRA_EXPORT_DIR = "pictelio-ugoira-export";

    private Context ctx;
    private ImageMemoryCache memoryCache;
    private PictelioImageService service;
    private PixivImageLoader loader;

    @Before
    public void setUp() {
        ctx = ApplicationProvider.getApplicationContext();
        ctx.getSharedPreferences(ImageCacheStatsStore.PREFS_NAME, Context.MODE_PRIVATE)
                .edit().clear().commit();
        ImageCacheStatsStore.resetSingletonForTest();

        memoryCache = new ImageMemoryCache(64L * 1024 * 1024);
        service = new PictelioImageService(memoryCache);
        service.onInitialize(ctx);
        loader = new PixivImageLoader(ctx);
    }

    @After
    public void tearDown() {
        ImageCacheStatsStore.resetSingletonForTest();
    }

    // ── 红线：四个兄弟目录分毫未变 ──────────────────────────

    /**
     * 本票<b>最重要</b>的一条：清理后，那四个不可逆目录的内容与文件数<b>完全不变</b>。
     */
    @Test
    public void clearImageCache_leavesFourSiblingDirsUntouched() throws Exception {
        // ── 五个同级目录各放内容（图片缓存放 3 个条目，便于同时验证「全删」）──
        seedCacheDir(IMAGE_CACHE_DIR, "entry-a", "entry-b", "entry-c");
        seedCacheDir(TRANSLATE_CACHE_DIR, "t-1", "t-2");
        seedCacheDir(NOVEL_EXPORT_DIR, "novel-1");
        seedCacheDir(UGOIRA_EXPORT_DIR, "ugoira-export-1");
        seedCacheDir(UGOIRA_DIR, "12345/frame-0", "12345/frame-1");

        // 前置：清理前逐一记录「文件名 → 内容长度」的快照
        Map<String, Map<String, Long>> before = snapshotOf(
                TRANSLATE_CACHE_DIR, NOVEL_EXPORT_DIR, UGOIRA_EXPORT_DIR);
        Map<String, Map<String, Long>> ugoiraBefore = snapshotOfByPath(UGOIRA_DIR);

        ImageCacheClearResult result = service.clearImageCache();

        // ── 图片缓存目录：被清空（这是清理的目标）──
        assertFalse("清理目标目录名必须是图片缓存目录本身",
                IMAGE_CACHE_DIR.equals(ctx.getCacheDir().getName()));
        assertEquals("图片缓存目录内不得残留条目",
                0, countFiles(loader.getCacheDir()));
        assertEquals("三个条目全部删除", 3L, result.deletedEntries());
        assertFalse("清理本身不应被记为失败", result.failed());

        // ── 四个兄弟目录：内容与文件数逐项不变 ──
        assertEquals("翻译缓存目录的内容与文件数不得变化",
                before.get(TRANSLATE_CACHE_DIR), snapshotOf(TRANSLATE_CACHE_DIR).get(TRANSLATE_CACHE_DIR));
        assertEquals("作品导出目录的内容与文件数不得变化",
                before.get(NOVEL_EXPORT_DIR), snapshotOf(NOVEL_EXPORT_DIR).get(NOVEL_EXPORT_DIR));
        assertEquals("动图导出目录的内容与文件数不得变化",
                before.get(UGOIRA_EXPORT_DIR), snapshotOf(UGOIRA_EXPORT_DIR).get(UGOIRA_EXPORT_DIR));
        assertEquals("ugoira 动图帧目录（含 illustId 子层）的内容与文件数不得变化",
                ugoiraBefore, snapshotOfByPath(UGOIRA_DIR));

        // ── 父目录本身必须还在（删父目录会让上面五个目录一起消失）──
        assertTrue("cacheDir 父目录不得被删除", ctx.getCacheDir().exists());
        assertTrue("图片缓存目录本身应保留（下次加载自建条目即可）",
                loader.getCacheDir().exists());
    }

    /** 锚点契约：清理目标就是 {@code pictelio-images} 本身，不是它的父目录或兄弟目录 */
    @Test
    public void anchor_isTheImageCacheDirItself() {
        File dir = loader.getCacheDir();
        assertEquals("清理锚点必须是图片缓存目录本身", IMAGE_CACHE_DIR, dir.getName());
        assertEquals("清理锚点的父目录必须是 cacheDir（不得更上层）",
                ctx.getCacheDir().getAbsolutePath(), dir.getParent());
    }

    /** 清空后不报错、占用归零：量表与目录实际内容一致 */
    @Test
    public void clearImageCache_resetsUsageAndStats() throws Exception {
        seedCacheDir(IMAGE_CACHE_DIR, "x-1", "x-2");
        ImageCacheStats before = service.cacheStats();
        assertEquals("清理前磁盘层有 2 个条目", 2L, before.diskEntries());

        ImageCacheClearResult result = service.clearImageCache();

        assertEquals("释放字节数 = 两个载荷的长度之和",
                (long) (PAYLOAD.length * 2), result.freedBytes());
        ImageCacheStats after = service.cacheStats();
        assertEquals("清理后磁盘占用归零", 0L, after.diskBytes());
        assertEquals("清理后条目数归零", 0L, after.diskEntries());
        assertEquals("清理后命中率累计量归零（用户已清缓存，旧命中率对它无意义）",
                0L, after.requests());
        assertEquals("清理后分子归零", 0L, after.hits());
    }

    /**
     * 缓存目录不存在时自愈：{@code getCacheDir()} 会重建目录，故「清一个不存在的目录」
     * 是<b>成功且释放 0 字节</b>，不是失败——这不是降级，是缓存可自愈。
     */
@Test
    public void clearDiskCache_onMissingDirSelfHealsAndReportsSuccess() throws Exception {
        PixivImageLoader fresh = new PixivImageLoader(ctx);
        seedCacheDir(IMAGE_CACHE_DIR, "entry-a");
        File dir = fresh.getCacheDir();
        // File.delete() 只能删空目录 ⇒ 先删条目再删目录（否则前置就会失败）
        for (File f : dir.listFiles()) {
            assertTrue(f.delete());
        }
        assertTrue(dir.delete());
        assertFalse("前置：目录确已不存在", dir.exists());

        ImageCacheClearResult result = fresh.clearDiskCache();

        assertFalse("目录已自愈重建，清空空目录是成功而非失败", result.failed());
        assertEquals("无内容可删，释放 0 字节", 0L, result.freedBytes());
        assertEquals("无内容可删", 0L, result.deletedEntries());
        assertTrue("缓存目录应可自愈重建", fresh.getCacheDir().exists());
    }

    /**
     * 失败必须显式可见：图片服务未初始化时一键清理不得谎报成功——
     * 界面必须能据此显示「清理失败」，而不是显示「已释放 0 字节」的假成功（禁静默降级）。
     */
    @Test
    public void clearImageCache_uninitializedService_reportsFailure() {
        // 未经 onInitialize ⇒ 拿不到 context ⇒ 统计采集器为 null，磁盘层也无从清理
        PictelioImageService fresh = new PictelioImageService(new ImageMemoryCache(64L * 1024L));

        ImageCacheClearResult result = fresh.clearImageCache();

        assertTrue("服务未初始化必须报失败（禁静默降级）", result.failed());
        assertEquals("失败路径不谎报释放字节", 0L, result.freedBytes());
    }

    /** 清理只做全删，不做容量淘汰：未超限时也必须清空（与 trimAtStartup 语义相反） */
    @Test
    public void clearDiskCache_removesEverythingEvenWhenUnderBudget() throws Exception {
        PixivImageLoader small = new PixivImageLoader(ctx, client(), 64L * 1024L * 1024L);
        seedCacheDir(IMAGE_CACHE_DIR, "a", "b", "c", "d", "e");

        small.clearDiskCache();

        assertEquals("清理是全删而非按上限淘汰", 0, countFiles(small.getCacheDir()));
    }

    /**
     * 验收条件「清理后图片正常重新加载（走一次下载并重建），不出现空白」。
     *
     * <p>外部证据：①第二次加载<b>真的触网</b>（请求数 1 → 2，证明缓存确实被清空、
     * 走了一次重新下载而非复用旧条目）；②回调成功且拿到 Bitmap（不空白）；
     * ③磁盘条目被重建（缓存可自愈，不是删了就再也不回来）。
     */
    @Test
    public void clearImageCache_nextLoadRedownloadsAndRebuildsWithoutBlank() throws Exception {
        MockWebServer server = new MockWebServer();
        server.start();
        try {
            String url = server.url("/img/rebuild.png").toString();
            enqueuePng(server);
            loadAndAwaitBitmap(service, url);
            assertEquals("① 首次加载触网一次", 1, server.getRequestCount());

            service.clearImageCache();

            enqueuePng(server);
            ImageContent content = loadAndAwaitBitmap(service, url);

            assertEquals("② 清理后重新加载真的走了一次下载（缓存已清空）",
                    2, server.getRequestCount());
            assertNotNull("③ 重新加载必须拿到内容（不出现空白）", content);
            assertNotNull("④ 拿到的应是可解码的 Bitmap", content.getBitmap());
            assertEquals("⑤ 磁盘层被重建（缓存可自愈，不是删了就没了）",
                    1, countFiles(loader.getCacheDir()));
            assertEquals("重建后的占用应与写入载荷一致",
                    (long) PNG_1PX.length, service.cacheStats().diskBytes());
        } finally {
            server.shutdown();
        }
    }

    // ── fixture ────────────────────────────────────────────

    private static void enqueuePng(MockWebServer server) {
        server.enqueue(new MockResponse().setResponseCode(200)
                .setBody(new okio.Buffer().write(PNG_1PX)));
    }

    /** 走显示链路并等到 onSuccess（等待方式与 {@link ImageCacheStatsTest} 同款） */
    private ImageContent loadAndAwaitBitmap(PictelioImageService svc, String url) throws Exception {
        RecordingListener listener = new RecordingListener();
        svc.fetchImage(new ImageRequestInfoBuilder().setUrl(url).build(), listener, null, ctx);
        assertTrue("onSuccess 应在超时内回调: " + url, listener.done.await(5, TimeUnit.SECONDS));
        assertNull("不应失败（不得出现空白）: " + url, listener.failure.get());
        return listener.success.get();
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
        public void onFailure(int code, Throwable error) {
            failure.set(error);
            done.countDown();
        }

        @Override
        public void onImageMonitorInfo(org.json.JSONObject monitorInfo) {
        }
    }

    /** 本类自己写入的载荷：其长度即「释放字节数」的独立出处 */
    private static final byte[] PAYLOAD = "Pictelio 图片缓存条目".getBytes(StandardCharsets.UTF_8);

    private okhttp3.OkHttpClient client() {
        return new okhttp3.OkHttpClient.Builder().callTimeout(10, TimeUnit.SECONDS).build();
    }

    /** 在 {@code cacheDir/<dirName>} 下写入若干载荷文件（父目录自动创建） */
    private void seedCacheDir(String dirName, String... files) throws IOException {
        File base = new File(ctx.getCacheDir(), dirName);
        for (String f : files) {
            File target = new File(base, f);
            File parent = target.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) {
                throw new IllegalStateException("建目录失败: " + parent);
            }
            try (FileOutputStream fos = new FileOutputStream(target)) {
                fos.write(PAYLOAD);
            }
        }
    }

    /** 逐目录快照：目录名 → （文件名 → 内容长度） */
    private Map<String, Map<String, Long>> snapshotOf(String... dirNames) {
        Map<String, Map<String, Long>> out = new LinkedHashMap<>();
        for (String name : dirNames) {
            Map<String, Long> files = new LinkedHashMap<>();
            File dir = new File(ctx.getCacheDir(), name);
            File[] children = dir.listFiles();
            assertNotNull("目录应可读: " + name, children);
            for (File f : children) {
                files.put(f.getName(), f.length());
            }
            out.put(name, files);
        }
        return out;
    }

    /** 递归快照（用于 {@code ugoira/<illustId>/} 这类带子层的目录） */
    private Map<String, Map<String, Long>> snapshotOfByPath(String dirName) {
        Map<String, Map<String, Long>> out = new LinkedHashMap<>();
        collectInto(new File(ctx.getCacheDir(), dirName), out);
        return out;
    }

    private void collectInto(File dir, Map<String, Map<String, Long>> out) {
        File[] children = dir.listFiles();
        if (children == null) {
            return;
        }
        for (File f : children) {
            if (f.isDirectory()) {
                collectInto(f, out);
            } else {
                out.computeIfAbsent(relativePath(dir), k -> new LinkedHashMap<>())
                        .put(relativePath(f), f.length());
            }
        }
    }

    private String relativePath(File f) {
        String base = ctx.getCacheDir().getAbsolutePath();
        String path = f.getAbsolutePath();
        return path.startsWith(base) ? path.substring(base.length()) : path;
    }

    private int countFiles(File dir) {
        File[] children = dir.listFiles();
        return children == null ? 0 : children.length;
    }
}