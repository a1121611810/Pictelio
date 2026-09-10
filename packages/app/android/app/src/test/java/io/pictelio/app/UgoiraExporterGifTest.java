package io.pictelio.app;

import static org.junit.Assert.assertEquals;

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
import java.util.zip.CRC32;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * UgoiraExporter GIF 端到端单测（spec §6）：ZIP(PNG 帧) → GIF，用 {@link GifDecode} 校验结构。
 * 像素颜色正确性由 GifEncoderTest 覆盖（Robolectric BitmapFactory 阴影像素不足）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class UgoiraExporterGifTest {

    private final Context ctx = ApplicationProvider.getApplicationContext();

    private static void putInt(byte[] b, int off, int v) {
        b[off] = (byte) (v >>> 24);
        b[off + 1] = (byte) (v >>> 16);
        b[off + 2] = (byte) (v >>> 8);
        b[off + 3] = (byte) v;
    }

    private static void writeChunk(OutputStream out, String type, byte[] data) throws IOException {
        byte[] typeBytes = type.getBytes(java.nio.charset.StandardCharsets.US_ASCII);
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

    private static byte[] tinyPng(int r, int g, int b) throws IOException {
        byte[] ihdr = new byte[13];
        putInt(ihdr, 0, 1);
        putInt(ihdr, 4, 1);
        ihdr[8] = 8;
        ihdr[9] = 6;
        byte[] raw = {0, (byte) r, (byte) g, (byte) b, (byte) 255};
        Deflater d = new Deflater();
        d.setInput(raw);
        d.finish();
        byte[] buf = new byte[256];
        int n = d.deflate(buf);
        d.end();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(new byte[]{(byte) 0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a});
        writeChunk(out, "IHDR", ihdr);
        writeChunk(out, "IDAT", java.util.Arrays.copyOf(buf, n));
        writeChunk(out, "IEND", new byte[0]);
        return out.toByteArray();
    }

    private File makeZip() throws IOException {
        File zip = new File(ctx.getCacheDir(), "gif-src.zip");
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

    @Test
    public void export_gif_twoFrames_decodable() throws Exception {
        File src = makeZip();
        String frames = "[{\"file\":\"frame_0.png\",\"delay\":100},"
                + "{\"file\":\"frame_1.png\",\"delay\":200}]";
        File out = UgoiraExporter.export(ctx, src, "gif", "123", frames);
        assertEquals("123.gif", out.getName());
        GifDecode.Result r = GifDecode.decode(java.nio.file.Files.readAllBytes(out.toPath()));
        assertEquals(2, r.frames.size());
        assertEquals(10, (int) r.delays.get(0));
        assertEquals(20, (int) r.delays.get(1));
    }
}
