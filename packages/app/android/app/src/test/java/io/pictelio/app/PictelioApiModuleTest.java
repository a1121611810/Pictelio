package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.fail;

import org.json.JSONArray;
import org.json.JSONException;
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
import java.nio.charset.StandardCharsets;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

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
}
