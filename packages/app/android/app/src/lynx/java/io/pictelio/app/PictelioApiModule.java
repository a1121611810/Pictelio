package io.pictelio.app;

import android.content.Context;
import android.util.Log;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Pixiv API 转发 Native Module（#53）——access_token Java 堆隔离，JS 零知。
 *
 * <p>JS 侧访问：{@code NativeModules.PictelioApi}。
 * 回调契约（Callback.invoke；无 null）：
 * <ul>
 *   <li>{@code request(method, path, body, cb)}：cb(status, data, rotatedToken)——status 为
 *       HTTP 状态码（int），data 为响应体字符串（JSON），rotatedToken 为 401 刷新轮换后的
 *       refresh_token（未轮换为空串）；网络/转发异常 cb(0, errMsg, "")。2xx = 成功。
 *       Java 侧附加 Bearer + Referer/UA + 401 刷新</li>
 * </ul>
 *
 * <p>#130：request 异步化——同步 OkHttp 最长 45s（CONNECT 15s + READ 30s），
 * 不再占用 Lynx 调用线程；网络请求跑在模块内线程池，完成后直接回调
 * （Lynx Callback 自行派发回 JS 线程，与 PictelioAuthModule / PictelioSecureStorageModule
 * 同款模式）。
 */
public class PictelioApiModule extends LynxModule {

    private static final String TAG = "PictelioApiModule";

    private static final String API_BASE = PixivApiCore.apiBase();

    /** #130：API 转发线程池。executeRequest 为阻塞 IO（CONNECT 15s + READ 30s），
     * 不能占用 Lynx 调用线程；newCachedThreadPool 无固定上限、按请求伸缩
     * （与 PictelioImageService 同款模式），空闲线程自动回收。 */
    private static final ExecutorService API_EXECUTOR = Executors.newCachedThreadPool();

    public PictelioApiModule(Context context) {
        super(context);
    }

    private Context appContext() {
        return ((LynxContext) mContext).getContext();
    }

    /**
     * 【PROTOTYPE 方案 C】Java 解压写盘（zoomed: 原型验证，非生产路径）：
     * 下载 zip → ZipInputStream 解压 → 写 cache/ugoira-proto/frame_N.{ext} →
     * 回调帧 file:// URL 列表（JSON 数组字符串）。
     * 回调契约：cb(0, JSON) 成功；cb(1, errMsg) 失败。
     */
    @LynxMethod
    public void protoExtractUgoira(String zipUrl, String namesJson, Callback callback) {
        API_EXECUTOR.execute(() -> {
            try {
                okhttp3.Request req = new okhttp3.Request.Builder()
                        .url(zipUrl)
                        .addHeader("Referer", io.pictelio.app.config.OAuthConfig.REFERER)
                        .addHeader("User-Agent", io.pictelio.app.config.OAuthConfig.USER_AGENT)
                        .get()
                        .build();
                byte[] zipBytes;
                try (okhttp3.Response resp = PixivApiCore.getSharedClient().newCall(req).execute()) {
                    if (!resp.isSuccessful()) {
                        callback.invoke(1, "HTTP " + resp.code());
                        return;
                    }
                    try (okhttp3.ResponseBody rb = resp.body()) {
                        zipBytes = rb != null ? rb.bytes() : new byte[0];
                    }
                }
                java.io.File dir = new java.io.File(appContext().getCacheDir(), "ugoira-proto");
                if (!dir.exists() && !dir.mkdirs()) {
                    callback.invoke(1, "无法创建缓存目录");
                    return;
                }
                // namesJson：帧文件名顺序 ["a.png","b.jpg",...]（与 meta.frames 同序）
                org.json.JSONArray names = new org.json.JSONArray(namesJson);
                java.util.Map<String, java.util.zip.ZipEntry> entries =
                        new java.util.HashMap<>();
                java.util.zip.ZipInputStream zis = new java.util.zip.ZipInputStream(
                        new java.io.ByteArrayInputStream(zipBytes));
                java.util.zip.ZipEntry entry;
                while ((entry = zis.getNextEntry()) != null) {
                    if (!entry.isDirectory()) entries.put(entry.getName(), entry);
                }
                zis.close();
                org.json.JSONArray urls = new org.json.JSONArray();
                for (int i = 0; i < names.length(); i++) {
                    String name = names.getString(i);
                    java.util.zip.ZipEntry ze = entries.get(name);
                    if (ze == null) {
                        callback.invoke(1, "zip 缺少帧文件: " + name);
                        return;
                    }
                    String ext = name.toLowerCase().endsWith(".png") ? "png" : "jpg";
                    java.io.File out = new java.io.File(dir, "frame_" + i + "." + ext);
                    try (java.util.zip.ZipInputStream zis2 = new java.util.zip.ZipInputStream(
                            new java.io.ByteArrayInputStream(zipBytes))) {
                        java.util.zip.ZipEntry cur;
                        byte[] buf = new byte[65536];
                        int n;
                        try (java.io.FileOutputStream fos = new java.io.FileOutputStream(out)) {
                            while ((cur = zis2.getNextEntry()) != null) {
                                if (!cur.getName().equals(name)) continue;
                                while ((n = zis2.read(buf)) > 0) fos.write(buf, 0, n);
                                break;
                            }
                        }
                    }
                    urls.put("file://" + out.getAbsolutePath());
                }
                Log.i(TAG, "[proto] extractUgoira 帧写盘完成: " + urls.length() + " 帧 → callback.invoke");
                callback.invoke(0, urls.toString());
                Log.i(TAG, "[proto] extractUgoira callback.invoke 已返回");
            } catch (Throwable e) {
                Log.w(TAG, "[proto] extractUgoira 失败: " + zipUrl, e);
                callback.invoke(1, e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
            }
        });
    }

    /**
     * 【PROTOTYPE 方案 B】Java 网关下载：JS 传绝对 URL，Java 侧 OkHttp 下载
     * 字节（注入 Referer/UA），base64 回传 JS（原型验证用，非生产路径）。
     * 回调契约：cb(0, base64) 成功；cb(1, errMsg) 失败。
     */
    @LynxMethod
    public void protoDownloadFile(String url, Callback callback) {
        API_EXECUTOR.execute(() -> {
            try {
                okhttp3.Request req = new okhttp3.Request.Builder()
                        .url(url)
                        .addHeader("Referer", io.pictelio.app.config.OAuthConfig.REFERER)
                        .addHeader("User-Agent", io.pictelio.app.config.OAuthConfig.USER_AGENT)
                        .get()
                        .build();
                try (okhttp3.Response resp = PixivApiCore.getSharedClient().newCall(req).execute()) {
                    if (!resp.isSuccessful()) {
                        callback.invoke(1, "HTTP " + resp.code());
                        return;
                    }
                    byte[] bytes;
                    try (okhttp3.ResponseBody rb = resp.body()) {
                        bytes = rb != null ? rb.bytes() : new byte[0];
                    }
                    callback.invoke(0, android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP));
                }
            } catch (Throwable e) {
                Log.w(TAG, "[proto] downloadFile 失败: " + url, e);
                callback.invoke(1, e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
            }
        });
    }

    /**
     * API 转发：JS 传 method + path（可含 query 字符串）+ body；
     * Java 侧拼完整 URL、附加 Bearer/Referer/UA，401 自动刷新重试一次。
     * 回调第三参为 401 刷新轮换后的 refresh_token（未轮换为空串），供 JS 持久化。
     *
     * <p>#130：异步执行——提交线程池后立即返回，网络与回调在 worker 线程完成。
     */
    @LynxMethod
    public void request(String method, String path, String body, Callback callback) {
        String url = API_BASE + (path == null || path.startsWith("/") ? "" : "/")
                + (path == null ? "" : path);
        final String[] rotated = {""};
        API_EXECUTOR.execute(() -> {
            try {
                JSONObject result = PixivApiCore.executeRequest(method, url, body, false,
                        token -> rotated[0] = token);
                callback.invoke(result.optInt("status", 0), result.optString("data", ""), rotated[0]);
            } catch (Throwable e) {
                Log.w(TAG, "request 失败: " + method + " " + path, e);
                // 回调契约无 null：getMessage 为空时降级为异常类名
                String errMsg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                callback.invoke(0, errMsg, "");
            }
        });
    }
}
