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

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * app-lynx 原生翻译缓存 NativeModule（ADR-0175 + ticket #641 / wayfinder #644）。
 *
 * <p>在 {@code context.getCacheDir() + "/pictelio_translate_cache/"} 下存放每章翻译条目（独立 JSON 文件
 * + sha256 化的 key 作文件名）+ 独立 {@code manifest.json}（LRU 索引）。容量上限默认 10MB / 200 条
 * （与 ADR-0171 webview 端 LRU 200 同基线起步）；超限时按 manifest 头部（最旧 createdAt）淘汰。
 *
 * <p>线程模型：所有 manifest 写入走单线程 {@link #writeExecutor} 串行化，避免并发写坏。
 * 文件写本身用 temp + rename 原子化（POSIX rename 保证）。读路径（getItem）走调用线程，仅 touch
 * 文件 lastModified（LRU 时间戳），manifest 更新延后到下次 setItem 一并重排（ADR-0175 D3.1 末段）。
 *
 * <p>JS 侧契约（{@link Callback#invoke} 多参；Lynx Callback 对 null 崩——真机实测）：
 * <ul>
 *   <li>{@code getItem(key, cb)}：成功 {@code cb(json, "")}；未命中 {@code cb("", "ENOENT")}；
 *       其他 IO 错 {@code cb("", exceptionClassSimpleName)}</li>
 *   <li>{@code setItem(key, json, cb)}：成功 {@code cb("")}；磁盘满 {@code cb("", "ENOSPC")}；
 *       其他 IO 错 {@code cb("", exceptionClassSimpleName)}</li>
 *   <li>{@code deleteItem(key, cb)}：成功 {@code cb("")}（无论文件是否存在）</li>
 *   <li>{@code clear(cb)}：成功 {@code cb("")}（清空整个缓存目录 + manifest）</li>
 *   <li>{@code stats(cb)}：成功 {@code cb(json, "")}（{@code {entryCount, totalBytes, hitRate, missRate}}）</li>
 *   <li>{@code getCacheDirPath(cb)}：成功 {@code cb(path)}（调试用：暴露 cacheDir 绝对路径）</li>
 * </ul>
 *
 * <p>本模块是测试友好的：所有静态核心方法（{@link #cacheDir} / {@link #keyToFilename} /
 * {@link #loadManifest} / {@link #saveManifest} / {@link #evictLru} 等）都是包可见静态方法，
 * Robolectric 直接构造 {@link PictelioTranslateCacheModule}（ADR-0174 的 {@code TestLynxContext}
 * 模板复用）即可驱动。
 *
 * <p>设计参考：
 * <ul>
 *   <li>ADR-0175 D1（filesystem cacheDir）+ D2（文件名 = sha256(key)）+ D3（manifest sort LRU）+
 *       D4（与 ADR-0171 webview 端字段级一致）+ D5（半成品不写、容量 200、provider 校验全部沿用）</li>
 *   <li>ADR-0090（三层缓存 = ImageCachePlugin 独立文件 + manifest 先例）</li>
 *   <li>ADR-0170（{@code LynxMethod} + 回调去 null 单职责 NativeModule 范式）</li>
 *   <li>ADR-0174（{@code TestLynxContext} 子类化测试基础设施，本模块单测复用）</li>
 * </ul>
 */
public class PictelioTranslateCacheModule extends LynxModule {

    private static final String TAG = "PictelioTranslateCache";

    /** 缓存子目录名（与 ImageCachePlugin / PixivImageLoader / PictelioImageService 同形态） */
    public static final String CACHE_SUBDIR = "pictelio_translate_cache";
    /** 单条目文件后缀 */
    static final String ENTRY_SUFFIX = ".json";
    /** manifest 文件名 */
    public static final String MANIFEST_FILENAME = "manifest.json";
    /** manifest schema version（升级时递增；损坏重建时不依赖） */
    static final int MANIFEST_VERSION = 1;
    /** 默认容量上限（字节；10MB = 200 章 × ~50KB） */
    public static final long DEFAULT_MAX_BYTES = 10L * 1024L * 1024L;
    /** 默认条目数上限（与 ADR-0171 webview 端 LRU 200 同基线起步） */
    public static final int DEFAULT_MAX_ENTRIES = 200;

    /** 所有 manifest / 写入串行化的单线程 executor（manifest 并发写会破坏） */
    private static final ExecutorService WRITE_EXECUTOR = Executors.newSingleThreadExecutor();

    public PictelioTranslateCacheModule(Context context) {
        super(context);
        // 启动时一次性清理孤儿文件（ticket §T3「启动时 cleanupOrphanFiles」）。
        // 不在 setItem 内调：并发场景下「已写文件但 manifest 更新尚未排队到 executor」会被
        // 误判为 orphan 删除，破坏并发写测试 + 制造丢数据 bug。
        cleanupOrphansOnce();
    }

    /** 单 JVM 内仅执行一次启动期孤儿清理（同一进程多个 LynxActivity 复用同一 executor / 缓存目录） */
    private static volatile boolean cleanupOrphansDone = false;

    private void cleanupOrphansOnce() {
        if (cleanupOrphansDone) return;
        synchronized (PictelioTranslateCacheModule.class) {
            if (cleanupOrphansDone) return;
            try {
                File cd = myCacheDir();
                Manifest m = loadManifest(cd);
                int removed = cleanupOrphanFiles(cd, m);
                if (removed > 0) {
                    Log.w(TAG, "启动清理孤儿文件: " + removed);
                }
            } catch (IOException ioe) {
                Log.w(TAG, "启动清理孤儿文件失败", ioe);
            }
            cleanupOrphansDone = true;
        }
    }

    private Context appContext() {
        return ((LynxContext) mContext).getContext();
    }

    // ─────────────────── 纯静态核心（JVM 可测） ───────────────────

    /** 缓存目录（懒创建；缺失则 mkdirs） */
    public static File cacheDir(Context ctx) {
        File d = new File(ctx.getCacheDir(), CACHE_SUBDIR);
        if (!d.exists() && !d.mkdirs()) {
            // 极端：mkdirs 失败（权限、IO）。不抛——后续文件操作会暴露 FileNotFoundException，
            // cb 回 errCode。日志留痕便于排查。
            Log.w(TAG, "cacheDir 创建失败: " + d.getAbsolutePath());
        }
        return d;
    }

    /** 实例版本：使用模块持有的 appContext() */
    private File myCacheDir() {
        return cacheDir(appContext());
    }

    /** 缓存键 → 文件名（sha256(key).json）。hex 字符 0-9a-f，文件系统完全安全 */
    public static String keyToFilename(String key) {
        return sha256Hex(key) + ENTRY_SUFFIX;
    }

    static String sha256Hex(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(64);
            for (byte b : hash) {
                sb.append(String.format("%02x", b & 0xff));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 在 JDK 必备；理论不可达
            throw new RuntimeException("SHA-256 不可用", e);
        }
    }

    /**
     * 加载 manifest。损坏 / 缺失视为空集（自愈：下次写入会重建）。
     */
    static Manifest loadManifest(File cacheDir) throws IOException {
        File mf = new File(cacheDir, MANIFEST_FILENAME);
        if (!mf.exists()) {
            return Manifest.empty();
        }
        try {
            byte[] bytes = Files.readAllBytes(mf.toPath());
            String raw = new String(bytes, StandardCharsets.UTF_8);
            return Manifest.fromJson(raw);
        } catch (Exception e) {
            // 损坏（JSON 解析失败 / 字段缺失 / version 不识别）→ 自愈：视为空集
            Log.w(TAG, "manifest 损坏，视为空集（自愈）", e);
            return Manifest.empty();
        }
    }

    /** 写 manifest（原子：temp + rename）。损坏时由 {@link #loadManifest} 自动重建 */
    static void saveManifest(File cacheDir, Manifest manifest) throws IOException {
        File mf = new File(cacheDir, MANIFEST_FILENAME);
        File tmp = new File(cacheDir, MANIFEST_FILENAME + ".tmp");
        String json = manifest.toJson();
        try (FileOutputStream fos = new FileOutputStream(tmp)) {
            fos.write(json.getBytes(StandardCharsets.UTF_8));
            fos.getFD().sync();
        }
        if (!tmp.renameTo(mf)) {
            // rename 失败（极端：跨 fs / 权限）→ 退化为 copy + delete
            byte[] data = Files.readAllBytes(tmp.toPath());
            try (FileOutputStream fos = new FileOutputStream(mf)) {
                fos.write(data);
                fos.getFD().sync();
            }
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
        }
    }

    /**
     * 条目文件 path（key 已 sha256 化）。不保证文件存在——调用方负责 getItem 检查 / setItem 创建。
     */
    static File entryFile(File cacheDir, String key) {
        return new File(cacheDir, keyToFilename(key));
    }

    /**
     * 写入条目（temp + rename 原子）。manifest 更新另起 executor 任务。
     *
     * @return 写入文件实际字节数（>=0）；失败抛 IOException
     */
    static long writeEntry(File cacheDir, String key, String json) throws IOException {
        File final_ = entryFile(cacheDir, key);
        File tmp = new File(cacheDir, keyToFilename(key) + ".tmp");
        try (FileOutputStream fos = new FileOutputStream(tmp)) {
            fos.write(json.getBytes(StandardCharsets.UTF_8));
            fos.getFD().sync();
        }
        if (!tmp.renameTo(final_)) {
            // 退化为 copy
            byte[] data = Files.readAllBytes(tmp.toPath());
            try (FileOutputStream fos = new FileOutputStream(final_)) {
                fos.write(data);
                fos.getFD().sync();
            }
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
        }
        return final_.length();
    }

    /** 读条目（不存在返回 null）。读命中后 touch 文件 lastModified（LRU 时间戳） */
    static String readEntry(File entry) throws IOException {
        byte[] bytes = Files.readAllBytes(entry.toPath());
        //noinspection ResultOfMethodCallIgnored
        entry.setLastModified(System.currentTimeMillis());
        return new String(bytes, StandardCharsets.UTF_8);
    }

    /**
     * 淘汰最旧条目（按 manifest createdAt 升序头部），直至 entries.length <= maxEntries 或
     * totalBytes <= maxBytes。已淘汰的文件 delete（失败 warn，不抛错）。
     */
    static void evictLru(File cacheDir, Manifest manifest, long maxBytes, int maxEntries) {
        long totalBytes = computeTotalBytes(cacheDir, manifest);
        boolean overBytes = totalBytes > maxBytes;
        boolean overCount = manifest.entries.size() > maxEntries;
        if (!overBytes && !overCount) return;

        // 按 createdAt 升序淘汰最旧头部
        List<ManifestEntry> sorted = new ArrayList<>(manifest.entries);
        sorted.sort((a, b) -> Long.compare(a.createdAt, b.createdAt));

        Iterator<ManifestEntry> it = sorted.iterator();
        while (it.hasNext() && (overBytes || overCount)) {
            ManifestEntry victim = it.next();
            File f = entryFile(cacheDir, victim.key);
            if (f.exists()) {
                long sz = f.length();
                if (!f.delete()) {
                    Log.w(TAG, "淘汰失败（delete 返回 false）：" + f.getAbsolutePath());
                }
                totalBytes -= sz;
            }
            manifest.entries.removeIf(e -> e.key.equals(victim.key));
            overBytes = totalBytes > maxBytes;
            overCount = manifest.entries.size() > maxEntries;
        }
    }

    /** 累加所有当前 manifest 条目的字节数（已淘汰的不计） */
    static long computeTotalBytes(File cacheDir, Manifest manifest) {
        long total = 0;
        for (ManifestEntry e : manifest.entries) {
            File f = entryFile(cacheDir, e.key);
            if (f.exists()) total += f.length();
        }
        return total;
    }

    /**
     * 启动时清理孤儿文件：manifest 中没有但目录里有的文件 → 删除。
     * 正常路径下不应有；只有 manifest 损坏 + 自愈过程中写入未完成的边缘场景会残留。
     */
    static int cleanupOrphanFiles(File cacheDir, Manifest manifest) {
        File[] files = cacheDir.listFiles();
        if (files == null) return 0;
        int removed = 0;
        for (File f : files) {
            String name = f.getName();
            if (name.equals(MANIFEST_FILENAME) || name.endsWith(".tmp")) continue;
            if (!name.endsWith(ENTRY_SUFFIX)) continue;
            // 反向查 manifest：是否登记？
            boolean registered = false;
            for (ManifestEntry e : manifest.entries) {
                if (keyToFilename(e.key).equals(name)) {
                    registered = true;
                    break;
                }
            }
            if (!registered) {
                if (f.delete()) removed++;
            }
        }
        return removed;
    }

    /**
     * 反向重建 manifest（按目录文件 mtime 升序）。manifest 损坏时 fallback 使用。
     */
    static Manifest rebuildManifestFromDir(File cacheDir) {
        Manifest m = Manifest.empty();
        File[] files = cacheDir.listFiles();
        if (files == null) return m;
        List<File> entryFiles = new ArrayList<>();
        for (File f : files) {
            if (f.getName().endsWith(ENTRY_SUFFIX) && !f.getName().endsWith(".tmp")) {
                entryFiles.add(f);
            }
        }
        entryFiles.sort((a, b) -> Long.compare(a.lastModified(), b.lastModified()));
        for (File f : entryFiles) {
            // 重建时 key 不可逆（sha256 单向），无法从文件名还原 key。
            // 此处用 filename 作 placeholder key —— 任何命中查找都靠 sha256(filename 的「原 key」)，
            // 所以重建后无法命中旧条目；语义上等同于「全部失效」。这是合理的（manifest 损坏是
            // 极小概率事件，用户接受一次重译）。
            ManifestEntry e = new ManifestEntry();
            e.key = f.getName();
            e.size = f.length();
            e.createdAt = f.lastModified();
            m.entries.add(e);
        }
        return m;
    }

    // ─────────────────── @LynxMethod 暴露面 ───────────────────

    /**
     * 调试用：暴露 cacheDir 绝对路径（路径不携带用户数据，仅目录位置）。
     *
     * <p>arity 契约（code-review P9）：JS 侧调 `getCacheDirPath(cb)`（单参）。Lynx 的
     * `@LynxMethod` 在参数个数不匹配时会把函数塞进 String 槽、Callback 置 null → 调用即崩
     * （本类 javadoc 已记「Callback 对 null 崩」）。故这里用**无参**签名，由 Lynx 把
     * 唯一的函数实参绑到 Callback 上——与仓库既有 `getEndpoint(Callback)` 同形。
     */
    @LynxMethod
    public void getCacheDirPath(Callback callback) {
        callback.invoke(myCacheDir().getAbsolutePath());
    }

    @LynxMethod
    public void getItem(String key, Callback callback) {
        try {
            File entry = entryFile(myCacheDir(), key);
            if (!entry.exists()) {
                callback.invoke("", "ENOENT");
                return;
            }
            String content = readEntry(entry);
            // 延迟 manifest 更新：touch 文件 lastModified 已读命中（LRU 时间戳）；
            // manifest 实际重排留到下次 setItem（ADR-0175 D3.1 末段「延迟写」）。
            callback.invoke(content, "");
        } catch (FileNotFoundException | NoSuchFileException e) {
            // 并发删除（被 eviction 干掉）→ 与未命中同形
            callback.invoke("", "ENOENT");
        } catch (IOException e) {
            Log.w(TAG, "getItem(" + key + ") IO 失败", e);
            callback.invoke("", e.getClass().getSimpleName());
        }
    }

    @LynxMethod
    public void setItem(String key, String json, Callback callback) {
        if (json == null) {
            callback.invoke("", "json 不能为空");
            return;
        }
        File cd = myCacheDir();
        try {
            long size = writeEntry(cd, key, json);
            // 异步更新 manifest（写串行化），不阻塞 callback
            WRITE_EXECUTOR.execute(() -> {
                try {
                    Manifest m = loadManifest(cd);
                    long now = System.currentTimeMillis();
                    // upsert
                    boolean replaced = false;
                    for (ManifestEntry e : m.entries) {
                        if (e.key.equals(key)) {
                            e.size = size;
                            e.createdAt = now;
                            replaced = true;
                            break;
                        }
                    }
                    if (!replaced) {
                        ManifestEntry ne = new ManifestEntry();
                        ne.key = key;
                        ne.size = size;
                        ne.createdAt = now;
                        m.entries.add(ne);
                    }
                    // 排序 + 淘汰
                    m.sortByCreatedAt();
                    evictLru(cd, m, DEFAULT_MAX_BYTES, DEFAULT_MAX_ENTRIES);
                    // 注意：不再此处调 cleanupOrphanFiles（启动期清理已由构造器一次完成）。
                    // 此处再调会与正在排队的 setItem 写文件竞态——文件已写但 manifest 未排到
                    // executor 时被误判为 orphan 删除（破坏并发写测试）。
                    saveManifest(cd, m);
                } catch (IOException ioe) {
                    Log.w(TAG, "manifest 更新失败", ioe);
                }
            });
            callback.invoke("");
        } catch (IOException e) {
            String cls = e.getClass().getSimpleName();
            if ("FileSystemFullException".equals(cls) || cls.contains("DiskFull")) {
                callback.invoke("", "ENOSPC");
            } else {
                Log.w(TAG, "setItem(" + key + ") IO 失败", e);
                callback.invoke("", cls);
            }
        }
    }

    @LynxMethod
    public void deleteItem(String key, Callback callback) {
        File cd = myCacheDir();
        File entry = entryFile(cd, key);
        boolean fileExisted = entry.exists();
        if (fileExisted && !entry.delete()) {
            Log.w(TAG, "deleteItem 文件删除失败：" + entry.getAbsolutePath());
        }
        // 同步 manifest（删除条目）
        WRITE_EXECUTOR.execute(() -> {
            try {
                Manifest m = loadManifest(cd);
                m.entries.removeIf(e -> e.key.equals(key));
                saveManifest(cd, m);
            } catch (IOException ioe) {
                Log.w(TAG, "manifest 删除条目失败", ioe);
            }
        });
        callback.invoke("");
    }

    @LynxMethod
    public void clear(Callback callback) {
        File cd = myCacheDir();
        File[] files = cd.listFiles();
        if (files != null) {
            for (File f : files) {
                if (!f.delete()) {
                    Log.w(TAG, "clear 删除失败：" + f.getAbsolutePath());
                }
            }
        }
        callback.invoke("");
    }

    /**
     * 缓存统计。
     *
     * <p>arity 契约（code-review P9）：JS 侧调 `stats(cb)`（单参）。同 {@link #getCacheDirPath}
     * 的理由，用无参签名。
     *
     * <p>code-review S6：此前返回 `hitRate: 0` / `missRate: 0` 硬编码伪造值（注释自认
     * 「JS 侧维护」但 JS 从未覆盖）——暴露假数据比不暴露更糟。现改为返回
     * {@code hitRate}/{@code missRate} = **null**（JSON null，语义「未统计」），
     * 由消费方自行判断；JS 侧类型也同步为 `number | null`。
     */
    @LynxMethod
    public void stats(Callback callback) {
        File cd = myCacheDir();
        WRITE_EXECUTOR.execute(() -> {
            try {
                Manifest m = loadManifest(cd);
                long totalBytes = computeTotalBytes(cd, m);
                JSONObject ret = new JSONObject();
                ret.put("entryCount", m.entries.size());
                ret.put("totalBytes", totalBytes);
                ret.put("maxBytes", DEFAULT_MAX_BYTES);
                ret.put("maxEntries", DEFAULT_MAX_ENTRIES);
                // null = 「未统计」（Java 不持有命中计数器，避免跨重启统计漂移）。
                // 不用 0：0 是合法命中率（全 miss），语义上不可区分，属伪造数据。
                ret.put("hitRate", JSONObject.NULL);
                ret.put("missRate", JSONObject.NULL);
                callback.invoke(ret.toString(), "");
            } catch (Exception e) {
                Log.w(TAG, "stats 失败", e);
                callback.invoke("", e.getClass().getSimpleName());
            }
        });
    }

    // ─────────────────── Manifest 数据结构 ───────────────────

    /** Manifest 顶层对象（version + entries） */
    static final class Manifest {
        int version;
        List<ManifestEntry> entries = new ArrayList<>();

        static Manifest empty() {
            Manifest m = new Manifest();
            m.version = MANIFEST_VERSION;
            return m;
        }

        static Manifest fromJson(String raw) throws JSONException {
            JSONObject obj = new JSONObject(raw);
            Manifest m = new Manifest();
            // 缺失 version 视为损坏（fallback 处理交给调用方）；不在此处抛
            m.version = obj.optInt("version", MANIFEST_VERSION);
            JSONArray arr = obj.optJSONArray("entries");
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject eo = arr.getJSONObject(i);
                    ManifestEntry e = new ManifestEntry();
                    e.key = eo.getString("key");
                    e.size = eo.optLong("size", 0);
                    e.createdAt = eo.optLong("createdAt", 0);
                    m.entries.add(e);
                }
            }
            m.sortByCreatedAt();
            return m;
        }

        String toJson() {
            try {
                JSONObject obj = new JSONObject();
                obj.put("version", version);
                JSONArray arr = new JSONArray();
                for (ManifestEntry e : entries) {
                    JSONObject eo = new JSONObject();
                    eo.put("key", e.key);
                    eo.put("size", e.size);
                    eo.put("createdAt", e.createdAt);
                    arr.put(eo);
                }
                obj.put("entries", arr);
                return obj.toString();
            } catch (JSONException jse) {
                throw new RuntimeException("manifest 序列化失败", jse);
            }
        }

        void sortByCreatedAt() {
            Collections.sort(entries, (a, b) -> Long.compare(a.createdAt, b.createdAt));
        }
    }

    /** Manifest 单条目 */
    static final class ManifestEntry {
        String key;
        long size;
        long createdAt;
    }
}
