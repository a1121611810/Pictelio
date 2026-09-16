package io.pictelio.app.engine;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import android.app.Application;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * {@link EngineRouting#onLynxFailure} 运行时失败漏斗测试（Robolectric，spec §6）。
 *
 * <p>oracle: docs/specs/engine-default-lynx-bidirectional-fallback.md
 * §6（漏斗：LOAD_TIMEOUT 永不自动跳；开关开 ∧ 含 webview → 先写记忆再 HOP；
 * 开关关 / lynx 单引擎包 → 错误页）、§4 S6/S7/S8。失败记忆期望值 = PackageManager
 * 报告的当前 versionCode 十进制字符串（「精确相等才命中」契约的写入侧）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = Application.class)
public class EngineRoutingFunnelTest {

    private Context ctx;

    /** 最小桩探针：漏斗只消费 clientKinds（经 EnginePrefs.autoFallbackEnabled）。 */
    private static final class StubProbe implements EngineProbe {
        private final String[] kinds;

        StubProbe(String... kinds) {
            this.kinds = kinds;
        }

        @Override
        public String[] clientKinds() {
            return kinds;
        }

        @Override
        public boolean lynxAvailable() {
            return true;
        }

        @Override
        public boolean webviewOk() {
            return true;
        }

        @Override
        public boolean a11yActive() {
            return false;
        }
    }

    @Before
    public void setUp() {
        ctx = ApplicationProvider.getApplicationContext();
    }

    private SharedPreferences prefs() {
        return ctx.getSharedPreferences(EnginePrefs.PREFS_FILE, Context.MODE_PRIVATE);
    }

    private String storedFailureMemory() {
        return prefs().getString(EnginePrefs.KEY_FAILURE_MEMORY, null);
    }

    @Test
    public void loadTimeout_alwaysShowsErrorPage_regardlessOfSwitch() {
        // S8：10s 加载超时永不自动跳（慢设备 ≠ 不支持）——开关两态一致。
        EnginePrefs.setAutoFallback(ctx, true);
        assertEquals(EngineRouting.FailureVerdict.SHOW_ERROR_PAGE,
                EngineRouting.onLynxFailure(ctx, new StubProbe("lynx", "webview"),
                        EngineRouting.LynxFailureKind.LOAD_TIMEOUT));

        EnginePrefs.setAutoFallback(ctx, false);
        assertEquals(EngineRouting.FailureVerdict.SHOW_ERROR_PAGE,
                EngineRouting.onLynxFailure(ctx, new StubProbe("lynx", "webview"),
                        EngineRouting.LynxFailureKind.LOAD_TIMEOUT));
        assertNull("超时路径不得写失败记忆", storedFailureMemory());
    }

    @Test
    public void renderFatal_switchOn_kindsContainWebview_hopsAndWritesMemoryBeforeReturn()
            throws Exception {
        EnginePrefs.setAutoFallback(ctx, true);
        EngineRouting.FailureVerdict verdict = EngineRouting.onLynxFailure(ctx,
                new StubProbe("webview", "lynx"), EngineRouting.LynxFailureKind.RENDER_FATAL);

        assertEquals(EngineRouting.FailureVerdict.HOP_TO_WEBVIEW, verdict);
        // S6 契约：失败记忆 = 当前 versionCode 十进制字符串（先写记忆再返回，hop 途中崩溃也不丢）。
        PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
        assertEquals(String.valueOf(pi.getLongVersionCode()), storedFailureMemory());
    }

    @Test
    public void renderFatal_switchOff_showsErrorPage_memoryAbsent() {
        // S7：开关关 → 错误页 + 手动按钮（用户自担），失败记忆不得写入。
        EnginePrefs.setAutoFallback(ctx, false);
        assertEquals(EngineRouting.FailureVerdict.SHOW_ERROR_PAGE,
                EngineRouting.onLynxFailure(ctx, new StubProbe("webview", "lynx"),
                        EngineRouting.LynxFailureKind.RENDER_FATAL));
        assertNull(storedFailureMemory());
    }

    @Test
    public void lynxOnlyKinds_switchOn_stillShowsErrorPage() {
        // E9：lynx 单引擎包 CLIENT_KINDS 不含 webview → 恒 SHOW_ERROR_PAGE（无 WebView 可跳）。
        EnginePrefs.setAutoFallback(ctx, true);
        assertEquals(EngineRouting.FailureVerdict.SHOW_ERROR_PAGE,
                EngineRouting.onLynxFailure(ctx, new StubProbe("lynx"),
                        EngineRouting.LynxFailureKind.RENDER_FATAL));
        assertNull(storedFailureMemory());
    }

    @Test
    public void initAndBundleLoad_kindsBehaveAsRenderFatal_hopWhenSwitchOn() {
        // 生产者映射（spec §6）：init throw → INIT；onLoadFailed → BUNDLE_LOAD，
        // 与 RENDER_FATAL 同漏斗（LOAD_TIMEOUT 除外）。
        EnginePrefs.setAutoFallback(ctx, true);
        assertEquals(EngineRouting.FailureVerdict.HOP_TO_WEBVIEW,
                EngineRouting.onLynxFailure(ctx, new StubProbe("webview", "lynx"),
                        EngineRouting.LynxFailureKind.INIT));
        assertEquals(EngineRouting.FailureVerdict.HOP_TO_WEBVIEW,
                EngineRouting.onLynxFailure(ctx, new StubProbe("webview", "lynx"),
                        EngineRouting.LynxFailureKind.BUNDLE_LOAD));
    }
}
