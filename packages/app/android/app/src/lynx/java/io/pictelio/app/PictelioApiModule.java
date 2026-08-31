package io.pictelio.app;

import android.content.Context;
import android.util.Log;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import io.pictelio.app.config.OAuthConfig;
import okhttp3.Request;
import okhttp3.Response;

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
 *   <li>{@code ugoiraExtract(zipUrl, framesJson, cb)}：cb(code, payload)——code 0 = 成功，
 *       payload 为帧 file:// URL 的 JSON 数组字符串（按 framesJson 时序，与 zip 条目名匹配）；
 *       code 1 = 失败，payload 为可读错误信息（HTTP 码 / zip 损坏 / 缺帧 / IO 错误）。
 *       ZIP 下载注入 Referer + User-Agent（仅接受 https://，防 scheme 注入）；帧写入
 *       {@code cache/ugoira/frame_N.{png|jpg}}（扩展名由 zip 条目名后缀判定，.png 否则 .jpg）；
 *       写盘前执行 LRU 式缓存清理（文件数 > 300 或总大小 > 50MB 时按 lastModified 删最旧帧）。</li>
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

    /** ugoira 缓存清理：文件数上限——超过则按 lastModified 删除最旧帧 */
    private static final long UGOIRA_MAX_COUNT = 300;

    /** ugoira 缓存清理：总大小上限（50MB）——超过则按 lastModified 删除最旧帧 */
    private static final long UGOIRA_MAX_BYTES = 50L * 1024 * 1024;

    public PictelioApiModule(Context context) {
        super(context);
    }

    private Context appContext() {
        return ((LynxContext) mContext).getContext();
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

    /**
     * ugoira 解压写盘（ADR-0125，正式实现，替代原型 ProtoExtractUgoira）：Java 下载 zip →
     * 单次扫描解压 → 按 framesJson 时序写帧到 {@code cache/ugoira/frame_N.{png|jpg}} →
     * 回传帧 file:// URL 列表。
     *
     * <p>与原型差异（硬化点）：
     * <ul>
     *   <li>zip 条目只全量扫描<b>一次</b>（原型每个帧重新创建 ZipInputStream 全量扫描 52 次，
     *       低效）；扫描结果按「条目名 → 帧字节」缓存，再按 framesJson 顺序逐帧输出</li>
     *   <li>{@code https://} 白名单（防 file:// 等 scheme 注入）</li>
     *   <li>写盘前 LRU 式缓存清理（数 < 300 / 大小 &lt; 50MB）</li>
     *   <li>帧文件名与 zip 条目名匹配，扩展名由条目名后缀判定（.png 否则 .jpg）</li>
     * </ul>
     *
     * <p>回调：{@code cb(0, jsonUrls)} 成功；{@code cb(1, errMsg)} 失败（errMsg 可读：
     * HTTP 码 / zip 损坏 / 缺帧 / IO 错误；为空时降级异常类名）。异步执行于 {@link #API_EXECUTOR}。
     *
     * @param zipUrl     绝对 https URL（ugoira zip）
     * @param framesJson {@code meta.frames} JSON 数组字符串（服务端时序），
     *                   如 {@code [{"file":"a.png","delay":125},...]}
     */
    @LynxMethod
    public void ugoiraExtract(String zipUrl, String framesJson, Callback callback) {
        // 白名单防御：zip 只接受绝对 https URL（防 file://、相对路径等 scheme 注入）。
        if (zipUrl == null || !zipUrl.startsWith("https://")) {
            callback.invoke(1, "非法 zip URL（仅接受 https:// 绝对地址）");
            return;
        }
        API_EXECUTOR.execute(() -> {
            try {
                // 1) 下载 zip（注入 Referer/UA）；非 2xx → 抛 "HTTP xxx"
                byte[] zipBytes = downloadZip(zipUrl);
                Context ctx = appContext();
                if (ctx == null) {
                    throw new IOException("上下文不可用");
                }
                // 2) 核心：解析帧列表 → 清理 → 单次解压 → 按时序写盘 → 帧 URL 列表
                JSONArray urls = ugoiraExtractCore(zipBytes, framesJson, new File(ctx.getCacheDir(), PictelioImageService.UGOIRA_CACHE_DIR));
                callback.invoke(0, urls.toString());
            } catch (Throwable e) {
                Log.w(TAG, "ugoiraExtract 失败: " + zipUrl, e);
                // 回调契约无 null：getMessage 为空时降级为异常类名（与 request 一致）
                String errMsg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                callback.invoke(1, errMsg);
            }
        });
    }

    /**
     * ugoira 解压写盘核心（package-private 静态，可测核心——与 PictelioPrefsModule
     * 「可测核心 + 薄模块包装」同模式）：解析帧列表 → 写盘前清理 → 单次扫描解压 →
     * 按 framesJson 时序逐帧写盘 → 返回帧 file:// URL 列表。
     *
     * @param zipBytes   zip 原始字节（已下载）
     * @param framesJson {@code meta.frames} JSON 数组字符串（服务端时序）
     * @param dir        缓存目录（调用方已选好；不存在则创建）
     * @return 帧 file:// URL 的 JSONArray（按 framesJson 顺序）
     * @throws IOException 帧列表解析失败 / zip 损坏 / 缺帧 / 写盘失败
     */
    static JSONArray ugoiraExtractCore(byte[] zipBytes, String framesJson, File dir) throws IOException {
        // 帧列表解析（服务端 meta.frames 时序）；解析失败 → "帧列表解析失败"
        JSONArray frames = parseFrames(framesJson);
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("无法创建 ugoira 缓存目录");
        }
        cleanupOldFrames(dir);
        // 单次解压扫描：条目名 → 帧字节（避免每个帧重新创建 ZipInputStream 全量扫描）
        Map<String, byte[]> entries = scanZip(zipBytes);
        // 按 framesJson 时序逐帧输出（帧名须与 zip 条目名匹配，否则视为缺帧）
        JSONArray urls = new JSONArray();
        for (int i = 0; i < frames.length(); i++) {
            try {
                JSONObject frame = frames.getJSONObject(i);
                String name = frame.getString("file");
                byte[] data = entries.get(name);
                if (data == null) {
                    throw new IOException("zip 缺少帧文件 " + name);
                }
                String ext = name.toLowerCase(Locale.ROOT).endsWith(".png") ? ".png" : ".jpg";
                File out = new File(dir, "frame_" + i + ext);
                writeFile(out, data);
                // file:// + 绝对路径（与 PictelioImageService.file:// 白名单一致）
                urls.put("file://" + out.getAbsolutePath());
            } catch (org.json.JSONException e) {
                // 条目缺 file 字段 / 帧元素非对象 → 视为帧列表契约破坏（可读错误）
                throw new IOException("帧列表解析失败", e);
            }
        }
        return urls;
    }

    /** OkHttp 下载 zip 字节；注入 Referer + User-Agent。非 2xx 抛 "HTTP xxx"。 */
    private byte[] downloadZip(String zipUrl) throws IOException {
        Request request = new Request.Builder()
                .url(zipUrl)
                .addHeader("Referer", OAuthConfig.REFERER)
                .addHeader("User-Agent", OAuthConfig.USER_AGENT)
                .build();
        try (Response response = PixivApiCore.getSharedClient().newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("HTTP " + response.code());
            }
            if (response.body() == null) {
                throw new IOException("HTTP 响应体为空");
            }
            return response.body().bytes();
        }
    }

    /**
     * 解析 {@code meta.frames} JSON 数组字符串。null/空或解析失败 → 抛 "帧列表解析失败"。
     */
    private static JSONArray parseFrames(String framesJson) throws IOException {
        if (framesJson == null || framesJson.trim().isEmpty()) {
            throw new IOException("帧列表解析失败");
        }
        try {
            return new JSONArray(framesJson);
        } catch (JSONException e) {
            throw new IOException("帧列表解析失败");
        }
    }

    /**
     * 单次扫描 zip：所有条目名 → 帧字节（ZipInputStream 顺序读取，条目名可含目录前缀；
     * 目录条目跳过）。全量缓冲到内存以支持按 framesJson 顺序随机取帧（避免每个帧重新全量扫描）。
     * 空 zip → 抛 "zip 无有效条目（zip 损坏）"。
     */
    private static Map<String, byte[]> scanZip(byte[] zipBytes) throws IOException {
        Map<String, byte[]> entries = new HashMap<>();
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(zipBytes))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.isDirectory()) {
                    continue;
                }
                entries.put(entry.getName(), readAll(zis));
            }
        }
        if (entries.isEmpty()) {
            throw new IOException("zip 无有效条目（zip 损坏）");
        }
        return entries;
    }

    /**
     * 写盘前 LRU 式清理：若缓存目录内文件数 > {@link #UGOIRA_MAX_COUNT} 或总大小 >
     * {@link #UGOIRA_MAX_BYTES}，按 lastModified 升序（最旧在前）删除，直到回到阈值以下。
     * 此时本作品帧尚未写盘，故不会误删当前帧；清理失败仅 Log.w 不中断主流程。
     */
    private static void cleanupOldFrames(File dir) {
        try {
            File[] files = dir.listFiles();
            if (files == null) {
                return;
            }
            long count = files.length;
            long total = 0;
            for (File f : files) {
                total += f.length();
            }
            if (count <= UGOIRA_MAX_COUNT && total <= UGOIRA_MAX_BYTES) {
                return;
            }
            Arrays.sort(files, Comparator.comparingLong(File::lastModified));
            for (File f : files) {
                if (count <= UGOIRA_MAX_COUNT && total <= UGOIRA_MAX_BYTES) {
                    break;
                }
                long len = f.length();
                if (f.delete()) {
                    count--;
                    total -= len;
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "ugoira 缓存清理失败（不影响播放）", t);
        }
    }

    /** 读取当前 zip 条目完整数据（ZipInputStream 每读到一个条目末尾返回 -1）。 */
    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        int n;
        while ((n = in.read(buf)) != -1) {
            bos.write(buf, 0, n);
        }
        return bos.toByteArray();
    }

    /** 写帧字节到目标文件（覆盖同名旧文件）。 */
    private static void writeFile(File f, byte[] data) throws IOException {
        try (FileOutputStream fos = new FileOutputStream(f)) {
            fos.write(data);
        }
    }
}
