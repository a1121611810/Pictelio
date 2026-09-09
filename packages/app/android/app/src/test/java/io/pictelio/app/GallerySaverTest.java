package io.pictelio.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import android.content.Context;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;

import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;

/**
 * GallerySaver 单测（spec docs/specs/image-save-download.md §6）——API 28 回退路径 + 纯函数契约。
 *
 * <p>期望值来源（oracle）：spec §3/§5 文件名/mime/目录字面规则；MediaStore 33 路径见
 * {@link GallerySaverMediaStoreTest}。缓存键契约（官方 URL 寻址）沿用 PixivImageLoaderTest
 * 的同款预置方式：先写缓存文件再走 save，断言零网络请求。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class GallerySaverTest {

    private static final String URL = "https://i.pximg.net/img-original/img/2024/01/01/00/00/00/123456_p0.jpg";

    private Context context;
    private PixivImageLoader loader;

    @Before
    public void setUp() {
        context = ApplicationProvider.getApplicationContext();
        loader = new PixivImageLoader(context, new OkHttpClient.Builder().build(), 1 << 20);
    }

    /** 预置缓存（官方 URL 寻址），返回写入的字节 */
    private byte[] seedCache(String url, byte[] bytes) throws IOException {
        PixivImageLoader.writeFile(new File(loader.getCacheDir(), PixivImageLoader.keyToFilename(url)), bytes);
        return bytes;
    }

    // ── 纯函数契约（spec §3 D1 字面规则） ─────────────────────

    @Test
    public void extFor_readsUrlTailExtension() {
        assertEquals("jpg", GallerySaver.extFor("https://i.pximg.net/a/b/1_p0.jpg"));
        assertEquals("png", GallerySaver.extFor("https://i.pximg.net/a/b/1.png"));
        assertEquals("jpeg", GallerySaver.extFor("https://i.pximg.net/a/b/1.JPEG"));
        assertEquals("gif", GallerySaver.extFor("https://i.pximg.net/a/b/1.gif"));
        assertEquals("webp", GallerySaver.extFor("https://i.pximg.net/a/b/1.webp"));
    }

    @Test
    public void extFor_stripsQueryAndDefaultsToJpg() {
        assertEquals("png", GallerySaver.extFor("https://i.pximg.net/a/b/1.png?x=1")); // query 剥离后读 ext
        assertEquals("jpg", GallerySaver.extFor("https://i.pximg.net/a/b/no-ext"));
        assertEquals("jpg", GallerySaver.extFor("https://i.pximg.net/a.b.com/dir")); // dot 不在文件段
    }

    @Test
    public void mimeFor_mapsWhitelistAndDefaultsJpeg() {
        assertEquals("image/jpeg", GallerySaver.mimeFor("Pictelio_1_p0.jpg"));
        assertEquals("image/jpeg", GallerySaver.mimeFor("Pictelio_1.jpeg"));
        assertEquals("image/png", GallerySaver.mimeFor("Pictelio_1.png"));
        assertEquals("image/gif", GallerySaver.mimeFor("Pictelio_1.gif"));
        assertEquals("image/webp", GallerySaver.mimeFor("Pictelio_1.webp"));
        assertEquals("image/jpeg", GallerySaver.mimeFor("Pictelio_1"));
    }

    @Test
    public void sanitizeFileName_stripsSeparatorsAndControlChars() throws IOException {
        assertEquals("Pictelio_1_p0.jpg", GallerySaver.sanitizeFileName("Pictelio_1_p0.jpg"));
        assertEquals("a_b_c.jpg", GallerySaver.sanitizeFileName("a/b\\c.jpg"));
        assertEquals("a__b.jpg", GallerySaver.sanitizeFileName("a\u0000\u001fb.jpg")); // 每个控制字符各换一个 _
        assertEquals("x.jpg", GallerySaver.sanitizeFileName("  x.jpg "));
        assertEquals("___", GallerySaver.sanitizeFileName("///")); // 全分隔符 → 全下划线（合法文件名）
    }

    @Test
    public void sanitizeFileName_emptyAfterClean_isVisibleFailure() {
        assertThrows(IOException.class, () -> GallerySaver.sanitizeFileName(""));
        assertThrows(IOException.class, () -> GallerySaver.sanitizeFileName("   "));
        assertThrows(IOException.class, () -> GallerySaver.sanitizeFileName(null));
    }

    // ── API 28 回退路径：app 专属外部目录 + bytes 一致 ─────────

    @Test
    public void save_api28Fallback_writesFileUnderAppExternalPictures() throws IOException {
        byte[] bytes = seedCache(URL, new byte[]{1, 2, 3, 4});

        GallerySaver.SaveResult r = GallerySaver.save(context, loader, URL, "Pictelio_123456_p0.jpg");

        assertFalse(r.mediaStore);
        File expectedDir = new File(
                context.getExternalFilesDir(android.os.Environment.DIRECTORY_PICTURES), "Pictelio");
        File expected = new File(expectedDir, "Pictelio_123456_p0.jpg");
        assertEquals(expected.getAbsolutePath(), new File(r.uri.getPath()).getAbsolutePath());
        assertArrayEquals(bytes, Files.readAllBytes(expected.toPath()));
    }

    @Test
    public void save_api28Fallback_pathTraversalInFileName_isNeutralized() throws IOException {
        seedCache(URL, new byte[]{9});

        GallerySaver.SaveResult r = GallerySaver.save(context, loader, URL, "../evil.jpg");

        File dir = new File(
                context.getExternalFilesDir(android.os.Environment.DIRECTORY_PICTURES), "Pictelio");
        // 分隔符被替换为下划线，文件必须落在 Pictelio 目录内
        assertTrue(new File(r.uri.getPath()).getAbsolutePath()
                .startsWith(dir.getAbsolutePath() + File.separator));
        assertTrue(new File(r.uri.getPath()).getName().endsWith("_evil.jpg"));
    }

    @Test
    public void save_cacheMiss_downloadsFromOfficialUrl() throws IOException {
        try (MockWebServer server = new MockWebServer()) {
            server.start();
            server.enqueue(new MockResponse().setBody(new okio.Buffer().write(new byte[]{5, 6, 7})));
            String missUrl = server.url("/img-original/999_p1.jpg").toString();

            GallerySaver.SaveResult r = GallerySaver.save(context, loader, missUrl,
                    "Pictelio_999_p1.jpg");

            assertEquals(1, server.getRequestCount()); // 下载恰一次（图床关 → 官方单请求）
            File dest = new File(context.getExternalFilesDir(
                    android.os.Environment.DIRECTORY_PICTURES), "Pictelio/Pictelio_999_p1.jpg");
            assertArrayEquals(new byte[]{5, 6, 7}, Files.readAllBytes(dest.toPath()));
        }
    }

    @Test
    public void save_downloadFailure_propagatesReadableError() throws IOException {
        try (MockWebServer server = new MockWebServer()) {
            server.start();
            server.enqueue(new MockResponse().setResponseCode(404));
            String badUrl = server.url("/img-original/404_p0.jpg").toString();

            IOException e = assertThrows(IOException.class,
                    () -> GallerySaver.save(context, loader, badUrl, "Pictelio_404_p0.jpg"));
            assertTrue(e.getMessage().contains("404"));
        }
    }

    @Test
    public void save_blankUrl_visibleFailure() {
        assertThrows(IOException.class, () -> GallerySaver.save(context, loader, "", "a.jpg"));
    }
}
