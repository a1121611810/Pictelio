package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.res.Configuration;
import android.util.Log;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowLog;

/**
 * 暗色外观原生核心逻辑测试（spec docs/specs/lynx-night-mode.md §4.1–§4.5；ADR-0180 D1/D2/D6/D7）。
 *
 * <p>oracle 溯源（期望值出处 = 冻结契约 / spec，**非**从实现反推）：
 * <ul>
 *   <li>契约常量（事件名 / 持久化键 / 文件）：spec §4.1 + §4.3 表（键字面量与 app-lynx
 *       settingsStore DARK_MODE_KEY / PictelioPrefs.PREFS_FILE 同源）</li>
 *   <li>{@code currentDarkMode}：spec §4.3（载荷 = UI_MODE_NIGHT_MASK 判定）</li>
 *   <li>{@code normalizeDarkMode} 三态 + 缺省/非法 → system + warn：spec §4.1 + §4.2（禁静默降级）</li>
 *   <li>{@code resolveIsDark} 三态 × uiMode：ADR-0180 D6（状态栏图标随 resolvedDark）+ spec §4.1
 *       （system = 跟随系统）</li>
 *   <li>{@code splashThemeIdFor}（system → 0 = 交还 values-night 主轨）：ADR-0180 D7 + spec §4.7/§5</li>
 *   <li>{@code shouldBackfillDark}：spec §4.3 表「后台兜底」行（onResume 比对缓存补发）</li>
 * </ul>
 *
 * <p>反自证声明（#692 code-review 整改）：本文件**不含**反射 set/get 静态字段、手抄 onResume
 * 分支、wouldFireEvent、UI_MODE_NIGHT_MASK 位运算参考这类「测试即实现镜像」用例——它们断言恒真、
 * 删掉实现也不会红，零回归价值。改为纯函数输入输出矩阵 + 真实 SharedPreferences 读点语料：
 * 后者是 issue #692 的核心缺陷防线（原生侧此前对 {@code settings_dark_mode} 零读点 → 手动模式
 * 的状态栏图标与 splash 全部未接线）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 31)
public class LynxDarkModeTest {

    /** LynxActivity.TAG 字面量（日志契约：非法值告警落该 tag） */
    private static final String ACTIVITY_TAG = "LynxActivity";

    private Context ctx;

    @Before
    public void setUp() {
        ctx = ApplicationProvider.getApplicationContext();
        ShadowLog.clear();
    }

    // ── 契约常量（JS↔Java 双向钉死；oracle = spec §4.1 / §4.3）──

    @Test
    public void contractConstants_matchSpecAnchors() {
        // spec §4.3 表：事件名（app-lynx utils/darkMode.ts addListener 同一字面量）
        assertEquals("pictelioDarkMode", LynxActivity.EVENT_DARK_MODE);
        // spec §4.1：三态持久化键（app-lynx settingsStore.setDarkMode 写同一键）
        assertEquals("settings_dark_mode", LynxActivity.KEY_DARK_MODE);
        // spec §4.1：存储文件（@capacitor/preferences 默认 group / PictelioPrefs.PREFS_FILE）
        assertEquals("CapacitorStorage", LynxActivity.SYSTEMBARS_PREFS);
    }

    // ── currentDarkMode(uiMode)：系统 uiMode → 事件载荷（spec §4.3）──

    @Test
    public void currentDarkMode_nightYes_returnsDark() {
        assertEquals("dark", LynxActivity.currentDarkMode(Configuration.UI_MODE_NIGHT_YES));
    }

    @Test
    public void currentDarkMode_nightNo_returnsLight() {
        assertEquals("light", LynxActivity.currentDarkMode(Configuration.UI_MODE_NIGHT_NO));
    }

    @Test
    public void currentDarkMode_nightYesWithOtherFlags_returnsDark() {
        // 防御：UI_MODE_NIGHT_MASK 只取夜间位，UI_MODE_TYPE_* 等其它位不影响判定
        int uiMode = Configuration.UI_MODE_NIGHT_YES | Configuration.UI_MODE_TYPE_NORMAL;
        assertEquals("dark", LynxActivity.currentDarkMode(uiMode));
    }

    @Test
    public void currentDarkMode_maskOnly_extractsNightBit() {
        // raw = 仅掩码位（0x30）→ 不等于 UI_MODE_NIGHT_YES（0x20）→ light
        assertEquals("light", LynxActivity.currentDarkMode(Configuration.UI_MODE_NIGHT_MASK));
    }

    @Test
    public void currentDarkMode_uninitializedSentinelIsNotNightYes() {
        // -1 未初始化哨兵经掩码后为 0x30 ≠ 0x20 —— 纯函数判 light，**不会**误判 dark。
        // 消费方（PictelioAppModule.getDarkMode）在 lastUiMode == -1 时另走 Configuration 实读兜底。
        assertEquals("light", LynxActivity.currentDarkMode(-1));
    }

    // ── normalizeDarkMode(raw)：三态校验 + 缺省回退（spec §4.1/§4.2）──

    @Test
    public void normalizeDarkMode_legalValues_preserved() {
        assertEquals("light", LynxActivity.normalizeDarkMode("light"));
        assertEquals("dark", LynxActivity.normalizeDarkMode("dark"));
        assertEquals("system", LynxActivity.normalizeDarkMode("system"));
    }

    @Test
    public void normalizeDarkMode_absentKey_fallsBackToSystemWithoutWarn() {
        // 键缺省 = 正常态（默认跟随系统，spec §4.1「默认 system」）——不得告警刷屏
        assertEquals("system", LynxActivity.normalizeDarkMode(null));
        assertFalse("键缺省属正常态，不得 warn", warnedOnActivityTag());
    }

    @Test
    public void normalizeDarkMode_illegalValues_warnAndFallBackToSystem() {
        // 非法值样本含大小写/空白/空串/JSON 形态（JS 侧 PrefsStorage 万一写入非裸三态字符串）
        String[] illegal = {
                "", "auto", "DARK", "Dark", "light ", " light", "0", "true",
                "{\"mode\":\"dark\"}", "system-night",
        };
        for (String raw : illegal) {
            ShadowLog.clear();
            assertEquals("非法值必须回退 system: [" + raw + "]", "system",
                    LynxActivity.normalizeDarkMode(raw));
            assertTrue("非法值必须 Log.w（禁静默降级，spec §4.2）: [" + raw + "]",
                    warnedOnActivityTag());
        }
    }

    // ── resolveIsDark(darkMode, uiMode)：三态 × uiMode 矩阵（ADR-0180 D6 决策输入）──

    @Test
    public void resolveIsDark_manualLight_ignoresUiMode() {
        assertFalse(LynxActivity.resolveIsDark("light", Configuration.UI_MODE_NIGHT_NO));
        assertFalse("手动 light 在系统暗色下仍为亮（覆盖系统）",
                LynxActivity.resolveIsDark("light", Configuration.UI_MODE_NIGHT_YES));
    }

    @Test
    public void resolveIsDark_manualDark_ignoresUiMode() {
        assertTrue(LynxActivity.resolveIsDark("dark", Configuration.UI_MODE_NIGHT_YES));
        assertTrue("手动 dark 在系统亮色下仍为暗（覆盖系统）",
                LynxActivity.resolveIsDark("dark", Configuration.UI_MODE_NIGHT_NO));
    }

    @Test
    public void resolveIsDark_system_followsUiMode() {
        assertFalse(LynxActivity.resolveIsDark("system", Configuration.UI_MODE_NIGHT_NO));
        assertTrue(LynxActivity.resolveIsDark("system", Configuration.UI_MODE_NIGHT_YES));
    }

    @Test
    public void resolveIsDark_unknownOrSentinel_followsUiModeFailSafe() {
        // 输入契约是「已归一」值；未初始化哨兵 -1 经掩码后为 0x30 → 不得误判 dark
        assertFalse(LynxActivity.resolveIsDark("bogus", -1));
        assertFalse(LynxActivity.resolveIsDark(null, -1));
        // 含其它 UI_MODE 位时仍只看夜间位（与 currentDarkMode 同源）
        assertTrue(LynxActivity.resolveIsDark("system",
                Configuration.UI_MODE_NIGHT_YES | Configuration.UI_MODE_TYPE_CAR));
    }

    // ── splashThemeIdFor(darkMode)：兜底轨主题选择（ADR-0180 D7 / spec §4.7/§5）──

    @Test
    public void splashThemeIdFor_lightAndDark_mapToDistinctThemes() {
        assertEquals(R.style.Theme_SplashScreen_Light, LynxActivity.splashThemeIdFor("light"));
        assertEquals(R.style.Theme_SplashScreen_Dark, LynxActivity.splashThemeIdFor("dark"));
        assertNotEquals("亮/暗 splash 主题不得同 id（否则手动覆盖无语义）",
                R.style.Theme_SplashScreen_Light, R.style.Theme_SplashScreen_Dark);
    }

    @Test
    public void splashThemeIdFor_system_returnsZeroToHandBackToMainTrack() {
        // 0 = 调用点转 Resources.ID_NULL：复位 manifest 默认主题，交还 values-night 主轨按
        // 系统 uiMode 解析。若此处返回 Light/Dark 之一，system 模式会被上一支手动主题钉死
        // （= #692 的镜像缺陷：手动选择撤销不了）。
        assertEquals(0, LynxActivity.splashThemeIdFor("system"));
    }

    @Test
    public void splashThemeIdFor_absentOrIllegal_returnsZero() {
        // 缺省 / 非法 → 归一到 system → 0（不得兜底到某一支手动主题）
        assertEquals(0, LynxActivity.splashThemeIdFor(null));
        assertEquals(0, LynxActivity.splashThemeIdFor("auto"));
        assertEquals(0, LynxActivity.splashThemeIdFor(""));
    }

    // ── shouldBackfillDark(last, current)：onResume 兜底比对（spec §4.3 表「后台兜底」行）──

    @Test
    public void shouldBackfillDark_uninitializedNeverBackfills() {
        assertFalse("sLastUiMode == -1（onCreate 未走 / onDestroy 后）不补发",
                LynxActivity.shouldBackfillDark(-1, Configuration.UI_MODE_NIGHT_YES));
        assertFalse(LynxActivity.shouldBackfillDark(-1, Configuration.UI_MODE_NIGHT_NO));
        assertFalse(LynxActivity.shouldBackfillDark(-1, -1));
    }

    @Test
    public void shouldBackfillDark_sameValueNeverBackfills() {
        assertFalse("同值不补发（防抖不变量）",
                LynxActivity.shouldBackfillDark(Configuration.UI_MODE_NIGHT_NO,
                        Configuration.UI_MODE_NIGHT_NO));
        assertFalse(LynxActivity.shouldBackfillDark(Configuration.UI_MODE_NIGHT_YES,
                Configuration.UI_MODE_NIGHT_YES));
    }

    @Test
    public void shouldBackfillDark_flipBackfills() {
        assertTrue("后台期间系统翻转 → resume 补发",
                LynxActivity.shouldBackfillDark(Configuration.UI_MODE_NIGHT_NO,
                        Configuration.UI_MODE_NIGHT_YES));
        assertTrue(LynxActivity.shouldBackfillDark(Configuration.UI_MODE_NIGHT_YES,
                Configuration.UI_MODE_NIGHT_NO));
    }

    // ── 读点接线（#692 核心缺陷防线：原生侧对 settings_dark_mode 的真实读点）──

    @Test
    public void readDarkModeRaw_readsSameFileAndKeyAsJsSide() {
        // 写路径（JS）：settingsStore.setDarkMode → PrefsStorage.set("settings_dark_mode", mode)
        // → NativeModules.PictelioPrefs.prefsSet → SharedPreferences "CapacitorStorage"。
        // 原生读点必须命中同文件同键（此前零读点 → 手动模式的 status bar / splash 全未生效）。
        ctx.getSharedPreferences(LynxActivity.SYSTEMBARS_PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(LynxActivity.KEY_DARK_MODE, "dark")
                .commit();
        assertEquals("dark", LynxActivity.readDarkModeRaw(ctx));
        assertTrue("手动 dark 在系统亮色下仍须判暗（→ 状态栏浅图标）",
                LynxActivity.resolveIsDark(
                        LynxActivity.normalizeDarkMode(LynxActivity.readDarkModeRaw(ctx)),
                        Configuration.UI_MODE_NIGHT_NO));
    }

    @Test
    public void readDarkModeRaw_absentKey_normalizesToSystem() {
        // 键不存在（未设置过 / 用户从未切换外观）→ null → 归一 system（默认跟随系统）
        assertNull(LynxActivity.readDarkModeRaw(ctx));
        assertEquals("system", LynxActivity.normalizeDarkMode(LynxActivity.readDarkModeRaw(ctx)));
        assertTrue("缺省跟随系统（键缺失 ≠ 无读点）",
                LynxActivity.resolveIsDark("system", Configuration.UI_MODE_NIGHT_YES));
    }

    // ── helper ──

    /** 本用例窗口内是否出现 LynxActivity tag 的 WARN（禁静默降级的机器防线） */
    private static boolean warnedOnActivityTag() {
        for (ShadowLog.LogItem item : ShadowLog.getLogsForTag(ACTIVITY_TAG)) {
            if (item.type == Log.WARN) return true;
        }
        return false;
    }
}
