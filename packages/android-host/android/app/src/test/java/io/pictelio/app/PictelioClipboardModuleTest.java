package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;

import androidx.test.core.app.ApplicationProvider;

import com.lynx.react.bridge.Callback;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * 剪贴板薄桥 JVM 行为测试（spec docs/specs/app-lynx-novel-text-selection.md §ID 6）。
 *
 * <p>oracle：① Callback 双参契约 = PictelioShareModule 的 {@code ("1","")/("", msg)} 形态，且
 * <b>禁传 null</b>（真机 CallbackImpl 崩溃，PictelioWebDavModuleTest 同款断言）；
 * ② 「写入确实到达系统剪贴板」= 回读 {@code getPrimaryClip()}（Robolectric ShadowClipboardManager）。
 *
 * <p>驱动方式：直接调包可见静态缝 {@code copyInto}——LynxModule 构造函数需要 LynxContext，
 * 仓库没有任何测试构造过模块实例（先例 PictelioWebDavModuleTest 驱动 {@code run(Callback, Op)}）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class PictelioClipboardModuleTest {

    /** 记录 invoke 实参的假 Callback（Lynx Callback 契约：invoke(Object...)） */
    private static final class RecordingCallback implements Callback {
        private final java.util.concurrent.CountDownLatch latch =
                new java.util.concurrent.CountDownLatch(1);
        volatile Object[] args;

        @Override
        public void invoke(Object... objects) {
            this.args = objects;
            latch.countDown();
        }

        Object[] await() throws InterruptedException {
            if (!latch.await(5, java.util.concurrent.TimeUnit.SECONDS)) {
                throw new AssertionError("Callback 未在 5s 内被调用");
            }
            return args;
        }
    }

    private static ClipboardManager clipboard() {
        Context ctx = ApplicationProvider.getApplicationContext();
        return (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
    }

    @Test
    public void copyInto_success_invokesOkAndWritesSystemClipboard() throws Exception {
        Context ctx = ApplicationProvider.getApplicationContext();
        RecordingCallback cb = new RecordingCallback();
        PictelioClipboardModule.copyInto(ctx, "讨论也没那么热闹", cb);

        Object[] args = cb.await();
        assertEquals(2, args.length);
        assertEquals("1", args[0]);
        assertEquals("", args[1]);

        ClipData clip = clipboard().getPrimaryClip();
        assertNotNull("写入成功但系统剪贴板为空", clip);
        assertEquals("讨论也没那么热闹", clip.getItemAt(0).getText().toString());
    }

    /** 只把剪贴板服务替换为 null 的 Context（覆盖 manager == null 分支；Robolectric 默认会给真 shadow） */
    private static Context contextWithoutClipboardService() {
        final Context base = ApplicationProvider.getApplicationContext();
        return new android.content.ContextWrapper(base) {
            @Override
            public Object getSystemService(String name) {
                return Context.CLIPBOARD_SERVICE.equals(name) ? null : super.getSystemService(name);
            }
        };
    }

    /** 取剪贴板服务时抛「空消息」异常（覆盖错误串兜底：失败必须给出非空原因） */
    private static Context contextThrowingEmptyMessage() {
        final Context base = ApplicationProvider.getApplicationContext();
        return new android.content.ContextWrapper(base) {
            @Override
            public Object getSystemService(String name) {
                if (Context.CLIPBOARD_SERVICE.equals(name)) {
                    throw new IllegalStateException("");
                }
                return super.getSystemService(name);
            }
        };
    }

    @Test
    public void copyInto_nullClipboardService_failsVisiblyWithoutCrash() throws Exception {
        RecordingCallback cb = new RecordingCallback();
        PictelioClipboardModule.copyInto(contextWithoutClipboardService(), "内容", cb);

        Object[] args = cb.await();
        assertEquals(2, args.length);
        assertEquals("", args[0]);
        assertNotNull(args[1]);
        assertTrue(((String) args[1]).contains("剪贴板服务不可用"));
    }

    @Test
    public void copyInto_exceptionWithEmptyMessage_fallsBackToClassName() throws Exception {
        RecordingCallback cb = new RecordingCallback();
        PictelioClipboardModule.copyInto(contextThrowingEmptyMessage(), "内容", cb);

        Object[] args = cb.await();
        assertEquals("", args[0]);
        // 空 message 不得原样透出（JS 侧以非空错误串判失败）→ 兜底为异常类名
        assertEquals("IllegalStateException", args[1]);
    }

    @Test
    public void copyInto_emptyText_failsVisiblyAndKeepsClipboardUntouched() throws Exception {
        Context ctx = ApplicationProvider.getApplicationContext();
        clipboard().setPrimaryClip(ClipData.newPlainText("seed", "旧内容"));

        RecordingCallback cb = new RecordingCallback();
        PictelioClipboardModule.copyInto(ctx, "", cb);

        Object[] args = cb.await();
        assertEquals("", args[0]);
        assertNotNull("失败分支必须给出错误串（禁静默）", args[1]);
        assertTrue("空文本不得覆写剪贴板", "旧内容"
                .equals(clipboard().getPrimaryClip().getItemAt(0).getText().toString()));
    }

    @Test
    public void copyInto_nullText_neverPassesNullToCallback() throws Exception {
        Context ctx = ApplicationProvider.getApplicationContext();
        RecordingCallback cb = new RecordingCallback();
        PictelioClipboardModule.copyInto(ctx, null, cb);

        Object[] args = cb.await();
        assertEquals(2, args.length);
        assertEquals("", args[0]);
        // Callback 对 null 参数崩（真机实测）——两个参数都不得为 null
        assertNotNull(args[0]);
        assertNotNull(args[1]);
    }
}
