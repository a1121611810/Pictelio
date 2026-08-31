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

    /** ADR-0128：流式渐进引擎（薄包装见 ugoiraExtractStream/Poll/Cancel；可测核心见 UgoiraStreamEngine） */
    private final UgoiraStreamEngine streamEngine = new UgoiraStreamEngine(API_EXECUTOR, framesJson -> {
        try {
            return parseFrames(framesJson).length();
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    });

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
     * ugoira 解压写盘（ADR-0125 + ADR-0126 缓存命中）：Java 下载 zip → 单次扫描解压 →
     * 按 framesJson 时序写帧到 {@code cache/ugoira/<illustId>/frame_N.{png|jpg}} →
     * 回传帧 file:// URL 列表。**帧文件完整（数与帧列表一致且非空）时零下载直回 URL 列表**
     * （兑现 ADR-0125「二次播放零下载」；目录按 illustId 隔离，跨作品帧不串）。
     *
     * <p>回调：{@code cb(0, jsonUrls)} 成功；{@code cb(1, errMsg)} 失败（errMsg 可读：
     * HTTP 码 / zip 损坏 / 缺帧 / IO 错误；为空时降级异常类名）。异步执行于 {@link #API_EXECUTOR}。
     *
     * @param zipUrl     绝对 https URL（ugoira zip；仅接受 https，防 scheme 注入）
     * @param framesJson {@code meta.frames} JSON 数组字符串（服务端时序），
     *                   如 {@code [{"file":"a.png","delay":125},...]}
     * @param illustId   ugoira 作品 ID（纯数字；缓存目录命名空间，防路径注入）
     */
    @LynxMethod
    public void ugoiraExtract(String zipUrl, String framesJson, String illustId, Callback callback) {
        // 白名单防御：zip 只接受绝对 https URL（防 file://、相对路径等 scheme 注入）。
        if (zipUrl == null || !zipUrl.startsWith("https://")) {
            callback.invoke(1, "非法 zip URL（仅接受 https:// 绝对地址）");
            return;
        }
        if (illustId == null || !illustId.matches("\\d+")) {
            callback.invoke(1, "非法 illustId（仅接受数字）");
            return;
        }
        API_EXECUTOR.execute(() -> {
            try {
                Context ctx = appContext();
                if (ctx == null) {
                    throw new IOException("上下文不可用");
                }
                File dir = new File(new File(ctx.getCacheDir(), PictelioImageService.UGOIRA_CACHE_DIR), illustId);
                // 1) 缓存命中（帧完整）→ 零下载直回 URL 列表
                JSONArray cached = ugoiraExtractCached(dir, framesJson);
                if (cached != null) {
                    Log.i(TAG, "ugoiraExtract 缓存命中: " + illustId + " (" + cached.length() + " 帧)");
                    callback.invoke(0, cached.toString());
                    return;
                }
                // 2) 未命中：下载 zip（注入 Referer/UA）；非 2xx → 抛 "HTTP xxx"
                Log.i(TAG, "ugoiraExtract 下载解压: " + illustId);
                byte[] zipBytes = downloadZip(zipUrl);
                // 3) 核心：解析帧列表 → 清理 → 单次解压 → 按时序写盘 → 帧 URL 列表
                JSONArray urls = ugoiraExtractCore(zipBytes, framesJson, dir);
                callback.invoke(0, urls.toString());
            } catch (Throwable e) {
                Log.w(TAG, "ugoiraExtract 失败: " + zipUrl, e);
                // 回调契约无 null：getMessage 为空时降级为异常类名（与 request 一致）
                String errMsg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                callback.invoke(1, errMsg);
            }
        });
    }

    // ── ADR-0128：流式渐进（拉模式状态机薄包装；核心见 UgoiraStreamEngine） ──

    /**
     * 启动流式渐进（ADR-0128）：Java 流式下载 → 边解压边写盘 → 按批交付帧 URL。
     * 拉模式契约（Lynx Callback 一次性语义）：
     * <ul>
     *   <li>{@code ugoiraExtractStream(zipUrl, framesJson, illustId, batchSize, cb)}：
     *       cb(0, {"started":true})；缓存命中（帧完整）→ 不启动网络流，后续一次 poll 全量交付</li>
     *   <li>{@code ugoiraExtractStreamPoll(cb)}：cb(0, {delivered, urls[], done, error})</li>
     *   <li>{@code ugoiraExtractStreamCancel(cb)}：cb(0, {})；取消后 poll 见 done=true</li>
     * </ul>
     * 错误（下载中断/zip 损坏/帧序不一致）→ poll 的 error 可读；帧序不一致场景 JS 端降级全量路径。
     */
    @LynxMethod
    public void ugoiraExtractStream(String zipUrl, String framesJson, String illustId, String batchSizeStr, Callback callback) {
        if (zipUrl == null || !zipUrl.startsWith("https://")) {
            callback.invoke(1, "非法 zip URL（仅接受 https:// 绝对地址）");
            return;
        }
        if (illustId == null || !illustId.matches("\\d+")) {
            callback.invoke(1, "非法 illustId（仅接受数字）");
            return;
        }
        int batchSize = 5;
        try {
            batchSize = Integer.parseInt(batchSizeStr);
        } catch (Exception ignored) {
            // 默认 5
        }
        try {
            Context ctx = appContext();
            if (ctx == null) {
                throw new IOException("上下文不可用");
            }
            File dir = new File(new File(ctx.getCacheDir(), PictelioImageService.UGOIRA_CACHE_DIR), illustId);
            streamEngine.start(() -> streamDownloadZip(zipUrl), framesJson, dir, batchSize);
            callback.invoke(0, "{\"started\":true}");
        } catch (Throwable e) {
            String errMsg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
            callback.invoke(1, errMsg);
        }
    }

    /** 拉取自上次 poll 以来新交付的帧 URL 批次（契约见 ugoiraExtractStream 注释） */
    @LynxMethod
    public void ugoiraExtractStreamPoll(Callback callback) {
        callback.invoke(0, streamEngine.poll().toString());
    }

    /** 取消活动流（已写盘帧保留 → 下次缓存命中） */
    @LynxMethod
    public void ugoiraExtractStreamCancel(Callback callback) {
        streamEngine.cancel();
        callback.invoke(0, "{}");
    }

    /** 流式下载：OkHttp 执行后返回响应体字节流（不驻留；取消时关闭流即中断读取） */
    private InputStream streamDownloadZip(String zipUrl) throws IOException {
        Request request = new Request.Builder()
                .url(zipUrl)
                .addHeader("Referer", OAuthConfig.REFERER)
                .addHeader("User-Agent", OAuthConfig.USER_AGENT)
                .build();
        Response response = PixivApiCore.getSharedClient().newCall(request).execute();
        if (!response.isSuccessful()) {
            response.close();
            throw new IOException("HTTP " + response.code());
        }
        if (response.body() == null) {
            response.close();
            throw new IOException("HTTP 响应体为空");
        }
        return response.body().byteStream();
    }

    /**
     * ugoira 缓存命中判定（package-private 静态，可测核心）：目录内帧文件与帧列表
     * 逐位匹配（数量一致、全部存在且非空）→ 返回帧 file:// URL 列表；否则返回 null（调用方走下载）。
     *
     * @param dir        作品缓存目录 {@code cache/ugoira/<illustId>}
     * @param framesJson {@code meta.frames} JSON 数组字符串
     * @return 命中：帧 URL JSONArray（与 framesJson 同序）；未命中：null
     * @throws IOException 帧列表解析失败
     */
    static JSONArray ugoiraExtractCached(File dir, String framesJson) throws IOException {
        JSONArray frames = parseFrames(framesJson);
        if (!dir.isDirectory()) {
            return null;
        }
        JSONArray urls = new JSONArray();
        for (int i = 0; i < frames.length(); i++) {
            try {
                JSONObject frame = frames.getJSONObject(i);
                String name = frame.getString("file");
                File f = new File(dir, frameFileName(i, name));
                if (!f.isFile() || f.length() == 0) {
                    return null;
                }
                urls.put("file://" + f.getAbsolutePath());
            } catch (org.json.JSONException e) {
                // 条目缺 file 字段 / 帧元素非对象 → 视为帧列表契约破坏（可读错误）
                throw new IOException("帧列表解析失败", e);
            }
        }
        return urls;
    }

    /** 帧文件名（目录内平铺）：{@code frame_N.{png|jpg}}，扩展名由 zip 条目名后缀判定 */
    private static String frameFileName(int i, String entryName) {
        String ext = entryName.toLowerCase(Locale.ROOT).endsWith(".png") ? ".png" : ".jpg";
        return "frame_" + i + ext;
    }

    // ── ADR-0128：流式渐进（可测核心，被 UgoiraStreamEngine 调用） ──

    /** 流式批次事件：本批帧 URL + 已读字节水位（原型取证形态，oracle = ugoira-native-streaming-proto.md） */
    static final class StreamBatch {
        final JSONArray urls;
        final long bytesRead;

        StreamBatch(JSONArray urls, long bytesRead) {
            this.urls = urls;
            this.bytesRead = bytesRead;
        }
    }

    /** 底层已消费字节计数（含 ZipInputStream 缓冲预读——真实网络缓冲行为） */
    private static final class CountingInputStream extends InputStream {
        private final InputStream in;
        private long read;

        CountingInputStream(InputStream in) {
            this.in = in;
        }

        @Override
        public int read() throws IOException {
            int b = in.read();
            if (b >= 0) {
                read++;
            }
            return b;
        }

        @Override
        public int read(byte[] buf, int off, int len) throws IOException {
            int n = in.read(buf, off, len);
            if (n > 0) {
                read += n;
            }
            return n;
        }
    }

    /**
     * 流式解压写盘核心（ADR-0128）：zip 流 → ZipInputStream 顺序解压（local header 驱动，
     * 不依赖中央目录）→ 逐帧写盘 → 每写满 batchSize 帧交付一批（帧 URL + 已读字节水位）。
     *
     * <p><b>顺序断言</b>：要求 zip 条目物理序 == framesJson 序（原型实测真实 Pixiv zip 成立）；
     * 不一致立即抛可读错误（调用方/JS 端降级全量路径，绝不产生错帧）。
     *
     * @param zipIn     zip 字节流（调用方提供；流式读完即弃，不驻留）
     * @param framesJson {@code meta.frames} JSON 数组字符串（服务端时序）
     * @param dir       作品缓存目录 {@code cache/ugoira/<illustId>}
     * @param batchSize 每批帧数（<1 视为 5）
     * @param onBatch   批次回调（同步调用；帧 URL 列表 + 已读字节水位）
     * @return 交付总帧数
     * @throws IOException 帧列表解析失败 / zip 损坏 / 帧序不一致 / 缺帧 / 写盘失败
     */
    static int ugoiraStreamCore(InputStream zipIn, String framesJson, File dir, int batchSize,
            java.util.function.Consumer<StreamBatch> onBatch) throws IOException {
        JSONArray frames = parseFrames(framesJson);
        if (batchSize < 1) {
            batchSize = 5;
        }
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("无法创建 ugoira 缓存目录");
        }
        File root = dir.getParentFile();
        if (root != null) {
            cleanupOldFrames(root);
        }
        CountingInputStream counting = new CountingInputStream(zipIn);
        JSONArray batchUrls = new JSONArray();
        int frameIdx = 0;
        byte[] buf = new byte[16 * 1024];
        try (ZipInputStream zis = new ZipInputStream(counting)) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.isDirectory()) {
                    continue;
                }
                final int idx = frameIdx;
                String expected;
                try {
                    expected = frames.getJSONObject(idx).getString("file");
                } catch (JSONException e) {
                    throw new IOException("帧列表解析失败", e);
                }
                if (!expected.equals(entry.getName())) {
                    throw new IOException("ugoira: zip 条目序与帧列表不一致（" + entry.getName() + " ≠ " + expected + "）");
                }
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                int n;
                while ((n = zis.read(buf)) != -1) {
                    out.write(buf, 0, n);
                }
                File outFile = new File(dir, frameFileName(idx, expected));
                writeFile(outFile, out.toByteArray());
                batchUrls.put("file://" + outFile.getAbsolutePath());
                frameIdx++;
                if (frameIdx % batchSize == 0) {
                    Log.i(TAG, "ugoiraStream 批次交付: frame=" + (frameIdx - batchSize) + "-" + (frameIdx - 1)
                            + " 已读=" + counting.read + "B");
                    onBatch.accept(new StreamBatch(batchUrls, counting.read));
                    batchUrls = new JSONArray();
                }
            }
        }
        if (frameIdx != frames.length()) {
            throw new IOException("ugoira: zip 缺帧（流式解析到末尾仍有 " + (frames.length() - frameIdx) + " 帧未到）");
        }
        if (batchUrls.length() > 0) {
            onBatch.accept(new StreamBatch(batchUrls, counting.read));
        }
        return frameIdx;
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
        // 清理按外层根目录统计（per-illust 子目录递归），避免误删当前作品帧
        File root = dir.getParentFile();
        if (root != null) {
            cleanupOldFrames(root);
        }
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
                File out = new File(dir, frameFileName(i, name));
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
            // 递归收集帧文件（per-illust 子目录结构，ADR-0126）：子目录本身不计入大小
            java.util.List<File> files = new java.util.ArrayList<>();
            collectFrameFiles(dir, files);
            long count = files.size();
            long total = 0;
            for (File f : files) {
                total += f.length();
            }
            if (count <= UGOIRA_MAX_COUNT && total <= UGOIRA_MAX_BYTES) {
                return;
            }
            files.sort(Comparator.comparingLong(File::lastModified));
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
            // 空作品目录一并清掉（避免目录堆积）
            deleteEmptySubdirs(dir);
        } catch (Throwable t) {
            Log.w(TAG, "ugoira 缓存清理失败（不影响播放）", t);
        }
    }

    /** 递归收集目录下全部文件（帧；跳过子目录本身） */
    private static void collectFrameFiles(File dir, java.util.List<File> out) {
        File[] children = dir.listFiles();
        if (children == null) {
            return;
        }
        for (File f : children) {
            if (f.isDirectory()) {
                collectFrameFiles(f, out);
            } else {
                out.add(f);
            }
        }
    }

    /** 删除空的 per-illust 子目录（其内帧文件已被清理） */
    private static void deleteEmptySubdirs(File root) {
        File[] children = root.listFiles();
        if (children == null) {
            return;
        }
        for (File f : children) {
            if (!f.isDirectory()) {
                continue;
            }
            File[] inside = f.listFiles();
            if (inside == null || inside.length == 0) {
                f.delete();
            }
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
