package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.view.View;

import androidx.appcompat.app.AppCompatActivity;
import androidx.test.core.app.ApplicationProvider;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;

/**
 * 系统栏策略核心逻辑测试（spec docs/specs/lynx-systembars.md §6 T1 单测；
 * 「可测核心 + 薄模块包装」模式——静态纯函数 + 普通 AppCompatActivity，
 * 绕开 LynxActivity.onCreate 的 LynxEnv 原生依赖）。
 *
 * <p>契约断言（oracle = spec D2/D3/D5 + #594 基线数值）：
 * <ul>
 *   <li>可视内容区 = 边界 − 可见系统栏 insets，高 ≥0（D3；#594：1080×2160 → 2016）</li>
 *   <li>全屏模式键仅 "true" 判真（D5 默认关）</li>
 *   <li>事件名/键名字面量 = spec §4.3 契约锚点（Java 侧钉死，JS 侧在 T2 钉）</li>
 *   <li>hide/show 在兼容层 legacy 实现（sdk 28）下映射 systemUiVisibility 全屏位</li>
 * </ul>
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class LynxSystemBarsTest {

    @Test
    public void applyVisibleInsets_subtractsVisibleBars() {
        // oracle = #594 基线：pixel_4 类设备 1080×2160，双栏各 72 → 可视内容区 2016
        int[] size = LynxActivity.applyVisibleInsets(1080, 2160, 72, 72);
        assertEquals(1080, size[0]);
        assertEquals(2016, size[1]);
    }

    @Test
    public void applyVisibleInsets_fullscreenHidesBars_heightEqualsBounds() {
        // 全屏模式：系统栏隐藏 → insets 归零 → 内容区高度 = 全屏边界
        int[] size = LynxActivity.applyVisibleInsets(1080, 2160, 0, 0);
        assertEquals(2160, size[1]);
    }

    @Test
    public void applyVisibleInsets_neverNegative() {
        // 防御：异常大 insets（理论上不出现）不得产生负高度
        int[] size = LynxActivity.applyVisibleInsets(1080, 100, 80, 80);
        assertEquals(0, size[1]);
    }

    @Test
    public void fullscreenPref_missingOrCorrupt_returnsFalse() {
        Context ctx = ApplicationProvider.getApplicationContext();
        // 缺省（未写过键）= false（D5 默认关）
        assertFalse(LynxActivity.isFullscreenModeRequested(ctx));
        // 损坏值一律 false
        ctx.getSharedPreferences(LynxActivity.SYSTEMBARS_PREFS, Context.MODE_PRIVATE)
                .edit().putString(LynxActivity.KEY_FULLSCREEN_MODE, "yes").commit();
        assertFalse(LynxActivity.isFullscreenModeRequested(ctx));
    }

    @Test
    public void fullscreenPref_trueString_returnsTrue() {
        Context ctx = ApplicationProvider.getApplicationContext();
        ctx.getSharedPreferences(LynxActivity.SYSTEMBARS_PREFS, Context.MODE_PRIVATE)
                .edit().putString(LynxActivity.KEY_FULLSCREEN_MODE, "true").commit();
        assertTrue(LynxActivity.isFullscreenModeRequested(ctx));
    }

    @Test
    public void contractConstants_matchSpecAnchors() {
        // oracle = spec §4.3 契约锚点（JS 侧字面量由 T2 契约测试比对，任一漂移红灯）
        assertEquals("pictelioInsets", LynxActivity.EVENT_INSETS);
        assertEquals("settings_fullscreen_mode", LynxActivity.KEY_FULLSCREEN_MODE);
        assertEquals("CapacitorStorage", LynxActivity.SYSTEMBARS_PREFS);
    }

    @Test
    public void applySystemBarsHidden_togglesLegacyFullscreenFlags() {
        // sdk 28 走 WindowInsetsControllerCompat 的 legacy 实现（Impl23/26/28），
        // hide/show 映射 decor systemUiVisibility 全屏位——Robolectric 可直接断言。
        ActivityController<AppCompatActivity> controller =
                Robolectric.buildActivity(AppCompatActivity.class).setup();
        AppCompatActivity activity = controller.get();

        LynxActivity.applySystemBarsHidden(activity, true);
        int vis = activity.getWindow().getDecorView().getSystemUiVisibility();
        assertTrue("hide 后应置全屏位",
                (vis & View.SYSTEM_UI_FLAG_FULLSCREEN) != 0);
        assertTrue("hide 后应置导航栏隐藏位（systemBars 并集语义）",
                (vis & View.SYSTEM_UI_FLAG_HIDE_NAVIGATION) != 0);

        LynxActivity.applySystemBarsHidden(activity, false);
        vis = activity.getWindow().getDecorView().getSystemUiVisibility();
        assertTrue("show 后应清除全屏位",
                (vis & View.SYSTEM_UI_FLAG_FULLSCREEN) == 0);
    }
}
