package io.pictelio.app;

import io.pictelio.app.config.OAuthConfig;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.Arrays;
import java.util.Comparator;

/**
 * 将 Pixiv 图片缓存在应用内部存储目录，使冷启动后无需重新下载。
 *
 * 缓存目录：context.getCacheDir()/{cacheDir}/
 * 淘汰策略：总大小超过 getMaxCacheBytes() 返回值时，删除最旧访问的文件
 * 文件名：Base64URL-safe 编码的 URL key（不含 padding）
 */
@CapacitorPlugin(name = "ImageCache")
public class ImageCachePlugin extends Plugin {

    private static final String TAG = "ImageCachePlugin";

    private long getMaxCacheBytes() {
        try {
            SharedPreferences prefs = getContext().getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
            String val = prefs.getString("image_cache_disk_size", null);
            if (val != null) {
                long mb = Long.parseLong(val);
                return mb * 1024 * 1024;
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to read image_cache_disk_size, using default", e);
        }
        return OAuthConfig.CACHE_MAX_BYTES;
    }

    private File getCacheDir() {
        File dir = new File(getContext().getCacheDir(), OAuthConfig.CACHE_DIR);
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    /** 将 key 编码为安全的文件名（Base64URL safe, no padding） */
    private String keyToFilename(String key) {
        return Base64.encodeToString(key.getBytes(), Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    }

    /** 将文件名解码回 key */
    private String filenameToKey(String filename) {
        return new String(Base64.decode(filename, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP));
    }

    @PluginMethod
    public void saveImage(PluginCall call) {
        String key = call.getString("key");
        String base64 = call.getString("base64");
        if (key == null || base64 == null) {
            call.reject("key and base64 are required");
            return;
        }

        try {
            byte[] data = Base64.decode(base64, Base64.DEFAULT);
            File file = new File(getCacheDir(), keyToFilename(key));
            try (FileOutputStream fos = new FileOutputStream(file)) {
                fos.write(data);
            }

            // 淘汰超限缓存
            enforceCacheLimit();

            JSObject ret = new JSObject();
            ret.put("path", file.getAbsolutePath());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "saveImage failed", e);
            call.reject("saveImage failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getImage(PluginCall call) {
        String key = call.getString("key");
        if (key == null) {
            call.reject("key is required");
            return;
        }

        try {
            File file = new File(getCacheDir(), keyToFilename(key));
            if (!file.exists()) {
                call.resolve(new JSObject());
                return;
            }

            // 更新文件的最后访问时间（touch）
            file.setLastModified(System.currentTimeMillis());

            try (FileInputStream fis = new FileInputStream(file);
                 ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                int read;
                while ((read = fis.read(buf)) != -1) {
                    bos.write(buf, 0, read);
                }
                String base64 = Base64.encodeToString(bos.toByteArray(), Base64.DEFAULT);

                JSObject ret = new JSObject();
                ret.put("base64", base64);
                call.resolve(ret);
            }
        } catch (Exception e) {
            Log.e(TAG, "getImage failed", e);
            call.reject("getImage failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getCachedKeys(PluginCall call) {
        try {
            File[] files = getCacheDir().listFiles();
            JSArray keys = new JSArray();
            if (files != null) {
                // 按最后修改时间排序，最新的在后
                Arrays.sort(files, Comparator.comparingLong(File::lastModified));
                for (File f : files) {
                    if (f.isFile()) {
                        keys.put(filenameToKey(f.getName()));
                    }
                }
            }
            JSObject ret = new JSObject();
            ret.put("keys", keys);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "getCachedKeys failed", e);
            call.reject("getCachedKeys failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void clearCache(PluginCall call) {
        try {
            File[] files = getCacheDir().listFiles();
            if (files != null) {
                for (File f : files) {
                    f.delete();
                }
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "clearCache failed", e);
            call.reject("clearCache failed: " + e.getMessage());
        }
    }

    /** 淘汰最旧文件直到低于容量上限 */
    private void enforceCacheLimit() {
        File cacheDir = getCacheDir();
        File[] files = cacheDir.listFiles();
        if (files == null) return;

        long total = 0;
        for (File f : files) {
            total += f.length();
        }

        if (total <= getMaxCacheBytes()) return;

        // 按最后修改时间升序（最旧在前）
        Arrays.sort(files, Comparator.comparingLong(File::lastModified));

        for (File f : files) {
            if (total <= getMaxCacheBytes()) break;
            total -= f.length();
            f.delete();
        }
    }
}
