package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.res.Configuration;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * 状态栏图标深浅决策纯函数测试（spec lynx-night-mode.md T3 验收 / ADR-0180 D6）。
 *
 * <p>解 ADR-0168 D4 钉死 —— 状态栏图标不再恒定钉死为深色，改为随 resolved uiMode / 手动三态动态。
 * oracle 溯源（冻结契约 + spec §4.3 表 + ADR-0180 D6）：
 * <ul>
 *   <li>{@link LynxActivity#isDarkUiMode}：系统 uiMode → 是否暗外观（resolveIsDark 的 system 支底座）</li>
 *   <li>{@link LynxActivity#isAppearanceLightStatusBarsFor}：暗外观 → 浅图标（false）的布尔映射</li>
 *   <li>{@link LynxActivity#resolveStatusBarAppearance}：status bar 隐藏（全屏模式）时跳过下发，
 *       返回 null（消费方 {@code applyStatusBarAppearance} 判空后跳过 setAppearanceLightStatusBars）</li>
 * </ul>
 *
 * <p>模式同 {@code LynxDarkModeTest}——纯函数断言，无需 LynxActivity 实例化；Robolectric 仅提供
 * SDK context（@Config(sdk=31)）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 31)
public class LynxStatusBarAppearanceTest {

    // ── isDarkUiMode(uiMode) 决策纯函数（oracle = spec §4.3 表 uiMode 判定）──

    @Test
    public void isDarkUiMode_nightYes_true() {
        // 与 currentDarkMode(uiMode) 同源：NIGHT_YES ⇒ 暗外观（"dark"）
        assertTrue(LynxActivity.isDarkUiMode(Configuration.UI_MODE_NIGHT_YES));
        assertEquals("dark", LynxActivity.currentDarkMode(Configuration.UI_MODE_NIGHT_YES));
    }

    @Test
    public void isDarkUiMode_nightNo_false() {
        assertFalse(LynxActivity.isDarkUiMode(Configuration.UI_MODE_NIGHT_NO));
        assertEquals("light", LynxActivity.currentDarkMode(Configuration.UI_MODE_NIGHT_NO));
    }

    // ── isAppearanceLightStatusBarsFor(boolean) 决策纯函数 ──

    @Test
    public void isAppearanceLightStatusBarsFor_lightMode_returnsTrue() {
        // 明外观（isDarkMode=false）：status bar 视作亮底 → setAppearanceLightStatusBars(true)（深图标）
        assertEquals(true, LynxActivity.isAppearanceLightStatusBarsFor(false));
    }

    @Test
    public void isAppearanceLightStatusBarsFor_darkMode_returnsFalse() {
        // 暗外观（isDarkMode=true）：status bar 视作暗底 → setAppearanceLightStatusBars(false)（浅图标）
        assertEquals(false, LynxActivity.isAppearanceLightStatusBarsFor(true));
    }

    // ── resolveStatusBarAppearance(boolean, boolean) 全屏跳过分支 ──

    @Test
    public void resolveStatusBarAppearance_fullscreenHidden_returnsNull() {
        // 全屏模式 status bar 隐藏：外观设置无 UI 反馈点 → null（消费方据此跳过下发）
        assertNull(LynxActivity.resolveStatusBarAppearance(false, true));
        assertNull(LynxActivity.resolveStatusBarAppearance(true, true));
    }

    @Test
    public void resolveStatusBarAppearance_fullscreenVisible_returnsDecision() {
        // 非全屏模式：透传 isAppearanceLightStatusBarsFor
        assertEquals(Boolean.TRUE, LynxActivity.resolveStatusBarAppearance(false, false));
        assertEquals(Boolean.FALSE, LynxActivity.resolveStatusBarAppearance(true, false));
    }
}
