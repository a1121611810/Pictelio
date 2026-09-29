package io.pictelio.app;

import android.content.Context;
import android.util.Base64;
import android.util.Log;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import io.pictelio.app.WebDavClient.DavEntry;
import io.pictelio.app.WebDavClient.DavException;

/**
 * WebDAV Native Module（ADR-0156 D1 双薄桥之一，lynx 侧）。
 *
 * <p>JS 侧访问：{@code NativeModules.PictelioWebDav}。
 * 回调契约（Callback.invoke；<b>无 null 参数</b>——CallbackImpl 对 null 崩，真机实测，
 * 同 PictelioPrefsModule 注释）：统一 {@code cb(code, payload)} 形态——
 * code 0 = 成功，payload 按方法约定（空串 / base64 / JSON 字符串）；
 * code 1 = 失败，payload 为 JSON 错误对象字符串
 * {@code {"kind": "<DavException.Kind>", "statusCode": n, "message": "..."}}
 * （kind 枚举：AUTH_FAILED / FORBIDDEN / NOT_FOUND / QUOTA_EXCEEDED / CONFLICT /
 * NETWORK / SERVER / CRYPTO），JS 侧映射为带 kind/statusCode 的 WebDavError。
 *
 * <p>字节经 base64 过桥；阻塞 IO 跑模块内线程池（PictelioApiModule #130 同款），
 * 不占 Lynx 调用线程。协议逻辑全在 {@link WebDavClient} / {@link BackupCrypto}。
 */
public class PictelioWebDavModule extends LynxModule {

    private static final String TAG = "PictelioWebDavModule";

    private static final ExecutorService EXECUTOR = Executors.newCachedThreadPool();

    public PictelioWebDavModule(Context context) {
        super(context);
    }

    @LynxMethod
    public void ensureDir(String url, String user, String password, Callback callback) {
        run(callback, () -> {
            client(user, password).ensureDir(url);
            return "";
        });
    }

    @LynxMethod
    public void upload(String url, String user, String password, String base64, Callback callback) {
        run(callback, () -> {
            client(user, password).upload(url, decode(base64));
            return "";
        });
    }

    @LynxMethod
    public void uploadWithVerify(String url, String user, String password, String base64,
                                 Double maxAttempts, Callback callback) {
        int attempts = maxAttempts == null ? WebDavClient.VERIFY_MAX_ATTEMPTS : maxAttempts.intValue();
        run(callback, () -> {
            client(user, password).uploadWithVerify(url, decode(base64), attempts);
            return "";
        });
    }

    @LynxMethod
    public void download(String url, String user, String password, Callback callback) {
        run(callback, () -> encode(client(user, password).download(url)));
    }

    @LynxMethod
    public void list(String url, String user, String password, Callback callback) {
        run(callback, () -> entriesToJson(client(user, password).list(url)));
    }

    @LynxMethod
    public void stat(String url, String user, String password, Callback callback) {
        run(callback, () -> entryToJson(client(user, password).stat(url)).toString());
    }

    @LynxMethod
    public void delete(String url, String user, String password, Callback callback) {
        run(callback, () -> {
            client(user, password).delete(url);
            return "";
        });
    }

    @LynxMethod
    public void prune(String dirUrl, String user, String password, String prefix,
                      Double keep, Callback callback) {
        int keepN = keep == null ? WebDavClient.KEEP_BACKUPS : keep.intValue();
        run(callback, () -> new JSONArray(client(user, password).prune(dirUrl, prefix, keepN)).toString());
    }

    @LynxMethod
    public void encrypt(String base64, String password, Callback callback) {
        run(callback, () -> encode(BackupCrypto.encrypt(decode(base64), password.toCharArray())));
    }

    @LynxMethod
    public void decrypt(String base64, String password, Callback callback) {
        run(callback, () -> encode(BackupCrypto.decrypt(decode(base64), password.toCharArray())));
    }

    @LynxMethod
    public void isEncrypted(String base64, Callback callback) {
        run(callback, () -> BackupCrypto.isEncrypted(decode(base64)) ? "true" : "false");
    }

    // ── 薄桥内部 ──

    /** 包可见：JVM 行为测试直接驱动（验证 Callback 双参契约） */
    interface Op {
        String exec() throws Exception;
    }

    /** 阻塞 IO 线程池执行；成功/失败统一双参回调（无 null） */
    /** 包可见：JVM 行为测试直接驱动 */
    static void run(Callback callback, Op op) {
        EXECUTOR.execute(() -> {
            try {
                callback.invoke(0, op.exec());
            } catch (DavException e) {
                Log.w(TAG, "WebDAV 操作失败: " + e.getMessage());
                callback.invoke(1, errorJson(e.kind.name(), e.statusCode, e.getMessage()));
            } catch (BackupCrypto.CryptoException e) {
                Log.w(TAG, "加解密失败: " + e.getMessage());
                callback.invoke(1, errorJson("CRYPTO", -1, e.getMessage()));
            } catch (Exception e) {
                Log.w(TAG, "WebDAV 未分类失败", e);
                callback.invoke(1, errorJson("SERVER", -1, "WebDAV 操作失败: " + e.getMessage()));
            }
        });
    }

    private static WebDavClient client(String user, String password) {
        return new WebDavClient(user == null ? "" : user, password == null ? "" : password);
    }

    private static byte[] decode(String base64) {
        return Base64.decode(base64 == null ? "" : base64, Base64.DEFAULT);
    }

    private static String encode(byte[] data) {
        return Base64.encodeToString(data, Base64.NO_WRAP);
    }

    /** 包可见：JVM 契约测试直接断言 JSON 形状（TS 桥解析面） */
    static String errorJson(String kind, int statusCode, String message) {
        try {
            JSONObject o = new JSONObject();
            o.put("kind", kind);
            o.put("statusCode", statusCode);
            o.put("message", message == null ? "" : message);
            return o.toString();
        } catch (JSONException e) {
            return "{\"kind\":\"SERVER\",\"statusCode\":-1,\"message\":\"error json failed\"}";
        }
    }

    /** 包可见：JVM 契约测试直接断言 JSON 形状 */
    static JSONObject entryToJson(DavEntry e) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("href", e.href);
        o.put("isCollection", e.isCollection);
        o.put("contentLength", e.contentLength == null ? JSONObject.NULL : e.contentLength);
        return o;
    }

    /** 包可见：JVM 契约测试直接断言 JSON 形状 */
    static String entriesToJson(List<DavEntry> entries) throws JSONException {
        JSONArray arr = new JSONArray();
        for (DavEntry e : entries) arr.put(entryToJson(e));
        return arr.toString();
    }
}
