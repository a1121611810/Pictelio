package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * ShareHelper 单测（spec docs/specs/download-manager.md §4.1/§7）：
 * mime 白名单、单/多条 Intent 构造与授权、空/非法 uri、file:// → FileProvider content://。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class ShareHelperTest {

    private final Context ctx = ApplicationProvider.getApplicationContext();

    @Test
    public void mimeForName_whitelist() {
        assertEquals("image/jpeg", ShareHelper.mimeForName("a.jpg"));
        assertEquals("image/jpeg", ShareHelper.mimeForName("a.JPEG"));
        assertEquals("image/png", ShareHelper.mimeForName("a.png"));
        assertEquals("image/png", ShareHelper.mimeForName("a.apng"));
        assertEquals("image/gif", ShareHelper.mimeForName("a.gif"));
        assertEquals("image/webp", ShareHelper.mimeForName("a.webp"));
        assertEquals("video/mp4", ShareHelper.mimeForName("a.mp4"));
        assertEquals("application/zip", ShareHelper.mimeForName("a.zip"));
        assertEquals("application/x-tar", ShareHelper.mimeForName("a.tar"));
        assertEquals("application/octet-stream", ShareHelper.mimeForName("a.bin"));
        assertEquals("application/octet-stream", ShareHelper.mimeForName("noext"));
        assertEquals("application/octet-stream", ShareHelper.mimeForName(null));
    }

    /** 小说导出文档 MIME（ADR-0154 D4 / spec §3.3 D4）：9 项逐一锚定。 */
    @Test
    public void mimeForName_documentFormats() {
        assertEquals("text/plain", ShareHelper.mimeForName("Pictelio_1.txt"));
        assertEquals("text/html", ShareHelper.mimeForName("Pictelio_1.html"));
        assertEquals("text/markdown", ShareHelper.mimeForName("Pictelio_1.md"));
        assertEquals("application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ShareHelper.mimeForName("Pictelio_1.docx"));
        assertEquals("application/pdf", ShareHelper.mimeForName("Pictelio_1.pdf"));
        assertEquals("application/epub+zip", ShareHelper.mimeForName("Pictelio_1.epub"));
        assertEquals("application/rtf", ShareHelper.mimeForName("Pictelio_1.rtf"));
        assertEquals("application/json", ShareHelper.mimeForName("Pictelio_1.json"));
        assertEquals("application/x-fictionbook+xml", ShareHelper.mimeForName("Pictelio_1.fb2"));
    }

    @Test
    public void buildIntent_single_send() throws IOException {
        Intent intent = ShareHelper.buildIntent(ctx,
                Collections.singletonList("content://media/external/images/media/1"), "image/jpeg");
        assertEquals(Intent.ACTION_SEND, intent.getAction());
        assertEquals("image/jpeg", intent.getType());
        assertTrue((intent.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0);
        assertNotNull(intent.getParcelableExtra(Intent.EXTRA_STREAM));
    }

    @Test
    public void buildIntent_multiple_sendMultiple() throws IOException {
        List<String> uris = new ArrayList<>();
        uris.add("content://media/external/images/media/1");
        uris.add("content://media/external/images/media/2");
        Intent intent = ShareHelper.buildIntent(ctx, uris, "image/jpeg");
        assertEquals(Intent.ACTION_SEND_MULTIPLE, intent.getAction());
        ArrayList<Uri> extra = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
        assertNotNull(extra);
        assertEquals(2, extra.size());
    }

    @Test
    public void buildIntent_emptyOrNull_throws() {
        assertThrows(IOException.class, () -> ShareHelper.buildIntent(ctx, new ArrayList<>(), null));
        assertThrows(IOException.class, () -> ShareHelper.buildIntent(ctx, null, null));
    }

    @Test
    public void buildIntent_unsupportedScheme_throws() {
        assertThrows(IOException.class,
                () -> ShareHelper.buildIntent(ctx, Collections.singletonList("https://x/y.jpg"), null));
    }

    @Test
    public void toShareableUri_fileScheme_convertedViaFileProvider() throws IOException {
        File f = new File(ctx.getCacheDir(), "share-me.jpg");
        java.nio.file.Files.write(f.toPath(), "x".getBytes(StandardCharsets.UTF_8));
        Uri shareable = ShareHelper.toShareableUri(ctx, Uri.fromFile(f).toString());
        assertEquals("content", shareable.getScheme());
        assertTrue("authority 应为 <pkg>.fileprovider: " + shareable.getAuthority(),
                shareable.getAuthority().contains(".fileprovider"));
    }
}
