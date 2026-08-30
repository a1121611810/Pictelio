package io.pictelio.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.webkit.WebResourceResponse;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * OTA web bundle 原生插件（#249，规格 docs/specs/ota-web-bundle.md；ADR-0122 自研切换原语）。
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
 * 生产增量：APK 升级自动清 OTA（resetWhenUpdate 同构）；健康确认后磁盘保留
 * current+lastGood 两版；tmp 孤儿目录启动清扫；manifest.minApkVersion 拒装（G2）；
 * 公钥走 BuildConfig 注入（构建期长度校验）。
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
    private static final Pattern VERSION_NAME_PATTERN = Pattern.compile("[A-Za-z0-9.+-]+");

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
            deleteR(versionsRoot());
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

    /** 立即应用 pending 并重载（门槛自愈 G1 路径用；常规 T0 走"下次启动"） */
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
     * 下载安装（快慢双通道共用：前台直连与 WorkManager 走同一实现）：
     * manifest → 验签（OtaSignatureVerifier）→ minApkVersion 拒装守卫（G2）→ zip 下载 →
     * checksum 快检 → 解压版本目录（zip-slip 防护 + 幂等重装坑④）→ 写 pending（下次启动生效，
     * 或由 applyNow 立即应用）。
     *
     * @param urlBase 三件套资产前缀 URL（拼 -manifest.json / -manifest.json.sig / -web-bundle.zip）
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
            long t0 = System.currentTimeMillis();
            try {
                byte[] manifest = httpGet(base + "-manifest.json");
                byte[] sig = Base64.decode(
                        new String(httpGet(base + "-manifest.json.sig"), StandardCharsets.UTF_8).trim(),
                        Base64.DEFAULT);
                if (!OtaSignatureVerifier.verifyManifest(manifest, sig, BuildConfig.OTA_ED25519_PUBLIC_KEY_B64)) {
                    Log.w(TAG, "[ota] install-rejected bad-signature");
                    call.reject("bad-signature");
                    return;
                }
                JSONObject m = new JSONObject(new String(manifest, StandardCharsets.UTF_8));
                String version = m.getString("version");
                if (!VERSION_NAME_PATTERN.matcher(version).matches()) {
                    Log.w(TAG, "[ota] install-rejected bad-version-name: " + version);
                    call.reject("bad-version-name");
                    return;
                }
                // G2 逆向门槛：bundle 要求的宿主 APK 下限（进签名覆盖，发布端无法事后篡改）
                String minApkVersion = m.optString("minApkVersion", "");
                if (!minApkVersion.isEmpty()
                        && !OtaSignatureVerifier.isApkVersionAtLeast(BuildConfig.VERSION_NAME, minApkVersion)) {
                    Log.w(TAG, "[ota] install-rejected apk-too-old host=" + BuildConfig.VERSION_NAME
                            + " minApkVersion=" + minApkVersion);
                    call.reject("apk-too-old");
                    return;
                }
                byte[] zip = httpGet(base + "-web-bundle.zip");
                long declaredSize = m.optLong("size", -1);
                if (declaredSize >= 0 && zip.length != declaredSize) {
                    Log.w(TAG, "[ota] install-rejected size-mismatch " + zip.length + " != " + declaredSize);
                    call.reject("size-mismatch");
                    return;
                }
                String sha256 = OtaSignatureVerifier.sha256Hex(zip);
                if (!sha256.equals(m.getString("sha256"))) {
                    Log.w(TAG, "[ota] install-rejected checksum");
                    call.reject("checksum");
                    return;
                }
                File dir = unpack(zip, version);
                if (dir == null) {
                    Log.w(TAG, "[ota] install-rejected unzip-missing-index");
                    call.reject("unzip-missing-index");
                    return;
                }
                prefs().edit().putString(KEY_PENDING, version).commit();
                Log.i(TAG, "[ota] install-ok version=" + version + " 耗时=" + (System.currentTimeMillis() - t0)
                        + "ms → pending（下次启动生效）");
                JSObject r = new JSObject();
                r.put("ok", true);
                r.put("version", version);
                call.resolve(r);
            } catch (Exception e) {
                Log.w(TAG, "[ota] install-failed " + e, e);
                call.reject("error: " + e.getMessage());
            }
        }, "ota-install").start();
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
        File root = versionsRoot();
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
        File root = versionsRoot();
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

    private File versionsRoot() {
        return new File(getContext().getFilesDir(), "ota/versions");
    }

    private File versionDir(String version) {
        return new File(versionsRoot(), version);
    }

    /**
     * 解压到 versions/<version>/：zip-slip 防护（canonical path 越界拒绝）；要求解压后存在
     * index.html；同版本重装先删旧目录再 rename（幂等，坑④——否则 renameTo 必败）。
     */
    private File unpack(byte[] zip, String version) throws Exception {
        File dir = versionDir(version);
        File tmp = new File(getContext().getFilesDir(), "ota/versions/tmp-" + System.currentTimeMillis());
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

    private static byte[] httpGet(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10_000);
        c.setReadTimeout(15_000);
        c.setInstanceFollowRedirects(true);
        int code = c.getResponseCode();
        if (code != 200) {
            throw new IllegalStateException("HTTP " + code + " for " + url);
        }
        InputStream in = c.getInputStream();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        long total = 0;
        int n;
        while ((n = in.read(buf)) > 0) {
            total += n;
            if (total > MAX_DOWNLOAD_BYTES) {
                throw new IllegalStateException("download exceeds cap: " + url);
            }
            out.write(buf, 0, n);
        }
        in.close();
        return out.toByteArray();
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
