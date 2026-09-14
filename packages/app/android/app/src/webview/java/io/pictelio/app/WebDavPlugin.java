package io.pictelio.app;

import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;

import io.pictelio.app.WebDavClient.DavEntry;
import io.pictelio.app.WebDavClient.DavException;

/**
 * WebDAV Capacitor 插件（webview 壳，ADR-0156 D1 双薄桥之一）。
 *
 * <p>JS：{@code WebDav.<verb>({ url, user, password, ... })}；字节经 base64 过桥。
 * 薄桥职责仅参数/回调形态转换 + 错误分类映射，协议逻辑全在 {@link WebDavClient} /
 * {@link BackupCrypto}（单一事实源，纯 JVM 可测）。
 *
 * <p>错误契约：{@code reject(message, code)}——code = DavException.kind 名
 * （AUTH_FAILED / FORBIDDEN / NOT_FOUND / QUOTA_EXCEEDED / CONFLICT / NETWORK / SERVER），
 * JS 侧 {@code src/native/WebDav.ts} 映射为带 kind/statusCode 的 WebDavError。
 * 阻塞 IO 跑后台线程（NetDiagPlugin 同款模式）。
 */
@CapacitorPlugin(name = "WebDav")
public class WebDavPlugin extends Plugin {

    private static WebDavClient client(String user, String password) {
        return new WebDavClient(user, password);
    }

    @PluginMethod
    public void ensureDir(PluginCall call) {
        run(call, () -> {
            client(credsUser(call), credsPassword(call))
                    .ensureDir(required(call, "url"));
            return new JSObject();
        });
    }

    @PluginMethod
    public void upload(PluginCall call) {
        run(call, () -> {
            client(credsUser(call), credsPassword(call))
                    .upload(required(call, "url"), body64(call));
            return new JSObject();
        });
    }

    @PluginMethod
    public void uploadWithVerify(PluginCall call) {
        run(call, () -> {
            int maxAttempts = call.getInt("maxAttempts", WebDavClient.VERIFY_MAX_ATTEMPTS);
            client(credsUser(call), credsPassword(call))
                    .uploadWithVerify(required(call, "url"), body64(call), maxAttempts);
            return new JSObject();
        });
    }

    @PluginMethod
    public void download(PluginCall call) {
        run(call, () -> {
            byte[] data = client(credsUser(call), credsPassword(call))
                    .download(required(call, "url"));
            return result("base64", Base64.encodeToString(data, Base64.NO_WRAP));
        });
    }

    @PluginMethod
    public void list(PluginCall call) {
        run(call, () -> {
            List<DavEntry> entries = client(credsUser(call), credsPassword(call))
                    .list(required(call, "url"));
            return result("entries", entriesToJson(entries));
        });
    }

    @PluginMethod
    public void stat(PluginCall call) {
        run(call, () -> {
            DavEntry entry = client(credsUser(call), credsPassword(call))
                    .stat(required(call, "url"));
            return result("entry", entryToJson(entry));
        });
    }

    @PluginMethod
    public void delete(PluginCall call) {
        run(call, () -> {
            client(credsUser(call), credsPassword(call))
                    .delete(required(call, "url"));
            return new JSObject();
        });
    }

    @PluginMethod
    public void prune(PluginCall call) {
        run(call, () -> {
            int keep = call.getInt("keep", WebDavClient.KEEP_BACKUPS);
            List<String> deleted = client(credsUser(call), credsPassword(call))
                    .prune(required(call, "url"), required(call, "prefix"), keep);
            return result("deleted", new JSArray(deleted));
        });
    }

    @PluginMethod
    public void encrypt(PluginCall call) {
        run(call, () -> {
            byte[] out = BackupCrypto.encrypt(body64(call), required(call, "password").toCharArray());
            return result("base64", Base64.encodeToString(out, Base64.NO_WRAP));
        });
    }

    @PluginMethod
    public void decrypt(PluginCall call) {
        run(call, () -> {
            byte[] out = BackupCrypto.decrypt(body64(call), required(call, "password").toCharArray());
            return result("base64", Base64.encodeToString(out, Base64.NO_WRAP));
        });
    }

    @PluginMethod
    public void isEncrypted(PluginCall call) {
        run(call, () -> result("encrypted", BackupCrypto.isEncrypted(body64(call))));
    }

    // ── 薄桥内部 ──

    private interface Op {
        JSObject exec() throws Exception;
    }

    /** 阻塞 IO 后台线程执行（NetDiagPlugin 同款）；错误分类映射到 reject code */
    private void run(PluginCall call, Op op) {
        new Thread(() -> {
            try {
                call.resolve(op.exec());
            } catch (DavException e) {
                // 第 4 参 data 经 Capacitor 原样拷进 JS 异常（native-bridge returnResult），
                // TS 侧读 err.data.statusCode —— 与 lynx 桥的 statusCode 语义对齐（spec §5）
                call.reject(e.getMessage(), e.kind.name(), null, statusData(e.statusCode));
            } catch (BackupCrypto.CryptoException e) {
                call.reject(e.getMessage(), "CRYPTO");
            } catch (Exception e) {
                call.reject("WebDAV 操作失败: " + e.getMessage(), "SERVER");
            }
        }, "webdav").start();
    }

    private static JSObject statusData(int statusCode) {
        JSObject data = new JSObject();
        data.put("statusCode", statusCode);
        return data;
    }

    private static String required(PluginCall call, String key) {
        String v = call.getString(key);
        if (v == null || v.isEmpty()) throw new IllegalArgumentException("缺参数: " + key);
        return v;
    }

    private static String credsUser(PluginCall call) {
        return call.getString("user", "");
    }

    private static String credsPassword(PluginCall call) {
        return call.getString("password", "");
    }

    private static byte[] body64(PluginCall call) {
        // 空 base64 是合法输入（空字节数组；与 lynx 桥 decode 语义一致）——不得用 required 判缺参
        String b64 = call.getString("base64", "");
        return Base64.decode(b64, Base64.DEFAULT);
    }

    private static JSObject result(String key, Object value) throws JSONException {
        JSObject o = new JSObject();
        o.put(key, value);
        return o;
    }

    private static JSONObject entryToJson(DavEntry e) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("href", e.href);
        o.put("isCollection", e.isCollection);
        o.put("contentLength", e.contentLength == null ? JSONObject.NULL : e.contentLength);
        return o;
    }

    private static JSArray entriesToJson(List<DavEntry> entries) throws JSONException {
        JSArray arr = new JSArray();
        for (DavEntry e : entries) arr.put(entryToJson(e));
        return arr;
    }
}
