package io.pictelio.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * splash 主题资源冻结值测试（night 配置；spec lynx-night-mode.md §4.7/§5；ADR-0180 D7）。
 *
 * <p>断言范围声明（round-2 复审 M6）：本文件只断言**资源值已登记**（{@code obtainStyledAttributes}
 * 读得到 values-night/ 的声明），**不**断言「该值在设备端生效」——主轨 {@code AppTheme.NoActionBarLaunch}
 * 的父保持 {@code Theme.SplashScreen}，其 plate 项「已登记未生效」（有意差异；生效性走查见
 * docs/specs/lynx-night-mode-walkthrough.md T3-3c）。
 *
 * <p>oracle 溯源（冻结契约，非从实现反推）：
 * <ul>
 *   <li>主轨 {@code AppTheme.NoActionBarLaunch}（system 跟随）：底 {@code #101418}
 *       （app-lynx {@code .theme-sky.dark} 的 {@code --md-surface}，符号锚）+ plate {@code #1C2024}
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
    /** app-lynx {@code .theme-sky.dark} 的 {@code --md-surface}（符号锚；不写 tokens.css 行号——必然漂移） */
    private static final int DARK_SURFACE = 0xFF101418;
    /** app-lynx {@code .theme-sky.dark} 的 {@code --md-surface-container}——plate 上一阶（符号锚，同上） */
    private static final int DARK_PLATE = 0xFF1C2024;

    private static final int ATTR_BACKGROUND =
            androidx.core.splashscreen.R.attr.windowSplashScreenBackground;
    private static final int ATTR_PLATE =
            androidx.core.splashscreen.R.attr.windowSplashScreenIconBackgroundColor;

    @Test
    public void launchTheme_nightOverride_resourceValuesRegistered_plateNotEffective() {
        // 主轨（system 跟随）暗色配置：**资源值断言** —— 底/plate 均已登记为暗色面。
        // 生效性边界（M6，必须逐字保留本限定）：底（windowSplashScreenBackground）由系统 splash
        // 直接消费；plate 项**已登记未生效**——主轨父保持 Theme.SplashScreen（非 IconBackground），
        // 平台不把 android:windowSplashScreenIconBackgroundColor 映射回本 app attr。故本用例名/注释
        // 不得声称「主轨暗色 splash 有可见圆盘」；生效性 = docs/specs/lynx-night-mode-walkthrough.md
        // T3-3c（走查项，非 JVM 断言）。
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
