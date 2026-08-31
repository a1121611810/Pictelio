package io.pictelio.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

/**
 * client 切换重启 Native Module（#51）。
 *
 * <p>JS 侧访问：{@code NativeModules.PictelioApp}。回调契约（第二参区分错误）：
 * <ul>
 *   <li>{@code setClientKind(kind, cb)}：成功 {@code cb(null)}；失败 {@code cb(errMsg)}</li>
 *   <li>{@code getClientKind(cb)}：成功 {@code cb(kind, null)}；失败 {@code cb(null, errMsg)}</li>
 *   <li>{@code restart(cb)}：成功 {@code cb(null)}；失败 {@code cb(errMsg)}</li>
 *   <li>{@code exitApp(cb)}：成功 {@code cb(null)}；失败 {@code cb(errMsg)}（ADR-0066）</li>
 *   <li>{@code exportDiagLog(text, cb)}：成功 {@code cb(null)}；失败 {@code cb(errMsg)}
 *       （T0-DIAG 临时通道：无可用分享应用时日志已写盘，回调可读提示而非失败）</li>
 * </ul>
 *
 * <p>{@code setClientKind} 落盘文件必须是 {@code "CapacitorStorage"} ——
 * 与 {@code @capacitor/preferences} 默认 group、MainActivity 分发读取的是同一文件，
 * 保证 webview/lynx 两侧读到同一开关。
 */
public class PictelioAppModule extends LynxModule {

    private static final String TAG = "PictelioAppModule";

    /** SharedPreferences 文件（@capacitor/preferences 默认 group，勿改） */
    public static final String CLIENT_PREFS = "CapacitorStorage";
    /** client 开关 key（app-lynx clientSwitchStore 同名） */
    public static final String CLIENT_KEY = "pictelio_client_kind";

    /** httpGet 线程池（阻塞 IO 不占 Lynx 调用线程；同 PictelioApiModule 模式） */
    private static final java.util.concurrent.ExecutorService HTTP_EXECUTOR =
            java.util.concurrent.Executors.newCachedThreadPool();

    /** 诊断日志导出目录（app 外部私有目录，无需权限；adb 可 pull） */
    private static final String DIAG_DIR = "diag";

    /** httpGet 响应体大小上限（version.json 极小；防异常端点导致 OOM） */
    private static final int MAX_HTTP_BODY_BYTES = 1024 * 1024;

    /** 受限读取响应体（超限抛 IOException → 走 cb(0, errMsg)） */
    private static String readLimitedBody(okhttp3.ResponseBody body, int max) throws java.io.IOException {
        okio.BufferedSource src = body.source();
        byte[] buf = new byte[max + 1];
        int read = 0;
        while (read <= max) {
            int n = src.read(buf, read, max + 1 - read);
            if (n == -1) break;
            read += n;
            if (read > max) throw new java.io.IOException("响应体超过上限 " + max);
        }
        return new String(buf, 0, read, java.nio.charset.StandardCharsets.UTF_8);
    }

    public PictelioAppModule(Context context) {
        super(context);
    }

    private Context appContext() {
        return ((LynxContext) mContext).getContext();
    }

    @LynxMethod
    public void setClientKind(String kind, Callback callback) {
        try {
            appContext()
                    .getSharedPreferences(CLIENT_PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(CLIENT_KEY, kind)
                    .apply();
            callback.invoke();
        } catch (Exception e) {
            Log.w(TAG, "setClientKind(" + kind + ") 失败", e);
            callback.invoke(String.valueOf(e.getMessage()));
        }
    }

    @LynxMethod
    public void getClientKind(Callback callback) {
        try {
            String stored = appContext()
                    .getSharedPreferences(CLIENT_PREFS, Context.MODE_PRIVATE)
                    .getString(CLIENT_KEY, "webview");
            // ADR-0062：归一化——存储值不在当前包支持列表时回退到包默认引擎
            // （如 full 包切到 lynx 后换装 lynx-only 包，残留 "webview" → 归一为 "lynx"）
            String kind = containsKind(stored) ? stored : BuildConfig.CLIENT_KINDS[0];
            callback.invoke(kind);
        } catch (Exception e) {
            Log.w(TAG, "getClientKind 失败", e);
            callback.invoke(String.valueOf(e.getMessage()));
        }
    }

    /**
     * 返回当前包支持的 client 引擎列表（ADR-0062）。
     * full → ["webview","lynx"]；webview → ["webview"]；lynx → ["lynx"]。
     * JS 侧据此决定是否渲染引擎切换入口。
     */
    @LynxMethod
    public void getClientKinds(Callback callback) {
        try {
            callback.invoke(BuildConfig.CLIENT_KINDS);
        } catch (Exception e) {
            Log.w(TAG, "getClientKinds 失败", e);
            callback.invoke(String.valueOf(e.getMessage()));
        }
    }

    private static boolean containsKind(String kind) {
        for (String k : BuildConfig.CLIENT_KINDS) {
            if (k.equals(kind)) return true;
        }
        return false;
    }

    @LynxMethod
    public void restart(Callback callback) {
        try {
            Context ctx = appContext();
            // 通过 PackageManager 获取 LAUNCHER intent，避免硬编码 Activity 类
            // （lynx flavor 无 MainActivity，full flavor LAUNCHER 是 MainActivity）
            Intent intent = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            if (intent == null) {
                callback.invoke("无法获取 LAUNCHER intent");
                return;
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            ctx.startActivity(intent);
            callback.invoke();
            // 不 killProcess（issue #120/#124）：Activity 级切换，进程保留——
            // token 内存态 / OkHttp 连接池 / 图片磁盘缓存延续；旧 Activity（LynxActivity）
            // 被 CLEAR_TASK 销毁后 LynxView.destroy() 释放资源。与 webview 侧
            // ClientInfoPlugin.restart 语义对齐（双向行为一致）。
            // 降级分支：若实测 LynxView.destroy() 释放不净，可恢复 300ms 延迟
            // killProcess（lynx 官方模式）——仅开关一个 flag，架构不变。
        } catch (Exception e) {
            Log.w(TAG, "restart 失败", e);
            callback.invoke(String.valueOf(e.getMessage()));
        }
    }

    /**
     * 退出 Lynx 宿主 Activity（ADR-0066 系统返回桥：JS 根路由双击退出时调用）。
     * 主线程执行 finish()；目标 Activity 由 LynxActivity 静态弱引用提供（onDestroy 清理），
     * 未持有引用时静默成功（Activity 已不在前台，无需退出动作）。
     */
    @LynxMethod
    public void exitApp(Callback callback) {
        try {
            LynxActivity activity = LynxActivity.current();
            if (activity != null) {
                activity.runOnUiThread(activity::finish);
            }
            callback.invoke();
        } catch (Exception e) {
            Log.w(TAG, "exitApp 失败", e);
            callback.invoke(String.valueOf(e.getMessage()));
        }
    }

    /**
     * 用系统浏览器强制打开外部 URL（检查更新跳 release 页）。
     *
     * <p>语义：外部浏览器为独立 task，app 退到后台——用户无法从浏览器"返回" app 内
     * （符合检查更新需求：强制打开新页面，无法返回上一页）。回调契约：
     * 成功 {@code cb(null)}；失败 {@code cb(errMsg)}。
     *
     * <p>安全：URL 来源为远端 version.json 字段，仅放行 http/https scheme，
     * 拒绝 {@code intent://}、{@code file://} 等任意 scheme 注入；
     * {@code resolveActivity} 为空（无浏览器）时回调错误，不抛 ActivityNotFoundException。
     */
    @LynxMethod
    public void openUrl(String url, Callback callback) {
        try {
            if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
                callback.invoke("不支持的 URL: " + url);
                return;
            }
            Intent intent = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Context ctx = appContext();
            if (intent.resolveActivity(ctx.getPackageManager()) == null) {
                callback.invoke("未找到可打开链接的应用");
                return;
            }
            ctx.startActivity(intent);
            callback.invoke();
        } catch (Exception e) {
            Log.w(TAG, "openUrl(" + url + ") 失败", e);
            callback.invoke(String.valueOf(e.getMessage()));
        }
    }

    /**
     * 通用 HTTP GET（检查更新用）：返回 status + body。
     *
     * <p>背景：原生 Lynx JS 运行时无 fetch（fetchWrapper 仅 web-core 可用，实测），
     * 检查更新在原生环境必须经此桥走 OkHttp 真实网络。回调契约（与 PictelioApi
     * 对齐）：{@code cb(status, body)}——2xx 成功时 body 为响应文本；
     * 网络/异常 {@code cb(0, errMsg)}。scheme 白名单 http/https（URL 来源为远端
     * version.json 字段，防御 file:// 等 scheme 注入）；callTimeout 10s 与 JS 侧
     * AbortController 同值兜底。线程池执行，不占 Lynx 调用线程（同 PictelioApiModule）。
     */
    @LynxMethod
    public void httpGet(String url, Callback callback) {
        try {
            if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
                callback.invoke(0, "不支持的 URL: " + url);
                return;
            }
            HTTP_EXECUTOR.execute(() -> {
                try {
                    okhttp3.OkHttpClient shortClient = PixivApiCore.getSharedClient().newBuilder()
                            .callTimeout(10_000, java.util.concurrent.TimeUnit.MILLISECONDS)
                            .build();
                    okhttp3.Request req = new okhttp3.Request.Builder().url(url).get().build();
                    try (okhttp3.Response resp = shortClient.newCall(req).execute()) {
                        okhttp3.ResponseBody rb = resp.body();
                        String body = rb != null ? readLimitedBody(rb, MAX_HTTP_BODY_BYTES) : "";
                        callback.invoke(resp.code(), body);
                    }
                } catch (Exception e) {
                    Log.w(TAG, "httpGet(" + url + ") 失败", e);
                    String errMsg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                    callback.invoke(0, errMsg);
                }
            });
        } catch (Exception e) {
            Log.w(TAG, "httpGet(" + url + ") 失败", e);
            callback.invoke(0, String.valueOf(e.getMessage()));
        }
    }

    /**
     * 导出诊断日志（T0-DIAG 临时通道，真机取证）：把 JS 侧日志文本写入
     * 外部私有目录（adb 可 pull），并弹出 Android 分享面板（微信/邮件/保存文件）。
     * 回调契约：成功 {@code cb(null)}；失败 {@code cb(errMsg)}。
     * 分享面板无可用应用时仍成功（文件已落盘，错误信息返回给 JS 提示）。
     */
    @LynxMethod
    public void exportDiagLog(String text, Callback callback) {
        try {
            Context ctx = appContext();
            java.io.File dir = new java.io.File(ctx.getExternalFilesDir(null), DIAG_DIR);
            if (!dir.exists() && !dir.mkdirs()) {
                throw new java.io.IOException("无法创建诊断目录: " + dir);
            }
            java.io.File file = new java.io.File(dir, "diag-" + System.currentTimeMillis() + ".txt");
            java.nio.file.Files.write(
                    file.toPath(),
                    text.getBytes(java.nio.charset.StandardCharsets.UTF_8));

            Intent share = new Intent(Intent.ACTION_SEND);
            share.setType("text/plain");
            share.putExtra(Intent.EXTRA_SUBJECT, "Pictelio lynx 诊断日志");
            share.putExtra(Intent.EXTRA_TEXT, text);
            share.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (share.resolveActivity(ctx.getPackageManager()) == null) {
                callback.invoke("无可用分享应用（日志已写入 " + file.getAbsolutePath() + "）");
                return;
            }
            ctx.startActivity(Intent.createChooser(share, "导出诊断日志"));
            callback.invoke();
        } catch (Exception e) {
            Log.w(TAG, "exportDiagLog 失败", e);
            callback.invoke(String.valueOf(e.getMessage()));
        }
    }
}
