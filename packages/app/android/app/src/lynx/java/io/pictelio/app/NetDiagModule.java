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
 * 网络自检 Lynx Native Module。
 *
 * <p>JS：{@code NativeModules.NetDiag.diagnose(userId, cb)} -> {@code cb(jsonString)}，
 * jsonString 为 {@code {device, probes}} 或 {@code {error}}。
 * 阻塞 IO 在模块线程池执行，不占 Lynx 调用线程（同 PictelioApiModule 模式）。
 */
public class NetDiagModule extends LynxModule {

    private static final String TAG = "NetDiagModule";
    private static final ExecutorService EXECUTOR = Executors.newCachedThreadPool();

    public NetDiagModule(Context context) {
        super(context);
    }

    @LynxMethod
    public void diagnose(String userId, Callback callback) {
        final String uid = userId == null ? "" : userId;
        EXECUTOR.execute(() -> {
            try {
                Context ctx = ((LynxContext) mContext).getContext();
                JSONObject r = NetDiagProbe.run(ctx, uid);
                // 完成日志：设备验收（benchNav 深链 /network-check）以 logcat 为证据
                Log.i(TAG, "diagnose 完成: " + r.optJSONArray("probes").length() + " 项");
                callback.invoke(r.toString());
            } catch (Throwable e) {
                Log.w(TAG, "diagnose 失败", e);
                String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                callback.invoke("{\"error\":\"" + msg.replace("\"", "'") + "\"}");
            }
        });
    }
}
