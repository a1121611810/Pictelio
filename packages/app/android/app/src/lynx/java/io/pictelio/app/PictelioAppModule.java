package io.pictelio.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.util.Log;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

import io.pictelio.app.engine.EnginePrefs;

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
 * <p>{@code setClientKind} 落盘文件必须是 {@code "CapacitorStorage"}（键/文件常量
 * 别名 {@link EnginePrefs}——引擎键唯一所有者，ADR-0164 决策 3）——
 * 与 {@code @capacitor/preferences} 默认 group、MainActivity 分发读取的是同一文件，
 * 保证 webview/lynx 两侧读到同一开关。
 */
public class PictelioAppModule extends LynxModule {

    private static final String TAG = "PictelioAppModule";

    /** SharedPreferences 文件（@capacitor/preferences 默认 group，勿改；别名 EnginePrefs 单一所有者） */
    public static final String CLIENT_PREFS = EnginePrefs.PREFS_FILE;
    /** client 开关 key（app-lynx clientSwitchStore 同名；别名 EnginePrefs 单一所有者） */
    public static final String CLIENT_KEY = EnginePrefs.KEY_PREFERRED_KIND;

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
            // S12（ADR-0164 决策 9）：显式选择清失败记忆——否则残留记忆会在下次启动
            // 被 S4 弹回 webview，显式选择失效。
            try {
                EnginePrefs.clearLynxFailure(appContext());
            } catch (Exception clearEx) {
                Log.w(TAG, "clearLynxFailure 失败（显式选择可能被失败记忆覆盖）", clearEx);
            }
            callback.invoke();
        } catch (Exception e) {
            Log.w(TAG, "setClientKind(" + kind + ") 失败", e);
            callback.invoke(String.valueOf(e.getMessage()));
        }
    }

    @LynxMethod
    public void getClientKind(Callback callback) {
        try {
            // 缺省读 null（非 "webview"）：absent → containsKind 归一化 → CLIENT_KINDS[0]
            //（= 本包缺省引擎，full 包翻转后为 lynx，ADR-0164 决策 1）。
            String stored = appContext()
                    .getSharedPreferences(CLIENT_PREFS, Context.MODE_PRIVATE)
                    .getString(CLIENT_KEY, null);
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
     * 返回 LynxView 内容区尺寸（px，ADR-0131）。
     *
     * <p>背景：SystemInfo（pixelWidth/pixelHeight）返回的是全屏物理尺寸，而 LynxView
     * 内容区撇除系统导航条 inset（手势条/3 键导航），放射导航 FAB 按全屏高定位导致
     * 底部被裁。本方法把内容区实际尺寸回传 JS，订正底部几何。
     *
     * <p>回调契约：{@code cb(w, h)}——未布局完成时 {@code cb(-1, -1)}，JS 侧回退
     * SystemInfo 计算；异常同样 {@code cb(-1, -1)}（不抛）。单位：物理 px，
     * 与 {@code SystemInfo.pixelWidth} 同基准。
     */
    @LynxMethod
    public void getViewportSize(Callback callback) {
        try {
            int[] size = LynxActivity.contentSize();
            if (size == null) {
                callback.invoke(-1, -1);
                return;
            }
            callback.invoke(size[0], size[1]);
        } catch (Exception e) {
            Log.w(TAG, "getViewportSize 失败", e);
            callback.invoke(-1, -1);
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
     * 拉取当前系统栏安全 insets（spec docs/specs/lynx-systembars.md D2）。
     *
     * <p>JS 侧订阅 {@code pictelioInsets} 事件后调用本方法拉当前值——**订阅后拉**而非
     * 依赖初始事件：insets 首次分发发生在视图 attach 期，几乎必然早于 JS 订阅
     * （benchNav 四次广播同族的竞态），纯推模式首帧必丢。回调契约：
     * {@code cb(top, bottom)}——数值 px，与 {@code SystemInfo.pixelWidth} 同基准；
     * 异常 {@code cb(0, 0)}（不抛）。
     */
    @LynxMethod
    public void getSafeAreaInsets(Callback callback) {
        try {
            callback.invoke(LynxActivity.currentSafeTop(), LynxActivity.currentSafeBottom());
        } catch (Exception e) {
            Log.w(TAG, "getSafeAreaInsets 失败", e);
            callback.invoke(0, 0);
        }
    }

    /**
     * 全屏模式运行时切换（spec D5：设置内「全屏模式」开关的落地通道）。
     * 主线程执行 {@link LynxActivity#applySystemBarsHidden}；未持有 Activity 引用时
     * 静默成功（无宿主可切换，冷启动读键路径兜底）。回调契约：成功 {@code cb()}；
     * 失败 {@code cb(errMsg)}。
     */
    @LynxMethod
    public void setSystemBarsHidden(boolean hidden, Callback callback) {
        try {
            LynxActivity activity = LynxActivity.current();
            if (activity != null) {
                activity.runOnUiThread(() -> LynxActivity.applySystemBarsHidden(activity, hidden));
            }
            callback.invoke();
        } catch (Exception e) {
            Log.w(TAG, "setSystemBarsHidden(" + hidden + ") 失败", e);
            callback.invoke(String.valueOf(e.getMessage()));
        }
    }

    /**
     * 拉取当前系统暗色 uiMode（spec docs/specs/lynx-night-mode.md T1 §4.3）。
     *
     * <p>JS 侧订阅 {@code pictelioDarkMode} 事件后调用本方法拉当前值——**订阅后拉**
     * 而非依赖初始事件：onCreate 初始化早于 JS 订阅（lynx 4.0.1 实测 bundle 渲染晚于
     * Activity onConfigurationChanged 首回调），纯推模式首帧必丢；事件只负责后续变化
     * （onConfigurationChanged 比对变化 + onResume 兜底补发）。回调契约：{@code cb(mode)}
     * —— mode 为字符串 {@code "light"} 或 {@code "dark"}（与 JS utils/darkMode.ts
     * parseNativePayload 裸字符串分支兼容）；异常 {@code cb("light")}（兜底禁静默降级）。
     *
     * <p>配置缺失（如未走 onCreate 路径）→ sLastUiMode = -1 → 走 Configuration 实读；
     * 防御性兜底到 UI_MODE_NIGHT_NO（"light"），避免负值导致 UI_MODE_NIGHT_MASK 位运算后
     * 误判为夜间模式。
     */
    @LynxMethod
    public void getDarkMode(Callback callback) {
        try {
            int uiMode = LynxActivity.lastUiMode();
            if (uiMode == -1) {
                Configuration cfg = appContext().getResources().getConfiguration();
                uiMode = cfg.uiMode & Configuration.UI_MODE_NIGHT_MASK;
            }
            callback.invoke(LynxActivity.currentDarkMode(uiMode));
        } catch (Exception e) {
            Log.w(TAG, "getDarkMode 失败", e);
            callback.invoke("light");
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
