package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.zip.CRC32;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * UgoiraExporter APNG 单测（spec docs/specs/download-manager.md §6）：
 * 结构（IHDR→acTL→fcTL→IDAT→fcTL→fdAT→IEND）、帧数/时序、CRC 合法性、缺时序回退。
 * 用测试内手工构造的合法 1×1 RGBA PNG（Deflater 压缩 IDAT），不依赖 Bitmap 图形栈。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class UgoiraExporterApngTest {

    private final Context ctx = ApplicationProvider.getApplicationContext();

    private static void putInt(byte[] b, int off, int v) {
        b[off] = (byte) (v >>> 24);
        b[off + 1] = (byte) (v >>> 16);
        b[off + 2] = (byte) (v >>> 8);
        b[off + 3] = (byte) v;
    }

    private static int readInt(byte[] b, int off) {
        return ((b[off] & 0xff) << 24) | ((b[off + 1] & 0xff) << 16)
                | ((b[off + 2] & 0xff) << 8) | (b[off + 3] & 0xff);
    }

    private static void writeChunk(OutputStream out, String type, byte[] data) throws IOException {
        byte[] typeBytes = type.getBytes(StandardCharsets.US_ASCII);
        out.write(new byte[]{(byte) (data.length >>> 24), (byte) (data.length >>> 16),
                (byte) (data.length >>> 8), (byte) data.length});
        out.write(typeBytes);
        out.write(data);
        CRC32 crc = new CRC32();
        crc.update(typeBytes);
        crc.update(data);
        int v = (int) crc.getValue();
        out.write(new byte[]{(byte) (v >>> 24), (byte) (v >>> 16), (byte) (v >>> 8), (byte) v});
    }

    private static byte[] deflate(byte[] raw) {
        Deflater d = new Deflater();
        d.setInput(raw);
        d.finish();
        byte[] buf = new byte[256];
        int n = d.deflate(buf);
        d.end();
        return Arrays.copyOf(buf, n);
    }

    /** 合法 1×1 RGBA PNG */
    private static byte[] tinyPng(int r, int g, int b) throws IOException {
        byte[] ihdr = new byte[13];
        putInt(ihdr, 0, 1);
        putInt(ihdr, 4, 1);
        ihdr[8] = 8;
        ihdr[9] = 6;
        byte[] raw = {0, (byte) r, (byte) g, (byte) b, (byte) 255};
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(new byte[]{(byte) 0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a});
        writeChunk(out, "IHDR", ihdr);
        writeChunk(out, "IDAT", deflate(raw));
        writeChunk(out, "IEND", new byte[0]);
        return out.toByteArray();
    }

    private File makeZip() throws IOException {
        File zip = new File(ctx.getCacheDir(), "apng-src.zip");
        try (ZipOutputStream zos = new ZipOutputStream(new FileOutputStream(zip))) {
            zos.putNextEntry(new ZipEntry("frame_0.png"));
            zos.write(tinyPng(255, 0, 0));
            zos.closeEntry();
            zos.putNextEntry(new ZipEntry("frame_1.png"));
            zos.write(tinyPng(0, 255, 0));
            zos.closeEntry();
        }
        return zip;
    }

    private static final class Chunk {
        final String type;
        final byte[] data;

        Chunk(String type, byte[] data) {
            this.type = type;
            this.data = data;
        }
    }

    /** 解析 PNG/APNG chunk 并逐块校验 CRC */
    private static List<Chunk> parseChunks(byte[] png) {
        List<Chunk> out = new ArrayList<>();
        int off = 8;
        while (off + 12 <= png.length) {
            int len = readInt(png, off);
            String type = new String(png, off + 4, 4, StandardCharsets.US_ASCII);
            byte[] data = Arrays.copyOfRange(png, off + 8, off + 8 + len);
            CRC32 crc = new CRC32();
            crc.update(png, off + 4, 4 + len);
            int stored = readInt(png, off + 8 + len);
            assertEquals("chunk CRC 必须合法: " + type, (int) crc.getValue(), stored);
            out.add(new Chunk(type, data));
            off += 12 + len;
            if ("IEND".equals(type)) {
                break;
            }
        }
        return out;
    }

    private static int delayOf(Chunk fcTL) {
        return ((fcTL.data[20] & 0xff) << 8) | (fcTL.data[21] & 0xff);
    }

    @Test
    public void export_apng_buildsAnimationFromFramesJson() throws IOException {
        File src = makeZip();
        String frames = "[{\"file\":\"frame_0.png\",\"delay\":100},"
                + "{\"file\":\"frame_1.png\",\"delay\":200}]";
        File out = UgoiraExporter.export(ctx, src, "apng", "123", frames);
        assertEquals("123.apng", out.getName());
        List<Chunk> chunks = parseChunks(java.nio.file.Files.readAllBytes(out.toPath()));
        List<String> types = new ArrayList<>();
        for (Chunk c : chunks) {
            types.add(c.type);
        }
        assertEquals(Arrays.asList("IHDR", "acTL", "fcTL", "IDAT", "fcTL", "fdAT", "IEND"), types);
        assertEquals(2, readInt(chunks.get(1).data, 0)); // num_frames
        assertEquals(0, readInt(chunks.get(2).data, 0)); // 首个 fcTL 序号
        assertEquals(100, delayOf(chunks.get(2)));
        assertEquals(1, readInt(chunks.get(4).data, 0)); // 第二个 fcTL 序号
        assertEquals(200, delayOf(chunks.get(4)));
        assertEquals(2, readInt(chunks.get(5).data, 0)); // fdAT 序号
    }

    @Test
    public void export_apng_withoutFramesJson_fallsBackToDefaults() throws IOException {
        File src = makeZip();
        File out = UgoiraExporter.export(ctx, src, "apng", "123", null);
        List<Chunk> chunks = parseChunks(java.nio.file.Files.readAllBytes(out.toPath()));
        List<String> types = new ArrayList<>();
        for (Chunk c : chunks) {
            types.add(c.type);
        }
        assertTrue(types.contains("acTL"));
        assertTrue(types.contains("fdAT"));
        assertEquals(2, readInt(chunks.get(1).data, 0));
        assertEquals(100, delayOf(chunks.get(2)));
    }
}
