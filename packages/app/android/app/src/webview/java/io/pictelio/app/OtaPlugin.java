package io.pictelio.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.webkit.WebResourceResponse;

import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.TimeUnit;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.regex.Pattern;

/**
 * OTA web bundle 原生插件（#249/#252，规格 docs/specs/ota-web-bundle.md；ADR-0122 自研切换原语）。
 *
 * 机制语义（#245 原型验证 + 四个生产必修坑内建）：
 *  - 版本目录不可变（files/ota/versions/<version>/）+ 三指针（current/lastGood/pending，
 *    SharedPreferences commit 同步落盘）+ 整页 reload 原子切换；
 *  - 坑①：Capacitor 本地服务器响应缺 Cache-Control → {@link #ensureNoStore} 包装注入
 *    （MainActivity 调用）+ index.html 导航带版本化 query（?otav=）破缓存复活；
 *  - 坑②：notifyReady 版本握手——上报版本 ≠ current 指针即拒绝计数（陈旧文档误报防护）；
 *  - 坑③：adopt pending 后延迟 {@link #APPLY_DELAY_MS} 再切根 + 导航（避让 WebView 首导航竞态）；
 *  - 坑④：回滚必须清 pending；同版本重装先删旧目录再 rename（幂等）。
 *
 * 快慢双通道下载（#252）：T0 常规预热 = {@link #prewarm}（WorkManager 后台，CONNECTED
 * 约束 + 指数退避 + unique KEEP 防堆叠，只写 pending 下次启动生效）；G1 门槛自愈 =
 * {@link #install}（前台直连，用户正在过渡面等待）。两通道共用 {@link OtaInstaller} 流水线。
 *
 * 生产增量：APK 升级自动清 OTA（resetWhenUpdate 同构）；健康确认后磁盘保留
 * current+lastGood 两版；tmp 孤儿目录启动清扫；公钥走 BuildConfig 注入（构建期长度校验）。
 */
@CapacitorPlugin(name = "Ota")
public class OtaPlugin extends Plugin {

    static final String TAG = "OtaPlugin";
    static final String PREFS = "ota_state";
    static final String KEY_CURRENT = "current";
    static final String KEY_LAST_GOOD = "lastGood";
    static final String KEY_PENDING = "pending";
    static final String KEY_NATIVE_VERSION_CODE = "nativeVersionCode";

    /** 内置 bundle 的指针字面量（Capacitor assets 目录名） */
    static final String BUILTIN_POINTER = "public";

    /** notifyReady 超时（ms）：超时未握手 → 回滚 lastGood（仍失败回内置） */
    static final long ROLLBACK_TIMEOUT_MS = 10_000;
    /** adopt pending 后延迟切根（ms）：plugin.load() 时立即切换会与 WebView 首导航竞态（坑③） */
    static final long APPLY_DELAY_MS = 500;
    /** 单文件下载上限（防失控响应） */
    static final long MAX_DOWNLOAD_BYTES = 64L * 1024 * 1024;
    /** 版本目录名的合法形态（防路径穿越；签名 manifest 之外的纵深防御） */
    static final Pattern VERSION_NAME_PATTERN = Pattern.compile("[A-Za-z0-9.+-]+");

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private volatile boolean readyAcked = false;
    private Runnable rollbackRunnable;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ── 生命周期 ────────────────────────────────────────────────

    /** 插件加载即应用指针（早于 WebView 首次 loadUrl），并武装回滚定时器 */
    @Override
    public void load() {
        boolean nativeChanged = resetIfNativeVersionChanged();
        if (!nativeChanged) {
            // adopt pending（"下次启动生效"语义）：pending → current，延迟切根（坑③）
            String pending = prefs().getString(KEY_PENDING, null);
            if (pending != null) {
                prefs().edit().putString(KEY_CURRENT, pending).remove(KEY_PENDING).commit();
                Log.i(TAG, "[ota] adopt-pending current=" + pending);
                final String adopted = pending;
                mainHandler.postDelayed(() -> {
                    applyPointer();
                    android.webkit.WebView wv = bridge.getWebView();
                    if (wv == null) {
                        Log.w(TAG, "[ota] versioned-nav skipped: webview null");
                        return;
                    }
                    wv.loadUrl(versionedUrl(adopted));
                    wv.clearHistory();
                }, APPLY_DELAY_MS);
            }
        }
        sweepTmpOrphans();
        armRollbackIfNeeded();
    }

    /**
     * APK 升级清 OTA（capgo resetWhenUpdate 同构）：安装 bundle 时的原生 versionCode 与
     * 当前不一致 → 原生桥可能已变更，清空全部版本目录并复位内置。返回是否发生了复位。
     */
    private boolean resetIfNativeVersionChanged() {
        SharedPreferences p = prefs();
        int stored = p.getInt(KEY_NATIVE_VERSION_CODE, 0);
        int now = BuildConfig.VERSION_CODE;
        if (stored != 0 && stored != now) {
            Log.w(TAG, "[ota] native-upgrade reset: " + stored + " → " + now + "，清空 OTA 回内置");
            deleteR(versionsRoot(getContext()));
            p.edit()
                    .putString(KEY_CURRENT, BUILTIN_POINTER)
                    .putString(KEY_LAST_GOOD, BUILTIN_POINTER)
                    .remove(KEY_PENDING)
                    .putInt(KEY_NATIVE_VERSION_CODE, now)
                    .commit();
            return true;
        }
        if (stored != now) {
            p.edit().putInt(KEY_NATIVE_VERSION_CODE, now).commit();
        }
        return false;
    }

    private void applyPointer() {
        String current = prefs().getString(KEY_CURRENT, BUILTIN_POINTER);
        try {
            // 官方高层原语（Capacitor issue #1228 背书）：setServerBasePath/AssetPath 内部做
            // hostFiles + 重载处理；裸调 hostFiles 在 plugin.load() 时机不生效（#245 实测）
            if (BUILTIN_POINTER.equals(current)) {
                bridge.setServerAssetPath(BUILTIN_POINTER);
            } else {
                File dir = versionDir(current);
                if (new File(dir, "index.html").exists()) {
                    bridge.setServerBasePath(dir.getAbsolutePath());
                } else {
                    Log.w(TAG, "[ota] version dir 缺 index.html，回退内置: " + current);
                    bridge.setServerAssetPath(BUILTIN_POINTER);
                }
            }
            Log.i(TAG, "[ota] applyPointer → " + current);
        } catch (Exception e) {
            Log.w(TAG, "[ota] applyPointer failed", e);
        }
    }

    private void armRollbackIfNeeded() {
        readyAcked = false;
        if (rollbackRunnable != null) {
            mainHandler.removeCallbacks(rollbackRunnable);
        }
        String current = prefs().getString(KEY_CURRENT, BUILTIN_POINTER);
        if (BUILTIN_POINTER.equals(current)) {
            return; // 内置 bundle 无需回滚保护
        }
        rollbackRunnable = () -> {
            if (readyAcked) {
                return;
            }
            String lastGood = prefs().getString(KEY_LAST_GOOD, BUILTIN_POINTER);
            Log.w(TAG, "[ota] rollback-timeout current=" + current + " → " + lastGood);
            prefs().edit().putString(KEY_CURRENT, lastGood).remove(KEY_PENDING).commit();
            applyPointer();
            reload();
        };
        mainHandler.postDelayed(rollbackRunnable, ROLLBACK_TIMEOUT_MS);
    }

    private void reload() {
        final android.webkit.WebView wv = bridge.getWebView();
        if (wv == null) {
            return;
        }
        wv.post(() -> {
            wv.loadUrl(versionedUrl(prefs().getString(KEY_CURRENT, BUILTIN_POINTER)));
            wv.clearHistory();
        });
    }

    /** 版本化 query 导航：破 index.html 的导航级缓存（坑①；子资源 hash 文件名天然无此问题） */
    private static String versionedUrl(String version) {
        return "https://localhost/index.html?otav=" + java.net.URLEncoder.encode(version == null ? BUILTIN_POINTER : version);
    }

    // ── JS 方法面（契约：packages/app/src/native/Ota.ts，桥一致性测试锁定） ──

    @PluginMethod
    public void status(PluginCall call) {
        JSObject o = new JSObject();
        o.put("current", prefs().getString(KEY_CURRENT, BUILTIN_POINTER));
        o.put("lastGood", prefs().getString(KEY_LAST_GOOD, BUILTIN_POINTER));
        o.put("pending", prefs().getString(KEY_PENDING, null));
        o.put("publicKeyFingerprint", publicKeyFingerprint());
        call.resolve(o);
    }

    /**
     * 健康上报（版本握手，坑②）：上报版本与 current 指针一致才计健康并刷新 lastGood；
     * 陈旧缓存文档的上报版本不符 → 拒绝计数（否则坏 bundle 被旧文档误标健康，回滚失效）。
     * 内置 bundle（current=public）按 APK versionName 校验。
     */
    @PluginMethod
    public void notifyReady(PluginCall call) {
        String reported = call.getString("version");
        String current = prefs().getString(KEY_CURRENT, BUILTIN_POINTER);
        boolean expected;
        if (BUILTIN_POINTER.equals(current)) {
            expected = BuildConfig.VERSION_NAME.equals(reported);
        } else {
            expected = current.equals(reported);
        }
        if (!expected) {
            Log.w(TAG, "[ota] notifyReady-ignored reported=" + reported + " current=" + current
                    + "（陈旧文档，不计健康）");
            call.resolve();
            return;
        }
        readyAcked = true;
        if (rollbackRunnable != null) {
            mainHandler.removeCallbacks(rollbackRunnable);
        }
        prefs().edit().putString(KEY_LAST_GOOD, current).commit();
        cleanupOldVersions(current);
        Log.i(TAG, "[ota] notifyReady-ok version=" + current + " → lastGood=" + current);
        call.resolve();
    }

    /** 立即应用 pending 并重载（门槛自愈 G1 快路径；常规 T0 走 prewarm 后台 + 下次启动） */
    @PluginMethod
    public void applyNow(PluginCall call) {
        String pending = prefs().getString(KEY_PENDING, null);
        if (pending == null) {
            call.reject("no pending");
            return;
        }
        prefs().edit().putString(KEY_CURRENT, pending).remove(KEY_PENDING).commit();
        applyPointer();
        armRollbackIfNeeded();
        reload();
        call.resolve();
    }

    /**
     * 前台直连安装（G1 门槛自愈快路径）：与 {@link OtaWorker} 共用 {@link OtaInstaller}
     * 流水线，成功即由 JS 侧 applyNow + reload（用户正在全屏过渡面等待）。
     */
    @PluginMethod
    public void install(PluginCall call) {
        String urlBase = call.getString("urlBase");
        if (urlBase == null || urlBase.isEmpty()) {
            call.reject("urlBase required");
            return;
        }
        final String base = urlBase;
        new Thread(() -> {
            try {
                OtaInstaller.InstallResult r = OtaInstaller.installBundle(getContext(), base);
                JSObject ro = new JSObject();
                ro.put("ok", true);
                ro.put("version", r.version);
                call.resolve(ro);
            } catch (OtaInstaller.OtaInstallException e) {
                call.reject(e.reason);
            }
        }, "ota-install").start();
    }

    /**
     * 慢通道预热（#252）：入队 WorkManager 后台下载——CONNECTED 网络约束（含计费网络）、
     * 指数退避、unique KEEP 防重复堆叠；无网时任务挂起、有网自动续。只写 pending，
     * 下次启动生效（指针应用在 load()，Worker 无桥不触碰 WebView）。
     */
    @PluginMethod
    public void prewarm(PluginCall call) {
        String urlBase = call.getString("urlBase");
        if (urlBase == null || urlBase.isEmpty()) {
            call.reject("urlBase required");
            return;
        }
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(OtaWorker.class)
                .setInputData(new Data.Builder().putString(OtaWorker.KEY_URL_BASE, urlBase).build())
                .setConstraints(new Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build();
        WorkManager.getInstance(getContext())
                .enqueueUniqueWork(OtaWorker.UNIQUE_NAME, ExistingWorkPolicy.KEEP, request);
        Log.i(TAG, "[ota] prewarm enqueued（unique KEEP，CONNECTED）");
        JSObject r = new JSObject();
        r.put("queued", true);
        call.resolve(r);
    }

    // ── 内部工具 ────────────────────────────────────────────────

    /** 公钥指纹（SHA-256 hex，About/Debug 页与文档肉眼比对用；公开物的防呆手段） */
    private String publicKeyFingerprint() {
        try {
            byte[] pub = Base64.decode(BuildConfig.OTA_ED25519_PUBLIC_KEY_B64, Base64.DEFAULT);
            return OtaSignatureVerifier.sha256Hex(pub);
        } catch (Exception e) {
            Log.w(TAG, "[ota] fingerprint failed", e);
            return "";
        }
    }

    /** 磁盘清理：健康确认后仅保留 current + lastGood 两版 */
    private void cleanupOldVersions(String current) {
        File root = versionsRoot(getContext());
        File[] dirs = root.listFiles();
        if (dirs == null) {
            return;
        }
        String lastGood = prefs().getString(KEY_LAST_GOOD, BUILTIN_POINTER);
        for (File d : dirs) {
            if (!d.isDirectory() || d.getName().equals(current) || d.getName().equals(lastGood)) {
                continue;
            }
            Log.i(TAG, "[ota] cleanup version dir: " + d.getName());
            deleteR(d);
        }
    }

    /** 启动清扫：解压中断遗留的 tmp 目录（孤儿） */
    private void sweepTmpOrphans() {
        File root = versionsRoot(getContext());
        File[] kids = root.listFiles();
        if (kids == null) {
            return;
        }
        for (File k : kids) {
            if (k.isDirectory() && k.getName().startsWith("tmp-")) {
                Log.w(TAG, "[ota] sweep tmp orphan: " + k.getName());
                deleteR(k);
            }
        }
    }

    static File versionsRoot(Context context) {
        return new File(context.getFilesDir(), "ota/versions");
    }

    private File versionDir(String version) {
        return new File(versionsRoot(getContext()), version);
    }

    /**
     * 解压到 versions/<version>/：zip-slip 防护（canonical path 越界拒绝）；要求解压后存在
     * index.html；同版本重装先删旧目录再 rename（幂等，坑④——否则 renameTo 必败）。
     * static 供 {@link OtaInstaller}（Worker 无桥上下文）共用。
     */
    static File unpackTo(Context context, byte[] zip, String version) throws Exception {
        File dir = new File(versionsRoot(context), version);
        File tmp = new File(versionsRoot(context), "tmp-" + System.currentTimeMillis());
        if (!tmp.mkdirs()) {
            Log.w(TAG, "[ota] unpack tmp mkdirs failed: " + tmp);
            return null;
        }
        String tmpRoot = tmp.getCanonicalPath() + File.separator;
        boolean hasIndex = false;
        ZipInputStream zis = new ZipInputStream(new java.io.ByteArrayInputStream(zip));
        ZipEntry entry;
        byte[] buf = new byte[8192];
        try {
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.isDirectory()) {
                    continue;
                }
                File out = new File(tmp, entry.getName());
                if (!out.getCanonicalPath().startsWith(tmpRoot)) {
                    throw new SecurityException("zip-slip: " + entry.getName());
                }
                File parent = out.getParentFile();
                if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                    throw new IllegalStateException("mkdirs failed: " + parent);
                }
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    int n;
                    while ((n = zis.read(buf)) > 0) {
                        fos.write(buf, 0, n);
                    }
                }
                if (entry.getName().equals("index.html")) {
                    hasIndex = true;
                }
            }
        } finally {
            zis.close();
        }
        if (!hasIndex) {
            deleteR(tmp);
            return null;
        }
        File parent = dir.getParentFile();
        if (dir.exists()) {
            deleteR(dir); // 幂等重装（坑④）
        }
        boolean parentOk = parent != null && (parent.isDirectory() || parent.mkdirs());
        if (!parentOk || !tmp.renameTo(dir)) {
            Log.w(TAG, "[ota] rename failed tmp=" + tmp + " dir=" + dir + " parentOk=" + parentOk);
            deleteR(tmp);
            return null;
        }
        return dir;
    }

    private static void deleteR(File f) {
        if (f == null) {
            return;
        }
        File[] kids = f.listFiles();
        if (kids != null) {
            for (File k : kids) {
                deleteR(k);
            }
        }
        f.delete();
    }

    // ── MainActivity 共用：坑① 的缓存注入 ─────────────────────

    /**
     * 给本地服务器响应补 Cache-Control: no-store（坑①）。Capacitor 本地服务器响应不带
     * 缓存头时 Chromium 启发式缓存文档 → OTA 切换后旧 JS 从缓存复活误调 notifyReady。
     * /pixiv-img/ 代理响应自带缓存头 → 不受影响。
     */
    static WebResourceResponse ensureNoStore(WebResourceResponse response) {
        if (response == null) {
            return null;
        }
        java.util.Map<String, String> headers = response.getResponseHeaders();
        if (headers == null) {
            headers = new java.util.HashMap<>();
            response.setResponseHeaders(headers);
        }
        if (!headers.containsKey("Cache-Control")) {
            headers.put("Cache-Control", "no-store");
        }
        return response;
    }
}
