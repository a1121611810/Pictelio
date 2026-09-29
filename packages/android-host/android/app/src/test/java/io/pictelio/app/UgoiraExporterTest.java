package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import android.content.ContentValues;
import android.content.Context;
import android.provider.MediaStore;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * UgoiraExporter 单测（spec docs/specs/download-manager.md §6）：
 * ZIP 原样拷贝、TAR ustar 打包（512 对齐/魔数/校验和）、未知格式拒绝、
 * saveDownloadFile API 28 回退落盘、Downloads values 契约与归档 mime。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class UgoiraExporterTest {

    private final Context ctx = ApplicationProvider.getApplicationContext();

    private File makeZip() throws IOException {
        File zip = new File(ctx.getCacheDir(), "src-ugoira.zip");
        try (ZipOutputStream zos = new ZipOutputStream(new FileOutputStream(zip))) {
            zos.putNextEntry(new ZipEntry("frame_0.png"));
            zos.write("AAAA".getBytes(StandardCharsets.UTF_8));
            zos.closeEntry();
            zos.putNextEntry(new ZipEntry("frame_1.png"));
            zos.write("BBBBBB".getBytes(StandardCharsets.UTF_8));
            zos.closeEntry();
        }
        return zip;
    }

    @Test
    public void export_zip_copiesSource() throws IOException {
        File src = makeZip();
        File out = UgoiraExporter.export(ctx, src, "zip", "123", null);
        assertEquals("123.zip", out.getName());
        assertEquals(src.length(), out.length());
    }

    @Test
    public void export_tar_packsEntriesBlockAligned() throws IOException {
        File src = makeZip();
        File out = UgoiraExporter.export(ctx, src, "tar", "123", null);
        byte[] bytes = java.nio.file.Files.readAllBytes(out.toPath());
        assertEquals(0, bytes.length % 512);
        String name = new String(bytes, 0, 100, StandardCharsets.UTF_8);
        assertTrue("首个条目应为 frame_0.png: " + name, name.startsWith("frame_0.png"));
        assertEquals('0', (char) bytes[156]);
        assertEquals("ustar", new String(bytes, 257, 5, StandardCharsets.US_ASCII));
        // 校验和按「校验和字段视作空格」重算（tar 规范），再与存储值比对
        int sum = 0;
        for (int i = 0; i < 512; i++) {
            sum += (i >= 148 && i < 156) ? ' ' : (bytes[i] & 0xff);
        }
        String octal = new String(bytes, 148, 7, StandardCharsets.US_ASCII).trim();
        assertEquals(sum, Integer.parseInt(octal, 8));
    }

    @Test
    public void export_unknownFormat_throws() throws IOException {
        File src = makeZip();
        assertThrows(IOException.class, () -> UgoiraExporter.export(ctx, src, "mp4", "1", null));
    }

    @Test
    public void saveDownloadFile_api28_writesToExternalDownloads() throws IOException {
        File src = new File(ctx.getCacheDir(), "art.zip");
        java.nio.file.Files.write(src.toPath(), "z".getBytes(StandardCharsets.UTF_8));
        GallerySaver.SaveResult r = GallerySaver.saveDownloadFile(ctx, src, "Pictelio_1.zip");
        assertTrue("API 28 回退应为 file:// : " + r.uri, r.uri.toString().startsWith("file://"));
        File saved = new File(r.uri.getPath());
        assertTrue(saved.exists());
        assertEquals("Pictelio_1.zip", saved.getName());
    }

    @Test
    public void buildDownloadValues_contract() {
        ContentValues v = GallerySaver.buildDownloadValues("a.zip", "application/zip");
        assertEquals("a.zip", v.getAsString(MediaStore.MediaColumns.DISPLAY_NAME));
        assertEquals("application/zip", v.getAsString(MediaStore.MediaColumns.MIME_TYPE));
        assertEquals(1, (int) v.getAsInteger(MediaStore.MediaColumns.IS_PENDING));
    }

    @Test
    public void mimeFor_archivesAndVideo() {
        assertEquals("application/zip", GallerySaver.mimeFor("Pictelio_1.zip"));
        assertEquals("application/x-tar", GallerySaver.mimeFor("Pictelio_1.tar"));
        assertEquals("video/mp4", GallerySaver.mimeFor("Pictelio_1.mp4"));
        assertEquals("image/png", GallerySaver.mimeFor("Pictelio_1.apng"));
        assertEquals("image/jpeg", GallerySaver.mimeFor("Pictelio_1"));
    }
}
