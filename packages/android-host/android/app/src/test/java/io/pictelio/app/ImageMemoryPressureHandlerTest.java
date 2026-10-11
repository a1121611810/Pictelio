package io.pictelio.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import android.app.Application;
import android.content.ComponentCallbacks;
import android.graphics.Bitmap;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowLog;

import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;

/**
 * 图片内存层内存压力响应单测（#981）。
 *
 * <p>覆盖：
 * <ul>
 *   <li><b>注册幂等</b>——重复 {@code ensureRegistered} 只让框架收到一次回调（本票最易做错处）；</li>
 *   <li><b>UI_HIDDEN 级</b>——收缩一部分、保留最近使用的条目（AOSP：须能快速恢复）；</li>
 *   <li><b>BACKGROUND 级</b>——清空内存层（AOSP：应尽可能多释放）；</li>
 *   <li><b>废弃级别不作触发条件</b>——API 34 起不再派发的 RUNNING_* 三档不触发收缩；</li>
 *   <li><b>恢复前台可重新填充</b>——收缩后 put/get 照常工作，图片可再次显示；</li>
 *   <li><b>磁盘层不受影响</b>——压力回调前后磁盘条目逐字节不变；</li>
 *   <li><b>降级必告警</b>——内存层尚未创建 / 注册参数缺失均 Log.w（禁静默降级）。</li>
 * </ul>
 *
 * <p><b>oracle 溯源</b>：级别语义（UI_HIDDEN=部分收缩、BACKGROUND=全部释放）来自 AOSP
 * {@code ComponentCallbacks2} 文档，断言的是该<b>语义不变量</b>；确切保留比例是策略取值
 * （推导见 {@link ImageCacheBudget} 的 KDoc），单独一条用例钉住取值不被无声改动。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class ImageMemoryPressureHandlerTest {

    /** 4×4 ARGB_8888 = 64 字节，与生产 sizeOf 口径一致 */
    private static Bitmap bitmap() {
        return Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888);
    }

    /** 同线程执行器：让收缩在调用点同步完成，断言无需等待/轮询（去掉时序不确定性） */
    private static final Executor DIRECT = Runnable::run;

    private ImageMemoryCache cache;

    @Before
    public void setUp() {
        // 注册闸是进程级静态，测试间需重置，否则后序用例全部被幂等跳过
        ImageMemoryPressureHandler.resetRegistrationForTest();
        ShadowLog.clear();
        // 预算 = 8 张图（512 字节），便于按整条目数断言收缩结果
        cache = new ImageMemoryCache(8 * 64L);
    }

    @After
    public void tearDown() {
        ImageMemoryPressureHandler.resetRegistrationForTest();
    }

    private ImageMemoryPressureHandler register() {
        assertTrue("首次注册必须成功",
                ImageMemoryPressureHandler.ensureRegistered(
                        RuntimeEnvironment.getApplication(), () -> cache, DIRECT));
        return ImageMemoryPressureHandler.registeredInstance();
    }

    private void fill(int entries) {
        for (int i = 0; i < entries; i++) {
            cache.put("url" + i, bitmap());
        }
    }

    private static boolean warnedOnPressureTag() {
        for (ShadowLog.LogItem item : ShadowLog.getLogs()) {
            if (ImageMemoryPressureHandler.TAG.equals(item.tag) && item.type == android.util.Log.WARN) {
                return true;
            }
        }
        return false;
    }

    // ── 注册幂等（本票最易做错处）───────────────────────────────

    /** 计数用 Application：框架侧真正收到的 registerComponentCallbacks 次数 */
    public static class CountingApplication extends Application {
        final List<ComponentCallbacks> registered = new ArrayList<>();

        @Override
        public void registerComponentCallbacks(ComponentCallbacks callback) {
            registered.add(callback);
            super.registerComponentCallbacks(callback);
        }
    }

    @Test
    @Config(application = CountingApplication.class)
    public void ensureRegistered_repeatedly_registersComponentCallbackOnlyOnce() {
        assertTrue("前置：本例须以 CountingApplication 运行",
                RuntimeEnvironment.getApplication() instanceof CountingApplication);
        CountingApplication app = (CountingApplication) RuntimeEnvironment.getApplication();

        assertTrue("首次注册必须成功",
                ImageMemoryPressureHandler.ensureRegistered(app, () -> cache, DIRECT));
        ImageMemoryPressureHandler first = ImageMemoryPressureHandler.registeredInstance();

        // 第二次（模拟另一条初始化路径 / 进程复用兜底再入）
        assertFalse("重复注册必须被幂等闸挡下",
                ImageMemoryPressureHandler.ensureRegistered(app, () -> cache, DIRECT));

        assertEquals("框架只应收到一次回调（重复注册会让每级收缩跑两遍）",
                1, app.registered.size());
        assertSame("幂等跳过时不得换实例（否则首个内存层引用会被丢弃）",
                first, ImageMemoryPressureHandler.registeredInstance());
        assertSame("已注册的那个实例就是注册到框架上的",
                first, app.registered.get(0));
    }

    @Test
    public void ensureRegistered_nullParams_warnsAndDoesNotRegister() {
        assertFalse("参数缺失必须返回失败而非静默生效",
                ImageMemoryPressureHandler.ensureRegistered(null, () -> cache, DIRECT));
        assertNull("未注册成功时不得留下实例", ImageMemoryPressureHandler.registeredInstance());
        assertTrue("注册参数缺失必须 Log.w（禁静默降级）", warnedOnPressureTag());
    }

    // ── 级别一：UI 不可见 → 部分收缩 ─────────────────────────────

    @Test
    public void onTrimMemory_uiHidden_releasesPartButKeepsMostRecent() {
        ImageMemoryPressureHandler handler = register();
        fill(8);
        assertEquals(8, cache.size());
        // 重读最早那条：accessOrder 下它变为<b>最近使用</b>，故最不会被逐出；
        // 真正最久未使用的是此后未再被读的 url1 —— 用来验证逐出按使用顺序而非写入顺序
        cache.get("url0");

        handler.onTrimMemory(android.content.ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN);

        long budget = cache.maxBytes();
        long retained = cache.totalBytes();
        assertTrue("UI 不可见须释放内存（AOSP：应释放较大分配）", retained < budget);
        assertTrue("UI 不可见不得全清——进程须能快速恢复（AOSP）", retained > 0);
        assertEquals("保留量不得超过预算的一半（策略取值 UI_HIDDEN_KEEP_RATIO=0.5）",
                ImageCacheBudget.retainedBytesAfterTrim(budget, 0.5f), retained);
        assertNull("最久未使用的条目应先被逐出", cache.get("url1"));
        assertNotNull("最近被读过的条目应保留", cache.get("url0"));
        assertNotNull("最近写入的条目应保留", cache.get("url7"));
    }

    @Test
    public void uiHidden_keepRatio_isHalfOfBudget() {
        // 钉住策略取值本身：它由 AOSP 语义推导而来（见 ImageCacheBudget KDoc），
        // 若有人无声改动该系数，本例即失败
        assertEquals(0.5f, ImageCacheBudget.UI_HIDDEN_KEEP_RATIO, 0f);
    }

    @Test
    public void onTrimMemory_uiHiddenTwice_doesNotShrinkProgressively() {
        ImageMemoryPressureHandler handler = register();
        fill(8);

        handler.onTrimMemory(android.content.ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN);
        long afterFirst = cache.totalBytes();
        handler.onTrimMemory(android.content.ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN);

        assertEquals("重复收缩同一级不得逐级变小（目标恒按预算算）", afterFirst, cache.totalBytes());
        assertEquals("容量上限不得被收缩改写（回前台按原容量填充的前提）",
                8 * 64L, cache.maxBytes());
    }

    // ── 级别二：进程进入后台 → 清空内存层 ─────────────────────────

    @Test
    public void onTrimMemory_background_clearsMemoryLayer() {
        ImageMemoryPressureHandler handler = register();
        fill(8);

        handler.onTrimMemory(android.content.ComponentCallbacks2.TRIM_MEMORY_BACKGROUND);

        assertEquals("进入后台应尽可能多释放 ⇒ 内存层清空（AOSP）", 0, cache.size());
        assertEquals(0L, cache.totalBytes());
    }

    @Test
    public void onTrimMemory_backgroundAfterUiHidden_shrinksFurther() {
        ImageMemoryPressureHandler handler = register();
        fill(8);

        handler.onTrimMemory(android.content.ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN);
        long afterUiHidden = cache.totalBytes();
        assertTrue("前置：UI_HIDDEN 后仍有残留", afterUiHidden > 0);

        handler.onTrimMemory(android.content.ComponentCallbacks2.TRIM_MEMORY_BACKGROUND);
        assertEquals("后台档须在 UI_HIDDEN 档之上进一步收缩", 0, cache.totalBytes());
    }

    // ── 其余历史级别：不作实现依据 ────────────────────────────────

    @Test
    public void onTrimMemory_deprecatedRunningLevels_areNotTriggers() {
        ImageMemoryPressureHandler handler = register();
        fill(8);
        int[] deprecated = {
            android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE, // 5
            android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW,      // 10
            android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL, // 15
        };

        for (int level : deprecated) {
            handler.onTrimMemory(level);
        }

        assertEquals("API 34 起不再派发的旧级别不得触发收缩", 8, cache.size());
        assertEquals(8 * 64L, cache.totalBytes());
    }

    // ── 恢复前台：可重新填充、正常显示 ────────────────────────────

    @Test
    public void afterBackgroundTrim_memoryLayerRefillsAndServesImages() {
        ImageMemoryPressureHandler handler = register();
        fill(8);
        handler.onTrimMemory(android.content.ComponentCallbacks2.TRIM_MEMORY_BACKGROUND);
        assertEquals("前置：内存层已清空", 0, cache.size());

        // 回前台后重新请求同一批图片
        Bitmap refilled = bitmap();
        cache.put("url0", refilled);

        assertSame("恢复前台后应能重新命中内存层", refilled, cache.get("url0"));
        assertFalse("重新填充的图不得是已回收实例", cache.get("url0").isRecycled());
    }

    // ── 磁盘层不随内存压力收缩 ──────────────────────────────────

    @Test
    public void memoryPressure_doesNotTouchDiskCacheLayer() throws Exception {
        ImageMemoryPressureHandler handler = register();
        fill(8);
        Application app = RuntimeEnvironment.getApplication();
        PixivImageLoader loader = new PixivImageLoader(app);
        File dir = loader.getCacheDir();
        assertTrue(dir.exists() || dir.mkdirs());
        byte[] payload = new byte[512];
        java.util.Arrays.fill(payload, (byte) 0x5A);
        File diskEntry = new File(dir, PixivImageLoader.keyToFilename("https://i.pximg.net/pressure.jpg"));
        Files.write(diskEntry.toPath(), payload);

        handler.onTrimMemory(android.content.ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN);
        handler.onTrimMemory(android.content.ComponentCallbacks2.TRIM_MEMORY_BACKGROUND);

        assertTrue("内存压力不得删除磁盘条目（#981 验收项）", diskEntry.exists());
        assertArrayEquals("磁盘条目内容不得被内存压力改动", payload, Files.readAllBytes(diskEntry.toPath()));
    }

    // ── 降级必告警 ─────────────────────────────────────────────

    @Test
    public void onTrimMemory_whenMemoryLayerNotYetCreated_warnsAndSkips() {
        ImageMemoryPressureHandler.ensureRegistered(
                RuntimeEnvironment.getApplication(), () -> null, DIRECT);
        ImageMemoryPressureHandler handler = ImageMemoryPressureHandler.registeredInstance();

        handler.onTrimMemory(android.content.ComponentCallbacks2.TRIM_MEMORY_BACKGROUND);

        assertTrue("内存层尚未创建必须 Log.w（不得被误读成回调没触发）", warnedOnPressureTag());
    }
}
