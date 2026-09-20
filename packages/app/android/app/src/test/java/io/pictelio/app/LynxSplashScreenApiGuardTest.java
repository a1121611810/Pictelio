package io.pictelio.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * Splash 兜底轨 API 等级 guard 测试（spec lynx-night-mode.md T3 §验收检查）。
 *
 * <p>{@code SplashScreen.setSplashScreenTheme()} 在 androidx.core-splashscreen 1.2.0 中
 * API 31+（Android 12+, {@link android.os.Build.VERSION_CODES#S}）转发到平台
 * {@code android.window.SplashScreen.setTheme()}；API 28-30 内部为 no-op（残留冷启动窗口
 * 平台无解，已接受——见 spec §4.7 + §5 「Out of Scope」）。
 *
 * <p>{@code shouldApplySplashScreenTheme(int sdkInt)} 显式 guard 让编译期意图清晰，避免
 * 后人误读为无条件调用。本测试钉死 {@code sdkInt >= 31} 的不变量。
 *
 * <p>模式同 {@code LynxStatusBarAppearanceTest}：纯函数 + 静态断言；不依赖 Robolectric SDK
 * context（@Config(sdk=31) 仅用于 Robolectric runner 初始化）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 31)
public class LynxSplashScreenApiGuardTest {

    @Test
    public void shouldApplySplashScreenTheme_api28_false() {
        // API 28 (Android 9, minSdkVersion)：setSplashScreenTheme 为 no-op
        // 显式 guard 跳过调用，避免在该版本调用浪费 + 让后人看清「不在低版本调」
        assertFalse(LynxActivity.shouldApplySplashScreenTheme(28));
    }

    @Test
    public void shouldApplySplashScreenTheme_api30_false() {
        // API 30 (Android 11)：setSplashScreenTheme 仍为 no-op
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

    @Test
    public void shouldApplySplashScreenTheme_thresholdMatchesBuildCodes() {
        // 防御：阈值必须等于 Build.VERSION_CODES.S（避免硬编码 31 与常量漂移）
        assertTrue(LynxActivity.shouldApplySplashScreenTheme(
                android.os.Build.VERSION_CODES.S));
    }
}
