package io.pictelio.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.net.Uri;

import androidx.test.core.app.ApplicationProvider;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;

/**
 * PictelioDownloader 下载队列执行器单测（spec docs/specs/download-manager.md §4.3）：
 * 下载落盘 + 进度、输入校验、取消登记表、删除文件（content/file/非法 scheme）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class PictelioDownloaderTest {

    private MockWebServer server;
    private PixivImageLoader loader;
    private Context ctx;

    @Before
    public void setUp() throws IOException {
        server = new MockWebServer();
        server.start();
        ctx = ApplicationProvider.getApplicationContext();
        loader = new PixivImageLoader(ctx, new OkHttpClient.Builder().build(), 10_000_000L);
    }

    @After
    public void tearDown() throws IOException {
        server.shutdown();
    }

    @Test
    public void download_savesAndReportsProgress() throws IOException {
        byte[] body = new byte[150_000];
        for (int i = 0; i < body.length; i++) {
            body[i] = (byte) (i % 251);
        }
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(body)));
        String url = server.url("/pixiv-img/dl.jpg").toString();

        List<long[]> reports = new ArrayList<>();
        String uri = PictelioDownloader.download(ctx, loader, "task-1", url, "Pictelio_1_p0.jpg",
                (done, total) -> reports.add(new long[]{done, total}));

        assertTrue("API 28 回退路径应返回 file:// : " + uri, uri.startsWith("file://"));
        File saved = new File(Uri.parse(uri).getPath());
        assertTrue(saved.exists());
        assertEquals(150_000, saved.length());
        assertFalse(reports.isEmpty());
        assertEquals(150_000, reports.get(reports.size() - 1)[0]);
    }

    // ── dir 作者目录段（ADR-0192 D4/D7 / spec docs/specs/lynx-download-naming.md D5/D7）──
    // oracle = 基座常量 Pictures/Pictelio（API 28 回退 = getExternalFilesDir(Pictures)/Pictelio）
    // 与 Downloads/Pictelio（getExternalFilesDir(Downloads)/Pictelio）；空串/缺省 = 现行为字节不变。

    @Test
    public void download_authorDir_landsUnderPicturesPictelioAuthor() throws IOException {
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(new byte[]{1, 2})));
        String url = server.url("/img-original/dir_p0.jpg").toString();

        String uri = PictelioDownloader.download(ctx, loader, "task-dir", url,
                "Pictelio_2_p0.jpg", "画师名", null);

        File base = new File(ctx.getExternalFilesDir(android.os.Environment.DIRECTORY_PICTURES), "Pictelio");
        File expected = new File(new File(base, "画师名"), "Pictelio_2_p0.jpg");
        assertEquals(expected.getAbsolutePath(), new File(Uri.parse(uri).getPath()).getAbsolutePath());
        assertTrue(expected.exists());
    }

    @Test
    public void download_emptyDir_keepsLegacyDirectory() throws IOException {
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(new byte[]{3})));
        String url = server.url("/img-original/legacy_p0.jpg").toString();

        String uri = PictelioDownloader.download(ctx, loader, "task-legacy", url,
                "Pictelio_3_p0.jpg", "", null);

        File expected = new File(new File(
                ctx.getExternalFilesDir(android.os.Environment.DIRECTORY_PICTURES), "Pictelio"),
                "Pictelio_3_p0.jpg");
        assertEquals(expected.getAbsolutePath(), new File(Uri.parse(uri).getPath()).getAbsolutePath());
    }

    @Test
    public void downloadUgoira_authorDir_landsUnderDownloadsPictelioAuthor() throws IOException {
        // 导出格式 zip = 原样拷贝源字节（UgoiraExporter copyFile），任意字节即可
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(new byte[]{4, 5, 6})));
        String zipUrl = server.url("img-zip-ugoira/123.zip").toString();

        String uri = PictelioDownloader.downloadUgoira(ctx, loader, "ugoira-dir", zipUrl,
                "zip", "Pictelio_4.zip", "画师名", "", null);

        File base = new File(ctx.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS), "Pictelio");
        File expected = new File(new File(base, "画师名"), "Pictelio_4.zip");
        assertEquals(expected.getAbsolutePath(), new File(Uri.parse(uri).getPath()).getAbsolutePath());
        assertArrayEquals(new byte[]{4, 5, 6}, java.nio.file.Files.readAllBytes(expected.toPath()));
    }

    @Test
    public void downloadUgoira_emptyDir_keepsLegacyDirectory() throws IOException {
        server.enqueue(new MockResponse().setResponseCode(200).setBody(new okio.Buffer().write(new byte[]{7})));
        String zipUrl = server.url("img-zip-ugoira/124.zip").toString();

        String uri = PictelioDownloader.downloadUgoira(ctx, loader, "ugoira-legacy", zipUrl,
                "zip", "Pictelio_5.zip", "", "", null);

        File expected = new File(new File(
                ctx.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS), "Pictelio"),
                "Pictelio_5.zip");
        assertEquals(expected.getAbsolutePath(), new File(Uri.parse(uri).getPath()).getAbsolutePath());
    }

    @Test
    public void download_rejectsEmptyInputs() {
        assertThrows(IOException.class,
                () -> PictelioDownloader.download(ctx, loader, "", "u", "f", null));
        assertThrows(IOException.class,
                () -> PictelioDownloader.download(ctx, loader, "id", "", "f", null));
        assertThrows(IOException.class,
                () -> PictelioDownloader.download(ctx, loader, "id", "u", "", null));
    }

    @Test
    public void cancel_unknownTask_returnsFalse() {
        assertFalse(PictelioDownloader.cancel("nope"));
        assertFalse(PictelioDownloader.cancel(null));
    }

    @Test
    public void deleteFile_rejectsUnsupportedUri() {
        assertThrows(IOException.class, () -> PictelioDownloader.deleteFile(ctx, "https://x/y.jpg"));
        assertThrows(IOException.class, () -> PictelioDownloader.deleteFile(ctx, ""));
    }

    @Test
    public void deleteFile_fileScheme_deletesAndIsIdempotent() throws IOException {
        File tmp = new File(ctx.getCacheDir(), "delete-me.jpg");
        java.nio.file.Files.write(tmp.toPath(), "x".getBytes(StandardCharsets.UTF_8));
        assertTrue(tmp.exists());
        PictelioDownloader.deleteFile(ctx, Uri.fromFile(tmp).toString());
        assertFalse(tmp.exists());
        // 幂等：再次删除不抛（文件已不存在视为成功）
        PictelioDownloader.deleteFile(ctx, Uri.fromFile(tmp).toString());
    }
}
