package io.pictelio.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * splash 主题资源冻结值测试（night 配置；spec lynx-night-mode.md §4.7/§5；ADR-0180 D7）。
 *
 * <p>oracle 溯源（冻结契约，非从实现反推）：
 * <ul>
 *   <li>主轨 {@code AppTheme.NoActionBarLaunch}（system 跟随）：底 {@code #101418}
 *       （app-lynx {@code .theme-sky.dark --md-surface}）+ plate {@code #1C2024}
 *       （{@code --md-surface-container}，上一阶）——旧值 {@code #1A1A1A} 已废（M3 baseline
 *       近似值，与皮肤暗色面不一致）</li>
 *   <li>{@code Theme.SplashScreen.Light} 在 values-night/ **也必须存在且为白**：手动 light 被
 *       API 31+ 持久化后，系统转暗的冷启动仍解析该主题 → 强制亮 splash（不得回落到暗色）</li>
 *   <li>{@code Theme.SplashScreen.Dark} 在 values-night/ 与 values/ 同值（名跨配置稳定，
 *       暗色配置下解析结果不随配置翻转漂移）</li>
 * </ul>
 *
 * <p>配置切换方式：Robolectric {@code @Config(qualifiers = "night")} —— 资源限定符真实参与解析
 * （等价真机 uiMode=night），非 mock。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 31, qualifiers = "night")
public class LynxSplashThemeResourcesNightTest {

    private static final int WHITE = 0xFFFFFFFF;
    /** app-lynx .theme-sky.dark --md-surface（tokens.css:445） */
    private static final int DARK_SURFACE = 0xFF101418;
    /** app-lynx .theme-sky.dark --md-surface-container（tokens.css:453）——plate 上一阶 */
    private static final int DARK_PLATE = 0xFF1C2024;

    private static final int ATTR_BACKGROUND =
            androidx.core.splashscreen.R.attr.windowSplashScreenBackground;
    private static final int ATTR_PLATE =
            androidx.core.splashscreen.R.attr.windowSplashScreenIconBackgroundColor;

    @Test
    public void launchTheme_nightOverride_usesSkyDarkSurfaceAndPlate() {
        // 主轨（system 跟随）：暗色配置下系统按 manifest 主题绘制最早帧 → 底/plate 必须同暗色面
        assertEquals(DARK_SURFACE,
                LynxSplashThemeResourcesTest.attrColor(R.style.AppTheme_NoActionBarLaunch, ATTR_BACKGROUND));
        assertEquals(DARK_PLATE,
                LynxSplashThemeResourcesTest.attrColor(R.style.AppTheme_NoActionBarLaunch, ATTR_PLATE));
    }

    @Test
    public void lightSplashTheme_staysWhiteUnderNightConfiguration() {
        // 手动 light：values-night/ 也必须定义 Light 且为白——否则暗色配置冷启动解析到
        // 「未定义」而回落父主题（暗），手动 light 失效
        assertEquals(WHITE,
                LynxSplashThemeResourcesTest.attrColor(R.style.Theme_SplashScreen_Light, ATTR_BACKGROUND));
        assertEquals(WHITE,
                LynxSplashThemeResourcesTest.attrColor(R.style.Theme_SplashScreen_Light, ATTR_PLATE));
    }

    @Test
    public void darkSplashTheme_sameValuesAsLightConfiguration() {
        // 名跨配置稳定：Dark 在 values-night/ 与 values/ 同值（暗色配置下不漂移）
        assertEquals(DARK_SURFACE,
                LynxSplashThemeResourcesTest.attrColor(R.style.Theme_SplashScreen_Dark, ATTR_BACKGROUND));
        assertEquals(DARK_PLATE,
                LynxSplashThemeResourcesTest.attrColor(R.style.Theme_SplashScreen_Dark, ATTR_PLATE));
    }
}
