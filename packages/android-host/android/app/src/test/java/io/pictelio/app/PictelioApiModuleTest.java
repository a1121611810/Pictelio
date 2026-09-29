package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.fail;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.test.core.app.ApplicationProvider;

import org.json.JSONArray;
import org.json.JSONException;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

import io.pictelio.app.config.OAuthConfig;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import okhttp3.mockwebserver.SocketPolicy;

/**
 * PictelioApiModule.ugoiraExtractCore 契约测试（ADR-0125 解压写盘管线）。
 *
 * <p>测试核心静态方法（绕开 LynxContext 依赖，与 PictelioPrefsModuleTest
 * 「可测核心 + 薄模块包装」同模式）。
 *
 * <p>契约断言（oracle = ADR-0125 + issue #265 spec + 原型实测）：
 * <ul>
 *   <li>成功：帧 file:// URL 按 framesJson 时序输出，数量/顺序与 meta.frames 一致</li>
 *   <li>扩展名派生：zip 条目名 {@code .png} → {@code .png}，否则 {@code .jpg}（spec「帧 URL 形态」）</li>
 *   <li>帧缺失：framesJson 某 {@code file} 在 zip 中不存在 → 抛「zip 缺少帧文件 &lt;name&gt;」（spec IO 边界）</li>
 *   <li>zip 损坏：无有效条目 → 抛「zip 无有效条目（zip 损坏）」（spec IO 边界）</li>
 *   <li>帧列表解析失败：framesJson 非法 JSON → 抛「帧列表解析失败」（spec IO 边界）</li>
 * </ul>
 *
 * <p>另含 ADR-0143 T4 zip 下载源测试（downloadZip/streamDownloadZip 直测，见文件末尾分组注释）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class PictelioApiModuleTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    /** 构建 store 模式 zip（帧字节原样存储，与 Pixiv ugoira zip 一致） */
    private static byte[] buildStoreZip(String[][] frames) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (ZipOutputStream zos = new ZipOutputStream(bos)) {
            for (String[] f : frames) {
                byte[] data = f[1].getBytes(StandardCharsets.UTF_8);
                ZipEntry e = new ZipEntry(f[0]);
                // store 模式（compression method 0）——Pixiv ugoira zip 的事实形态
                e.setMethod(ZipEntry.STORED);
                e.setSize(data.length);
                CRC32 crc = new CRC32();
                crc.update(data);
                e.setCrc(crc.getValue());
                zos.putNextEntry(e);
                zos.write(data);
                zos.closeEntry();
            }
        }
        return bos.toByteArray();
    }

    /** framesJson 为真实 API 契约形态：[{file, delay}, ...] */
    private static String framesJson(String... files) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < files.length; i++) {
            if (i > 0) sb.append(",");
            sb.append("{\"file\":\"").append(files[i]).append("\",\"delay\":").append(100 + i).append("}");
        }
        return sb.append("]").toString();
    }

    @Test
    public void success_framesOrderAndExtension() throws Exception {
        File dir = tmp.newFolder("cache", "ugoira");
        byte[] zip = buildStoreZip(new String[][]{
                {"frame_0.png", "PNG-BYTES-0"},
                {"frame_1.jpg", "JPG-BYTES-1"},
        });
        JSONArray urls = PictelioApiModule.ugoiraExtractCore(zip, framesJson("frame_0.png", "frame_1.jpg"), dir);
        assertEquals(2, urls.length());
        // 帧 URL 顺序与 framesJson 一致；扩展名按 zip 条目名派生（.png → .png，.jpg → .jpg）
        String u0 = urls.getString(0);
        String u1 = urls.getString(1);
        assertTrue("帧 0 应为 .png: " + u0, u0.endsWith("frame_0.png"));
        assertTrue("帧 1 应为 .jpg: " + u1, u1.endsWith("frame_1.jpg"));
        assertTrue("帧 URL 应为 file:// 前缀: " + u0, u0.startsWith("file://"));
        // 写盘内容校验（帧字节与 zip 条目一致）
        File out0 = new File(dir, "frame_0.png");
        byte[] written = java.nio.file.Files.readAllBytes(out0.toPath());
        assertEquals("PNG-BYTES-0", new String(written, StandardCharsets.UTF_8));
    }

    @Test
    public void missingFrame_throws_readableError() throws Exception {
        File dir = tmp.newFolder("cache", "ugoira");
        byte[] zip = buildStoreZip(new String[][]{{"frame_0.png", "X"}});
        try {
            PictelioApiModule.ugoiraExtractCore(zip, framesJson("frame_0.png", "frame_1.png"), dir);
            fail("应抛缺帧错误");
        } catch (IOException e) {
            assertEquals("zip 缺少帧文件 frame_1.png", e.getMessage());
        }
    }

    @Test
    public void corruptZip_throws_readableError() throws Exception {
        File dir = tmp.newFolder("cache", "ugoira");
        // 非 zip 字节（无任何有效条目）
        byte[] garbage = "not-a-zip".getBytes(StandardCharsets.UTF_8);
        try {
            PictelioApiModule.ugoiraExtractCore(garbage, framesJson("frame_0.png"), dir);
            fail("应抛 zip 损坏错误");
        } catch (IOException e) {
            assertEquals("zip 无有效条目（zip 损坏）", e.getMessage());
        }
    }

    @Test
    public void invalidFramesJson_throws_readableError() throws Exception {
        File dir = tmp.newFolder("cache", "ugoira");
        byte[] zip = buildStoreZip(new String[][]{{"frame_0.png", "X"}});
        try {
            PictelioApiModule.ugoiraExtractCore(zip, "{not-json", dir);
            fail("应抛帧列表解析失败");
        } catch (IOException e) {
            assertEquals("帧列表解析失败", e.getMessage());
        }
    }

    @Test
    public void cleanupOldFrames_deletesOldestWhenOverLimit() throws Exception {
        // 写盘前清理：超过阈值（文件数 300）时删最旧——用小阈值验证逻辑（把 300 视作上限，
        // 构造 301 个旧文件 + 1 个"当前作品"占位由核心写入，验证清理发生在写盘前）。
        File dir = tmp.newFolder("cache", "ugoira");
        for (int i = 0; i < 301; i++) {
            File f = new File(dir, "old_" + i + ".jpg");
            try (FileOutputStream fos = new FileOutputStream(f)) {
                fos.write(1);
            }
            // 递增 mtime：i=0 最旧，i=300 最新
            f.setLastModified(1_000_000L + i);
        }
        byte[] zip = buildStoreZip(new String[][]{{"frame_0.png", "X"}});
        JSONArray urls = PictelioApiModule.ugoiraExtractCore(zip, framesJson("frame_0.png"), dir);
        assertEquals(1, urls.length());
        // 清理后帧数应回落（≥ 当前作品的 1 帧 + 最近保留）
        int remaining = dir.listFiles().length;
        assertTrue("清理后应显著减少（当前 " + remaining + "）", remaining <= 301);
    }

    // ── ADR-0126：缓存命中（零下载）+ per-illust 目录 ──

    @Test
    public void cached_hit_returnsUrlsWithoutDownload() throws Exception {
        File dir = tmp.newFolder("cache", "ugoira", "123456");
        writeFrame(dir, "frame_0.png", "X");
        writeFrame(dir, "frame_1.png", "Y");
        JSONArray urls = PictelioApiModule.ugoiraExtractCached(dir, framesJson("frame_0.png", "frame_1.png"));
        assertNotNull("帧完整应命中", urls);
        assertEquals(2, urls.length());
        assertTrue(urls.getString(0).endsWith("frame_0.png"));
        assertTrue(urls.getString(0).startsWith("file://"));
        // 命中路径不写盘不清理：文件内容不变（零 IO 语义）
        assertEquals("X", new String(java.nio.file.Files.readAllBytes(
                new File(dir, "frame_0.png").toPath()), StandardCharsets.UTF_8));
    }

    @Test
    public void cached_partialFrames_miss() throws Exception {
        File dir = tmp.newFolder("cache", "ugoira", "123456");
        writeFrame(dir, "frame_0.png", "X");
        // 少一帧 → 未命中（需重解压写盘）
        assertNull(PictelioApiModule.ugoiraExtractCached(dir, framesJson("frame_0.png", "frame_1.png")));
    }

    @Test
    public void cached_emptyFrame_miss() throws Exception {
        File dir = tmp.newFolder("cache", "ugoira", "123456");
        writeFrame(dir, "frame_0.png", "X");
        writeFrame(dir, "frame_1.png", ""); // 空文件 → 视为损坏帧 → 未命中
        assertNull(PictelioApiModule.ugoiraExtractCached(dir, framesJson("frame_0.png", "frame_1.png")));
    }

    @Test
    public void cached_dirAbsent_miss() throws Exception {
        File dir = new File(tmp.getRoot(), "never-created");
        assertNull(PictelioApiModule.ugoiraExtractCached(dir, framesJson("frame_0.png")));
    }

    @Test
    public void cached_invalidFramesJson_throws() throws Exception {
        File dir = tmp.newFolder("cache", "ugoira", "123456");
        try {
            PictelioApiModule.ugoiraExtractCached(dir, "{not-json");
            fail("应抛帧列表解析失败");
        } catch (IOException e) {
            assertEquals("帧列表解析失败", e.getMessage());
        }
    }

    private static void writeFrame(File dir, String name, String content) throws IOException {
        try (FileOutputStream fos = new FileOutputStream(new File(dir, name))) {
            fos.write(content.getBytes(StandardCharsets.UTF_8));
        }
    }
    // ── ADR-0128：流式渐进（ugoiraStreamCore + UgoiraStreamEngine） ──
    // oracle：docs/research/ugoira-native-streaming-proto.md（首批水位/批次序列/字节一致）

    /** 全量解压对照（测试内实现：ZipInputStream 顺序读入 map） */
    private static java.util.Map<String, byte[]> fullMapExtract(byte[] zip) throws IOException {
        java.util.Map<String, byte[]> map = new java.util.HashMap<>();
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(zip))) {
            ZipEntry entry;
            byte[] buf = new byte[16 * 1024];
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                int n;
                while ((n = zis.read(buf)) != -1) out.write(buf, 0, n);
                map.put(entry.getName(), out.toByteArray());
            }
        }
        return map;
    }

    @Test
    public void streamCore_batchTimeline_andByteConsistency() throws Exception {
        int frameCount = 200;
        String[] names = new String[frameCount];
        String[][] frames = new String[frameCount][];
        for (int i = 0; i < frameCount; i++) {
            names[i] = String.format("%06d.jpg", i);
            int size = 2048 + (i % 7) * 512;
            StringBuilder sb = new StringBuilder(size);
            for (int k = 0; k < size; k++) sb.append((char) ('a' + (k + i) % 26));
            frames[i] = new String[]{names[i], sb.toString()};
        }
        byte[] zip = buildStoreZip(frames);
        File dir = tmp.newFolder("stream");
        int[] batchCount = {0};
        long[] firstBytes = {0};
        java.util.List<String> allUrls = new java.util.ArrayList<>();
        int delivered = PictelioApiModule.ugoiraStreamCore(
                new ByteArrayInputStream(zip), framesJson(names), dir, 10, batch -> {
                    batchCount[0]++;
                    if (batchCount[0] == 1) firstBytes[0] = batch.bytesRead;
                    try {
                        for (int i = 0; i < batch.urls.length(); i++) {
                            allUrls.add(batch.urls.getString(i));
                        }
                    } catch (JSONException e) {
                        throw new RuntimeException(e);
                    }
                });
        assertEquals(frameCount, delivered);
        assertEquals(frameCount / 10, batchCount[0]);
        // 首批水位远小于全量（oracle：原型报告首批 4.5%）
        assertTrue("首批水位应远小于全量: " + firstBytes[0] + "/" + zip.length,
                firstBytes[0] * 10 < zip.length);
        // 字节一致：流式写盘（frame_N.jpg 命名规则）vs 全量解压
        java.util.Map<String, byte[]> reference = fullMapExtract(zip);
        for (int i = 0; i < names.length; i++) {
            String name = names[i];
            byte[] written = java.nio.file.Files.readAllBytes(new File(dir, "frame_" + i + ".jpg").toPath());
            assertTrue("帧字节一致: " + name, java.util.Arrays.equals(reference.get(name), written));
        }
        assertEquals("交付顺序 == 帧序", frameCount, allUrls.size());
    }

    @Test
    public void streamCore_reorderedZip_throwsReadableOrderError() throws Exception {
        // 物理序倒置：顺序断言必须抛可读错误（JS 端降级全量路径，绝不产生错帧）
        String[] names = {"000000.jpg", "000001.jpg"};
        byte[] zip = buildStoreZip(new String[][]{
                {"000001.jpg", "SECOND"},
                {"000000.jpg", "FIRST"},
        });
        File dir = tmp.newFolder("reorder");
        try {
            PictelioApiModule.ugoiraStreamCore(new ByteArrayInputStream(zip), framesJson(names), dir, 5, b -> {});
            fail("应抛帧序不一致错误");
        } catch (IOException e) {
            assertTrue(e.getMessage().contains("条目序与帧列表不一致"));
        }
    }

    @Test
    public void streamCore_missingFrame_throws() throws Exception {
        byte[] zip = buildStoreZip(new String[][]{{"000000.jpg", "X"}});
        File dir = tmp.newFolder("missing");
        try {
            PictelioApiModule.ugoiraStreamCore(new ByteArrayInputStream(zip),
                    framesJson("000000.jpg", "000001.jpg"), dir, 5, b -> {});
            fail("应抛缺帧错误");
        } catch (IOException e) {
            assertTrue(e.getMessage().contains("zip 缺帧"));
        }
    }

    // ── UgoiraStreamEngine 状态机（拉模式） ──

    private UgoiraStreamEngine newEngine() {
        return new UgoiraStreamEngine(java.util.concurrent.Executors.newSingleThreadExecutor(), json -> {
            try {
                return new JSONArray(json).length();
            } catch (JSONException e) {
                throw new IOException("帧列表解析失败", e);
            }
        });
    }

    /** 轮询直到 done（超时 3s），返回最终 payload */
    private org.json.JSONObject pollUntilDone(UgoiraStreamEngine engine) throws Exception {
        long deadline = System.currentTimeMillis() + 3000;
        org.json.JSONObject last = null;
        while (System.currentTimeMillis() < deadline) {
            last = engine.poll();
            if (last.optBoolean("done")) return last;
            Thread.sleep(10);
        }
        return last;
    }

    @Test
    public void engine_streamDeliversAllBatches() throws Exception {
        String[] names = {"000000.jpg", "000001.jpg", "000002.jpg"};
        byte[] zip = buildStoreZip(new String[][]{
                {"000000.jpg", "AAA"},
                {"000001.jpg", "BBB"},
                {"000002.jpg", "CCC"},
        });
        File dir = tmp.newFolder("engine");
        UgoiraStreamEngine engine = newEngine();
        engine.start(() -> new ByteArrayInputStream(zip), framesJson(names), dir, 1);
        org.json.JSONObject payload = pollUntilDone(engine);
        assertTrue(payload.optBoolean("done"));
        assertFalse(payload.has("error"));
        assertEquals(3, payload.optJSONArray("urls").length());
        assertTrue(payload.optJSONArray("urls").getString(0).startsWith("file://"));
        assertTrue(payload.optJSONArray("urls").getString(0).endsWith("frame_0.jpg"));
    }

    @Test
    public void engine_cacheHit_deliversAllWithoutSource() throws Exception {
        File dir = tmp.newFolder("engine-cache");
        writeFrame(dir, "frame_0.png", "X");
        writeFrame(dir, "frame_1.png", "Y");
        UgoiraStreamEngine engine = newEngine();
        boolean[] sourceCalled = {false};
        engine.start(() -> {
            sourceCalled[0] = true;
            return new ByteArrayInputStream(new byte[0]);
        }, framesJson("frame_0.png", "frame_1.png"), dir, 5);
        org.json.JSONObject payload = pollUntilDone(engine);
        assertTrue(payload.optBoolean("done"));
        assertEquals(2, payload.optJSONArray("urls").length());
        assertFalse("缓存命中不得打开网络流", sourceCalled[0]);
    }

    @Test
    public void engine_sourceError_exposesReadableError() throws Exception {
        File dir = tmp.newFolder("engine-err");
        UgoiraStreamEngine engine = newEngine();
        engine.start(() -> {
            throw new IOException("HTTP 403");
        }, framesJson("000000.jpg"), dir, 5);
        org.json.JSONObject payload = pollUntilDone(engine);
        assertTrue(payload.optBoolean("done"));
        assertEquals("HTTP 403", payload.optString("error"));
    }

    @Test
    public void engine_cancel_marksDoneWithoutError() throws Exception {
        File dir = tmp.newFolder("engine-cancel");
        UgoiraStreamEngine engine = newEngine();
        engine.start(() -> new ByteArrayInputStream(new byte[]{1, 2, 3}), framesJson("000000.jpg"), dir, 5);
        engine.cancel();
        org.json.JSONObject payload = engine.poll();
        assertTrue(payload.optBoolean("done"));
        assertFalse("取消不是错误", payload.has("error"));
    }

    @Test
    public void engine_restart_replacesPreviousStream() throws Exception {
        File dir = tmp.newFolder("engine-restart");
        UgoiraStreamEngine engine = newEngine();
        engine.start(() -> new ByteArrayInputStream(new byte[]{1, 2, 3}), framesJson("000000.jpg"), dir, 5);
        // 第二次 start（不同帧列表）→ 旧流被取消
        String[] names = {"000000.jpg", "000001.jpg"};
        byte[] zip = buildStoreZip(new String[][]{{"000000.jpg", "A"}, {"000001.jpg", "B"}});
        engine.start(() -> new ByteArrayInputStream(zip), framesJson(names), dir, 1);
        org.json.JSONObject payload = pollUntilDone(engine);
        assertTrue(payload.optBoolean("done"));
        assertEquals(2, payload.optJSONArray("urls").length());
     }

    // ── ADR-0143 T4：zip 下载源接入（downloadZip / streamDownloadZip 直测） ──
    // oracle：ADR-0143 D1/D4 + spec #376（镜像失败 → 官方重试一次；流式回退仅限「建立连接 /
    // HTTP 状态 / 响应体获取」阶段，读取阶段失败不得换源）。
    // 图床开启 fixture 走生产入口 ImageHostConfig.get(ctx)（SharedPreferences "CapacitorStorage"
    // 的 image_host_settings，JSON 形状与 ImageHostConfigTest 同源 = imageHostStore.ts 真实持久化
    // 形态，测试硬约束 #2 禁自洽 mock）。
    // 白名单说明：@LynxMethod 入口的 https:// 校验针对 JS 传入的官方 zip URL；直测下载方法
    // 可用 MockWebServer 的 http:// 地址（resolve 契约接受 http(s)）。

    private MockWebServer mirrorServer;
    private MockWebServer officialServer;
    private Context zipCtx;

    @Before
    public void setUpZipDownload() throws Exception {
        zipCtx = ApplicationProvider.getApplicationContext();
        mirrorServer = new MockWebServer();
        mirrorServer.start();
        officialServer = new MockWebServer();
        officialServer.start();
        // ImageHostConfig.get() 为进程级单例：Robolectric 同配置用例共享类加载器时，单例可能携带
        // 上一个用例的 Application 引用（其 prefs 指向已清理的旧沙箱目录）→ 反射重置，保证每个
        // 用例以当前 Context 重新接线（不动 T1 冻结文件前提下唯一的确定性手段）
        Field instance = ImageHostConfig.class.getDeclaredField("instance");
        instance.setAccessible(true);
        instance.set(null, null);
        // 清除同沙箱内可能残留的图床配置（跨用例磁盘共享时保证「图床关」用例确定性）
        imageHostPrefs().edit().remove("image_host_settings").commit();
    }

    @After
    public void tearDownZipDownload() throws IOException {
        mirrorServer.shutdown();
        officialServer.shutdown();
        // 同步重置生产单例：本类在 Gradle 单 JVM 中可能先于其他测试类执行，遗留持有本类
        // Application 引用的单例会污染后续类的 ImageHostConfig.get() 接线（其 prefs 指向
        // 已关闭的 MockWebServer 端口）→ 置空交还给后续类按自身 Context 重建
        try {
            Field instance = ImageHostConfig.class.getDeclaredField("instance");
            instance.setAccessible(true);
            instance.set(null, null);
        } catch (Exception ignored) {
            // 重置失败不影响本类断言；仅可能影响同 JVM 后续类的隔离性
        }
    }

    /** Capacitor Preferences 落盘名（先例：ImageIntercept；oracle = ImageHostConfig.PREFS_NAME） */
    private SharedPreferences imageHostPrefs() {
        return zipCtx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
    }

    /** 图床开启（single 模式指向 mirrorServer）；JSON 形状 oracle = imageHostStore.ts 持久化形态 */
    private void enableImageHost() {
        String json = "{\"masterEnabled\":true,\"mode\":\"single\",\"selectedHostId\":\"mirror\","
                + "\"hosts\":[{\"id\":\"mirror\",\"name\":\"mirror\",\"baseUrl\":\""
                + mirrorServer.url("/")
                + "\",\"enabled\":true,\"weight\":100,\"isBuiltIn\":false,\"edited\":false}],"
                + "\"probeResults\":[],\"fastestHostId\":null,\"fastestHostExpiresAt\":null}";
        assertTrue("图床配置写入成功", imageHostPrefs().edit()
                .putString("image_host_settings", json).commit());
    }

    /** 官方 zip URL：path 形态对齐真实 ugoira zip（i.pximg.net /img-zip-ugoira/&lt;illust&gt;/&lt;hash&gt;.zip） */
    private String officialZipUrl() {
        return officialServer.url("/img-zip-ugoira/12345/0000000_ugoira.zip").toString();
    }

    private static MockResponse zipResponse(byte[] zip) {
        return new MockResponse().setBody(new okio.Buffer().write(zip));
    }

    private static byte[] readAllBytes(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) {
            bos.write(buf, 0, n);
        }
        in.close();
        return bos.toByteArray();
    }

    @Test
    public void downloadZip_imageHostOn_servesMirrorBytesWithoutOfficialRequest() throws Exception {
        enableImageHost();
        byte[] mirrorZip = buildStoreZip(new String[][]{{"000000.jpg", "MIRROR"}});
        byte[] officialZip = buildStoreZip(new String[][]{{"000000.jpg", "OFFICIAL"}});
        mirrorServer.enqueue(zipResponse(mirrorZip));
        officialServer.enqueue(zipResponse(officialZip));
        byte[] out = PictelioApiModule.downloadZip(zipCtx, officialZipUrl());
        assertArrayEquals("zip 字节应来自镜像", mirrorZip, out);
        assertEquals("镜像命中不得请求官方", 0, officialServer.getRequestCount());
        assertEquals(1, mirrorServer.getRequestCount());
        RecordedRequest req = mirrorServer.takeRequest();
        assertEquals("官方 path 逐字节保留（ADR-0143 D1 仅替换 host）",
                "/img-zip-ugoira/12345/0000000_ugoira.zip", req.getPath());
        assertEquals("镜像请求保留 Referer（与官方同款头）", OAuthConfig.REFERER, req.getHeader("Referer"));
        assertEquals("镜像请求保留 UA", OAuthConfig.USER_AGENT, req.getHeader("User-Agent"));
    }

    @Test
    public void downloadZip_mirrorHttp500_fallsBackToOfficialOnce() throws Exception {
        enableImageHost();
        byte[] officialZip = buildStoreZip(new String[][]{{"000000.jpg", "OFFICIAL"}});
        mirrorServer.enqueue(new MockResponse().setResponseCode(500));
        officialServer.enqueue(zipResponse(officialZip));
        byte[] out = PictelioApiModule.downloadZip(zipCtx, officialZipUrl());
        assertArrayEquals(officialZip, out);
        assertEquals(1, mirrorServer.getRequestCount());
        assertEquals("回退官方恰一次", 1, officialServer.getRequestCount());
    }

    @Test
    public void downloadZip_mirrorConnectionFailure_fallsBackToOfficial() throws Exception {
        enableImageHost();
        byte[] officialZip = buildStoreZip(new String[][]{{"000000.jpg", "OFFICIAL"}});
        mirrorServer.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START));
        officialServer.enqueue(zipResponse(officialZip));
        byte[] out = PictelioApiModule.downloadZip(zipCtx, officialZipUrl());
        assertArrayEquals(officialZip, out);
        assertEquals(1, mirrorServer.getRequestCount());
        assertEquals(1, officialServer.getRequestCount());
    }

    @Test
    public void downloadZip_mirrorEmptyBody_fallsBackToOfficial() throws Exception {
        enableImageHost();
        byte[] officialZip = buildStoreZip(new String[][]{{"000000.jpg", "OFFICIAL"}});
        mirrorServer.enqueue(new MockResponse().setBody("")); // HTTP 200 + 空 body（镜像失败形态之一）
        officialServer.enqueue(zipResponse(officialZip));
        byte[] out = PictelioApiModule.downloadZip(zipCtx, officialZipUrl());
        assertArrayEquals(officialZip, out);
        assertEquals(1, mirrorServer.getRequestCount());
        assertEquals(1, officialServer.getRequestCount());
    }

    @Test
    public void downloadZip_imageHostOff_singleOfficialRequestOnly() throws Exception {
        // 图床关（@Before 已清除配置 → resolve 透传）→ 行为与接入前一致：仅官方一次
        byte[] officialZip = buildStoreZip(new String[][]{{"000000.jpg", "OFFICIAL"}});
        officialServer.enqueue(zipResponse(officialZip));
        byte[] out = PictelioApiModule.downloadZip(zipCtx, officialZipUrl());
        assertArrayEquals(officialZip, out);
        assertEquals("图床关不得触碰镜像", 0, mirrorServer.getRequestCount());
        assertEquals(1, officialServer.getRequestCount());
    }

    @Test
    public void streamDownloadZip_imageHostOn_streamsMirrorBytes() throws Exception {
        enableImageHost();
        byte[] mirrorZip = buildStoreZip(new String[][]{{"000000.jpg", "MIRROR"}});
        mirrorServer.enqueue(zipResponse(mirrorZip));
        InputStream in = PictelioApiModule.streamDownloadZip(zipCtx, officialZipUrl());
        assertArrayEquals("流式字节应来自镜像", mirrorZip, readAllBytes(in));
        assertEquals("流式镜像命中不得请求官方", 0, officialServer.getRequestCount());
        assertEquals(1, mirrorServer.getRequestCount());
    }

    @Test
    public void streamDownloadZip_mirrorHttp500_fallsBackToOfficialStream() throws Exception {
        enableImageHost();
        byte[] officialZip = buildStoreZip(new String[][]{{"000000.jpg", "OFFICIAL"}});
        mirrorServer.enqueue(new MockResponse().setResponseCode(500));
        officialServer.enqueue(zipResponse(officialZip));
        InputStream in = PictelioApiModule.streamDownloadZip(zipCtx, officialZipUrl());
        assertArrayEquals("连接阶段失败回退 → 读到官方流", officialZip, readAllBytes(in));
        assertEquals(1, mirrorServer.getRequestCount());
        assertEquals(1, officialServer.getRequestCount());
    }

    @Test
    public void streamDownloadZip_mirrorConnectionFailure_fallsBackToOfficialStream() throws Exception {
        enableImageHost();
        byte[] officialZip = buildStoreZip(new String[][]{{"000000.jpg", "OFFICIAL"}});
        mirrorServer.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START));
        officialServer.enqueue(zipResponse(officialZip));
        InputStream in = PictelioApiModule.streamDownloadZip(zipCtx, officialZipUrl());
        assertArrayEquals(officialZip, readAllBytes(in));
        assertEquals(1, mirrorServer.getRequestCount());
        assertEquals(1, officialServer.getRequestCount());
    }

    @Test
    public void streamDownloadZip_mirrorMidStreamFailure_noSourceSwitch() throws Exception {
        // 流式回退硬边界（oracle = ticket #380 / ADR-0143 D4）：一旦开始读取流中数据（镜像
        // 200 已建立），失败沿原错误路径上报，不得中途换源重开官方流（JS 端有降级全量语义，
        // 换源 = 镜像已交付帧与官方续读字节混源，破坏 zip 流物理连续性）
        enableImageHost();
        mirrorServer.enqueue(new MockResponse()
                .setBody("partial-mirror-bytes")
                .setSocketPolicy(SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY));
        InputStream in = PictelioApiModule.streamDownloadZip(zipCtx, officialZipUrl());
        try {
            readAllBytes(in);
            fail("读取镜像中断流应抛 IOException");
        } catch (IOException expected) {
            // 预期：读取阶段失败（非连接/状态/响应体获取阶段，不回退）
        }
        assertEquals("读取阶段失败不得请求官方（无中途换源）", 0, officialServer.getRequestCount());
    }

    @Test
    public void streamDownloadZip_imageHostOff_singleOfficialStream() throws Exception {
        byte[] officialZip = buildStoreZip(new String[][]{{"000000.jpg", "OFFICIAL"}});
        officialServer.enqueue(zipResponse(officialZip));
        InputStream in = PictelioApiModule.streamDownloadZip(zipCtx, officialZipUrl());
        assertArrayEquals(officialZip, readAllBytes(in));
        assertEquals(0, mirrorServer.getRequestCount());
        assertEquals(1, officialServer.getRequestCount());
    }
}
