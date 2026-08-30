package io.pictelio.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * OTA 安装流水线核心（#252）：快慢双通道共用同一实现——
 *  - 慢通道（T0 常规预热）：{@link OtaWorker}（WorkManager）调用，结果写 pending 下次启动生效；
 *  - 快通道（G1 门槛自愈）：{@link OtaPlugin#install}（前台直连，用户正在过渡面等待）调用。
 *
 * 流水线：manifest 拉取 → Ed25519 验签（OtaSignatureVerifier）→ minApkVersion 拒装（G2）→
 * zip 下载 → size/checksum 快检 → 解压版本目录（zip-slip 防护 + 幂等重装）→ 写 pending。
 * 纯 Context 基（不触 Capacitor bridge：Worker 无桥，指针应用在下次启动的 load() 里）。
 */
public final class OtaInstaller {

    static final String TAG = "OtaInstaller";

    /** 机器可读失败原因（OtaPlugin reject / OtaWorker failure 共用，禁静默降级） */
    public static final class OtaInstallException extends Exception {
        public final String reason;

        OtaInstallException(String reason) {
            super(reason);
            this.reason = reason;
        }
    }

    public static final class InstallResult {
        public final String version;

        InstallResult(String version) {
            this.version = version;
        }
    }

    private OtaInstaller() {
    }

    /**
     * 完整安装流水线。任何失败抛 {@link OtaInstallException}（reason 为机器可读契约值：
     * bad-signature / bad-version-name / apk-too-old / size-mismatch / checksum /
     * unzip-missing-index / error:*）。
     */
    public static InstallResult installBundle(Context context, String urlBase) throws OtaInstallException {
        long t0 = System.currentTimeMillis();
        // 资产前缀 URL 规范化：去掉尾斜杠再拼后缀（root 形态 http://host:port/ 与
        // 前缀形态 .../pictelio-4.21.0 统一；不规范化则带尾斜杠时拼出坏 URL——设备实测
        // "http://127.0.0.1:8899-manifest.json" 端口解析炸，#256 bench 抓到）
        String base = urlBase.replaceAll("/+$", "");
        try {
            byte[] manifest = httpGet(base + "-manifest.json");
            byte[] sig = Base64.decode(
                    new String(httpGet(base + "-manifest.json.sig"), StandardCharsets.UTF_8).trim(),
                    Base64.DEFAULT);
            if (!OtaSignatureVerifier.verifyManifest(manifest, sig, BuildConfig.OTA_ED25519_PUBLIC_KEY_B64)) {
                Log.w(TAG, "[ota] install-rejected bad-signature");
                throw new OtaInstallException("bad-signature");
            }
            JSONObject m = new JSONObject(new String(manifest, StandardCharsets.UTF_8));
            String version = m.getString("version");
            if (!OtaPlugin.VERSION_NAME_PATTERN.matcher(version).matches()) {
                Log.w(TAG, "[ota] install-rejected bad-version-name: " + version);
                throw new OtaInstallException("bad-version-name");
            }
            // G2 逆向门槛：bundle 要求的宿主 APK 下限（进签名覆盖，发布端无法事后篡改）
            String minApkVersion = m.optString("minApkVersion", "");
            if (!minApkVersion.isEmpty()
                    && !OtaSignatureVerifier.isApkVersionAtLeast(BuildConfig.VERSION_NAME, minApkVersion)) {
                Log.w(TAG, "[ota] install-rejected apk-too-old host=" + BuildConfig.VERSION_NAME
                        + " minApkVersion=" + minApkVersion);
                throw new OtaInstallException("apk-too-old");
            }
            byte[] zip = httpGet(base + "-web-bundle.zip");
            long declaredSize = m.optLong("size", -1);
            if (declaredSize >= 0 && zip.length != declaredSize) {
                Log.w(TAG, "[ota] install-rejected size-mismatch " + zip.length + " != " + declaredSize);
                throw new OtaInstallException("size-mismatch");
            }
            String sha256 = OtaSignatureVerifier.sha256Hex(zip);
            if (!sha256.equals(m.getString("sha256"))) {
                Log.w(TAG, "[ota] install-rejected checksum");
                throw new OtaInstallException("checksum");
            }
            File dir = OtaPlugin.unpackTo(context, zip, version);
            if (dir == null) {
                Log.w(TAG, "[ota] install-rejected unzip-missing-index");
                throw new OtaInstallException("unzip-missing-index");
            }
            prefs(context).edit().putString(OtaPlugin.KEY_PENDING, version).commit();
            Log.i(TAG, "[ota] install-ok version=" + version
                    + " 耗时=" + (System.currentTimeMillis() - t0) + "ms → pending（下次启动生效）");
            return new InstallResult(version);
        } catch (OtaInstallException e) {
            throw e;
        } catch (Exception e) {
            Log.w(TAG, "[ota] install-failed " + e, e);
            throw new OtaInstallException("error: " + e.getMessage());
        }
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(OtaPlugin.PREFS, Context.MODE_PRIVATE);
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
            if (total > OtaPlugin.MAX_DOWNLOAD_BYTES) {
                throw new IllegalStateException("download exceeds cap: " + url);
            }
            out.write(buf, 0, n);
        }
        in.close();
        return out.toByteArray();
    }
}
