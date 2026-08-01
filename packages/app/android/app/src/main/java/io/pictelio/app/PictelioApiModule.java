package io.pictelio.app;

import android.content.Context;
import android.util.Log;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

import org.json.JSONObject;

/**
 * Pixiv API 转发 Native Module（#53）——access_token Java 堆隔离，JS 零知。
 *
 * <p>JS 侧访问：{@code NativeModules.PictelioApi}。
 * 回调契约（Callback.invoke 双参；无 null）：
 * <ul>
 *   <li>{@code request(method, path, body, cb)}：cb(status, data)——status 为
 *       HTTP 状态码（int），data 为响应体字符串（JSON）；网络/转发异常
 *       cb(0, errMsg)。2xx = 成功。Java 侧附加 Bearer + Referer/UA + 401 刷新</li>
 * </ul>
 */
public class PictelioApiModule extends LynxModule {

    private static final String TAG = "PictelioApiModule";

    private static final String API_BASE = "https://app-api.pixiv.net";

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
     */
    @LynxMethod
    public void request(String method, String path, String body, Callback callback) {
        String url = API_BASE + (path == null || path.startsWith("/") ? "" : "/")
                + (path == null ? "" : path);
        final String[] rotated = {""};
        try {
            JSONObject result = PixivApiPlugin.executeRequest(method, url, body, false,
                    token -> rotated[0] = token);
            callback.invoke(result.optInt("status", 0), result.optString("data", ""), rotated[0]);
        } catch (Exception e) {
            Log.w(TAG, "request 失败: " + method + " " + path, e);
            callback.invoke(0, e.getMessage(), "");
        }
    }
}
