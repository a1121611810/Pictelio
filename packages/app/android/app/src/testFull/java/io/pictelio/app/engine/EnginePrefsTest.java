package io.pictelio.app.engine;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

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
 * {@link EnginePrefs} 键契约与读写测试（Robolectric，先例 {@code PictelioAppTest}）。
 *
 * <p>oracle: docs/specs/engine-default-lynx-bidirectional-fallback.md
 * §3（键契约表：键字面量 / 缺省值 / 写者）、§4 不变量（失败记忆与当前 versionCode
 * 精确相等才命中）、§3.1（快照格式 {@code preferred=<kind> effective=<kind|none>
 * reason=<code>}）。键字面量来源 = ADR-0164 决策文本（断言经本类公开常量，
 * 字面量漂移由一致性测试另行钉住）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = Application.class)
public class EnginePrefsTest {

    private static final String[] FULL_KINDS = {"lynx", "webview"};
    private static final String[] WEBVIEW_ONLY = {"webview"};

    private Context ctx;

    @Before
    public void setUp() {
        ctx = ApplicationProvider.getApplicationContext();
    }

    private SharedPreferences prefs() {
        return ctx.getSharedPreferences(EnginePrefs.PREFS_FILE, Context.MODE_PRIVATE);
    }

    // ── 首选归一化（preferredNormalization_viaClientKinds）────────

    @Test
    public void preferred_absent_fullKinds_normalizesToLynx() {
        // 缺省即 lynx（ADR-0164 决策 1 的读侧语义：absent → CLIENT_KINDS 含 lynx → LYNX）。
        EngineState s = EnginePrefs.read(ctx, FULL_KINDS);
        assertEquals(Engine.LYNX, s.preferred);
    }

    @Test
    public void preferred_absent_webviewOnlyKinds_normalizesToWebview() {
        assertEquals(Engine.WEBVIEW, EnginePrefs.read(ctx, WEBVIEW_ONLY).preferred);
    }

    @Test
    public void preferred_storedWebview_fullKinds_staysWebview() {
        // E1：存量用户显式 webview → S9 照旧，零感知。
        prefs().edit().putString(EnginePrefs.KEY_PREFERRED_KIND, "webview").commit();
        assertEquals(Engine.WEBVIEW, EnginePrefs.read(ctx, FULL_KINDS).preferred);
    }

    @Test
    public void preferred_storedLynx_fullKinds_staysLynx() {
        prefs().edit().putString(EnginePrefs.KEY_PREFERRED_KIND, "lynx").commit();
        assertEquals(Engine.LYNX, EnginePrefs.read(ctx, FULL_KINDS).preferred);
    }

    @Test
    public void preferred_storedGarbage_fallsBackToDefault() {
        prefs().edit().putString(EnginePrefs.KEY_PREFERRED_KIND, "terminator").commit();
        assertEquals(Engine.LYNX, EnginePrefs.read(ctx, FULL_KINDS).preferred);
    }

    @Test
    public void preferred_storedKindNotInKinds_fallsBackToKindsDefault() {
        // 存储值合法但不在本包能力集（如 full 装 lynx 后换 webview 单引擎包装同 appId）。
        prefs().edit().putString(EnginePrefs.KEY_PREFERRED_KIND, "lynx").commit();
        assertEquals(Engine.WEBVIEW, EnginePrefs.read(ctx, WEBVIEW_ONLY).preferred);
    }

    // ── 自动回退开关 ───────────────────────────────────────────

    @Test
    public void autoFallback_absent_defaultsTrue() {
        assertTrue(EnginePrefs.autoFallbackEnabled(ctx));
        assertTrue(EnginePrefs.read(ctx, FULL_KINDS).autoFallback);
    }

    @Test
    public void autoFallback_false_staysFalse() {
        EnginePrefs.setAutoFallback(ctx, false);
        assertFalse(EnginePrefs.autoFallbackEnabled(ctx));
        assertFalse(EnginePrefs.read(ctx, FULL_KINDS).autoFallback);
    }

    @Test
    public void autoFallback_bogusValue_fallsBackTrue() {
        prefs().edit().putString(EnginePrefs.KEY_AUTO_FALLBACK, "maybe").commit();
        assertTrue(EnginePrefs.autoFallbackEnabled(ctx));
    }

    // ── 失败记忆 ───────────────────────────────────────────────

    @Test
    public void failureMemory_recordLynxFailure_hitsKnownBad() {
        EnginePrefs.recordLynxFailure(ctx);
        assertTrue(EnginePrefs.read(ctx, FULL_KINDS).knownBad);
    }

    @Test
    public void failureMemory_afterClear_doesNotHit() {
        EnginePrefs.recordLynxFailure(ctx);
        EnginePrefs.clearLynxFailure(ctx);
        assertFalse(EnginePrefs.read(ctx, FULL_KINDS).knownBad);
    }

    @Test
    public void failureMemory_differentVersion_doesNotHit() throws Exception {
        // E4：应用升级后记忆版本失配 → 自动遗忘（写入 versionCode+1 模拟升级后的旧记忆）。
        PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
        prefs().edit()
                .putString(EnginePrefs.KEY_FAILURE_MEMORY, String.valueOf(pi.getLongVersionCode() + 1))
                .commit();
        assertFalse(EnginePrefs.read(ctx, FULL_KINDS).knownBad);
    }

    @Test
    public void failureMemory_garbageValue_doesNotHit() {
        prefs().edit().putString(EnginePrefs.KEY_FAILURE_MEMORY, "not-a-number").commit();
        assertFalse(EnginePrefs.read(ctx, FULL_KINDS).knownBad);
    }

    // ── 显式选择（S12：写首选 + 清记忆）────────────────────────

    @Test
    public void setPreferredExplicit_writesKindAndClearsFailureMemory() {
        EnginePrefs.recordLynxFailure(ctx);
        EnginePrefs.setPreferredExplicit(ctx, Engine.WEBVIEW);

        assertEquals("webview", prefs().getString(EnginePrefs.KEY_PREFERRED_KIND, null));
        assertNull("S12：显式选择必须同时清失败记忆", prefs().getString(EnginePrefs.KEY_FAILURE_MEMORY, null));
        assertFalse(EnginePrefs.read(ctx, FULL_KINDS).knownBad);
    }

    // ── 快照发布 ───────────────────────────────────────────────

    @Test
    public void publish_writesSnapshotLineInContractFormat() {
        // M1 期望快照逐字格式（spec §3）：字段顺序与单空格分隔即 TS 解析契约。
        EngineRoute route = new EngineRoute(Engine.LYNX, Engine.WEBVIEW,
                EngineRoute.Action.BOOT_WEBVIEW, EngineRoute.Reason.LYNX_UNAVAILABLE, false);
        EnginePrefs.publish(ctx, route);
        assertEquals("preferred=lynx effective=webview reason=lynx_unavailable",
                prefs().getString(EnginePrefs.KEY_STATE, null));
    }

    @Test
    public void snapshotLine_noEngine_rendersNone() {
        EngineRoute route = new EngineRoute(Engine.LYNX, null,
                EngineRoute.Action.UPGRADE_PAGE, EngineRoute.Reason.NO_ENGINE, false);
        assertEquals("preferred=lynx effective=none reason=no_engine", route.snapshotLine());
    }

    // ── 提示条 optout ──────────────────────────────────────────

    @Test
    public void optOut_roundTrip() {
        assertFalse(EnginePrefs.readOptOut(ctx));
        EnginePrefs.setOptOut(ctx, true);
        assertTrue(EnginePrefs.readOptOut(ctx));
        EnginePrefs.setOptOut(ctx, false);
        assertFalse(EnginePrefs.readOptOut(ctx));
    }

    // ── E2E 取证键 ─────────────────────────────────────────────

    @Test
    public void debugForceLynxUnavailable_readsRawPrefWithoutDebugGate() {
        // 本方法只读原始值；BuildConfig.DEBUG 门控在 LynxProbe 适配器（src/lynx）——
        // 本类保持零 BuildConfig 引用，release 下键分支随调用方一起被 R8 消除。
        assertFalse(EnginePrefs.debugForceLynxUnavailable(ctx));
        prefs().edit()
                .putString(EnginePrefs.KEY_DEBUG_FORCE_LYNX_UNAVAILABLE, "true")
                .commit();
        assertTrue(EnginePrefs.debugForceLynxUnavailable(ctx));
    }
}
