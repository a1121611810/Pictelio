package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import android.content.Context;
import android.content.res.TypedArray;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * splash 主题资源冻结值测试（default/亮色配置；spec lynx-night-mode.md §4.7/§5；ADR-0180 D7）。
 *
 * <p>oracle 溯源（冻结契约，非从实现反推）：
 * <ul>
 *   <li>亮色=白底+白 plate：现状视觉零回归（旧实现即 {@code @android:color/white} 双白；
 *       亮色 plate 与底同色为**有意**——launcher 前景自带白底，plate 与底同色才无可见圆盘边）</li>
 *   <li>暗色=底 {@code #101418}（app-lynx {@code .theme-sky.dark} 的 {@code --md-surface}）+
 *       plate {@code #1C2024}（其上一阶 {@code --md-surface-container}，离底有差 → 可见 plate）</li>
 *   <li>两主题（{@code Theme.SplashScreen.Light} / {@code .Dark}）必须在 values/ 与 values-night/
 *       各定义一份：API 31+ 持久化主题名跨配置翻转后仍须可解析（名稳定性）</li>
 *   <li>plate 生效依赖父主题 {@code Theme.SplashScreen.IconBackground}（API 31+ 把平台
 *       {@code android:windowSplashScreenIconBackgroundColor} 映射回本 app attr）——该父链
 *       属依赖库资源语义，**JVM 无法断言**：Robolectric 不解析依赖 styles 里的 {@code ?attr}
 *       主题引用（实测 {@code TypedValue t=0x2/TYPE_ATTRIBUTE} 未解析 → 抛
 *       UnsupportedOperationException），故以本地 AAR 资源表核实为准（见 styles.xml 注释引用的
 *       core-splashscreen-1.2.0 {@code res/values-v31/values-v31.xml}）</li>
 * </ul>
 *
 * <p>回归对象：任何人把暗色值改回 {@code #1A1A1A}（M3 baseline 近似值）、或删掉 values/ 里的
 * 手动主题名（system/手动切换后 splash 解析失败）都会让本文件变红。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 31)
public class LynxSplashThemeResourcesTest {

    /** 亮色底 / plate（@android:color/white） */
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
    public void lightSplashTheme_isWhiteOnWhite_definedInValues() {
        // 手动 light / 兜底轨亮色变体：白底 + 白 plate（现状零视觉回归）
        assertEquals(WHITE, attrColor(R.style.Theme_SplashScreen_Light, ATTR_BACKGROUND));
        assertEquals(WHITE, attrColor(R.style.Theme_SplashScreen_Light, ATTR_PLATE));
    }

    @Test
    public void darkSplashTheme_usesSkyDarkSurfaceAndPlate_definedInValues() {
        // 手动 dark / 兜底轨暗色变体：面 #101418 + plate #1C2024（离底一阶，可见）
        assertEquals(DARK_SURFACE, attrColor(R.style.Theme_SplashScreen_Dark, ATTR_BACKGROUND));
        assertEquals(DARK_PLATE, attrColor(R.style.Theme_SplashScreen_Dark, ATTR_PLATE));
    }

    @Test
    public void launchTheme_matchesSystemFollowDefaultsInValues() {
        // manifest 主轨（system 跟随）：亮色配置下解析为白底 + 白 plate
        assertEquals(WHITE, attrColor(R.style.AppTheme_NoActionBarLaunch, ATTR_BACKGROUND));
        assertEquals(WHITE, attrColor(R.style.AppTheme_NoActionBarLaunch, ATTR_PLATE));
    }

    @Test
    public void bothSplashThemeNamesResolvableInLightConfiguration() {
        // 名稳定性：手动 dark 被持久化（PackageManager 口径）后，系统处于亮色配置的冷启动
        // 仍必须能解析 Theme.SplashScreen.Dark（否则启动即 crash / 回落默认主题）
        assertFalse(R.style.Theme_SplashScreen_Light == 0);
        assertFalse(R.style.Theme_SplashScreen_Dark == 0);
        assertFalse(R.style.Theme_SplashScreen_Light == R.style.Theme_SplashScreen_Dark);
    }

    // ── helper ──

    static int attrColor(int styleRes, int attrRes) {
        Context ctx = ApplicationProvider.getApplicationContext();
        TypedArray ta = ctx.obtainStyledAttributes(styleRes, new int[] { attrRes });
        try {
            if (!ta.hasValue(0)) throw new AssertionError("style 未定义该属性: " + styleRes);
            return ta.getColor(0, 0);
        } finally {
            ta.recycle();
        }
    }
}
