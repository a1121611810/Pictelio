package io.pictelio.app;

import static org.junit.Assert.*;

import android.content.Context;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * Behavioral tests for PictelioPrefsModule（ADR-0103 共享设置 KV 桥）。
 *
 * <p>测试核心静态方法（get/set/remove，注入 Application Context），绕开 LynxContext
 * 依赖（与 SecureStorageCompatTest 同模式：可测核心 + 薄模块包装）。
 *
 * <p>契约断言（oracle = ADR-0103 / @capacitor/preferences 默认 group）：
 * <ul>
 *   <li>键：{@code show_r18_${uid}}（下划线，registry defineFactory 约定）</li>
 *   <li>介质：SharedPreferences 文件 {@code "CapacitorStorage"}（webview 侧
 *       {@code @capacitor/preferences} 默认 group，跨 client 互读）</li>
 *   <li>键不存在返回 ""（JS 契约映射为 null），永不为 null</li>
 * </ul>
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class PictelioPrefsModuleTest {

    private Context ctx() {
        return ApplicationProvider.getApplicationContext();
    }

    @Test
    public void roundTrip_writeReadRemove() {
        Context ctx = ctx();
        PictelioPrefsModule.set(ctx, "show_r18_42", "true");
        assertEquals("true", PictelioPrefsModule.get(ctx, "show_r18_42"));

        PictelioPrefsModule.remove(ctx, "show_r18_42");
        assertEquals("", PictelioPrefsModule.get(ctx, "show_r18_42"));
    }

    @Test
    public void absentKey_returnsEmptyString() {
        Context ctx = ctx();
        // 契约：键不存在返回 ""（永不 null；lynx Callback 对 null 参数崩）
        assertEquals("", PictelioPrefsModule.get(ctx, "show_r18g_999999"));
    }

    @Test
    public void crossClient_webviewWritesSameFile_lynxReadsBack() {
        // 模拟 webview 侧（@capacitor/preferences → 默认 group "CapacitorStorage"）写入，
        // lynx 侧（本模块读同一文件）必须读到 —— 跨 client 同步契约的核心断言。
        Context ctx = ctx();
        ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                .edit()
                .putString("show_r18_7", "false")
                .commit();

        assertEquals("false", PictelioPrefsModule.get(ctx, "show_r18_7"));
    }

    @Test
    public void remove_onlyDeletesTargetKey() {
        Context ctx = ctx();
        PictelioPrefsModule.set(ctx, "show_r18_1", "true");
        PictelioPrefsModule.set(ctx, "show_r18g_1", "true");

        PictelioPrefsModule.remove(ctx, "show_r18_1");

        assertEquals("", PictelioPrefsModule.get(ctx, "show_r18_1"));
        assertEquals("true", PictelioPrefsModule.get(ctx, "show_r18g_1"));
    }
}
