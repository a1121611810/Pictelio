package io.pictelio.app;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.util.Log;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

/**
 * 剪贴板薄桥（lynx 引擎；spec docs/specs/app-lynx-novel-text-selection.md §ID 6）。
 *
 * <p>存在理由：Lynx JS 运行时没有 {@code navigator}、引擎也没有内置剪贴板 JS API
 * （liblynx.so 内 clipboard 零命中，见 wayfinder #560 研究），自绘选中菜单的「复制」
 * 必须自建通道。
 *
 * <p>回调契约（Callback.invoke；<b>无 null</b>——真机 CallbackImpl 对 null 崩溃）：
 * {@code setText(text, cb)}——成功 {@code cb("1", "")}；失败 {@code cb("", errMsg)}。
 *
 * <p>写入是瞬时内存操作，同步执行不占线程池（对齐 {@link PictelioShareModule} 形态）。
 * Android 13+ 系统自带剪贴板预览，本模块不额外弹自家 toast。
 */
public class PictelioClipboardModule extends LynxModule {

    private static final String TAG = "PictelioClipboardModule";

    public PictelioClipboardModule(Context context) {
        super(context);
    }

    @LynxMethod
    public void setText(String text, Callback callback) {
        copyInto(((LynxContext) mContext).getContext(), text, callback);
    }

    /** 包可见：JVM 行为测试直接驱动（验证 Callback 双参契约 + 系统剪贴板落盘） */
    static void copyInto(Context context, String text, Callback callback) {
        try {
            if (text == null || text.isEmpty()) {
                callback.invoke("", "文本为空");
                return;
            }
            ClipboardManager manager =
                    (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
            if (manager == null) {
                callback.invoke("", "剪贴板服务不可用");
                return;
            }
            manager.setPrimaryClip(ClipData.newPlainText("Pictelio", text));
            callback.invoke("1", "");
        } catch (Throwable e) {
            // 失败必须带非空原因（JS 侧以 ok 标记 + 非空错误串判失败，见 utils/lynxClipboard.ts）
            String raw = e.getMessage();
            String msg = raw != null && !raw.isEmpty() ? raw : e.getClass().getSimpleName();
            Log.w(TAG, "写入剪贴板失败: " + msg);
            callback.invoke("", msg);
        }
    }
}
