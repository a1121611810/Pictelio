package io.pictelio.nuxtproto;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters;
import org.bouncycastle.crypto.signers.Ed25519Signer;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * PROTOTYPE（#245）— OTA 机制原型插件：下载 → Ed25519 验签 → 解压版本目录 → 指针 → 静默下次生效 →
 * notifyReady 超时自动回滚。机制语义对齐 #241 结论（版本目录不可变 + 单指针 + 整页 reload）。
 * 指针状态：current（"public"=APK 内置 / 目录名）/ lastGood / pending。
 */
@CapacitorPlugin(name = "Ota")
public class OtaPlugin extends Plugin {

    static final String TAG = "OtaPlugin";
    static final String PREFS = "ota_proto";
    static final String KEY_CURRENT = "current";
    static final String KEY_LAST_GOOD = "lastGood";
    static final String KEY_PENDING = "pending";
    /** 域分隔前缀：防跨协议签名重用（#242 结论） */
    static final String SIGN_PREFIX = "Pictelio-OTA-bundle-v1\n";
    /** 内置公钥（raw 32B base64）——生产应走 buildConfigField 注入，原型硬编码占位 */
    static final String PUB_B64 = "ST/sQxNxrrZXOWwiuKdqqp79p3njn6MvIMWwJQTXWQY=";
    static final long ROLLBACK_TIMEOUT_MS = 10_000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private volatile boolean readyAcked = false;
    private Runnable rollbackRunnable;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** 插件加载即应用指针（早于 WebView 首次 loadUrl），并武装回滚定时器 */
    @Override
    public void load() {
        String pending = prefs().getString(KEY_PENDING, null);
        boolean adopted = false;
        if (pending != null) {
            prefs().edit().putString(KEY_CURRENT, pending).remove(KEY_PENDING).commit();
            Log.i(TAG, "[OTAPROTO] adopt-pending current=" + pending);
            adopted = true;
        }
        if (adopted) {
            // 切换延迟到 WebView 必然就绪的时点：plugin.load() 时立即 setServerBasePath/
            // hostFiles 会与 WebView 首次导航赛跑（实测两种时机都会输）—— adopt+500ms 再
            // 切根 + 版本化 query 导航，旧文档闪一帧但被 notifyReady 版本握手挡住误报
            final String cur = prefs().getString(KEY_CURRENT, "public");
            handler.postDelayed(() -> {
                applyPointer();
                WebView wv = bridge.getWebView();
                if (wv == null) {
                    Log.w(TAG, "[OTAPROTO] versioned-nav skipped: webview null");
                    return;
                }
                wv.loadUrl("https://localhost/index.html?otav=" + cur);
                wv.clearHistory();
            }, 500);
        }
        armRollbackIfNeeded();
    }

    private void applyPointer() {
        String current = prefs().getString(KEY_CURRENT, "public");
        try {
            // 官方高层原语（#1228 背书）：setServerBasePath/setServerAssetPath 内部做 hostFiles + 重载处理；
            // 裸调 getLocalServer().hostFiles() 在 plugin.load() 时机实测不生效（原型踩坑记录）
            if ("public".equals(current)) {
                bridge.setServerAssetPath("public");
            } else {
                File dir = versionDir(current);
                if (new File(dir, "index.html").exists()) {
                    bridge.setServerBasePath(dir.getAbsolutePath());
                } else {
                    Log.w(TAG, "version dir 缺 index.html，回退内置");
                    bridge.setServerAssetPath("public");
                }
            }
            Log.i(TAG, "[OTAPROTO] applyPointer → " + current);
        } catch (Exception e) {
            Log.w(TAG, "applyPointer failed", e);
        }
    }

    private void armRollbackIfNeeded() {
        readyAcked = false;
        if (rollbackRunnable != null) handler.removeCallbacks(rollbackRunnable);
        String current = prefs().getString(KEY_CURRENT, "public");
        if ("public".equals(current)) return; // 内置 bundle 无需回滚保护
        rollbackRunnable = () -> {
            if (readyAcked) return;
            String lastGood = prefs().getString(KEY_LAST_GOOD, "public");
            Log.w(TAG, "[OTAPROTO] rollback-timeout current=" + current + " → 回滚到 " + lastGood);
            prefs().edit().putString(KEY_CURRENT, lastGood).remove(KEY_PENDING).commit();
            applyPointer();
            reload();
        };
        handler.postDelayed(rollbackRunnable, ROLLBACK_TIMEOUT_MS);
    }

    private void reload() {
        final WebView wv = bridge.getWebView();
        if (wv == null) return;
        // 双保险 2：版本化 query 破 index.html 的导航缓存（子资源为 hash 文件名，天然无此问题）
        String current = prefs().getString(KEY_CURRENT, "public");
        wv.post(() -> {
            wv.loadUrl("https://localhost/index.html?otav=" + current);
            wv.clearHistory();
        });
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject o = new JSObject();
        o.put("current", prefs().getString(KEY_CURRENT, "public"));
        o.put("lastGood", prefs().getString(KEY_LAST_GOOD, "public"));
        o.put("pending", prefs().getString(KEY_PENDING, null));
        call.resolve(o);
    }

    /**
     * 健康上报（带版本握手）：broken bundle 走不到这里 → 10s 超时自动回滚；
     * 陈旧缓存文档（切换前旧 bundle 的 JS）也会调 notifyReady——版本不符即拒绝计数，
     * 否则坏 bundle 会被旧文档误标为健康（#245 实测发现的缓存陷阱）。
     */
    @PluginMethod
    public void notifyReady(PluginCall call) {
        String reported = call.getString("version");
        String current = prefs().getString(KEY_CURRENT, "public");
        if (reported == null || (!"public".equals(current) && !reported.equals(current))) {
            Log.w(TAG, "[OTAPROTO] notifyReady-ignored reported=" + reported + " current=" + current
                    + "（陈旧文档，不计健康）");
            call.resolve();
            return;
        }
        readyAcked = true;
        if (rollbackRunnable != null) handler.removeCallbacks(rollbackRunnable);
        prefs().edit().putString(KEY_LAST_GOOD, current).commit();
        Log.i(TAG, "[OTAPROTO] notifyReady-ok version=" + current + " → lastGood=" + current);
        call.resolve();
    }

    /** 立即应用 pending 并重载（门槛自愈 T1 路径用；常规路径走"下次启动"） */
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
     * 下载安装：manifest + .sig 验签（域分隔 + SHA-256 摘要）→ zip 下载 + 校验和 → 解压到
     * versions/<version>/ → 写 pending（"下次启动生效"，或由 applyNow 立即应用）
     */
    @PluginMethod
    public void install(PluginCall call) {
        String urlBase = call.getString("urlBase");
        if (urlBase == null || urlBase.isEmpty()) {
            call.reject("urlBase required");
            return;
        }
        new Thread(() -> {
            long t0 = System.currentTimeMillis();
            try {
                byte[] manifest = httpGet(urlBase + "/manifest.json");
                byte[] sig = Base64.decode(
                        new String(httpGet(urlBase + "/manifest.json.sig"), StandardCharsets.UTF_8).trim(),
                        Base64.DEFAULT);
                if (!verify(manifest, sig)) {
                    Log.w(TAG, "[OTAPROTO] install-rejected bad-signature");
                    call.reject("bad-signature");
                    return;
                }
                org.json.JSONObject m = new org.json.JSONObject(new String(manifest, StandardCharsets.UTF_8));
                String version = m.getString("version");
                String sha = m.getString("sha256");
                byte[] zip = httpGet(urlBase + "/bundle.zip");
                if (!sha256hex(zip).equals(sha)) {
                    Log.w(TAG, "[OTAPROTO] install-rejected checksum");
                    call.reject("checksum");
                    return;
                }
                File dir = unpack(zip, version);
                if (dir == null) {
                    Log.w(TAG, "[OTAPROTO] install-rejected unzip-missing-index");
                    call.reject("unzip-missing-index");
                    return;
                }
                prefs().edit().putString(KEY_PENDING, version).commit();
                Log.i(TAG, "[OTAPROTO] install-ok version=" + version
                        + " 耗时=" + (System.currentTimeMillis() - t0) + "ms → pending（下次启动生效）");
                JSObject r = new JSObject();
                r.put("ok", true);
                r.put("version", version);
                call.resolve(r);
            } catch (Exception e) {
                Log.w(TAG, "[OTAPROTO] install-failed " + e, e);
                call.reject("error: " + e.getMessage());
            }
        }, "ota-install").start();
    }

    /** 门槛 floor 获取（native 侧 http，绕开 https 页面对 cleartext 的 mixed-content 限制） */
    @PluginMethod
    public void fetchGate(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("url required");
            return;
        }
        new Thread(() -> {
            try {
                byte[] b = httpGet(url);
                JSObject v = JSObject.fromJSONObject(new org.json.JSONObject(new String(b, StandardCharsets.UTF_8)));
                call.resolve(v);
            } catch (Exception e) {
                call.reject("gate-fetch: " + e.getMessage());
            }
        }, "ota-gate").start();
    }

    // ── 内部工具 ──

    private boolean verify(byte[] manifest, byte[] sig) throws Exception {
        byte[] pub = Base64.decode(PUB_B64, Base64.DEFAULT);
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        md.update(SIGN_PREFIX.getBytes(StandardCharsets.UTF_8));
        md.update(manifest);
        byte[] digest = md.digest();
        Ed25519PublicKeyParameters pk = new Ed25519PublicKeyParameters(pub, 0);
        Ed25519Signer verifier = new Ed25519Signer();
        verifier.init(false, pk);
        verifier.update(digest, 0, digest.length);
        return verifier.verifySignature(sig);
    }

    private byte[] httpGet(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10_000);
        c.setReadTimeout(15_000);
        int code = c.getResponseCode();
        if (code != 200) throw new IllegalStateException("HTTP " + code + " for " + url);
        InputStream in = c.getInputStream();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toByteArray();
    }

    private static String sha256hex(byte[] data) throws Exception {
        byte[] h = MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder sb = new StringBuilder();
        for (byte b : h) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private File versionDir(String version) {
        return new File(new File(getContext().getFilesDir(), "ota/versions"), version);
    }

    /** 解压到 versions/<version>/，含 zip-slip 防护；要求解压后存在 index.html */
    private File unpack(byte[] zip, String version) throws Exception {
        File dir = versionDir(version);
        File tmp = new File(getContext().getFilesDir(), "ota/tmp-" + System.currentTimeMillis());
        tmp.mkdirs();
        String tmpRoot = tmp.getCanonicalPath() + File.separator;
        boolean hasIndex = false;
        int count = 0;
        StringBuilder names = new StringBuilder();
        ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(zip));
        ZipEntry entry;
        byte[] buf = new byte[8192];
        while ((entry = zis.getNextEntry()) != null) {
            if (count < 5) names.append(entry.getName()).append(" | ");
            count++;
            if (entry.isDirectory()) continue;
            File out = new File(tmp, entry.getName());
            if (!out.getCanonicalPath().startsWith(tmpRoot)) {
                throw new SecurityException("zip-slip: " + entry.getName());
            }
            out.getParentFile().mkdirs();
            try (FileOutputStream fos = new FileOutputStream(out)) {
                int n;
                while ((n = zis.read(buf)) > 0) fos.write(buf, 0, n);
            }
            if (entry.getName().equals("index.html")) hasIndex = true;
        }
        zis.close();
        Log.i(TAG, "[OTAPROTO] unpack entries=" + count + " hasIndex=" + hasIndex + " first=" + names);
        if (!hasIndex) {
            deleteR(tmp);
            return null;
        }
        File parent = dir.getParentFile();
        if (dir.exists()) deleteR(dir); // 幂等重装：同版本目录已存在则先删（否则 renameTo 必败）
        boolean parentOk = parent != null && (parent.isDirectory() || parent.mkdirs());
        if (!parentOk || !tmp.renameTo(dir)) {
            Log.w(TAG, "[OTAPROTO] rename failed tmp=" + tmp + " dir=" + dir + " parentOk=" + parentOk);
            deleteR(tmp);
            return null;
        }
        return dir;
    }

    private static void deleteR(File f) {
        if (f == null) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteR(k);
        f.delete();
    }
}
