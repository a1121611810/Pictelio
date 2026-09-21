package io.pictelio.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * Splash 兜底轨 API 等级 guard 测试（spec lynx-night-mode.md T3 验收 + §4.7/§5；ADR-0180 D7）。
 *
 * <p>平台事实（核实结论，2026-09-21 复核纠错）：{@code Activity.getSplashScreen()} 及其
 * {@code setSplashScreenTheme(int)} 是 **API 31+（Android 12, {@link android.os.Build.VERSION_CODES#S}）
 * 的平台 API**；低版本该方法在 Activity 类上不存在（必须显式 guard）。**不是**「androidx 在低版本
 * 内部为 no-op」：AndroidX core-splashscreen 1.2.0 根本不暴露该平台方法（其公开面只有
 * {@code setKeepOnScreenCondition} + {@code setOnExitAnimationListener}），低版本残留冷启动窗口
 * 平台无解，已接受——见 spec §4.7 + §5「Out of Scope」。
 *
 * <p>{@code shouldApplySplashScreenTheme(int sdkInt)} 显式 guard 让编译期意图清晰，避免
 * 后人误读为无条件调用。本测试钉死 {@code sdkInt >= 31} 的不变量。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 31)
public class LynxSplashScreenApiGuardTest {

    @Test
    public void shouldApplySplashScreenTheme_api28_false() {
        // API 28 (Android 9, minSdkVersion)：平台方法不存在 → 不得调用（显式 guard 跳过）
        assertFalse(LynxActivity.shouldApplySplashScreenTheme(28));
    }

    @Test
    public void shouldApplySplashScreenTheme_api30_false() {
        // API 30 (Android 11)：仍低于平台门槛（残留最早帧已接受，spec §5）
        assertFalse(LynxActivity.shouldApplySplashScreenTheme(30));
    }

    @Test
    public void shouldApplySplashScreenTheme_api31_true() {
        // API 31 (Android 12, Build.VERSION_CODES.S = 31)：guard 阈值
        assertTrue(LynxActivity.shouldApplySplashScreenTheme(31));
    }

    @Test
    public void shouldApplySplashScreenTheme_api36_true() {
        // API 36 (Android 16, 当前 compileSdk / targetSdk)
        assertTrue(LynxActivity.shouldApplySplashScreenTheme(36));
    }
}
