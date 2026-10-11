package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.app.ActivityManager;
import android.content.Context;
import android.util.DisplayMetrics;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowLog;

/**
 * 内存缓存预算解析器单测（#979）——系统服务读取的 IO 边界。
 *
 * <p>覆盖 IO 双路径（测试硬约束 #1 / #3）：
 * <ul>
 *   <li>成功路径：从 {@code Context} 读屏幕尺寸 + {@code ActivityManager} 内存等级，
 *       产出正预算且不超过封顶值；</li>
 *   <li>降级路径：屏幕尺寸不可用 → 退回封顶档、内存等级不可用或无 Context → 退回
 *       末档常量，<b>两条都必须 Log.w</b>（禁静默降级，断言用 {@link ShadowLog} 观测）。</li>
 * </ul>
 *
 * <p><b>oracle 溯源</b>：封顶比例的期望值来自 Glide {@code MemorySizeCalculator}
 * 常量（ADR-0222 §2.3），非从被测实现反推；本类只断言「落在封顶内」与「降级必告警」
 * 这两条不变量，不断言 Robolectric 自身那套虚拟屏幕的具体像素。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class ImageCacheBudgetResolverTest {

    private Context appContext() {
        return RuntimeEnvironment.getApplication();
    }

    private static boolean warnedOnBudgetTag() {
        for (ShadowLog.LogItem item : ShadowLog.getLogs()) {
            if (ImageCacheBudgetResolver.TAG.equals(item.tag) && item.type == android.util.Log.WARN) {
                return true;
            }
        }
        return false;
    }

    // ── 成功路径 ──

    @Test
    public void resolve_fromAppContext_returnsPositiveBudgetWithinCap() {
        ShadowLog.clear();
        Context ctx = appContext();
        // 把 Robolectric 的虚拟设备事实钉成明确值，使本例断言不依赖影子类的默认返回
        ActivityManager activityManager =
                (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
        shadowOf(activityManager).setMemoryClass(256);
        shadowOf(activityManager).setIsLowRamDevice(false);

        long budget = ImageCacheBudgetResolver.resolve(ctx);

        DisplayMetrics metrics = ctx.getResources().getDisplayMetrics();
        assertTrue("预算必须为正", budget > 0);
        assertTrue("预算须不超过本机内存等级封顶值",
                budget <= ImageCacheBudget.capBytes(256, false));
        assertTrue("预算须至少覆盖一屏",
                budget >= metrics.widthPixels * (long) metrics.heightPixels * 4L);
    }

    // qualifiers 把虚拟屏幕钉到 2880×5120 px（1440dp×2560dp @xhdpi）：屏数档目标值
    // 2880*5120*4*2 = 117,964,800 大于两档封顶，「低内存档严格更小」才可观察
    @Test
    @Config(qualifiers = "w1440dp-h2560dp-xhdpi")
    public void resolve_lowRamDevice_getsSmallerBudgetThanNormalDevice() {
        Context ctx = appContext();
        ActivityManager activityManager =
                (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
        DisplayMetrics metrics = ctx.getResources().getDisplayMetrics();

        shadowOf(activityManager).setMemoryClass(256);
        shadowOf(activityManager).setIsLowRamDevice(false);
        long normal = ImageCacheBudgetResolver.resolve(ctx);
        shadowOf(activityManager).setIsLowRamDevice(true);
        long lowRam = ImageCacheBudgetResolver.resolve(ctx);

        assertTrue("同一台设备被判为低内存时预算必须更小", lowRam < normal);
        assertEquals("低内存档预算须等于低内存封顶值",
                ImageCacheBudget.capBytes(256, true), lowRam);
        assertTrue("屏幕尺寸档在本例应远大于封顶，否则该断言不成立",
                metrics.widthPixels * (long) metrics.heightPixels * 8L > lowRam);
    }

    // ── 降级路径：屏幕尺寸不可用 → 退回封顶档（仍受内存等级约束，不吃满进程）──

    @Test
    public void resolveOrCompute_invalidScreen_fallsBackToCapAndWarns() {
        ShadowLog.clear();
        long budget = ImageCacheBudgetResolver.resolveOrCompute(0, 0, 2, 64, false);

        assertEquals("屏幕尺寸不可用时须退回封顶档",
                ImageCacheBudget.capBytes(64, false), budget);
        assertTrue("降级必须 Log.w（禁静默降级）", warnedOnBudgetTag());
    }

    // ── 降级路径：内存等级也不可用 → 末档常量 + 告警 ──

    @Test
    public void resolveOrCompute_noMemoryClass_fallsBackToLastResortAndWarns() {
        ShadowLog.clear();
        long budget = ImageCacheBudgetResolver.resolveOrCompute(1080, 2400, 2, 0, false);

        assertEquals("内存等级缺失时须退回末档常量",
                ImageCacheBudgetResolver.LAST_RESORT_BYTES, budget);
        assertTrue("降级必须 Log.w（禁静默降级）", warnedOnBudgetTag());
    }

    @Test
    public void resolve_nullContext_fallsBackToLastResortAndWarns() {
        ShadowLog.clear();
        long budget = ImageCacheBudgetResolver.resolve(null);

        assertEquals("无 Context 时须退回末档常量",
                ImageCacheBudgetResolver.LAST_RESORT_BYTES, budget);
        assertTrue("降级必须 Log.w（禁静默降级）", warnedOnBudgetTag());
    }
}
