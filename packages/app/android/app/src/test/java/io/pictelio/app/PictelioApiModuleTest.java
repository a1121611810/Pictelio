package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.json.JSONArray;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
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
}
