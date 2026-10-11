package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.test.core.app.ApplicationProvider;

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

/**
 * 升级后清空存量图片缓存（#985）——<b>一次性</b>、<b>不迁移</b>、<b>不越界</b>。
 *
 * <h3>「升级后」这个场景在测试里怎么造出来</h3>
 * 升级清空的判据只有一个：<b>布局代次标记尚未写入，而图片缓存目录里已有存量条目</b>。
 * 这正是「老用户从旧版升上来」的形态，与全新安装（目录本就没有条目）天然可分：
 * <pre>
 *   全新安装：标记无 + 条目无  → 清空空目录，无害，行为等同未清
 *   老用户升级：标记无 + 条目有 → 这就是要清的存量
 *   已清过的用户：标记有 + 条目有 → 用户的<b>新</b>缓存，不得再清
 * </pre>
 * 本类的 fixture 即按「标记无 + 五个目录各放内容」布置，无需真的装旧版本。
 *
 * <h3>oracle 溯源（测试硬约束 #6）</h3>
 * <ol>
 *   <li><b>五个目录名逐字取自票面实测</b>（issue #985 不可逆风险实证），不从被测实现反推；</li>
 *   <li><b>标记文件名</b>取自本票设计的独立约定（与 {@code ImageCacheStatsStore}
 *       「刻意不是 {@code SecureStorageCompat.PREFS_NAME} / {@code CapacitorStorage}」同源）；</li>
 *   <li><b>存量数据格式</b>用生产常量与既有键名（{@code image_host_settings}、
 *       oracle = {@code ImageHostConfig} 的存储键）验证「一字不改」；</li>
 *   <li><b>释放字节数</b>取自本类自己写入的载荷长度。</li>
 * </ol>
 *
 * <p>fixture 与断言模式沿用 #984 的 {@link ImageCacheClearScopeTest}（同一不可逆风险，
 * 同一套「先放五个目录再逐个核对」的做法），两处互补：#984 钉「用户手动清理」，
 * 本类钉「升级自动清空」——两条路径都声称复用同一删除实现，就都要被红线断言覆盖。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class ImageCacheUpgradePurgeTest {

    /** 图片缓存目录名（票面写死的清理目标） */
    private static final String IMAGE_CACHE_DIR = "pictelio-images";

    /**
     * 四个兄弟目录名（票面实证，<b>逐字照录</b>）：每个都是不可逆的用户数据。
     * {@code ugoira} 下还有一层 {@code <illustId>}，故按两层建目录。
     */
    private static final String TRANSLATE_CACHE_DIR = "pictelio_translate_cache";
    private static final String UGOIRA_DIR = "ugoira";
    private static final String NOVEL_EXPORT_DIR = "pictelio-novel-export";
    private static final String UGOIRA_EXPORT_DIR = "pictelio-ugoira-export";

    /**
     * 升级清空标记的 prefs 名（oracle = 本票设计的独立约定；刻意不同于安全存储与
     * {@code CapacitorStorage} 两个存量键空间）。断言「标记写进了这个文件」用的是字面量，
     * 不是被测实现的私有常量。
     */
    private static final String UPGRADE_PREFS_NAME = "pictelio-image-cache-upgrade";
    private static final String KEY_PURGED_GENERATION = "purged_generation";

    private Context ctx;
    private PixivImageLoader loader;

    @Before
    public void setUp() {
        ctx = ApplicationProvider.getApplicationContext();
        // Robolectric 会真的启动 Application（manifest 的 appClass = .PictelioAppLynx），
        // 其 onCreate 里那个后台清理任务在每个用例开始前就已提交 ⇒ 它已经替本用例清过一次并落标记。
        // 先等它跑完（清空目录为空目录，必定成功落标记），再把标记抹掉，
        // 把状态<b>显式摆回「升级后那一刻」</b>：标记未落 + 存量条目由各用例自行铺设。
        awaitStartupPurgeSettled(ctx);
        upgradePrefs().edit().clear().commit();
        ImageCacheStatsStore.resetSingletonForTest();
        loader = new PixivImageLoader(ctx);
    }

    /**
     * 等 Application 冷启动时提交的那个后台清空任务跑完（它成功时会落下标记）。
     *
     * <p><b>为什么需要它</b>：Robolectric 会真的启动 Application（manifest 的
     * {@code appClass = .PictelioAppLynx}），其 {@code onCreate} 提交的后台清空任务在
     * <b>后台线程</b>上跑，而 Robolectric 把用例体跑在「主线程」上——两者天然并发。
     * JVM 冷启动时该后台线程的类加载可能长达数十毫秒，于是它可能<b>晚于</b>用例摆好
     * 缓存条目之后才跑到，把刚摆好的 fixture 删掉。
     *
     * <p>不等待的后果不是「用例偶发失败」而是<b>状态不确知</b>：标记可能已被写上，
     * 于是本该走升级分支的调用直接返回「早已清过」——那正是「写一条永远走不到升级分支的
     * 假断言」。故这里显式收敛，而不是靠 sleep 赌调度。
     *
     * <p>本方法供本包内<b>其他</b>图片缓存用例复用（凡是自己往 {@code pictelio-images}
     * 里摆 fixture 的都要先收敛，否则会被冷启动清空抹掉）。
     */
    static void awaitStartupPurgeSettled(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(UPGRADE_PREFS_NAME, Context.MODE_PRIVATE);
        long deadline = System.currentTimeMillis() + 10_000L;
        while (prefs.getString(KEY_PURGED_GENERATION, null) == null
                && System.currentTimeMillis() < deadline) {
            try {
                Thread.sleep(5L);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    @After
    public void tearDown() {
        upgradePrefs().edit().clear().commit();
        ImageCacheStatsStore.resetSingletonForTest();
    }

    // ── 红线：升级清空同样只碰第一个目录 ──────────────────────

    /**
     * 本票<b>最重要</b>的一条：升级清空后，那四个不可逆目录的内容与文件数<b>完全不变</b>。
     *
     * <p>升级清空复用用户手动清理的同一条路径（{@code clearDiskCache()}），锚定纪律因而相同。
     * 只断言「图片缓存目录空了」是不够的——那正是删掉父目录也能通过的断言。
     */
    @Test
    public void upgradePurge_clearsLegacyEntriesAndLeavesFourSiblingDirsUntouched() throws Exception {
        // 前置：标记未写入（升级态），五个同级目录各放内容
        assertNull("前置：升级前不应已有清空标记", purgedGeneration());
        seedCacheDir(IMAGE_CACHE_DIR, "legacy-a", "legacy-b", "legacy-c");
        seedCacheDir(TRANSLATE_CACHE_DIR, "t-1", "t-2");
        seedCacheDir(NOVEL_EXPORT_DIR, "novel-1");
        seedCacheDir(UGOIRA_EXPORT_DIR, "ugoira-export-1");
        seedCacheDir(UGOIRA_DIR, "12345/frame-0", "12345/frame-1");

        Map<String, Map<String, Long>> before = snapshotOf(
                TRANSLATE_CACHE_DIR, NOVEL_EXPORT_DIR, UGOIRA_EXPORT_DIR);
        Map<String, Map<String, Long>> ugoiraBefore = snapshotOfByPath(UGOIRA_DIR);

        boolean executed = loader.purgeLegacyCacheOnUpgrade();

        // ── 图片缓存目录：存量被清空（这是清空的目标）──
        assertTrue("升级后应执行一次清空", executed);
        assertEquals("存量图片缓存不得残留条目", 0, countFiles(loader.getCacheDir()));
        assertTrue("存量目录本身要保留（下次加载自建条目即可）", loader.getCacheDir().exists());

        // ── 四个兄弟目录：内容与文件数逐项分毫未变 ──
        assertEquals("翻译缓存目录的内容与文件数不得变化",
                before.get(TRANSLATE_CACHE_DIR), snapshotOf(TRANSLATE_CACHE_DIR).get(TRANSLATE_CACHE_DIR));
        assertEquals("作品导出目录的内容与文件数不得变化",
                before.get(NOVEL_EXPORT_DIR), snapshotOf(NOVEL_EXPORT_DIR).get(NOVEL_EXPORT_DIR));
        assertEquals("动图导出目录的内容与文件数不得变化",
                before.get(UGOIRA_EXPORT_DIR), snapshotOf(UGOIRA_EXPORT_DIR).get(UGOIRA_EXPORT_DIR));
        assertEquals("ugoira 动图帧目录（含 illustId 子层）的内容与文件数不得变化",
                ugoiraBefore, snapshotOfByPath(UGOIRA_DIR));

        // ── 父目录必须还在（删父目录会让上面五个目录一起消失）──
        assertTrue("cacheDir 父目录不得被删除", ctx.getCacheDir().exists());

        // ── 清完确实落了标记 ──
        assertNotNull("清空成功后应写入标记（下次冷启动不再重跑）", purgedGeneration());
    }

    /** 锚点契约：清空目标就是 {@code pictelio-images} 本身，不是它的父目录或兄弟目录 */
    @Test
    public void upgradePurge_anchor_isTheImageCacheDirItself() {
        File dir = loader.getCacheDir();
        assertEquals("清空锚点必须是图片缓存目录本身", IMAGE_CACHE_DIR, dir.getName());
        assertEquals("清空锚点的父目录必须是 cacheDir（不得更上层）",
                ctx.getCacheDir().getAbsolutePath(), dir.getParent());
    }

    // ── 「只执行一次」 ──────────────────────────────────────

    /**
     * 升级清空<b>只发生一次</b>：第一次清掉存量并落标记，之后每次冷启动都不再清——
     * 特别是<b>用户重新缓存的图不得被误清</b>。
     */
    @Test
    public void upgradePurge_runsOnlyOnce_soLaterColdStartsKeepNewEntries() throws Exception {
        seedCacheDir(IMAGE_CACHE_DIR, "legacy-1");

        assertTrue("首次启动（升级态）应执行清空", loader.purgeLegacyCacheOnUpgrade());
        assertEquals("存量已清空", 0, countFiles(loader.getCacheDir()));

        // 用户在升级后重新缓存了图（此时它属于新版策略，不该被任何清空再删）
        seedCacheDir(IMAGE_CACHE_DIR, "new-1", "new-2");

        // 后续每次冷启动：用<b>另一个实例</b> 模拟（生产每次冷启动都是新实例）
        assertFalse("第二次冷启动不得再执行清空", new PixivImageLoader(ctx).purgeLegacyCacheOnUpgrade());
        assertFalse("第三次冷启动不得再执行清空", new PixivImageLoader(ctx).purgeLegacyCacheOnUpgrade());

        assertEquals("升级后新缓存的条目不得被后续冷启动误清", 2, countFiles(loader.getCacheDir()));
    }

    /** 全新安装：目录本就没有条目，清空空目录是成功且无害（行为等同未清） */
    @Test
    public void upgradePurge_freshInstall_isNoOpAndLeavesCacheDirUsable() throws Exception {
        assertNull("前置：全新安装也无清空标记", purgedGeneration());

        boolean executed = loader.purgeLegacyCacheOnUpgrade();

        assertTrue("全新安装也会走一次清空（对空目录）", executed);
        assertTrue("缓存目录应可自愈重建", loader.getCacheDir().exists());
        assertNotNull("清空（哪怕是空目录）后仍应落标记", purgedGeneration());
        assertFalse("落标记后再进不得重跑", new PixivImageLoader(ctx).purgeLegacyCacheOnUpgrade());
    }

    // ── 失败不静默：未清干净就不落标记，下次冷启动重试 ──────────

    /**
     * 清空未完全成功时<b>不得</b>落标记——否则会出现「标记说清过了、实际还剩半截旧缓存」
     * 这一最难排查的状态。失败必须在下一次冷启动被重试。
     *
     * <p>失败注入方式取自被测实现的既定契约而非 mock：{@code clearDiskCache()} 显式
     * <b>拒绝递归删除</b>，故目录内残留一个<b>非空子目录</b>时 {@code File.delete()} 必然失败
     * ——这正是真实场景（异常残留子目录）下的失败路径。
     */
    @Test
    public void upgradePurge_partialFailure_doesNotMarkDone_andRetriesNextLaunch() throws Exception {
        seedCacheDir(IMAGE_CACHE_DIR, "legacy-1", "legacy-2");
        // 制造失败：非空子目录删不掉（非空 ⇒ File.delete() 返回 false）
        seedCacheDir(IMAGE_CACHE_DIR, "leftover-subdir/inner-1");

        boolean executed = loader.purgeLegacyCacheOnUpgrade();

        assertTrue("仍应尝试执行清空", executed);
        assertNull("清空未完全成功 ⇒ 不得落标记（否则存量被永久遗忘）", purgedGeneration());

        // 清空确实发生过：同目录的普通条目已被删掉（证明走的是 clearDiskCache 而非空转）
        File cacheDir = loader.getCacheDir();
        assertFalse("普通条目应已被删掉（证明走的是 clearDiskCache 而非空转）",
                new File(cacheDir, "legacy-1").exists());
        assertTrue("残留子目录按既定契约不被递归删除（失败被显式暴露而非静默）",
                new File(cacheDir, "leftover-subdir").exists());

        // 下一次冷启动必须重试，而不是因「已处理过」跳过
        assertTrue("未落标记 ⇒ 下次冷启动应重试清空", new PixivImageLoader(ctx).purgeLegacyCacheOnUpgrade());
    }

    // ── 存量数据格式：一字不改 ──────────────────────────────

    /**
     * 验收条件「不触碰任何存量数据格式」——升级清空只新增一个标记文件，
     * 安全存储（refresh_token）与图床配置（{@code CapacitorStorage}）必须逐字不变。
     */
    @Test
    public void upgradePurge_leavesExistingUserDataPrefsUntouched() throws Exception {
        seedCacheDir(IMAGE_CACHE_DIR, "legacy-1");
        String hostJson = "{\"mode\":\"fastest-ip\",\"hosts\":[{\"id\":\"h1\",\"baseUrl\":\"https://mirror.example\"}]}";
        SharedPreferences secure = ctx.getSharedPreferences(
                SecureStorageCompat.PREFS_NAME, Context.MODE_PRIVATE);
        secure.edit().putString("refresh_token", "legacy-refresh-token-value").commit();
        SharedPreferences capacitor = ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        capacitor.edit().putString("image_host_settings", hostJson).commit();
        assertNull("前置：升级前无清空标记", purgedGeneration());

        loader.purgeLegacyCacheOnUpgrade();

        // 先确认清空确实发生了（否则下面「存量未被改动」可能是「压根没跑」的空断言）
        assertNotNull("清空已执行并落标记", purgedGeneration());
        assertEquals("存量图片缓存应已被清空", 0, countFiles(loader.getCacheDir()));
        assertEquals("安全存储（存量用户数据）不得被改动",
                "legacy-refresh-token-value",
                secure.getString("refresh_token", null));
        assertEquals("图床配置（存量用户数据）不得被改动",
                hostJson, capacitor.getString("image_host_settings", null));
        assertFalse("标记文件不得复用安全存储的文件名", UPGRADE_PREFS_NAME.equals(SecureStorageCompat.PREFS_NAME));
        assertFalse("标记文件不得复用图床配置的文件名", UPGRADE_PREFS_NAME.equals("CapacitorStorage"));
    }

    // ── fixture ────────────────────────────────────────────

    private SharedPreferences upgradePrefs() {
        return ctx.getSharedPreferences(UPGRADE_PREFS_NAME, Context.MODE_PRIVATE);
    }

    private String purgedGeneration() {
        return upgradePrefs().getString(KEY_PURGED_GENERATION, null);
    }

    /** 本类自己写入的载荷：其长度即「释放字节数」的独立出处 */
    private static final byte[] PAYLOAD = "Pictelio 存量图片缓存条目".getBytes(StandardCharsets.UTF_8);

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
