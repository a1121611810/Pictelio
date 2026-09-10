package io.pictelio.app;

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
