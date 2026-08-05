package io.pictelio.app;

import android.content.Context;
import android.util.Log;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

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
}
