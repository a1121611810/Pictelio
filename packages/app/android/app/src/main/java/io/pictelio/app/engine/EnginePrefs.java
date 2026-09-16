package io.pictelio.app.engine;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.util.Log;

/**
 * 全部引擎持久化键的唯一所有者（spec §3 键契约表 / ADR-0164 决策 3）。
 *
 * <p>收编现存散落的键字面量与 "CapacitorStorage" 文件名字面量；后续调用点
 * （PictelioAppModule / ClientInfoPlugin / LynxActivity 等，T2/T3 接线）一律经本类读写。
 *
 * <p>跨语言契约锚点——本类 KEY_* 与 TS 侧镜像常量
 * （{@code packages/app/src/utils/clientSwitch.ts}、
 * {@code packages/app-lynx/src/stores/settingsStore.ts}）经一致性测试比对，任一方漂移即红灯。
 *
 * <p>写入口径（spec §3 写者列）：首选键只由显式切换写入，<strong>降级绝不写</strong>；
 * 失败记忆只在运行时硬错误自动跳时写入、显式选择时清除。
 */
public final class EnginePrefs {

    private static final String TAG = "EnginePrefs";

    /** 所有引擎键所在 SharedPreferences 文件（与 Capacitor Preferences 插件同文件，双端共用）。 */
    public static final String PREFS_FILE = "CapacitorStorage";

    /** 首选引擎（"lynx" | "webview"）；缺省语义 = lynx（翻转后，T2 生效）。 */
    public static final String KEY_PREFERRED_KIND = "pictelio_client_kind";

    /** 运行时硬错误自动跳 WebView 开关（"true" | "false"；缺省 true）。 */
    public static final String KEY_AUTO_FALLBACK = "pictelio_engine_auto_fallback";

    /** Lynx 失败记忆（失败时 versionCode 十进制字符串；与当前版本精确相等才命中，升级自动遗忘）。 */
    public static final String KEY_FAILURE_MEMORY = "pictelio_engine_lynx_failure_version";

    /** 生效状态快照（每次 {@link EngineRouting#resolve} 覆写）。 */
    public static final String KEY_STATE = "pictelio_engine_state";

    /** webview 提示条「不再提示」（"true" = 不再提示）。 */
    public static final String KEY_FALLBACK_OPTOUT = "pictelio_engine_fallback_optout";

    /** E2E 取证键：强制 Lynx 探针返回 false（仅 DEBUG 构建被读取，release 无此分支）。 */
    public static final String KEY_DEBUG_FORCE_LYNX_UNAVAILABLE =
            "pictelio_debug_force_lynx_unavailable";

    private EnginePrefs() {}

    // ── 状态读取 ────────────────────────────────────────────────

    /**
     * 读取引擎决策状态（{@code resolve} 的输入）。
     *
     * <p>归一化规则（spec §3）：preferred = 存储值合法且 ∈ kinds → 它；
     * 否则 kinds 含 "lynx" → LYNX（缺省即 lynx）；否则 kinds[0]。
     * knownBad = 失败记忆解析为整数且与当前 versionCode <strong>精确相等</strong>
     * （versionCode 不可解析 → 按未命中，不阻断启动）；autoFallback 按
     * {@link #autoFallbackEnabled} 口径（absent → true）。
     *
     * @param clientKinds 本包支持的引擎列表（来自 EngineProbe.clientKinds()）
     */
    public static EngineState read(Context ctx, String[] clientKinds) {
        SharedPreferences sp = prefs(ctx);
        Engine preferred = normalizePreferred(sp.getString(KEY_PREFERRED_KIND, null), clientKinds);
        boolean knownBad = false;
        long versionCode = currentVersionCode(ctx);
        if (versionCode < 0) {
            // versionCode 不可解析（PackageManager 异常）→ 失败记忆无法精确比对，按未命中处理
            Log.w(TAG, "versionCode 不可解析，失败记忆按未命中处理");
        } else {
            String raw = sp.getString(KEY_FAILURE_MEMORY, null);
            if (raw != null) {
                try {
                    knownBad = Long.parseLong(raw) == versionCode;
                } catch (NumberFormatException e) {
                    Log.w(TAG, "失败记忆值畸形（" + raw + "），按未命中处理");
                    knownBad = false;
                }
            }
        }
        return new EngineState(preferred, knownBad, autoFallbackEnabled(ctx));
    }

    /** 归一化首选：存储值合法 ∈ kinds → 它；否则 kinds 含 lynx → LYNX；否则 kinds[0]。 */
    private static Engine normalizePreferred(String stored, String[] kinds) {
        Engine storedEngine = Engine.ofKind(stored);
        if (storedEngine != null) {
            if (containsKind(kinds, storedEngine.kind())) return storedEngine;
            Log.w(TAG, "首选 " + stored + " 不在本包 CLIENT_KINDS 内，按缺省归一化");
        } else if (stored != null) {
            Log.w(TAG, "首选键值畸形（" + stored + "），按缺省归一化");
        }
        if (containsKind(kinds, "lynx")) return Engine.LYNX;
        if (kinds != null && kinds.length > 0) {
            Engine first = Engine.ofKind(kinds[0]);
            if (first != null) return first;
        }
        return Engine.LYNX; // kinds 整体畸形时的最后兜底（编译期生成，正常构建不可达）
    }

    // ── 快照发布 ────────────────────────────────────────────────

    /** 覆写生效状态快照（每次 resolve 调用；apply 异步落盘，写失败单次自愈可接受，E12）。 */
    public static void publish(Context ctx, EngineRoute route) {
        prefs(ctx).edit().putString(KEY_STATE, route.snapshotLine()).apply();
    }

    // ── 自动回退开关 ────────────────────────────────────────────

    /**
     * 运行时自动回退开关：absent → true（缺省开）、"false" → false、其余 → true。
     * 只管运行时硬错误是否自动跳，不管预检降级（ADR-0164 决策 5）。
     */
    public static boolean autoFallbackEnabled(Context ctx) {
        String raw = prefs(ctx).getString(KEY_AUTO_FALLBACK, null);
        if (raw == null || "true".equals(raw)) return true;
        if ("false".equals(raw)) return false;
        Log.w(TAG, "自动回退开关值畸形（" + raw + "），按缺省开处理");
        return true;
    }

    /** 写自动回退开关（双端设置 UI 共用）。 */
    public static void setAutoFallback(Context ctx, boolean enabled) {
        prefs(ctx).edit().putString(KEY_AUTO_FALLBACK, enabled ? "true" : "false").apply();
    }

    // ── 失败记忆 ────────────────────────────────────────────────

    /**
     * 记录 Lynx 失败：写入当前 versionCode 十进制字符串（只在 {@link EngineRouting#onLynxFailure}
     * 自动跳路径调用——「先写记忆再返回」顺序承重，hop 途中崩溃也不丢）。
     */
    public static void recordLynxFailure(Context ctx) {
        long versionCode = currentVersionCode(ctx);
        if (versionCode < 0) {
            Log.w(TAG, "versionCode 不可解析，失败记忆未写入");
            return;
        }
        prefs(ctx).edit().putString(KEY_FAILURE_MEMORY, String.valueOf(versionCode)).apply();
    }

    /** 清除失败记忆（显式选择首选时随 S12 一并调用；应用升级后靠精确比对自然失配遗忘）。 */
    public static void clearLynxFailure(Context ctx) {
        prefs(ctx).edit().remove(KEY_FAILURE_MEMORY).apply();
    }

    // ── 显式选择（S12）─────────────────────────────────────────

    /**
     * 显式选择首选引擎：写 {@link #KEY_PREFERRED_KIND} + 清失败记忆。
     * 二者必须同写——否则残留记忆会让下次启动又被 S4 弹回，显式选择失效（死循环修复，ADR-0164 决策 9）。
     */
    public static void setPreferredExplicit(Context ctx, Engine engine) {
        prefs(ctx).edit()
                .putString(KEY_PREFERRED_KIND, engine.kind())
                .remove(KEY_FAILURE_MEMORY)
                .apply();
    }

    // ── 提示条 optout ───────────────────────────────────────────

    /** webview 提示条「不再提示」是否已置位（absent → false）。 */
    public static boolean readOptOut(Context ctx) {
        return "true".equals(prefs(ctx).getString(KEY_FALLBACK_OPTOUT, null));
    }

    /** 写「不再提示」。 */
    public static void setOptOut(Context ctx, boolean optOut) {
        prefs(ctx).edit().putString(KEY_FALLBACK_OPTOUT, optOut ? "true" : "false").apply();
    }

    // ── E2E 取证键 ─────────────────────────────────────────────

    /**
     * 读取 E2E 取证键原始值（<strong>无 DEBUG 门控</strong>——门控在 LynxProbe 适配器：
     * 本类保持零 BuildConfig 引用，release 构建中键分支随调用方的
     * {@code BuildConfig.DEBUG} 常量折叠一起被 R8 死代码消除，键字符串不进 release dex）。
     */
    public static boolean debugForceLynxUnavailable(Context ctx) {
        return "true".equals(prefs(ctx).getString(KEY_DEBUG_FORCE_LYNX_UNAVAILABLE, null));
    }

    // ── 内部 ───────────────────────────────────────────────────

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE);
    }

    private static boolean containsKind(String[] kinds, String kind) {
        if (kinds == null) return false;
        for (String k : kinds) {
            if (kind.equals(k)) return true;
        }
        return false;
    }

    /** 当前应用 versionCode；PackageManager 不可用时返回 -1（调用方按未命中/不写入处理）。 */
    private static long currentVersionCode(Context ctx) {
        try {
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            return pi.getLongVersionCode();
        } catch (Exception e) {
            return -1L;
        }
    }
}
