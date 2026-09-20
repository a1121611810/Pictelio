package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * 状态栏图标深浅决策纯函数测试（spec lynx-night-mode.md T3 §验收检查）。
 *
 * <p>解 ADR-0168 D4 钉死 —— 状态栏图标不再恒定钉死为深色，改为随当前 resolved uiMode 动态。
 * 决策纯函数拆分 + 全屏跳过分支同时单测：
 * <ul>
 *   <li>{@link LynxActivity#isAppearanceLightStatusBarsFor}：明/暗外观与外观值的布尔映射</li>
 *   <li>{@link LynxActivity#resolveStatusBarAppearance}：status bar 隐藏（全屏模式）时
 *       跳过外观下发，返回 null（消费方判断后跳过 setAppearanceLightStatusBars 调用）</li>
 * </ul>
 *
 * <p>模式同 {@code LynxDarkModeTest}（spec T1）——纯函数 + 静态断言，无需 LynxActivity 实例化；
 * Robolectric 仅提供 SDK context（@Config(sdk=31)）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 31)
public class LynxStatusBarAppearanceTest {

    // ── isAppearanceLightStatusBarsFor(boolean) 决策纯函数 ──

    @Test
    public void isAppearanceLightStatusBarsFor_lightMode_returnsTrue() {
        // 明外观（isDarkMode=false）：status bar 视作亮底 → setAppearanceLightStatusBars(true)（深图标）
        // 当前背景为亮时，深图标才可读。
        assertEquals(true, LynxActivity.isAppearanceLightStatusBarsFor(false));
    }

    @Test
    public void isAppearanceLightStatusBarsFor_darkMode_returnsFalse() {
        // 暗外观（isDarkMode=true）：status bar 视作暗底 → setAppearanceLightStatusBars(false)（浅图标）
        // 当前背景为暗时，深图标不可读，浅图标才可读。
        assertEquals(false, LynxActivity.isAppearanceLightStatusBarsFor(true));
    }

    @Test
    public void isAppearanceLightStatusBarsFor_involution() {
        // 同一 isDarkMode 双调幂等（避免副作用）
        assertEquals(LynxActivity.isAppearanceLightStatusBarsFor(true),
                LynxActivity.isAppearanceLightStatusBarsFor(true));
        assertEquals(LynxActivity.isAppearanceLightStatusBarsFor(false),
                LynxActivity.isAppearanceLightStatusBarsFor(false));
    }

    // ── resolveStatusBarAppearance(boolean, boolean) 全屏跳过分支（spec 验收要求）──

    @Test
    public void resolveStatusBarAppearance_fullscreenHidden_returnsNull() {
        // 全屏模式 status bar 隐藏：外观设置无 UI 反馈点 → 期望 null
        // applyStatusBarAppearanceFromUiMode 据此跳过 setAppearanceLightStatusBars 调用
        assertNull(LynxActivity.resolveStatusBarAppearance(false, true));
        assertNull(LynxActivity.resolveStatusBarAppearance(true, true));
    }

    @Test
    public void resolveStatusBarAppearance_fullscreenVisible_returnsDecision() {
        // 非全屏模式：透传 isAppearanceLightStatusBarsFor
        assertEquals(Boolean.TRUE, LynxActivity.resolveStatusBarAppearance(false, false));
        assertEquals(Boolean.FALSE, LynxActivity.resolveStatusBarAppearance(true, false));
    }

    @Test
    public void resolveStatusBarAppearance_contract_nullOnlyWhenHidden() {
        // 反向断言：返回值非空 ⇔ statusBarHidden=false（不入歧路）
        Boolean visibleLight = LynxActivity.resolveStatusBarAppearance(false, false);
        Boolean hiddenLight = LynxActivity.resolveStatusBarAppearance(false, true);
        Boolean visibleDark = LynxActivity.resolveStatusBarAppearance(true, false);
        Boolean hiddenDark = LynxActivity.resolveStatusBarAppearance(true, true);
        assertEquals(Boolean.TRUE, visibleLight);
        assertEquals(Boolean.FALSE, visibleDark);
        assertNull(hiddenLight);
        assertNull(hiddenDark);
    }
}
