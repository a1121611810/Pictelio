package io.pictelio.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowContentResolver;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import okhttp3.OkHttpClient;

/**
 * GallerySaver MediaStore 路径单测（API 33；spec docs/specs/image-save-download.md §6）。
 *
 * <p>期望值来源（oracle）：spec §3 D1「Pictures/Pictelio + IS_PENDING 两段式」字面契约；
 * MediaProvider 用记录型假件（Robolectric registerProvider）——insert 收到的 ContentValues
 * 字段、写入字节、IS_PENDING 复位、insert 为 null 的失败路径全部可断言，
 * 不从被测实现反推（测试硬约束 #2/#6）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 33)
public class GallerySaverMediaStoreTest {

    private static final String URL =
            "https://i.pximg.net/img-original/img/2024/01/01/00/00/00/123456_p0.jpg";

    private Context context;
    private PixivImageLoader loader;
    private RecordingMediaStoreProvider provider;

    @Before
    public void setUp() {
        context = ApplicationProvider.getApplicationContext();
        loader = new PixivImageLoader(context, new OkHttpClient.Builder().build(), 1 << 20);
        provider = new RecordingMediaStoreProvider(context);
        Shadows.shadowOf(context.getContentResolver())
                .registerProviderInternal(MediaStore.AUTHORITY, provider);
    }

    private byte[] seedCache(byte[] bytes) throws IOException {
        PixivImageLoader.writeFile(
                new File(loader.getCacheDir(), PixivImageLoader.keyToFilename(URL)), bytes);
        return bytes;
    }

    @Test
    public void save_mediaStore_insertsPendingRecord_writesBytes_clearsPending() throws IOException {
        byte[] bytes = seedCache(new byte[]{1, 2, 3, 4, 5});

        GallerySaver.SaveResult r = GallerySaver.save(context, loader, URL, "Pictelio_123456_p0.jpg");

        assertTrue(r.mediaStore);
        assertEquals(1, provider.inserts.size());
        ContentValues values = provider.inserts.get(0);
        assertEquals("Pictelio_123456_p0.jpg", values.getAsString(MediaStore.MediaColumns.DISPLAY_NAME));
        assertEquals("image/jpeg", values.getAsString(MediaStore.MediaColumns.MIME_TYPE));
        assertEquals("Pictures/Pictelio", values.getAsString(MediaStore.MediaColumns.RELATIVE_PATH));
        assertEquals(Integer.valueOf(1), values.getAsInteger(MediaStore.MediaColumns.IS_PENDING));

        assertArrayEquals(bytes, provider.writtenBytes(r.uri));

        assertEquals(1, provider.updates.size());
        assertEquals(Integer.valueOf(0),
                provider.updates.get(0).getAsInteger(MediaStore.MediaColumns.IS_PENDING));
    }

    @Test
    public void save_mediaStore_insertReturnsNull_visibleFailure_noUpdate() throws IOException {
        seedCache(new byte[]{1});
        provider.failInsert = true;

        IOException e = assertThrows(IOException.class,
                () -> GallerySaver.save(context, loader, URL, "Pictelio_123456_p0.jpg"));
        assertTrue(e.getMessage().contains("媒体库"));
        assertEquals(0, provider.updates.size());
    }

    @Test
    public void save_mediaStore_writeFailure_deletesPendingRecord() throws IOException {
        seedCache(new byte[]{1});
        provider.failWrite = true;

        assertThrows(IOException.class,
                () -> GallerySaver.save(context, loader, URL, "Pictelio_123456_p0.jpg"));
        assertEquals(1, provider.deletes.size());
        assertEquals(0, provider.updates.size());
    }

    @Test
    public void save_mediaStore_pngUrl_getsPngMime() throws IOException {
        String pngUrl = "https://i.pximg.net/img-original/img/2024/01/01/00/00/00/42.png";
        PixivImageLoader.writeFile(
                new File(loader.getCacheDir(), PixivImageLoader.keyToFilename(pngUrl)), new byte[]{8});

        GallerySaver.save(context, loader, pngUrl, "Pictelio_42.png");

        assertEquals("image/png",
                provider.inserts.get(0).getAsString(MediaStore.MediaColumns.MIME_TYPE));
    }

    /** 记录型 MediaProvider 假件。字节断言走 ShadowContentResolver.registerOutputStreamSupplier
     *  （4.14 的 shadow openOutputStream 不路由 provider.openFile，这是官方注册通道）。 */
    private static final class RecordingMediaStoreProvider extends ContentProvider {
        final List<ContentValues> inserts = new ArrayList<>();
        final List<ContentValues> updates = new ArrayList<>();
        final List<Uri> deletes = new ArrayList<>();
        final Map<Uri, ByteArrayOutputStream> streamsByUri = new HashMap<>();
        boolean failInsert;
        boolean failWrite;
        private int nextId = 1;
        private final Context testContext;

        RecordingMediaStoreProvider(Context testContext) {
            this.testContext = testContext;
        }

        byte[] writtenBytes(Uri uri) {
            ByteArrayOutputStream stream = streamsByUri.get(uri);
            assertTrue("uri 未注册输出流", stream != null);
            return stream.toByteArray();
        }

        @Override
        public boolean onCreate() {
            return true;
        }

        @Override
        public Uri insert(Uri uri, ContentValues values) {
            if (failInsert) {
                return null;
            }
            inserts.add(new ContentValues(values));
            Uri out = Uri.parse("content://media/external_primary/images/media/" + nextId++);
            ByteArrayOutputStream stream = new ByteArrayOutputStream();
            streamsByUri.put(out, stream);
            Shadows.shadowOf(testContext.getContentResolver())
                    .registerOutputStreamSupplier(out, () -> {
                        if (failWrite) {
                            return new OutputStream() {
                                @Override
                                public void write(int b) throws IOException {
                                    throw new IOException("simulated write failure");
                                }

                                @Override
                                public void write(byte[] b, int off, int len) throws IOException {
                                    throw new IOException("simulated write failure");
                                }
                            };
                        }
                        return stream;
                    });
            return out;
        }

        @Override
        public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
            updates.add(new ContentValues(values));
            return 1;
        }

        @Override
        public int delete(Uri uri, String selection, String[] selectionArgs) {
            deletes.add(uri);
            return 1;
        }

        @Override
        public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs,
                String sortOrder) {
            return null;
        }

        @Override
        public String getType(Uri uri) {
            return "image/jpeg";
        }
    }
}
