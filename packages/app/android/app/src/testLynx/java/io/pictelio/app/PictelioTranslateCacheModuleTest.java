package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.app.Application;
import android.content.Context;
import android.util.DisplayMetrics;

import androidx.test.core.app.ApplicationProvider;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.io.File;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * {@link PictelioTranslateCacheModule} 的契约守卫（ticket #641 / wayfinder #644 / ADR-0175）。
 *
 * <p><b>复用</b> ADR-0174 的 {@code TestLynxContext} 子类化技巧（research §2.1）——
 * Robolectric 4.14.1 + 真 {@link LynxContext} 抽象方法只有 1 个（{@code handleException}），
 * 本模块无 Keystore 依赖，无需伪造 AndroidKeyStore。
 *
 * <p><b>Oracle 溯源</b>（AGENTS.md 测试硬约束 #6）：
 * <ul>
 *   <li>文件名 = sha256(key).json → ADR-0175 D2.2 + ticket §T1（sha256 化的具体算法选择）</li>
 *   <li>manifest schema {@code {version:1, entries:[{key, size, createdAt}]}} → ADR-0175 D2.4</li>
 *   <li>LRU 容量 10MB / 200 条 → ADR-0175 D5.2 + ticket §T3</li>
 *   <li>错误码 ENOENT / ENOSPC → ticket §T1「errorCode 映射」</li>
 *   <li>callback 契约（{@code cb(value, err)} 二参去 null）→ ADR-0170 D4</li>
 * </ul>
 *
 * <p><b>变异实验</b>：
 * <ul>
 *   <li>M1（{@link PictelioTranslateCacheModule#evictLru} 改 no-op） → overCapacity_evictsLru 转红</li>
 *   <li>M2（manifest 写改非串行） → concurrentWrites_noCorruption 转红</li>
 *   <li>M3（{@code keyToFilename} 改 Base64URL 而非 sha256） → keySha256_usedAsFilename 转红</li>
 * </ul>
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = Application.class)
public class PictelioTranslateCacheModuleTest {

    /** ADR-0174 D2.1 同款 TestLynxContext 子类（handleException 是唯一抽象方法） */
    private static final class TestLynxContext extends LynxContext {
        TestLynxContext(Context base) {
            super(base, new DisplayMetrics());
        }
        @Override
        public void handleException(Exception e) {
            /* no-op */
        }
    }

    private PictelioTranslateCacheModule module;
    private File cacheDir;

    @Before
    public void setUp() {
        module = new PictelioTranslateCacheModule(
                new TestLynxContext(ApplicationProvider.getApplicationContext()));
        cacheDir = PictelioTranslateCacheModule.cacheDir(RuntimeEnvironment.getApplication());
        // 清理：每个用例独立目录起点
        if (cacheDir.exists()) {
            File[] files = cacheDir.listFiles();
            if (files != null) {
                for (File f : files) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
            }
        }
    }

    @After
    public void tearDown() {
        // 清干净：避免跨用例污染
        if (cacheDir.exists()) {
            File[] files = cacheDir.listFiles();
            if (files != null) {
                for (File f : files) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
            }
        }
    }

    // ─────────────────── 工具：invoke 反射 + 收集 callback ───────────────────

    /** 收集 (value, err) callback 结果 */
    private static final class CapturedCallback implements Callback {
        final AtomicReference<Object> valueRef = new AtomicReference<>(null);
        final AtomicReference<Object> errRef = new AtomicReference<>(null);
        final CountDownLatch latch = new CountDownLatch(1);
        volatile boolean invoked = false;

        @Override
        public void invoke(Object... args) {
            if (args == null || args.length == 0) {
                invoked = true;
                latch.countDown();
                return;
            }
            // 与 PictelioTranslateModule 等模块同款：第一个 arg = value，第二个 = err
            valueRef.set(args[0]);
            if (args.length > 1) errRef.set(args[1]);
            invoked = true;
            latch.countDown();
        }

        boolean awaitMs(long ms) throws InterruptedException {
            return latch.await(ms, TimeUnit.MILLISECONDS);
        }
    }

    /** 通过反射调用 @LynxMethod（避免硬编码签名在测试侧） */
    private Object invokeLynxMethod(String methodName, Object... args) throws Exception {
        // 找匹配参数数量的方法
        for (Method m : PictelioTranslateCacheModule.class.getDeclaredMethods()) {
            if (!m.getName().equals(methodName)) continue;
            if (!m.isAnnotationPresent(LynxMethod.class)) continue;
            Class<?>[] paramTypes = m.getParameterTypes();
            if (paramTypes.length != args.length) continue;
            boolean match = true;
            for (int i = 0; i < paramTypes.length; i++) {
                if (!paramTypes[i].isAssignableFrom(args[i].getClass())) {
                    match = false;
                    break;
                }
            }
            if (match) {
                m.setAccessible(true);
                return m.invoke(module, args);
            }
        }
        throw new NoSuchMethodException("No @LynxMethod " + methodName + " with " + args.length + " args");
    }

    // ─────────────────── keyToFilename + sha256 ───────────────────

    @Test
    public void keySha256_usedAsFilename() {
        // Oracle：sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
        String key = "hello";
        String filename = PictelioTranslateCacheModule.keyToFilename(key);
        assertEquals(
                "key 必须 sha256-hex 化为 64 字符 + .json 后缀（ADR-0175 D2.2 + ticket §T1）",
                "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824.json",
                filename);
    }

    @Test
    public void keySha256_filenameIsFilesystemSafe() {
        // key 含冒号（cache key 6 元组）→ 文件名仍文件系统安全（hex only）
        String weird = "12345:1:zh-CN:gpt-5:src:hash";
        String filename = PictelioTranslateCacheModule.keyToFilename(weird);
        assertTrue("文件名只含 [0-9a-f.]", filename.matches("^[0-9a-f]+\\.json$"));
    }

    @Test
    public void sha256Hex_knownVectors() {
        // FIPS 180-4 标准向量
        assertEquals(
                "sha256(\"\") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                PictelioTranslateCacheModule.sha256Hex(""));
        assertEquals(
                "sha256(\"abc\") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                PictelioTranslateCacheModule.sha256Hex("abc"));
    }

    // ─────────────────── setItem + getItem round trip ───────────────────

    @Test
    public void setItem_thenGetItem_returnsSame() throws Exception {
        String key = "12345:1:zh-CN:gpt-5:srcHash:baseHash";
        String json = "{\"paragraphs\":[\"译文1\",\"译文2\"],\"providerId\":\"openai-responses\"}";
        CapturedCallback setCb = new CapturedCallback();
        invokeLynxMethod("setItem", key, json, setCb);
        assertTrue("setItem callback 必须 invoke", setCb.awaitMs(2000));
        assertEquals("setItem 成功 cb(\"\")", "", setCb.valueRef.get());
        assertFalse("setItem 成功无 err", setCb.errRef.get() != null && !((String) setCb.errRef.get()).isEmpty());

        // 等 manifest 写入串行执行（单线程 executor）
        Thread.sleep(200);

        CapturedCallback getCb = new CapturedCallback();
        invokeLynxMethod("getItem", key, getCb);
        assertTrue("getItem callback 必须 invoke", getCb.awaitMs(2000));
        assertEquals("getItem 必须返回写入的 JSON", json, getCb.valueRef.get());
        // err = ""（空串）
        Object err = getCb.errRef.get();
        assertTrue("getItem 成功 err 必须为空", err == null || ((String) err).isEmpty());
    }

    @Test
    public void getItem_missingKey_returnsEnoent() throws Exception {
        CapturedCallback cb = new CapturedCallback();
        invokeLynxMethod("getItem", "nonexistent:key", cb);
        assertTrue(cb.awaitMs(2000));
        assertEquals("未命中 cb(\"\", \"ENOENT\")", "", cb.valueRef.get());
        assertEquals("未命中 err = ENOENT", "ENOENT", cb.errRef.get());
    }

    @Test
    public void deleteItem_thenGetItem_returnsEnoent() throws Exception {
        String key = "1:1:zh-CN:m:src:base";
        String json = "{\"paragraphs\":[\"x\"]}";
        invokeLynxMethod("setItem", key, json, new CapturedCallback());
        Thread.sleep(200);
        // 确认能读到
        CapturedCallback get1 = new CapturedCallback();
        invokeLynxMethod("getItem", key, get1);
        assertTrue(get1.awaitMs(2000));
        assertEquals(json, get1.valueRef.get());

        // 删除
        CapturedCallback delCb = new CapturedCallback();
        invokeLynxMethod("deleteItem", key, delCb);
        assertTrue(delCb.awaitMs(2000));
        assertEquals("", delCb.valueRef.get());

        Thread.sleep(200);
        // 再读必须 ENOENT
        CapturedCallback get2 = new CapturedCallback();
        invokeLynxMethod("getItem", key, get2);
        assertTrue(get2.awaitMs(2000));
        assertEquals("", get2.valueRef.get());
        assertEquals("ENOENT", get2.errRef.get());
    }

    @Test
    public void clear_emptiesDirectory() throws Exception {
        // 写 3 条
        for (int i = 0; i < 3; i++) {
            String key = "novel-" + i + ":ch1:zh-CN:m:src:base";
            CapturedCallback cb = new CapturedCallback();
            invokeLynxMethod("setItem", key, "{\"i\":" + i + "}", cb);
            assertTrue(cb.awaitMs(2000));
        }
        Thread.sleep(300);

        // 确认目录非空
        File[] before = cacheDir.listFiles();
        assertNotNull(before);
        assertTrue("clear 前目录应有文件", before.length >= 3);

        // clear
        CapturedCallback clearCb = new CapturedCallback();
        invokeLynxMethod("clear", clearCb);
        assertTrue(clearCb.awaitMs(2000));
        assertEquals("", clearCb.valueRef.get());

        // 目录应清空（manifest 也删）
        File[] after = cacheDir.listFiles();
        assertNotNull(after);
        // 目录可能为空或只剩 .tmp 残留（极端并发场景），不应有 .json 条目
        boolean hasEntry = false;
        for (File f : after) {
            if (f.getName().endsWith(".json") && !f.getName().endsWith(".tmp")) {
                hasEntry = true;
                break;
            }
        }
        assertFalse("clear 后目录不应有 .json 条目文件", hasEntry);
    }

    // ─────────────────── LRU 淘汰 ───────────────────

    @Test
    public void overCapacity_evictsLru() throws Exception {
        // 写 205 条（超过 DEFAULT_MAX_ENTRIES=200）；每条 1KB → 总大小 205KB < 10MB
        // → 触发条目数淘汰
        String payload = buildParagraphsJson(64, 16); // ~1KB
        for (int i = 0; i < 205; i++) {
            String key = "novel-" + i + ":ch1:zh-CN:m:src" + i + ":base";
            CapturedCallback cb = new CapturedCallback();
            invokeLynxMethod("setItem", key, payload, cb);
            assertTrue(cb.awaitMs(5000));
            // 每 10 条让 manifest 跟上（executor 串行）
            if (i % 10 == 0) Thread.sleep(50);
        }
        // 给 executor 时间消化所有任务
        Thread.sleep(2000);

        // 加载 manifest，验证 entries 数 ≤ 200
        File mf = new File(cacheDir, "manifest.json");
        assertTrue("manifest.json 必须存在", mf.exists());
        byte[] bytes = Files.readAllBytes(mf.toPath());
        JSONObject obj = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        JSONArray entries = obj.getJSONArray("entries");
        assertTrue(
                "LRU 200 上限：205 写入后 entries 必须 ≤ 200（oracle: ADR-0175 D5.2 + ticket §T3）",
                entries.length() <= PictelioTranslateCacheModule.DEFAULT_MAX_ENTRIES);
        assertEquals(
                "manifest schema version 必须为 1（ADR-0175 D2.4 契约）",
                PictelioTranslateCacheModule.MANIFEST_VERSION,
                obj.getInt("version"));

        // 最旧（i=0..4）应被淘汰
        for (int i = 0; i < 5; i++) {
            CapturedCallback cb = new CapturedCallback();
            invokeLynxMethod("getItem", "novel-" + i + ":ch1:zh-CN:m:src" + i + ":base", cb);
            assertTrue(cb.awaitMs(1000));
            assertEquals("最旧条目应被淘汰 → ENOENT", "ENOENT", cb.errRef.get());
        }
        // 最新（i=204）应可读
        CapturedCallback getNewest = new CapturedCallback();
        invokeLynxMethod("getItem", "novel-204:ch1:zh-CN:m:src204:base", getNewest);
        assertTrue(getNewest.awaitMs(1000));
        Object err = getNewest.errRef.get();
        assertTrue("最新条目必须可读", err == null || ((String) err).isEmpty());
    }

    @Test
    public void overCapacity_evictsByBytes() throws Exception {
        // 单条 200KB；写 60 条 = 12MB > 10MB → 触发字节淘汰
        // （条目数 60 < 200 容量，所以纯走字节淘汰分支）
        String payload = buildParagraphsJson(200, 1024); // ~200KB
        for (int i = 0; i < 60; i++) {
            String key = "n" + i + ":c1:l:m:s:b";
            CapturedCallback cb = new CapturedCallback();
            invokeLynxMethod("setItem", key, payload, cb);
            assertTrue(cb.awaitMs(5000));
            Thread.sleep(30);
        }
        Thread.sleep(2000);

        File mf = new File(cacheDir, "manifest.json");
        byte[] bytes = Files.readAllBytes(mf.toPath());
        JSONObject obj = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        // 字节淘汰：totalBytes 应 ≤ 10MB
        long totalBytes = 0;
        JSONArray entries = obj.getJSONArray("entries");
        for (int i = 0; i < entries.length(); i++) {
            JSONObject e = entries.getJSONObject(i);
            String key = e.getString("key");
            File f = new File(cacheDir, PictelioTranslateCacheModule.keyToFilename(key));
            if (f.exists()) totalBytes += f.length();
        }
        assertTrue(
                "字节淘汰：60 × 200KB 写入后 totalBytes 必须 ≤ 10MB（oracle: ticket §T3 + ADR-0175 D3.1）",
                totalBytes <= PictelioTranslateCacheModule.DEFAULT_MAX_BYTES);
    }

    // ─────────────────── 并发安全 ───────────────────

    @Test
    public void concurrentWrites_noCorruption() throws Exception {
        // 50 个并发 setItem：manifest JSON 合法 + 实际文件数 = 50
        final int N = 50;
        final CountDownLatch start = new CountDownLatch(1);
        final CountDownLatch done = new CountDownLatch(N);
        List<Thread> threads = new ArrayList<>();
        for (int i = 0; i < N; i++) {
            final int idx = i;
            Thread t = new Thread(() -> {
                try {
                    start.await();
                    String key = "conc-" + UUID.randomUUID().toString() + ":l:m:s:b";
                    String payload = "{\"i\":" + idx + ",\"data\":\"" + "x".repeat(100) + "\"}";
                    CapturedCallback cb = new CapturedCallback();
                    invokeLynxMethod("setItem", key, payload, cb);
                    assertTrue(cb.awaitMs(5000));
                } catch (Exception e) {
                    fail("并发写线程异常: " + e);
                } finally {
                    done.countDown();
                }
            });
            t.start();
            threads.add(t);
        }
        start.countDown();
        assertTrue("50 个并发写必须在 30s 内完成", done.await(30, TimeUnit.SECONDS));

        // 等 manifest 跟上
        Thread.sleep(2000);

        // manifest 必须合法 JSON + entries 数 = 50
        File mf = new File(cacheDir, "manifest.json");
        assertTrue("manifest 必须存在", mf.exists());
        byte[] bytes = Files.readAllBytes(mf.toPath());
        JSONObject obj;
        try {
            obj = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        } catch (Exception e) {
            fail("manifest JSON 损坏（并发写未串行化导致）：" + e);
            return;
        }
        JSONArray entries = obj.getJSONArray("entries");
        assertEquals(
                "50 个并发写后 manifest entries 必须 = 50（oracle: 串行 executor 保证）",
                N, entries.length());

        // 实际 .json 文件数（含 manifest.json）= N + 1（manifest 本身）
        File[] files = cacheDir.listFiles();
        assertNotNull(files);
        int jsonFiles = 0;
        for (File f : files) {
            if (f.getName().endsWith(".json") && !f.getName().equals("manifest.json")) {
                jsonFiles++;
            }
        }
        assertEquals("50 个并发写后 .json 文件数必须 = 50", N, jsonFiles);
    }

    // ─────────────────── orphan cleanup + manifest rebuild ───────────────────

    @Test
    public void orphanFilesCleanedOnStartup() throws Exception {
        // 手动创建一个孤儿文件（不在 manifest 中）
        File orphan = new File(cacheDir, "orphan_file_hash.json");
        Files.write(orphan.toPath(), "{\"orphan\":true}".getBytes(StandardCharsets.UTF_8));
        // 写一条合法条目
        String key = "1:1:l:m:s:b";
        invokeLynxMethod("setItem", key, "{\"x\":1}", new CapturedCallback());
        Thread.sleep(500);

        int removed = PictelioTranslateCacheModule.cleanupOrphanFiles(
                cacheDir, PictelioTranslateCacheModule.loadManifest(cacheDir));
        assertEquals("orphan 文件应被 cleanup 删除", 1, removed);
        assertFalse("orphan 已删除", orphan.exists());
    }

    @Test
    public void manifestCorruptionRebuildsFromDir() throws Exception {
        // 写一个合法条目
        String key = "1:1:l:m:s:b";
        invokeLynxMethod("setItem", key, "{\"x\":1}", new CapturedCallback());
        Thread.sleep(500);

        // 写损坏 manifest
        File mf = new File(cacheDir, "manifest.json");
        Files.write(mf.toPath(), "{ this is not valid json".getBytes(StandardCharsets.UTF_8));

        // 读 manifest：loadManifest 视为空集（自愈）
        PictelioTranslateCacheModule.Manifest loaded = PictelioTranslateCacheModule.loadManifest(cacheDir);
        assertEquals("损坏 manifest 应视为空（自愈）", 0, loaded.entries.size());

        // rebuildManifestFromDir：从目录现有文件重建（key 退化为文件名）
        PictelioTranslateCacheModule.Manifest rebuilt =
                PictelioTranslateCacheModule.rebuildManifestFromDir(cacheDir);
        // 至少重建 1 个条目（之前写入的合法条目）
        boolean foundAtLeastOne = false;
        for (PictelioTranslateCacheModule.ManifestEntry e : rebuilt.entries) {
            if (e.key.endsWith(".json") && !e.key.endsWith(".tmp")) {
                foundAtLeastOne = true;
                break;
            }
        }
        assertTrue("rebuild 应至少发现 1 个 .json 条目", foundAtLeastOne);
    }

    // ─────────────────── stats ───────────────────

    @Test
    public void stats_returnsExpectedShape() throws Exception {
        // 写 3 条
        for (int i = 0; i < 3; i++) {
            String key = "stats-" + i + ":c1:l:m:s:b";
            CapturedCallback cb = new CapturedCallback();
            invokeLynxMethod("setItem", key, "{\"i\":" + i + "}", cb);
            assertTrue(cb.awaitMs(2000));
        }
        Thread.sleep(500);

        // arity 契约（code-review P9）：stats 现为单参签名（无 String unused），
        // 与 JS 侧 `stats(cb)` 对齐；invokeLynxMethod 只传一个 Callback。
        CapturedCallback statsCb = new CapturedCallback();
        invokeLynxMethod("stats", statsCb);
        assertTrue("stats callback 必须 invoke", statsCb.awaitMs(2000));
        String raw = (String) statsCb.valueRef.get();
        assertNotNull(raw);
        JSONObject obj = new JSONObject(raw);
        assertEquals("entryCount 必须 = 3", 3, obj.getInt("entryCount"));
        assertTrue("totalBytes 必须 > 0", obj.getLong("totalBytes") > 0);
        assertEquals(
                "maxBytes 必须 = DEFAULT_MAX_BYTES",
                PictelioTranslateCacheModule.DEFAULT_MAX_BYTES,
                obj.getLong("maxBytes"));
        assertEquals(
                "maxEntries 必须 = DEFAULT_MAX_ENTRIES",
                PictelioTranslateCacheModule.DEFAULT_MAX_ENTRIES,
                obj.getInt("maxEntries"));
        // code-review S6：hitRate/missRate 必须是 JSON null（「未统计」），不是伪造的 0
        assertTrue("hitRate 必须为 JSON null（不再伪造 0）", obj.isNull("hitRate"));
        assertTrue("missRate 必须为 JSON null（不再伪造 0）", obj.isNull("missRate"));
    }

    @Test
    public void getCacheDirPath_returnsAbsolutePath() throws Exception {
        CapturedCallback cb = new CapturedCallback();
        // arity 契约（code-review P9）：单参签名，与 JS 侧 `getCacheDirPath(cb)` 对齐
        invokeLynxMethod("getCacheDirPath", cb);
        assertTrue(cb.awaitMs(2000));
        String path = (String) cb.valueRef.get();
        assertNotNull(path);
        assertTrue(
                "cacheDir 路径必须含子目录名 " + PictelioTranslateCacheModule.CACHE_SUBDIR,
                path.endsWith("/" + PictelioTranslateCacheModule.CACHE_SUBDIR));
    }

    // ─────────────────── 工具 ───────────────────

    /**
     * 构造约 {@code paraCount * paraSize} 字节的 paragraphs JSON：
     * {@code {"paragraphs":["x".repeat(paraSize), ...]}}。
     */
    private static String buildParagraphsJson(int paraCount, int paraSize) {
        StringBuilder sb = new StringBuilder("{\"paragraphs\":[");
        for (int i = 0; i < paraCount; i++) {
            if (i > 0) sb.append(",");
            sb.append("\"").append("x".repeat(paraSize)).append("\"");
        }
        sb.append("]}");
        return sb.toString();
    }
}
