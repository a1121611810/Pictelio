package io.pictelio.app;

import android.content.Context;
import android.content.res.Configuration;
import android.content.res.Resources;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.lynx.react.bridge.JavaOnlyArray;
import com.lynx.tasm.LynxError;
import com.lynx.tasm.LynxView;
import com.lynx.tasm.LynxViewBuilder;
import com.lynx.tasm.LynxViewClient;

import java.lang.ref.WeakReference;
import java.util.concurrent.atomic.AtomicBoolean;

import io.pictelio.app.BuildConfig;

/**
 * Lynx client 宿主 Activity（#51；沙盒 #610 起为单引擎 LAUNCHER 入口）。
 *
 * <p>沙盒 #610 后本类是唯一的 LAUNCHER Activity——WebView/Capacitor 线整体下线，
 * 不再有 MainActivity 入口路由分发。纯 LynxView 全屏，无 Capacitor bridge 参与。
 *
 * <p>生命周期：onResume/onPause/onDestroy 转发 LynxView
 * onEnterForeground/onEnterBackground/destroy()（LynxView 无自带生命周期）。
 *
 * <p>返回键（ADR-0066）：系统返回（手势/按键）由 {@link OnBackPressedCallback} 拦截，
 * bundle 就绪后经 {@code sendGlobalEvent("pictelioBack")} 转发 JS 决策——有路由历史返回
 * 上一页、根路由提示 + 2s 双击退出；bundle 未就绪时 JS 侧无
 * 监听者，原生兜底 {@link #finish()}。页面内「‹ 返回」按钮由 app-lynx 前端路由处理，
 * 与系统返回桥互不影响。
 *
 * <p>运行时失败（原 ADR-0164 失败漏斗）：init 抛错、bundle 加载失败、
 * 致命渲染错误、10s 加载超时四个生产者统一收敛到 {@link #showErrorFallback}。
 * 单引擎后不存在「可降级到的 WebView」，故不再有失败记忆与自动跳转——
 * 任何致命错误一律落错误页。10s 超时同样只落错误页，绝不自动跳
 * （慢设备 ≠ 不支持，该约束自 ADR-0164 起保持不变）。
 */
public class LynxActivity extends AppCompatActivity {

    private static final String TAG = "LynxActivity";

    // ── 系统栏契约常量（spec docs/specs/lynx-systembars.md §4.3；JS↔Java 契约测试钉住）──
    /** insets 变化事件名（JS safeArea.ts 订阅；载荷 [top, bottom] 数值，spec D2） */
    public static final String EVENT_INSETS = "pictelioInsets";
    /** 全屏模式设置键所在文件（settingsStore.setFullscreenMode 同文件写入，spec D5） */
    public static final String SYSTEMBARS_PREFS = "CapacitorStorage";
    /** 全屏模式设置键（"true" = 隐藏系统栏；默认缺省 = false） */
    public static final String KEY_FULLSCREEN_MODE = "settings_fullscreen_mode";

    // ── 暗色检测契约常量（spec docs/specs/lynx-night-mode.md T1 §4.3；JS↔Java 契约测试钉住）──
    /**
     * 系统暗色变化事件名（JS utils/darkMode.ts 订阅；载荷 = JSON.stringify({mode: "light" | "dark"})，
     * 与 insets 数值双参契约区分）。事件名单一事实源 —— JS 侧亦硬编码字面量。
     */
    public static final String EVENT_DARK_MODE = "pictelioDarkMode";

    /**
     * 明暗外观三态设置键（spec docs/specs/lynx-night-mode.md §4.1，ADR-0180 D1）：
     * 值域 {@code "light" | "dark" | "system"}，缺省 = system。JS 侧
     * {@code settingsStore.setDarkMode} 经 PrefsStorage seam 写同一文件同一键
     * （app-lynx src/stores/settingsStore.ts {@code DARK_MODE_KEY}）。
     *
     * <p>**唯一读点所有者**：原生侧对本键的读取全部收敛到 {@link #readDarkModeRaw} +
     * {@link #normalizeDarkMode}（状态栏图标 / splash / 运行时重下发三处消费）。
     */
    public static final String KEY_DARK_MODE = "settings_dark_mode";

    /** 三态字面量（值域单一事实源；{@link #normalizeDarkMode} 的匹配集） */
    static final String DARK_MODE_LIGHT = "light";
    static final String DARK_MODE_DARK = "dark";
    static final String DARK_MODE_SYSTEM = "system";

    // ── Dev intent hooks（BuildConfig.DEBUG 门禁；release 完全跳过；emulator 端到端测试用）──
    /**
     * 自动登录 refresh_token extra key：adb `am start --es pictelio_dev_refresh_token <token>` 直接登录。
     * 持久化到 Keystore + OAuth token 交换。
     */
    private static final String DEV_EXTRA_REFRESH_TOKEN = "pictelio_dev_refresh_token";
    /** 强制开启 R18 过滤 extra key（任何非空值即触发）。
     *  写入 SharedPreferences "CapacitorStorage" 的 {@code dev_force_r18=true}；
     *  JS 端 settingsStore.loadSettings 读取该键，若 === "true" 则强制 _showR18 / _showR18G = true。
     *  比事件总线更可靠：bundle 渲染时序无关，loadSettings 总会读到。 */
    private static final String DEV_EXTRA_FORCE_R18 = "pictelio_dev_force_r18";

    // ─── 通知落点契约（#940 / ADR-0220 决策 8、9）────────────────────────────
    // ⚠️ 这些常量**不是** dev extra：通知落点必须在 release 可用
    //   （benchNav 整条链被 BuildConfig.DEBUG + __BENCH_NAV__ 门死，release 不可用）。

    /** 点击意图携带的落点目标页 key */
    static final String EXTRA_NOTIFICATION_TARGET = "pictelio_notification_target";
    /** 点击意图携带的本次投递 id（冷启动多窗重发共享同一个 id，JS 据此去重） */
    static final String EXTRA_NOTIFICATION_CLICK_ID = "pictelio_notification_click_id";
    /** 唯一落点：通知列表页（#940 AC-1：不是通知中心子页，也不是别的聚合页） */
    static final String TARGET_NOTIFICATIONS = "notifications";
    /** 落点事件名（与 JS 侧逐字一致，由契约门禁两侧比对） */
    static final String EVENT_NOTIFICATION_TARGET = "pictelioNotificationTarget";
    /** 待认领的点击 clickId：广播可能全落在 JS 订阅之前，故同时落盘供 JS 拉取 */
    static final String KEY_PENDING_NOTIFICATION_CLICK = "delivery_probe_pending_click";
    /** 多窗重发的四档延时（ms）——与 benchNav 深链同一组数值（1.5/3/4.5/6s） */
    private static final long[] TARGET_BROADCAST_DELAYS = {1500L, 3000L, 4500L, 6000L};
    /**
     * 翻译 endpoint dev 播种 extras（BuildConfig.DEBUG 门禁）：
     * {@code pictelio_dev_llm_base_url} / {@code pictelio_dev_llm_api_key} / {@code pictelio_dev_llm_model}。
     * apiKey 走 Keystore（与 PictelioTranslateModule 同 alias），其余三项写 SharedPreferences
     * —— 模拟器端到端验证无需做设置页 UI 自动化（与 refresh_token / force_r18 同族 dev 通道）。
     */
    private static final String DEV_EXTRA_LLM_BASE_URL = "pictelio_dev_llm_base_url";
    private static final String DEV_EXTRA_LLM_API_KEY = "pictelio_dev_llm_api_key";
    private static final String DEV_EXTRA_LLM_MODEL = "pictelio_dev_llm_model";

    /** SharedPreferences 文件（对齐 JS 侧 nativePrefs 走的 PictelioPrefs.PREFS_FILE）。 */
    private static final String DEV_FORCE_R18_PREFS_FILE = "CapacitorStorage";
    /** SharedPreferences key（JS 侧 settingsStore.loadSettings 读取同名键）。 */
    private static final String DEV_FORCE_R18_PREFS_KEY = "dev_force_r18";
    /** refresh_token 存储 key（对齐 app-lynx/src/utils/tokenStorage.ts 的 KEY 常量） */
    private static final String REFRESH_TOKEN_KEY = "refresh_token";

    private LynxView lynxView;
    private final AtomicBoolean bundleLoaded = new AtomicBoolean(false);

    /** 当前 Activity 弱引用（PictelioAppModule.exitApp 使用，ADR-0066；onDestroy 清理） */
    private static WeakReference<LynxActivity> sInstance;

    // ADR-0131（spec lynx-systembars D3 修订）：可视内容区尺寸（px；首次布局后更新；-1 = 未布局）。
    // e2e 后 LynxView 布局为全屏，contentSize = 边界 − 当前可见系统栏 insets（sInset*），
    // 语义保持「可视内容区」——getViewportSize 对 JS 契约不变，GlobalFab/弹层几何零改动。
    private static volatile int sContentW = -1;
    private static volatile int sContentH = -1;
    /** 当前可见系统栏 insets（insets 回调更新；onDestroy 复位） */
    private static volatile int sInsetTop = 0;
    private static volatile int sInsetBottom = 0;
    /** 最近一次已推送 JS 的 insets（值变化才发事件，spec D2 防抖不变量；onDestroy 复位） */
    private static int sLastSentTop = -1;
    private static int sLastSentBottom = -1;

    // ADR-0180（T1）：最近一次已观察到的 uiMode 位（Configuration.UI_MODE_NIGHT_MASK 比较）。
    // 初次启动：onCreate 读 onConfigurationChanged 之前为 UNINITIALIZED；-1 = 未初始化哨兵。
    // onConfigurationChanged 写新值并比对；onResume 兜底比对：后台期间系统 uiMode 翻转若未触发
    // configChanges（API < 31 个别厂商 / 后台省电模式冻结），resume 时强制补发事件。
    // 复位同 sInset*（onDestroy 回到 -1，新实例首次读取命中兜底 light）。
    private static int sLastUiMode = -1;

    // ADR-0180（T1）：最近一次已下发的暗色 mode 字符串（"light"/"dark"）。同 insets
    // 字段语义，sendDarkModeEvent 内部短路去重；新增 caller 无需各自比 sLastUiMode。
    // 生命周期：onDestroy 复位 ""（F14）——静态字段跨实例复用，新实例的首帧真值不得被
    // 上一实例的记忆短路（否则重建后同一值的首次事件静默丢失）。
    private static String sLastDarkSent = "";

    // ADR-0180（T3，解 ADR-0168 D4 钉死）：当前 status bar 是否隐藏（全屏模式）。
    // 写入时机：onCreate 读设置键落初值 + 每次 applySystemBarsHidden 经 syncStatusBarHidden
    // 回写（hide/show 双向同步，#689 单向闩锁修复）。实例级、不持久化；Activity 重建回到
    // onCreate 重读。消费方：applyStatusBarAppearance 经 resolveStatusBarAppearance 跳过全屏分支。
    private boolean statusBarHidden = false;

    /** 可视内容区计算（spec D3 纯函数，供单测）：宽不消费水平 insets，高减上下可见栏且 ≥0。 */
    static int[] applyVisibleInsets(int w, int h, int insetTop, int insetBottom) {
        return new int[] { w, Math.max(h - insetTop - insetBottom, 0) };
    }

    private static void updateContentArea(int w, int h) {
        int[] size = applyVisibleInsets(w, h, sInsetTop, sInsetBottom);
        sContentW = size[0];
        sContentH = size[1];
    }

    /** 当前可见系统栏 insets（JS 订阅后经 PictelioAppModule.getSafeAreaInsets 拉取，spec D2 修订） */
    static int currentSafeTop() {
        return sInsetTop;
    }

    static int currentSafeBottom() {
        return sInsetBottom;
    }

    // ── 暗色 uiMode 核心逻辑（spec lynx-night-mode T1 §4.3；纯函数，JVM 可测）──

    /**
     * 当前是否夜间模式（Configuration.uiMode & UI_MODE_NIGHT_MASK == UI_MODE_NIGHT_YES）。
     * 返回 "dark" / "light" 字符串（与 JS utils/darkMode.ts parseNativePayload 契约一致）。
     * 静态纯函数 —— 无副作用、无 Activity 引用，Robolectric 可直接断言。
     */
    static String currentDarkMode(int uiMode) {
        return (uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
                ? "dark" : "light";
    }

    /**
     * uiMode → 是否暗外观（布尔版，与 currentDarkMode 同源）。
     * 静态纯函数，专为不需要字符串契约的消费方（状态栏图标 / splash 主题）准备，
     * 避免每次都做 .equals("dark") 比较。
     */
    static boolean isDarkUiMode(int uiMode) {
        return (uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    // ── 手动三态接线（follow-up #692：settings_dark_mode 的原生读点；spec §4.1/§4.7）──

    /**
     * 读 {@link #KEY_DARK_MODE} 原始值（未归一；键缺省 / 文件不存在 → null）。
     * 归一（缺省/非法 → "system" + 非法值 {@code Log.w}）由 {@link #normalizeDarkMode} 负责，
     * 消费方成对使用：{@code normalizeDarkMode(readDarkModeRaw(ctx))}。
     *
     * <p>值存储形态 = 裸三态字符串（PictelioPrefsModule.prefsSet 原样落 SharedPreferences；
     * 无 JSON 包裹）——与原「零读点」缺陷相对，这里是原生侧唯一读点。
     */
    @Nullable
    static String readDarkModeRaw(Context ctx) {
        return ctx.getSharedPreferences(SYSTEMBARS_PREFS, Context.MODE_PRIVATE)
                .getString(KEY_DARK_MODE, null);
    }

    /**
     * 三态归一（spec §4.1 值域 + §4.2 非法值规则）：合法值原样返回；缺省（null = 键不存在）
     * → {@code "system"} 且**不告警**（缺省是正常态，spec §4.1 默认 system）；
     * 非法值 → {@code "system"} + {@code Log.w}（禁静默降级，硬约束 #3）。
     *
     * <p>严格匹配，不做 trim / 大小写归一：写入方是自有 JS 常量
     * （app-lynx utils/darkMode.ts {@code DARK_MODE_IDS}），任何变体都是契约漂移信号，必须可见。
     */
    static String normalizeDarkMode(@Nullable String raw) {
        if (DARK_MODE_LIGHT.equals(raw) || DARK_MODE_DARK.equals(raw)
                || DARK_MODE_SYSTEM.equals(raw)) {
            return raw;
        }
        if (raw != null) {
            Log.w(TAG, "settings_dark_mode 值非法，回退 system: [" + raw + "]");
        }
        return DARK_MODE_SYSTEM;
    }

    /**
     * 外观决策（ADR-0180 D6）：三态 + 系统 uiMode → 是否暗外观。
     * light → false（亮界面 / 状态栏深图标）；dark → true（暗界面 / 浅图标）；
     * system 及其它未识别值 → {@link #isDarkUiMode}(uiMode)（跟随系统，fail-safe）。
     *
     * <p>输入契约：darkMode 应为 {@link #normalizeDarkMode} 的输出（告警语义归读点，避免双告警）。
     */
    static boolean resolveIsDark(@Nullable String darkMode, int uiMode) {
        if (DARK_MODE_LIGHT.equals(darkMode)) return false;
        if (DARK_MODE_DARK.equals(darkMode)) return true;
        return isDarkUiMode(uiMode);
    }

    /**
     * splash 兜底轨主题选择（ADR-0180 D7，spec §4.7）：light / dark → 对应持久化主题 id；
     * system（及未识别值）→ {@code 0} = 「交还主轨」哨兵，调用点转 {@link Resources#ID_NULL}
     * ——复位 manifest 默认主题，由 values-night 资源限定符按系统 uiMode 解析。
     * **不得**兜底到某一支手动主题：否则 system 模式会被上一次手动选择钉死（撤销不掉
     * = #692 的镜像缺陷）。
     *
     * <p>{@code Theme.SplashScreen.Light} / {@code Theme.SplashScreen.Dark} 在 values/ 与
     * values-night/ 各定义一份——API 31+ 持久化主题名跨配置翻转后仍可解析（名稳定性）。
     */
    static int splashThemeIdFor(@Nullable String darkMode) {
        if (DARK_MODE_LIGHT.equals(darkMode)) return R.style.Theme_SplashScreen_Light;
        if (DARK_MODE_DARK.equals(darkMode)) return R.style.Theme_SplashScreen_Dark;
        return 0;
    }

    /**
     * 暗色事件发射判定（spec §4.3 表「配置变更」+「后台兜底」两行的**唯一判定式**）：
     * 缓存已初始化（≠ -1）且夜间位与缓存不同 → 需发射。含两种触发源——{@link #onConfigurationChanged}
     * 的即时翻转，以及 {@link #onResume} 的后台补发（后台期间系统翻转未触发 configChanges 的厂商差异）。
     *
     * <p>纯函数化以便 JVM 直测（原实现内联在两个生命周期分支内，只能手抄断言 = 删掉实现也不会红）。
     * 消费方即上述两处；反射/静态字段读取无用——判定的 oracle 是 spec 决策表，故以输入输出矩阵覆盖。
     */
    static boolean shouldEmitDarkEvent(int lastUiMode, int nightMode) {
        return lastUiMode != -1 && nightMode != lastUiMode;
    }

    // ── 状态栏图标深浅决策（spec lynx-night-mode T3，解 ADR-0168 D4 钉死）──

    /**
     * 状态栏图标深浅决策纯函数（JVM 可测，无 Activity 引用）：
     * <ul>
     *   <li>isDarkMode=false（明外观，浅底 UI）→ true = setAppearanceLightStatusBars(true) = 深图标</li>
     *   <li>isDarkMode=true（暗外观，深底 UI）→ false = setAppearanceLightStatusBars(false) = 浅图标</li>
     * </ul>
     * 语义来源（ADR-0168 D4 修订）：系统栏基底为边到边，status bar = App surface 延伸，
     * 外观跟随 app-lynx resolvedDark（动态）而非固定钉死为 true（T1 之前的「app-lynx 无暗色
     * UI」假设不成立——T2 引入了完整 12 色暗色板）。
     */
    static boolean isAppearanceLightStatusBarsFor(boolean isDarkMode) {
        return !isDarkMode;
    }

    /**
     * 状态栏可见性跳过决策（spec lynx-night-mode T3）：status bar 当前隐藏（全屏模式）
     * 时外观设置无 UI 反馈点，返回 null 表示「不调用 setAppearanceLightStatusBars」；
     * 非全屏模式时透传 {@link #isAppearanceLightStatusBarsFor}。
     * 供单测覆盖全屏跳过分支（纯函数可测）；消费方 {@link #applyStatusBarAppearance}。
     */
    @Nullable
    static Boolean resolveStatusBarAppearance(boolean isDarkMode, boolean statusBarHidden) {
        return statusBarHidden ? null : isAppearanceLightStatusBarsFor(isDarkMode);
    }

    /**
     * API 等级 guard（spec lynx-night-mode T3，splash 双轨兜底轨）：
     * Activity 的 {@link android.app.Activity#getSplashScreen}()（平台 API 31+,
     * Android 12+, {@link android.os.Build.VERSION_CODES#S}）返回
     * {@code android.window.SplashScreen}，其 {@code setSplashScreenTheme(int)} 在 API 31+
     * 转发到底层平台实现。低版本此方法在 Activity 类不存在（必须显式 guard），且即使绕过
     * SDK 检查，AndroidX core-splashscreen 1.2.0 也不暴露对应 API（仅有
     * {@code setKeepOnScreenCondition} + {@code setOnExitAnimationListener}）。残留冷启动
     * 窗口平台无解（API 28-30），已接受——见 spec §4.7 + §5「Out of Scope」。显式 guard 让
     * 编译期意图清晰，避免后人误读为无条件调用。
     */
    static boolean shouldApplySplashScreenTheme(int sdkInt) {
        return sdkInt >= android.os.Build.VERSION_CODES.S;
    }

    /** 当前缓存的 uiMode（onDestroy 复位前有效）；未初始化 = -1 */
    static int lastUiMode() {
        return sLastUiMode;
    }

    /**
     * 全屏模式设置读取（spec D5）：仅 {@code "true"} 判真，缺失/损坏一律 false（默认关）。
     */
    static boolean isFullscreenModeRequested(Context ctx) {
        return "true".equals(ctx.getSharedPreferences(SYSTEMBARS_PREFS, Context.MODE_PRIVATE)
                .getString(KEY_FULLSCREEN_MODE, null));
    }

    /**
     * 状态栏图标深浅下发（ADR-0180 D6，解 ADR-0168 D4 钉死）：读三态设置键（单一事实源
     * {@link #KEY_DARK_MODE}）+ uiMode 缓存 {@link #sLastUiMode}，经 {@link #resolveIsDark}
     * 决策后下发 WindowInsetsControllerCompat；全屏模式（status bar 隐藏）时
     * {@link #resolveStatusBarAppearance} 返回 null 跳过（隐藏栏无 UI 反馈点）。不调用
     * recreate——同一 WindowInsetsControllerCompat 实例即时生效。
     *
     * <p>调用时机（全部集中在本方法，杜绝多处各自读键）：onCreate 初始化顺序中（先读
     * uiMode 缓存 + 全屏态，再首次下发）、onConfigurationChanged（系统 uiMode 翻转）、
     * onResume 兜底分支（经 {@link #shouldEmitDarkEvent}）、全屏切换
     * （{@link #syncStatusBarHidden}）、手动三态切换（{@link #applyDarkModePreference}）。
     * 只读 prefs + 字段，不写任何状态。
     */
    private void applyStatusBarAppearance() {
        Boolean appearance = resolveStatusBarAppearance(
                resolveIsDark(normalizeDarkMode(readDarkModeRaw(this)), sLastUiMode), statusBarHidden);
        if (appearance == null) return;
        WindowInsetsControllerCompat controller =
                new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(appearance);
    }

    /**
     * hide/show 系统栏核心（spec D5 纯逻辑，静态包私有供单测——模块薄包装调它）。
     * transient-swipe：隐藏后边缘滑动可临时唤出。Activity 重建走 onCreate 读键重设（F3.2）。
     *
     * <p>闩锁同步（#689 修复）：切换同时回写 Lynx 宿主的 {@code statusBarHidden}
     * （经 {@link #syncStatusBarHidden}）——旧实现该字段只在 onCreate 写过一次，运行时
     * 「全屏 → 退出全屏」后仍为 true，状态栏外观下发被永久跳过（单向闩锁）。非 LynxActivity
     * 宿主（MainActivity 等）无该闩锁语义，仅切换系统栏。
     */
    static void applySystemBarsHidden(AppCompatActivity activity, boolean hidden) {
        WindowInsetsControllerCompat controller =
                new WindowInsetsControllerCompat(activity.getWindow(), activity.getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        if (hidden) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars());
        }
        if (activity instanceof LynxActivity) {
            ((LynxActivity) activity).syncStatusBarHidden(hidden);
        }
    }

    /**
     * 全屏闩锁回写 + 外观重下发（{@link #applySystemBarsHidden} 专用）：hide → 置位
     * （外观下发跳过）；show → 解除并立即按当前三态/uiMode 重下发，避免退出全屏后状态栏
     * 图标停在隐藏前的旧深浅。
     */
    void syncStatusBarHidden(boolean hidden) {
        statusBarHidden = hidden;
        applyStatusBarAppearance();
    }

    /** 当前 status bar 是否因全屏模式隐藏（闩锁态；单测 / 诊断读点） */
    boolean isStatusBarHidden() {
        return statusBarHidden;
    }

    /**
     * splash 兜底轨下发（ADR-0180 D7；onCreate 与 {@link #applyDarkModePreference} 共用）：
     * 读三态设置键决策持久化主题——light / dark 显式覆盖；system → {@link Resources#ID_NULL}
     * 复位 manifest 默认主题（交还 values-night 主轨按系统 uiMode 解析）。
     * 平台门槛 {@link #shouldApplySplashScreenTheme}（API 31+，低版本无此平台 API）。
     */
    private void applySplashScreenThemeFromPref() {
        if (!shouldApplySplashScreenTheme(android.os.Build.VERSION.SDK_INT)) return;
        int splashThemeId = splashThemeIdFor(normalizeDarkMode(readDarkModeRaw(this)));
        getSplashScreen().setSplashScreenTheme(
                splashThemeId == 0 ? Resources.ID_NULL : splashThemeId);
    }

    /**
     * 手动三态运行时重下发（follow-up #692，spec §4.7）：JS 侧切换外观后即时生效——
     * 状态栏图标深浅按新偏好立即下发（全屏模式跳过）；splash 持久化主题同步重设
     * （API 31+，PackageManager 口径 → **下一次冷启动**生效：当前帧 splash 已退场，
     * 平台无改写在途窗口的通道，spec §5 遗留项）。
     *
     * <p>由 {@link PictelioAppModule#applyDarkModePreference} 在主线程调用（模块侧不含业务）。
     */
    void applyDarkModePreference() {
        applyStatusBarAppearance();
        try {
            applySplashScreenThemeFromPref();
        } catch (Throwable t) {
            // 厂商 ROM splash 实现差异：重设失败不得影响已生效的状态栏联动（显式告警，禁静默）
            Log.w(TAG, "重设 splash 持久化主题失败（下次冷启动 splash 沿用旧主题）", t);
        }
    }

    /** 内容区尺寸 [w, h]（px）；未布局返回 null。 */
    static int[] contentSize() {
        return (sContentW > 0 && sContentH > 0) ? new int[] { sContentW, sContentH } : null;
    }

    /** exitApp 目标：当前 LynxActivity（可能为 null） */
    static LynxActivity current() {
        return sInstance != null ? sInstance.get() : null;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // SplashScreen.installSplashScreen 必须在 super.onCreate 之前（AndroidX 要求）
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        splashScreen.setKeepOnScreenCondition(() -> !bundleLoaded.get());
        // T3（spec lynx-night-mode §4.7 · splash 兜底轨）+ follow-up #692 接线：兜底轨输入 =
        // 三态设置键 settings_dark_mode（此前误读系统 uiMode → 手动 light/dark 完全未接线）：
        // light/dark 显式覆盖持久化主题；system → Resources.ID_NULL 复位 manifest 默认主题，
        // 交还 values-night 主轨按系统 uiMode 解析（主轨全 API 覆盖，见 values-night/styles.xml）。
        // 平台门槛 API 31+（低版本 Activity 无 getSplashScreen()，残留最早帧已接受，spec §5）。
        applySplashScreenThemeFromPref();
        super.onCreate(savedInstanceState);
        sInstance = new WeakReference<>(this);

        // 系统栏基底边到边（spec lynx-systembars D1）：一行兼容 API 28→35+（透明/三键 scrim/
        // 图标/cutout 由 compat 层处理）；Android 15+ 设备系统本就强制（targetSdk 36），
        // 主动调用统一双门控两侧形态，≤14 不再出现独立黑/灰条（#594 基线实证的割裂现状）。
        // 注：实际解析 androidx.activity 1.8.0（variables 的 1.11.0 pin 未被引用，传递依赖
        // 决定），Java 侧入口是 EdgeToEdge.enable(activity) 静态方法（Kotlin 扩展
        // enableEdgeToEdge() 的底层实现，#592 报告 F4.2 所述 core WindowCompat 变体不存在）。
        EdgeToEdge.enable(this);
        // ADR-0180（T1）：初始化 uiMode 缓存——onCreate 必须先于 onConfigurationChanged
        // 首次回调（系统已声明 uiMode configChanges，免重建）；onResume 兜底比对以此为基准。
        // 顺序上提到 EdgeToEdge.enable 之后、状态栏外观设置之前（外观决策依赖 sLastUiMode）。
        sLastUiMode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        // #689 修复（初始化顺序）：全屏态先读入 statusBarHidden，再首次下发状态栏外观——
        // 旧实现在 onCreate 末尾 applySystemBarsHidden(this, true) 后**裸赋值**，首次下发
        // 落在赋值之前（全屏路径白下发一次外观，且运行时切换不回写 → 单向闩锁）。
        statusBarHidden = isFullscreenModeRequested(this);
        // T3（解 ADR-0168 D4 钉死）+ #692：状态栏图标深浅随 resolved 外观（手动三态优先，
        // system 跟随系统 uiMode），全屏模式（status bar 隐藏）跳过——决策见 applyStatusBarAppearance。
        applyStatusBarAppearance();

        // LynxEnv 兜底初始化（进程复用场景：Application.onCreate 未走 initLynx → LynxEnv
        // 未初始化会报 error 102）。LynxEnv.init 幂等（hasInit），与 PictelioApp 共用
        // LynxRuntimeInitializer 单点（issue #122），重复调用安全。
        try {
            LynxRuntimeInitializer.ensureInitialized(getApplication());
        } catch (Throwable t) {
            String safe = sanitizeError(String.valueOf(t.getMessage()));
            Log.w(TAG, "LynxEnv 兜底初始化失败: " + safe);
            bundleLoaded.set(true); // 退出 Splash，展示错误兜底
            onFatal("Lynx 环境初始化失败：" + safe);
            return;
        }

        LynxViewBuilder builder = new LynxViewBuilder();
        // XElement behaviors（#51 真机必需）：<input>/<textarea> 等扩展元件
        builder.addBehaviors(new com.lynx.xelement.XElementBehaviors().create());
        builder.setTemplateProvider(new PictelioTemplateProvider(this));
        // per-view 注册（与 PictelioApp 全局注册并存；LynxEnv 全局优先）
        builder.registerModule("PictelioSecureStorage", PictelioSecureStorageModule.class);
        builder.registerModule("PictelioApp", PictelioAppModule.class);
        builder.registerModule("PictelioAuth", PictelioAuthModule.class);
        builder.registerModule("PictelioApi", PictelioApiModule.class);
        builder.registerModule("PictelioTranslate", PictelioTranslateModule.class);
        builder.registerModule("PictelioTranslateCache", PictelioTranslateCacheModule.class);
        builder.registerModule("PictelioPrefs", PictelioPrefsModule.class);
        builder.registerModule("NetDiag", NetDiagModule.class);
        lynxView = builder.build(this);

        // Splash 退出时机：bundle 渲染成功/失败
        lynxView.addLynxViewClient(new LynxViewClient() {
            @Override
            public void onLoadSuccess() {
                bundleLoaded.set(true);
                cancelLoadTimeout();
                // bench 导航钩子（wayfinder #306，ADR-0136）：adb `am start --es benchNav <scenario>`
                // 直达目标页。真机 input tap 对放射 FAB 环项 hit-test 失效（事件送达但不导航，
                // Oppo R11s 实测），经 GlobalEventEmitter 深链绕过；生产无此 extra，零影响。
                // BuildConfig.DEBUG 包裹：release（minify+R8）下该分支为恒 false 死代码被移除，
                // 生产包不含钩子（ADR-0136 决策 1）。
                if (BuildConfig.DEBUG) {
                    String benchNav = getIntent().getStringExtra("benchNav");
                    if (benchNav != null && !benchNav.isEmpty()) {
                        // 事件名编码路由（lynx 4.0.1 无 JavaOnlyString，故不用载荷；空数组）。
                        // novel-follow 为两组事件：先路由到 /novels，页面挂载后再切「关注」子 tab。
                        final String[] events = switch (benchNav) {
                            case "carousel" -> new String[]{"pictelioBenchNavCarousel"};
                            case "illust" -> new String[]{"pictelioBenchNavIllust"};
                            case "novel" -> new String[]{"pictelioBenchNavNovel"};
                            case "following" -> new String[]{"pictelioBenchNavFollowing"};
                            case "illust-follow" -> new String[]{"pictelioBenchNavIllust", "pictelioBenchNavIllustFollow"};
                            case "novel-follow" -> new String[]{"pictelioBenchNavNovel", "pictelioBenchNavNovelFollow"};
                            // T3（#328）扩展：收藏/追更/用户页直达（用户页 id 由 JS 侧从 authStore 解析）
                            case "bookmarks" -> new String[]{"pictelioBenchNavBookmarks"};
                            case "watchlist" -> new String[]{"pictelioBenchNavWatchlist"};
                            case "user" -> new String[]{"pictelioBenchNavUser"};
                            case "userfollowing" -> new String[]{"pictelioBenchNavUserfollowing"};
                            // T4（spec app-lynx-benchnav-meta-exit-hooks）：/update、/error 直达——
                            // meta-exit 回归（S6）触发通道（版本检查/401 链无法在测试中伪造）
                            case "update" -> new String[]{"pictelioBenchNavUpdate"};
                            case "error" -> new String[]{"pictelioBenchNavError"};
                            // 网络自检直达（spec docs/specs/network-self-check.md）
                            case "netdiag" -> new String[]{"pictelioBenchNavNetDiag"};
                            // 平台一致性自检直达（spec docs/specs/qa-defense-lines.md §3.T4 / #550）：
                            // debug 自检页唯一入口（前端 /platform-check 不进导航）
                            case "platform-check" -> new String[]{"pictelioBenchNavPlatformCheck"};
                            // 「我」页直达（#640 step 5）：LLM endpoint 设置区挂在 /me 底部，
                            // 其 inline probe 需在表单里输入才触发 @input debounce；从 tab 栏
                            // 三段式点进去在合成点击下不稳定。与 netdiag / platform-check 同先例。
                            case "me" -> new String[]{"pictelioBenchNavMe"};
                            // 稍后看列表页直达（ADR-0191 D5 / #753）：模拟器验收通道
                            case "later" -> new String[]{"pictelioBenchNavLater"};
                            // 书架段 3「继续读」/ /continue 列表页（ADR-0219 / 票 #929）：
                            // 书架是顶层目的地、放映 FAB 环项的真机 tap 已实证失效，
                            // 无短名则设备取证进不去这两页（同 #913 D1 的缺口形态）。
                            case "shelf" -> new String[]{"pictelioBenchNavShelf"};
                            case "continue" -> new String[]{"pictelioBenchNavContinue"};
                            // 「更新」顶层页与「高级」次级页（维度重构 / #913 D1 补证）：
                            // 两页都消费 listItemStyle（各 3 处绑定），但重构时漏了短名，
                            // 导致 D1 的「消费方全覆盖」取证进不去这两页 —— 与 #913 当初
                            // 补 downloads/illust-detail/mute-tags 短名是同一类通道缺口
                            // （「未取证」≠「不可验证」，先查是不是自己造成的）。
                            case "updates" -> new String[]{"pictelioBenchNavUpdates"};
                            case "advanced" -> new String[]{"pictelioBenchNavAdvanced"};
                            // 好P友列表页直达（ADR-0193 D5 / #754）：模拟器验收通道
                            case "mypixiv" -> new String[]{"pictelioBenchNavMyPixiv"};
                            // #913 D1 取证补齐：下载管理 / 静音标签两页消费 listItemStyle，
                            // 此前无 benchNav 短名 ⇒ D1 设备取证只有 4/7（见 ADR-0211）。
                            case "downloads" -> new String[]{"pictelioBenchNavDownloads"};
                            case "mute-tags" -> new String[]{"pictelioBenchNavMuteTags"};
                            // 详情页直达（#542）走载荷通道（illust_id 数值经 extra 传入），不入本表
                            default -> new String[0];
                        };
                        // 四次广播（1.5/3/4.5/6s）：页面级监听（如 NovelList 子 tab）可能晚于路由监听，
                        // 扩大窗口防「App 挂载/页面挂载」竞态；重复到达幂等或无害
                        for (long delay : new long[]{1500, 3000, 4500, 6000}) {
                            for (String event : events) {
                                new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                                    if (!isFinishing() && !event.isEmpty())
                                        lynxView.sendGlobalEvent(event, new JavaOnlyArray());
                                }, delay);
                            }
                        }
                        // 详情页直达（#542）：载荷通道实测仅数值存活（lynx 4.0.1 无 JavaOnlyString，
                        // 字符串不可走载荷），illust_id 经 intent extra "benchNavIllustId" 数值下发；
                        // 同窗口四次广播，JS 侧缺载荷显式 warn（非静默）。
                        // 小说正文页直达（ADR-0173 验证用）：novel_id 经 extra 数值下发（同 illust-detail 载荷约定）
                        if ("novel-detail".equals(benchNav)) {
                            String rawNovelId = getIntent().getStringExtra("benchNavNovelId");
                            Long novelId = null;
                            try {
                                if (rawNovelId != null) novelId = Long.parseLong(rawNovelId);
                            } catch (NumberFormatException ignored) {
                            }
                            if (novelId != null) {
                                final long target = novelId;
                                for (long delay : new long[]{1500, 3000, 4500, 6000}) {
                                    new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                                        if (!isFinishing())
                                            lynxView.sendGlobalEvent("pictelioBenchNavNovelDetail",
                                                    JavaOnlyArray.of(target));
                                    }, delay);
                                }
                            } else {
                                Log.w(TAG, "benchNav=novel-detail 缺 benchNavNovelId extra，跳过");
                            }
                        }
                        if ("illust-detail".equals(benchNav)) {
                            String rawId = getIntent().getStringExtra("benchNavIllustId");
                            Long illustId = null;
                            try {
                                if (rawId != null) illustId = Long.parseLong(rawId);
                            } catch (NumberFormatException ignored) {
                            }
                            if (illustId != null) {
                                final long detailId = illustId;
                                for (long delay : new long[]{1500, 3000, 4500, 6000}) {
                                    new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                                        if (!isFinishing())
                                            lynxView.sendGlobalEvent("pictelioBenchNavIllustDetail",
                                                    JavaOnlyArray.of(detailId));
                                    }, delay);
                                }
                            } else {
                                Log.w(TAG, "benchNav=illust-detail 缺 benchNavIllustId extra，详情页直达跳过");
                            }
                        }
                    }
                }
                // ⚠️ **通知落点分发在 DEBUG 门之外**（#940）：benchNav 那整块被 BuildConfig.DEBUG
                //   门死、release 被 R8 移除，而通知落点必须在**正式包**里可用
                //   ——否则这个探测在日常构建上永远点不开。
                //   手法沿用 benchNav 深链（事件名编码路由 + 多窗重发对抗渲染竞态），
                //   门禁与载荷约定另立，故不复用 benchNav 的 extra 名与 switch 表。
                dispatchNotificationTarget(getIntent());
            }

            @Override
            public void onLoadFailed(String errorMsg) {
                String safe = sanitizeError(errorMsg);
                Log.w(TAG, "bundle 加载失败: " + safe);
                bundleLoaded.set(true); // 失败也退出 Splash，由页面展示错误态
                cancelLoadTimeout();
                onFatal("Lynx bundle 加载失败：" + safe);
            }

            // ── 渲染期错误兜底（ADR-0064，issue #132/#135）──
            // bundle 渲染阶段（非加载阶段）的错误走这里，而非 onLoadFailed。
            // 实测根因（error 990200 InstantiationException：R8 移除 $$PropsSetter
            // 无参构造器）即在此路径——若只挂钩 onLoadFailed 则白屏无出口。
            // 双回调都挂（SDK 分类入口 + 统一入口），onFatal 原子防重（errorShown 首胜）。
            @Override
            public void onReceivedNativeError(LynxError error) {
                handleRenderError(error);
            }

            @Override
            public void onReceivedError(LynxError error) {
                handleRenderError(error);
            }
        });

        setContentView(lynxView);
        // D2：insets 监听——系统栏可见性/几何变化（含冷启动首次分发、全屏开关 hide/show、
        // 旋转）都经此重算可视内容区并推送 JS。不消费 insets（原样返回），子树照常分发。
        lynxView.setOnApplyWindowInsetsListener(this::onWindowInsetsChanged);
        // ADR-0131（D3 修订）：内容区尺寸契约——布局与 insets 双入口都经 updateContentArea
        // 重算（可视内容区 = 边界 − 可见系统栏 insets），getViewportSize 语义不变。
        // 首次布局即触发，早于 bundle 渲染，getViewportSize 几乎必然命中有效值。
        // 生命周期：lambda 仅写静态字段、不捕获 this，随 lynxView destroy() 释放，无泄漏。
        lynxView.addOnLayoutChangeListener((v, left, top, right, bottom, ol, ot, or2, ob) -> {
            if (right - left > 0 && bottom - top > 0) {
                updateContentArea(right - left, bottom - top);
            }
        });
        // ADR-0066：系统返回桥——拦截系统返回（手势/按键），bundle 就绪后仅转发 JS 决策
        // （不自行退出）；bundle 未就绪时 JS 侧无监听者，原生兜底退出，避免卡死。
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // 渲染/加载错误兜底页（showErrorFallback）没有 JS 消费方：直接退出，
                // 避免返回键被吞导致用户卡死在错误页（lynx-only 包无「返回 WebView」按钮）。
                if (errorShown.get()) {
                    finish();
                    return;
                }
                if (!bundleLoaded.get()) {
                    finish();
                    return;
                }
                lynxView.sendGlobalEvent("pictelioBack", new JavaOnlyArray());
            }
        });
        // renderTemplateUrl(url, initData)：initData 由 app-lynx 启动自恢复，无需注入
        lynxView.renderTemplateUrl("main.lynx.bundle", "");

        // Dev intent hooks（emulator 端到端测试专用）：BuildConfig.DEBUG 门禁；release 完全跳过。
        // 必须放在 renderTemplateUrl 之后——auto-login 需要 lynxView.getLynxContext()，
        // force R18 广播由 onLoadSuccess 接力（避免 JS 未挂载提前投递丢事件）。
        applyDevIntentHooks(getIntent());

        // 兜底：bundle 加载可能既不回调成功也不回调失败（如宿主层卡死），
        // 10 秒未就绪则视为失败，退出 Splash 并展示错误页，避免启动屏/白屏卡死
        // （S8/ADR-0164 决策 2：超时属慢设备而非不支持，漏斗对 LOAD_TIMEOUT
        // 恒裁决错误页，永不自动跳 WebView）。
        // D5 冷启动重设：设置键为 true 时隐藏系统栏——Activity 重建（引擎切换/配置变更）
        // 必走 onCreate，天然满足「重建后重设」（#592 F3.2：新 Window 默认全显）。
        // 全屏态已在初始化段读入 statusBarHidden（顺序显式，见上）；此处只做系统栏切换——
        // applySystemBarsHidden 内部经 syncStatusBarHidden 幂等回写闩锁 + 重下发外观（跳过分支）。
        if (statusBarHidden) {
            applySystemBarsHidden(this, true);
        }
        scheduleLoadTimeout();
    }

    // ── Dev intent hooks（BuildConfig.DEBUG 门禁；emulator 端到端测试通道）────────

    /**
     * 处理 adb `am start --es ...` 注入的 dev extras：
     * <ul>
     *   <li>{@code pictelio_dev_refresh_token}：非空时立即调 PictelioSecureStorage 持久化 +
     *       PictelioAuth.loginWithRefreshToken 完成 OAuth 交换（access_token 进 Java 堆，refresh_token
     *       轮换后落 Keystore）。</li>
     *   <li>{@code pictelio_dev_force_r18}：任意值（任何非空字符串视为 true）时直接写
     *       {@link #DEV_FORCE_R18_PREFS_KEY} = "true" 到 SharedPreferences（{@link #DEV_FORCE_R18_PREFS_FILE}
     *       文件，与 JS 侧 nativePrefs 走的 PictelioPrefs.PREFS_FILE 同源）。JS 端
     *       settingsStore.loadSettings 读取该键，若 === "true" 则强制 _showR18 / _showR18G = true。
     *       取代之前 sendGlobalEvent("pictelioDevForceR18") + JS listener 置 globalThis.__FORCE_R18__
     *       的事件总线方案——bundle 渲染竞态不再丢事件（loadSettings 总会读到），
     *       SharedPreferences "CapacitorStorage" 写入路径完全一致（key 字符串与 native prefs adapter
     *       同契约，无 JS 端特殊处理）。</li>
     * </ul>
     * 门禁：{@code BuildConfig.DEBUG}。release 构建该判断恒 false，方法体整体作为死代码被 R8 移除，
     * 生产 APK 不含钩子（与 ADR-0136 benchNav 决策 1 同语义）。
     */
    private void applyDevIntentHooks(android.content.Intent intent) {
        if (!BuildConfig.DEBUG) return; // release 完全跳过

        // 1) refresh_token auto-login
        String refreshToken = intent.getStringExtra(DEV_EXTRA_REFRESH_TOKEN);
        if (refreshToken != null && !refreshToken.isEmpty()) {
            autoLoginWithRefreshToken(refreshToken);
        }

        // 2) 翻译 endpoint 播种（baseURL / model 进 SharedPreferences，apiKey 进 Keystore）
        applyLlmEndpointDevSeed(intent);

        // 3) force R18：直接写 SharedPreferences（KeyError 前与 PictelioPrefsModule.set 同文件同键，
        // 保证 JS 端 nativePrefs().get("dev_force_r18") 命中；详见 SPEC 第 6 章节）
        if (intent.hasExtra(DEV_EXTRA_FORCE_R18)) {
            try {
                getSharedPreferences(DEV_FORCE_R18_PREFS_FILE, MODE_PRIVATE)
                        .edit()
                        .putString(DEV_FORCE_R18_PREFS_KEY, "true")
                        .apply();
                Log.i(TAG, "dev hook: pictelio_dev_force_r18 extra 已捕获，dev_force_r18=true 已写入 "
                        + DEV_FORCE_R18_PREFS_FILE);
            } catch (Throwable t) {
                Log.w(TAG, "dev hook: dev_force_r18 写入 SharedPreferences 失败", t);
            }
        }
    }

    /**
     * 翻译 endpoint dev 播种：apiKey → Keystore（{@code SecureStorageCompat}，与
     * PictelioTranslateModule.KEY_API_KEY 同 key），baseURL / model → SharedPreferences
     * （与 JS 侧 nativePrefs 同文件）。三个 extra 全给才播种，避免半配置状态。
     */
    private void applyLlmEndpointDevSeed(android.content.Intent intent) {
        String baseURL = intent.getStringExtra(DEV_EXTRA_LLM_BASE_URL);
        String apiKey = intent.getStringExtra(DEV_EXTRA_LLM_API_KEY);
        String model = intent.getStringExtra(DEV_EXTRA_LLM_MODEL);
        if (baseURL == null || baseURL.isEmpty() || apiKey == null || apiKey.isEmpty()
                || model == null || model.isEmpty()) {
            return;
        }
        try {
            new SecureStorageCompat(getApplicationContext()).setItem("translate_llm_api_key", apiKey);
            getSharedPreferences(DEV_FORCE_R18_PREFS_FILE, MODE_PRIVATE)
                    .edit()
                    .putString("llm_endpoint_base_url", baseURL)
                    .putString("llm_endpoint_model", model)
                    .apply();
            Log.i(TAG, "dev hook: 翻译 endpoint 已播种 baseURL=" + baseURL + " model=" + model
                    + "（apiKey 已写 Keystore）");
        } catch (Throwable t) {
            Log.w(TAG, "dev hook: 翻译 endpoint 播种失败", t);
        }
    }

    /**
     * 调 PictelioSecureStorage.setItem + PictelioAuth.loginWithRefreshToken 完成登录态恢复。
     * <p>模块实例化路径：lynxView.getLynxContext() 拿 Lynx 自身使用的 LynxContext（满足模块内部
     * {@code (LynxContext) mContext} 转型的硬约束——直接传 Activity Context 会 ClassCastException）。
     * 错误回调均走 Log.w 显式告警，禁静默降级（测试 hard constraint #3）。
     */
    private void autoLoginWithRefreshToken(String refreshToken) {
        try {
            com.lynx.tasm.behavior.LynxContext ctx = lynxView.getLynxContext();
            PictelioSecureStorageModule storage = new PictelioSecureStorageModule(ctx);
            PictelioAuthModule auth = new PictelioAuthModule(ctx);

            // setItem 回调契约（见 PictelioSecureStorageModule.java）：单参失败信息（成功无参/null）。
            storage.setItem(REFRESH_TOKEN_KEY, refreshToken, (Object... setArgs) -> {
                String setErr = (setArgs != null && setArgs.length > 0 && setArgs[0] != null)
                        ? setArgs[0].toString() : "";
                if (!setErr.isEmpty()) {
                    Log.w(TAG, "dev hook: refresh_token 持久化失败: " + setErr);
                    return; // 持久化失败不继续 OAuth 交换（避免 Java 堆有 access 但下次启动丢登录态）
                }
                // loginWithRefreshToken 回调契约：cb(userInfoJson, errMsg) —— 失败第二参非空。
                auth.loginWithRefreshToken(refreshToken, (Object... loginArgs) -> {
                    String loginErr = (loginArgs != null && loginArgs.length >= 2 && loginArgs[1] != null)
                            ? loginArgs[1].toString() : "";
                    if (!loginErr.isEmpty()) {
                        Log.w(TAG, "dev hook: loginWithRefreshToken 失败: " + loginErr);
                    } else {
                        Log.i(TAG, "dev hook: 自动登录成功（userInfo=" + loginArgs[0] + "）");
                    }
                });
            });
        } catch (Throwable t) {
            Log.w(TAG, "dev hook: autoLoginWithRefreshToken 异常", t);
        }
    }

    // ── 系统栏 insets 管线（spec lynx-systembars D2/D3）─────────────────

    /**
     * insets 回调：记录可见系统栏 insets（systemBars ∪ displayCutout，即 JS 安全区），
     * 重算可视内容区并推送 JS。原样返回 insets 不消费——子树照常分发。
     */
    private WindowInsets onWindowInsetsChanged(View v, WindowInsets insets) {
        Insets safe = WindowInsetsCompat.toWindowInsetsCompat(insets)
                .getInsets(WindowInsetsCompat.Type.systemBars()
                        | WindowInsetsCompat.Type.displayCutout());
        sInsetTop = safe.top;
        sInsetBottom = safe.bottom;
        updateContentArea(v.getWidth(), v.getHeight());
        sendInsetsEvent();
        return insets;
    }

    /**
     * insets 变化推送 JS（事件通道，spec D2）：初始值由 JS 订阅后经
     * {@link PictelioAppModule#getSafeAreaInsets} 拉取（防 attach 期首帧事件早于
     * JS 订阅而丢失——benchNav 四次广播同族的竞态），事件只负责后续变化。
     * 值变化才发（防抖不变量：框架可能以相同值重复回调）。
     */
    private void sendInsetsEvent() {
        if (lynxView == null) return;
        if (sLastSentTop == sInsetTop && sLastSentBottom == sInsetBottom) return;
        sLastSentTop = sInsetTop;
        sLastSentBottom = sInsetBottom;
        lynxView.sendGlobalEvent(EVENT_INSETS, JavaOnlyArray.of(sInsetTop, sInsetBottom));
    }

    /**
     * 暗色 uiMode 变化推送 JS（事件通道，spec lynx-night-mode T1 §4.3）：
     * 载荷 = JSON 字符串 {@code {"mode":"light"|"dark"}} —— 与 insets 双参数值契约区分。
     * 值变化才发（防抖不变量：同值不重复回调，配置变更可能以同 uiMode 重复触发）。
     * lynxView 为 null 时静默 no-op（onDestroy 后被清空）；同 mode 不发（sLastDarkSent 短路，
     * 与 sendInsetsEvent 内部去重对齐，新增 caller 不必各自比 sLastUiMode）。
     */
    private void sendDarkModeEvent() {
        if (lynxView == null) return;
        String mode = currentDarkMode(sLastUiMode);
        if (mode.equals(sLastDarkSent)) return;
        sLastDarkSent = mode;
        lynxView.sendGlobalEvent(EVENT_DARK_MODE, JavaOnlyArray.of("{\"mode\":\"" + mode + "\"}"));
    }

    // ── bundle 加载失败兜底（#51 修复：切换引擎后白屏死锁） ─────────────

    /** 截断并清理 SDK 错误串，避免把本地路径/URL 等细节原样展示在用户可见错误页 */
    private static String sanitizeError(String msg) {
        if (msg == null) return "未知错误";
        String cleaned = msg.replaceAll("[\\r\\n\\t]+", " ").trim();
        return cleaned.length() > 120 ? cleaned.substring(0, 120) + "…" : cleaned;
    }

    /**
     * 渲染期错误处理（ADR-0064）：仅致命渲染中断类错误进失败漏斗（{@link #onFatal}，
     * ADR-0164，按 RENDER_FATAL 裁决），其余仅打日志。
     * 致命信号：errorCode 9902/990200（Lynx 渲染系统错误分类码/完整码，SDK 版本
     * 粒度不一故双匹配）或消息含 InstantiationException（注解生成类反射失败，
     * issue #132 白屏根因），或 isFatal。
     * 避免对可恢复的轻量错误（如单个组件 props 异常）误伤整页。
     */
    private void handleRenderError(LynxError error) {
        int code = error != null ? error.getErrorCode() : -1;
        String msg = error != null ? error.getMsg() : null;
        boolean fatal = error != null && error.isFatal();
        boolean renderBroken =
                code == 9902 || code == 990200
                        || (msg != null && msg.contains("InstantiationException"));
        if (renderBroken || fatal) {
            Log.w(TAG, "Lynx 渲染致命错误（code=" + code + "）→ 展示错误兜底");
            bundleLoaded.set(true); // 退出 Splash（若尚未退出）
            cancelLoadTimeout();
            onFatal("Lynx 渲染失败：" + sanitizeError(msg));
        } else {
            Log.w(TAG, "Lynx 渲染错误（code=" + code + "）已忽略（非致命）：" + sanitizeError(msg));
        }
    }

    private static final long LOAD_TIMEOUT_MS = 10_000L;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AtomicBoolean errorShown = new AtomicBoolean(false);
    private final Runnable loadTimeoutRunnable = () -> {
        if (!bundleLoaded.get()) {
            Log.w(TAG, "bundle 加载超时（" + LOAD_TIMEOUT_MS + "ms）→ 展示错误兜底");
            bundleLoaded.set(true); // 退出 Splash
            onFatal("Lynx bundle 加载超时");
        }
    };

    private void scheduleLoadTimeout() {
        mainHandler.postDelayed(loadTimeoutRunnable, LOAD_TIMEOUT_MS);
    }

    private void cancelLoadTimeout() {
        mainHandler.removeCallbacks(loadTimeoutRunnable);
    }

    // ── 运行时失败收敛（原 spec §6 / ADR-0164 失败漏斗；沙盒 #610 单引擎化后简化）──

    /**
     * 致命失败唯一入口（init 抛错 / onLoadFailed / 致命渲染错误 / 10s watchdog 收敛于此）。
     *
     * <p>沙盒 #610：WebView 线整体下线后不存在「可降级到的宿主」，失败记忆与
     * 自动跳转一并删除——任何致命错误一律落 {@link #showErrorFallback} 错误页。
     * 10s 加载超时同样只落错误页，绝不自动跳（该约束自 ADR-0164 起保持不变：
     * 慢设备 ≠ 不支持）。
     *
     * <p>防重契约不变：{@code errorShown} 首胜语义全局保持，防重由
     * {@link #showErrorFallback} 自身的原子 getAndSet 完成。多个 fatal 生产者
     * 并发时仅第一个渲染错误页，其余静默——防重不依赖本方法的前置状态。
     */
    private void onFatal(String message) {
        showErrorFallback(message); // 内部 errorShown 原子防重
    }

    /**
     * bundle 加载失败/超时时展示错误视图（替代白屏），并提供"返回 WebView"出口。
     * full 包（含 webview 能力）才显示切回按钮；lynx-only 包仅展示错误信息。
     */
    private void showErrorFallback(String message) {
        if (errorShown.getAndSet(true)) return;
        runOnUiThread(() -> {
            LinearLayout root = new LinearLayout(this);
            root.setOrientation(LinearLayout.VERTICAL);
            root.setGravity(Gravity.CENTER);
            root.setPadding(dp(28), dp(28), dp(28), dp(28));
            root.setBackgroundColor(0xFF1B1B1B);

            TextView title = new TextView(this);
            title.setText("Lynx 客户端启动失败");
            title.setTextColor(0xFFFFFFFF);
            title.setTextSize(20);
            title.setGravity(Gravity.CENTER);
            root.addView(title, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

            TextView detail = new TextView(this);
            detail.setText(message);
            detail.setTextColor(0xFFCCCCCC);
            detail.setTextSize(14);
            detail.setGravity(Gravity.CENTER);
            detail.setPadding(0, dp(12), 0, dp(28));
            root.addView(detail, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

            // 沙盒 #610：单引擎后错误页无「返回 WebView」可给（该宿主已下线），
            // 也不再有「降级进入」实例的区分——统一给一个退出出口。
            Button exitButton = new Button(this);
            exitButton.setText("退出应用");
            exitButton.setOnClickListener(v -> finish());
            root.addView(exitButton, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));

            setContentView(root);
        });
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    // ─── 通知落点分派（#940）────────────────────────────────────────────────

    /**
     * 把 intent 里的通知落点转成 JS 全局事件。
     *
     * <p>⚠️ <strong>冷启动必须多窗重发</strong>：bundle 渲染竞态下，页面级监听可能晚于
     *   onLoadSuccess 那一刻（这是本仓 benchNav 深链踩过的坑，同款延时组）。
     *   热启动则 JS 早已挂载，单次即可——多发只会白白多记几次到达。
     *
     * <p>载荷只带 clickId（单个 Long，见 benchNav illust-detail 先例：lynx 4.0.1 的
     *   {@code JavaOnlyArray.of} 只实证过单参数）；冷/热由<strong>事件名</strong>区分。
     *
     * <p>无落点 extra ⇒ 直接返回（绝大多数启动都走这条，不能误报）。
     *
     */
    /**
     * 本进程是否还有**活着的** LynxActivity 实例。
     *
     * <p>⚠️ 刻意**不用** {@code sProcessRendered}：那个静态在 onLoadSuccess 置位后**永不重置**，
     *   而 {@code PictelioAppModule.exitApp()} 只 {@code finish()} 不杀进程
     *   ⇒「进程活着但没有 Activity」是可达状态，用它会把单次广播发给一个不存在的监听者
     *   ⇒ 点击静默丢失。{@code sInstance} 由 ADR-0066 的 onCreate/onDestroy 成对维护，是真实存活标志。
     */
    static boolean hasLiveActivityInstance() {
        WeakReference<LynxActivity> ref = sInstance;
        return ref != null && ref.get() != null;
    }

    private void dispatchNotificationTarget(android.content.Intent intent) {
        if (lynxView == null) return;
        if (intent == null) return;
        String target = intent.getStringExtra(EXTRA_NOTIFICATION_TARGET);
        if (target == null || target.isEmpty()) return;
        if (!TARGET_NOTIFICATIONS.equals(target)) {
            // 未知目标：显式告警后不导航（禁静默降级）
            Log.w(TAG, "通知落点目标未知：" + target + "，不导航");
            return;
        }
        long clickId = intent.getLongExtra(EXTRA_NOTIFICATION_CLICK_ID, 0L);
        // ⚠️ 这里**不判冷热**：#940 实施期结论——「点击时用户是否在 App 里」在进程内不可判定
        //   （处理点击本身即状态跃迁，四种候选信号全被污染，见 ADR-0220 §6-3）。
        String event = EVENT_NOTIFICATION_TARGET;
        // ⚠️ 广播**恒为四次**，不再按「单次 / 多窗」判：两种判据都会错 ——
        //   ① 按 onLoadSuccess/onNewIntent 硬编码：冷启动时 onNewIntent 在 bundle 加载**之后**才送达
        //      （e2e #942 实测），判成单次 ⇒ 点击丢失；
        //   ② 按「bundle 是否已加载」实测：onLoadSuccess 调用点在加载回调**内部**，此刻该判据恒真。
        //   ⇒ 干脆不判：多余的三次由 clickId 去重挡掉（首次到达才导航+计数），成本可忽略。
        Log.i(
                TAG,
                "通知落点 → " + event + " clickId=" + clickId + "，四次广播 pid=" + android.os.Process.myPid());

        // ⚠️ 四次广播**可能全部落在 JS 订阅之前**（e2e #942 实测：落点分派成功、
        //   点击却一次没被记）。故同时把 clickId 落盘，让 JS 挂载时**主动拉取**
        //   ——与本仓 safeArea / darkMode 的「首帧事件早于订阅 ⇒ 订阅后拉取初值」同款。
        android.content.SharedPreferences.Editor ed =
                getApplication()
                        .getSharedPreferences(PictelioPrefsModule.PREFS_FILE, MODE_PRIVATE)
                        .edit();
        ed.putString(KEY_PENDING_NOTIFICATION_CLICK, String.valueOf(clickId));
        ed.commit(); // 同步落盘：进程可能随时被回收

        for (long delay : TARGET_BROADCAST_DELAYS) {
            final long id = clickId;
            new android.os.Handler(android.os.Looper.getMainLooper())
                    .postDelayed(
                            () -> {
                                if (!isFinishing() && lynxView != null) {
                                    lynxView.sendGlobalEvent(event, JavaOnlyArray.of(id));
                                }
                            },
                            delay);
        }
        Log.i(TAG, "通知落点 → " + event + " clickId=" + clickId + "，四次广播");
    }

    /**
     * 热启动落点（#940 AC-6）。
     *
     * <p>⚠️ {@code setIntent} 不可省：不调用的话 {@code getIntent()} 仍返回<strong>首次</strong>启动的
     *   intent，后续点击带来的 extra 会被静默丢弃——正是 ADR-0220 §6-3 点名的
     *   「onNewIntent 未 override ⇒ extra 静默丢弃 ⇒ 点了像没点」。
     *
     * <p>⚠️⚠️ <strong>不能用「哪个回调触发」判冷热</strong>（真机打脸过一次）：
     *   点击意图带 {@code FLAG_ACTIVITY_SINGLE_TOP}，任务记录仍在（用户只是 HOME 了、
     *   进程被系统回收）时，Android 会把新 intent 以 {@code onNewIntent} 投给
     *   <strong>已重建</strong>的 Activity——回调是热的，进程却是新起的，用户**并不在** App 里。
     *   真机实证：`am kill` 后进程确已死亡，落点仍被判成「热启动」。
     *   判据必须是 <strong>bundle 是否已加载</strong>（= JS 是否已在跑 = 用户是否可能在里面）。
     */
    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        dispatchNotificationTarget(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (lynxView != null) {
            lynxView.onEnterForeground();
            // 送达通道 · 触达探测（ADR-0220 决策 2）：进入前台事件。
            // LynxView.onEnterForeground() **不会**转成 JS 事件（insets/darkMode/back 之外
            // 没有第四条 JS 生命周期通道），而 Lynx 侧也没有窗口 focus 事件
            // （api/queryClient 已因此关闭 refetchOnWindowFocus）⇒ 静默期判定只能靠本事件。
            // ⚠️ 不设防抖：onResume 与 onPause 成对，重复进入前台的语义就是「又在前台了」，
            //   JS 侧静默期计时会自行重置。
            lynxView.sendGlobalEvent("pictelioAppForeground", new JavaOnlyArray());
        }
        // ADR-0180（T1）：onResume 兜底比对 — 后台期间系统 uiMode 翻转若未触发
        // configChanges（个别厂商 / 后台省电冻结），resume 时强制补发事件，避免 JS 漏感知。
        // 安全：sLastUiMode 已被 onConfigurationChanged / onCreate 初始化；未初始化不补发
        // （判定收敛到纯函数 shouldEmitDarkEvent，可单测）。
        // 防抖短路下沉到 sendDarkModeEvent 内部（sLastDarkSent），此处只需比对 uiMode 缓存。
        // 判定与发射必须相邻（≤ 数行）：JS 侧 darkModeJavaContract.test.ts 以源级断言钉住本形态。
        if (lynxView != null) {
            int current = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
            if (shouldEmitDarkEvent(sLastUiMode, current)) {
                sLastUiMode = current;
                sendDarkModeEvent();
                Log.i(TAG, "onResume 兜底补发暗色事件（uiMode 翻转未走 configChanges）");
                // T3 + #692：状态栏图标深浅联动——与 sendDarkModeEvent 同触发源（uiMode 翻转），
                // 不重新走 recreate（WindowInsetsControllerCompat 同一实例可即时生效）。
                applyStatusBarAppearance();
            }
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (lynxView != null) {
            lynxView.onEnterBackground();
            // 离开前台事件（ADR-0220 决策 2）：与 onResume 的前台事件成对。
            // JS 侧据此停止静默期计时——用户已经离开，本轮不再打扰。
            lynxView.sendGlobalEvent("pictelioAppBackground", new JavaOnlyArray());
        }
    }

    

    /**
     * 系统配置变化回调（spec lynx-night-mode T1 §3）：manifest 已声明 uiMode configChanges，
     * 免 Activity 重建；本回调仅比对 uiMode 并推事件，JS 侧 computed 归一输出即时反映。
     * 同 insets 管线（onWindowInsetsChanged）：值变化才发，防抖不变量。
     *
     * <p>T3 + #692：uiMode 翻转同时联动状态栏图标深浅（与 sendDarkModeEvent 同触发源）——
     * Android 状态栏图标属性是 Java 侧独立状态，必须在 sendDarkModeEvent 之后同步下发，
     * 否则 JS 切到暗外观后状态栏图标仍为深色与新背景不可读。手动三态下 uiMode 翻转不改
     * 外观（applyStatusBarAppearance 内按 prefs 决策），下发幂等无害。
     *
     * <p>判定与发射必须相邻（≤ 数行）：JS 侧 darkModeJavaContract.test.ts 以源级断言钉住
     * 「每个发射点由 {@link #shouldEmitDarkEvent} 决策 + 判定后紧随 {@code sendDarkModeEvent()}」
     * 的形态，防止调用被删或判定被绕开。
     */
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        int nightMode = newConfig.uiMode & Configuration.UI_MODE_NIGHT_MASK;
        if (shouldEmitDarkEvent(sLastUiMode, nightMode)) {
            sLastUiMode = nightMode;
            sendDarkModeEvent();
            // T3 + #692：状态栏图标深浅联动（解 ADR-0168 D4 钉死 + 手动三态接线）
            applyStatusBarAppearance();
        }
    }

    @Override
    protected void onDestroy() {
        // 取消未触发的加载超时回调，避免 Activity 销毁后仍执行 setContentView
        cancelLoadTimeout();
        sInstance = null; // ADR-0066：清理 exitApp 目标引用
        // ADR-0131：复位内容区尺寸与 insets（静态字段跨实例复用）——销毁后回到「未布局」
        // 哨兵，保证新实例首次查询（若先于布局）命中「cb(-1,-1) → JS 回退 SystemInfo」契约语义。
        sContentW = -1;
        sContentH = -1;
        sInsetTop = 0;
        sInsetBottom = 0;
        sLastSentTop = -1;
        sLastSentBottom = -1;
        // ADR-0180：复位 uiMode 哨兵到 -1；新实例首 onCreate 重新读 Configuration
        sLastUiMode = -1;
        // ADR-0180（F14）：暗色事件去重哨兵同步复位——否则新实例（重建/引擎切换）沿用旧实例的
        // 「已发 dark/light」记忆，同一值的首次事件被误判重复而短路，JS 侧漏掉新实例的首帧真值。
        sLastDarkSent = "";
        if (lynxView != null) {
            lynxView.destroy();
        }
        super.onDestroy();
    }
}
