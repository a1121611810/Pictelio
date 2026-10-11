package io.pictelio.app;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.content.Context;

import androidx.test.core.app.ApplicationProvider;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.File;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * 冷启动缓存维护的<b>闸门</b>契约（#990 取证时补的机器防线）。
 *
 * <h3>为什么单独一个类</h3>
 * #985 的 {@code ImageCacheUpgradePurgeTest} 覆盖的是<b>清空动作</b>本身（清干净、只跑一次、
 * 失败不落标记、四个兄弟目录不动），但它只是「等闸门收敛」当作 fixture 前置
 * （{@code awaitStartupPurgeSettled}）——<b>全仓没有任何测试直接调用
 * {@link PixivImageLoader#scheduleStartupCacheMaintenance}，也没有一条断言闸门行为</b>。
 * 于是闸门被无声改坏（不关 / 不开 / 把维护线程自己也挡住）不会有任何用例转红。
 *
 * <h3>本类钉住的三条不变量</h3>
 * <ol>
 *   <li><b>维护进行中，缓存访问确实排队</b>——闸门真的关上了，且维护结束后<b>准时放行</b>
 *       （不然就是永久卡死读路径）；</li>
 *   <li><b>维护线程自身不被自己挡住</b>——维护任务内部本来就要走 {@code getCacheDir()}
 *       （清空与淘汰都是），若少了线程自豁免就是自死锁；</li>
 *   <li><b>闸门开着时缓存访问不等待</b>——即「常态冷启动不加延迟」。</li>
 * </ol>
 *
 * <p><b>关于 {@code gate.getCount() == 0} 那个快路径（变异实测的更正）</b>：
 * 本类初稿把「初值应为已开闸」写成第 3 条不变量的<b>理由</b>，并称删掉该分支会导致
 * 「所有不经 Application 冷启动的进程都去等一个不存在的闸门」。<b>实测证伪</b>：删掉该分支后
 * 本类三条用例<b>仍全绿</b>——因为已开闸的 {@link CountDownLatch} 上 {@code await} 本就立即返回，
 * 该分支只是<b>避免一次 park 的快路径短路</b>，不是正确性保障。第 3 条用例保留（它钉住的是
 * 「常态不加延迟」这一可观察行为），但理由已按实测更正。
 *
 * <p><b>变异验证登记</b>（与本类同时提交，命令与结果见 #990）——
 * 关闸改为不关（{@code CountDownLatch(1)→(0)}）1 红；
 * {@code finally} 里去掉 {@code countDown}（永不开闸）2 红；
 * 拿掉线程自豁免分支 3 红。
 *
 * <h3>与 #990 的关系：只钉现状，不预设拍板结果</h3>
 * 本类<b>不改动任何行为</b>，三条用例在「保留现状」与「收窄闸门窗口」两种方案下都成立
 * （用例一律把状态摆回<b>标记未落</b>——那正是两种方案下都会关闸的同一场景）。
 * 刻意<b>不</b>写「已落标记时不关闸」这类断言：那是尚未拍板的改动。
 *
 * <h3>刻意未覆盖的一条（诚实登记）</h3>
 * 「等待超时后 fail-open 并 {@code Log.w}」<b>无法在本类廉价地钉住</b>：
 * {@code STARTUP_MAINTENANCE_WAIT_SECONDS} 是 {@code private static final} 编译期常量，
 * 会被内联到使用点，反射改不动；而真等它超时要 15s 单测。要钉它必须先给生产代码开一个
 * 测试缝（可注入的等待上限），那是 #990 的实现决策，不该顺手夹带。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class ImageCacheStartupGateTest {

    /**
     * 升级清空标记的 prefs 名与键（oracle = {@link ImageCacheUpgradePurgeTest} 的独立约定，
     * 刻意用<b>字面量</b>而非被测实现的私有常量——断言「标记写进了这个文件」不能自证）。
     */
    private static final String UPGRADE_PREFS_NAME = "pictelio-image-cache-upgrade";
    private static final String KEY_PURGED_GENERATION = "purged_generation";

    /**
     * 「没有等待」的上判据：闸门开着时是毫秒级，而真被挡住会等满 15s 超时。
     * 取 5s 是为了对 CI 抖动留足余量，同时仍远低于 15s——判别力不受影响。
     */
    private static final long NO_WAIT_BUDGET_MS = 5_000L;

    private Context ctx;
    private PixivImageLoader loader;
    private ExecutorService pool;

    @Before
    public void setUp() {
        ctx = ApplicationProvider.getApplicationContext();
        // Robolectric 会真的启动 Application，其 onCreate 已提交过一次后台清空。
        // 先等它收敛，再把标记抹掉 ⇒ 状态被显式摆回「升级后那一刻」（标记未落）。
        // 这同时让闸门处于<b>已开闸</b>状态，供第 3 条用例使用。
        ImageCacheUpgradePurgeTest.awaitStartupPurgeSettled(ctx);
        ctx.getSharedPreferences(UPGRADE_PREFS_NAME, Context.MODE_PRIVATE)
                .edit().clear().commit();
        ImageCacheStatsStore.resetSingletonForTest();
        loader = new PixivImageLoader(ctx);
        pool = Executors.newCachedThreadPool();
    }

    @After
    public void tearDown() {
        pool.shutdownNow();
    }

    /** 维护任务「已开始」与「可以放行」两个信号，由用例掌控节奏 */
    private final CountDownLatch taskStarted = new CountDownLatch(1);
    private final CountDownLatch releaseTask = new CountDownLatch(1);

    /**
     * 把维护任务挂在一个由用例控制节奏的执行器上：任务一开跑就报 {@code taskStarted}，
     * 然后一直阻塞到 {@code releaseTask} 放行——于是闸门处于「确已关闭」的可控状态。
     */
    private Executor blockingExecutor() {
        return r -> pool.submit(() -> {
            taskStarted.countDown();
            try {
                releaseTask.await(30, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            r.run();
        });
    }

    // ── 不变量 1：维护中排队，结束后放行 ────────────────────────

    @Test
    public void cacheAccess_queuesWhileMaintenanceRuns_andReleasesWhenItFinishes() throws Exception {
        loader.scheduleStartupCacheMaintenance(blockingExecutor());
        assertTrue("维护任务未在 5s 内开跑（则本用例测不到闸门）",
                taskStarted.await(5, TimeUnit.SECONDS));

        // 维护线程正卡在任务体里 ⇒ 闸门关着 ⇒ 另一线程的缓存访问应当排队
        Future<File> blocked = pool.submit(() -> loader.getCacheDir());
        try {
            blocked.get(300, TimeUnit.MILLISECONDS);
            fail("维护进行中，缓存访问本应被闸门挡住（却立即返回 ⇒ 闸门没关上）");
        } catch (TimeoutException expected) {
            // 预期：确实被挡住了
        }

        // 放行维护 ⇒ 闸门开 ⇒ 排队者必须拿到目录，不能永久卡死
        releaseTask.countDown();
        File dir = blocked.get(10, TimeUnit.SECONDS);
        assertNotNull("维护结束后排队的缓存访问必须放行并拿到目录", dir);
        assertTrue("拿到的应是图片缓存目录本身: " + dir, dir.isDirectory());
    }

    // ── 不变量 2：维护线程自身不被自己挡住（自死锁防线） ────────

    @Test
    public void maintenanceThread_isNotBlockedByItsOwnGate() throws Exception {
        // 用<b>内联执行器</b>：任务体就跑在调度线程上，内部必然走 getCacheDir()
        // （清空与淘汰都是），这正是「线程自豁免」要保护的真实场景。
        Executor inline = Runnable::run;

        Future<?> scheduled = pool.submit(
                () -> loader.scheduleStartupCacheMaintenance(inline));
        try {
            // 若线程自豁免被删掉，这里会等满 15s 超时 → 5s 判据转红（而非挂死 CI）
            scheduled.get(5, TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            fail("维护任务被自己关的闸门挡住了（自死锁）：线程自豁免分支疑似失效");
        }
    }

    // ── 不变量 3：闸门开着时不等待 ──────────────────────────────

    @Test
    public void cacheAccess_doesNotWaitWhenNoMaintenanceIsRunning() {
        long startNanos = System.nanoTime();
        File dir = loader.getCacheDir();
        long elapsedMs = (System.nanoTime() - startNanos) / 1_000_000L;

        assertNotNull(dir);
        assertTrue("闸门开着时缓存访问不应等待（实测 " + elapsedMs + "ms，判据 < "
                        + NO_WAIT_BUDGET_MS + "ms）——若逼近 15s 说明闸门没开",
                elapsedMs < NO_WAIT_BUDGET_MS);
    }
}
