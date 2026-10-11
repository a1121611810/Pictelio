package io.pictelio.app;

import android.app.ActivityManager;
import android.content.Context;
import android.util.DisplayMetrics;
import android.util.Log;

/**
 * 把「设备事实」从系统服务读出来，交给纯函数 {@link ImageCacheBudget} 算预算（#979）。
 *
 * <p>分工：本类<b>只负责读</b>屏幕尺寸 / 内存等级 / 是否低内存设备，算法一律在纯函数里，
 * 因此算法可被纯 JVM 单测覆盖，而读系统服务的边界由本类的单测覆盖（IO 双路径）。
 *
 * <p><b>降级一律显式告警</b>（测试硬约束 #3 禁静默降级）：读不到任何设备事实时退回
 * {@link #LAST_RESORT_BYTES} 保守末档并 {@code Log.w}；屏幕尺寸不可用但内存等级可读时，
 * 退回「仅内存封顶档」（仍是受控预算，不会吃满进程），同样 {@code Log.w}。
 */
public final class ImageCacheBudgetResolver {

    /** 日志 TAG（包可见：单测用 ShadowLog 断言「降级必须告警」，故非 private） */
    static final String TAG = "ImageCacheBudget";

    /**
     * 末档兜底常量（16MB）——<b>仅在设备事实完全读不到时使用</b>（无 Context 或无内存等级）。
     *
     * <p>⚠️ 此常量<b>不是</b> Glide 出处（Glide 无此值，见 {@link ImageCacheBudget} 的出处说明），
     * 是本仓自定的保守兜底：拿不到设备事实时宁可给小、不可给大。
     */
    public static final long LAST_RESORT_BYTES = 16L * 1024 * 1024;

    private ImageCacheBudgetResolver() {}

    /**
     * 从 {@code Context} 读设备事实并算出内存缓存预算。
     *
     * @param app Application 上下文（可为 null，null 走末档 + 告警）
     */
    public static long resolve(Context app) {
        if (app == null) {
            Log.w(TAG, "无 Context，无法读取屏幕尺寸与内存等级；退回末档预算 "
                    + (LAST_RESORT_BYTES / 1024 / 1024) + "MB");
            return LAST_RESORT_BYTES;
        }
        ActivityManager activityManager;
        DisplayMetrics metrics;
        try {
            activityManager = (ActivityManager) app.getSystemService(Context.ACTIVITY_SERVICE);
            metrics = app.getResources().getDisplayMetrics();
        } catch (RuntimeException e) {
            // 系统服务读取本身失败（厂商 ROM 差异 / 极早启动态）不得让进程崩在初始化路径上
            Log.w(TAG, "读取设备事实失败，退回末档预算 " + (LAST_RESORT_BYTES / 1024 / 1024) + "MB: " + e);
            return LAST_RESORT_BYTES;
        }
        int memoryClassMb = activityManager == null ? 0 : activityManager.getMemoryClass();
        boolean lowRamDevice = activityManager != null && activityManager.isLowRamDevice();
        long budget = resolveOrCompute(metrics.widthPixels, metrics.heightPixels,
                ImageCacheBudget.MEMORY_CACHE_TARGET_SCREENS, memoryClassMb, lowRamDevice);
        // 成功路径也留一行（2026-10-11）：内存预算是本轮唯一**没有任何观测出口**的数字——
        // 降级才告警，故正常设备上算出的值在 logcat 里查不到，真机验收与线上排查都无从下手。
        // 记 i 级（不是降级，不该是 w）。输入一并打出，便于对照 ADR-0222 §2.3 的公式手算复核。
        Log.i(TAG, "内存缓存预算已按设备算出: " + (budget / 1024 / 1024) + "MB"
                + "（屏幕 " + metrics.widthPixels + "x" + metrics.heightPixels
                + " × " + ImageCacheBudget.MEMORY_CACHE_TARGET_SCREENS + " 屏"
                + "，memoryClass " + memoryClassMb + "MB"
                + "，低内存设备 " + lowRamDevice + "）");
        return budget;
    }

    /**
     * 已读到设备事实后的算入口（包可见：单测直接覆盖降级分支，不依赖 Robolectric 的虚拟屏幕）。
     *
     * <p>降级两级：内存等级缺失 → 末档常量；仅屏幕尺寸不可用 → 只用内存封顶档。
     * 两级都 {@code Log.w}，不做静默兜底。
     */
    static long resolveOrCompute(long screenWidthPx, long screenHeightPx, int screens,
            int memoryClassMb, boolean lowRamDevice) {
        if (memoryClassMb <= 0) {
            Log.w(TAG, "内存等级不可用（memoryClassMb=" + memoryClassMb + "），退回末档预算 "
                    + (LAST_RESORT_BYTES / 1024 / 1024) + "MB");
            return LAST_RESORT_BYTES;
        }
        try {
            return ImageCacheBudget.memoryCacheBudgetBytes(
                    screenWidthPx, screenHeightPx, screens, memoryClassMb, lowRamDevice);
        } catch (IllegalArgumentException e) {
            Log.w(TAG, "屏幕尺寸不可用（" + screenWidthPx + "x" + screenHeightPx
                    + "），退回内存封顶档: " + e.getMessage());
            return ImageCacheBudget.capBytes(memoryClassMb, lowRamDevice);
        }
    }
}
