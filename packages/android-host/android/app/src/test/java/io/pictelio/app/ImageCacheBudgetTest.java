package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

/**
 * 内存缓存预算纯函数单测（#979）。
 *
 * <p><b>oracle 溯源</b>（期望值出处 = Glide {@code MemorySizeCalculator} 源码常量，
 * 见 ADR-0222 §2.3「内存预算的外部一手出处」）：期望值一律手写字面量或由公开常量直接
 * 推导，<b>不从被测实现反推</b>、不做同义反复重算。
 *
 * <p><b>本类刻意不用 Robolectric</b>：{@link ImageCacheBudget} 若真是不依赖
 * {@code Context} / 任何 Android 组件的纯函数，纯 JUnit 就能跑；一旦它偷偷引用了
 * android 包，本类会以「方法未 mock」失败——纯度因此被测试本身钉住。
 */
public class ImageCacheBudgetTest {

    /** 典型 FHD+ 竖屏（手写规格值） */
    private static final int W_1080 = 1080;
    private static final int H_2400 = 2400;
    /** 典型 1440p 竖屏（手写规格值） */
    private static final int W_1440 = 1440;
    private static final int H_3200 = 3200;

    /** 内存等级足够大时封顶必然不生效，用于隔离「屏数法目标值」这一分支 */
    private static final int HUGE_MEMORY_CLASS_MB = 4096;

    // ── 一手常量钉死（oracle = Glide MemorySizeCalculator 源码字面量）──

    @Test
    public void glideCoefficients_pinnedToSource() {
        assertEquals("内存缓存屏数须等于 Glide MEMORY_CACHE_TARGET_SCREENS",
                2, ImageCacheBudget.MEMORY_CACHE_TARGET_SCREENS);
        assertEquals("ARGB_8888 每像素 4 字节",
                4L, ImageCacheBudget.BYTES_PER_PIXEL);
        assertEquals("普通设备封顶系数须等于 Glide MAX_SIZE_MULTIPLIER",
                0.4f, ImageCacheBudget.MAX_SIZE_MULTIPLIER, 0.0f);
        assertEquals("低内存设备封顶系数须等于 Glide LOW_MEMORY_MAX_SIZE_MULTIPLIER",
                0.33f, ImageCacheBudget.LOW_MEMORY_MAX_SIZE_MULTIPLIER, 0.0f);
    }

    // ── 屏数法目标值（封顶不生效时）──

    @Test
    public void targetBudget_isScreenPixelsTimesScreensTimesFour() {
        // 1080*2400*4*2 = 20,736,000
        assertEquals(20_736_000L, ImageCacheBudget.memoryCacheBudgetBytes(
                W_1080, H_2400, 2, HUGE_MEMORY_CLASS_MB, false));
    }

    @Test
    public void moreScreens_doubleBudget() {
        long one = ImageCacheBudget.memoryCacheBudgetBytes(
                W_1080, H_2400, 1, HUGE_MEMORY_CLASS_MB, false);
        long two = ImageCacheBudget.memoryCacheBudgetBytes(
                W_1080, H_2400, 2, HUGE_MEMORY_CLASS_MB, false);
        // 1080*2400*4 = 10,368,000
        assertEquals(10_368_000L, one);
        assertEquals(20_736_000L, two);
        assertEquals("屏数翻倍则预算恰好翻倍", one * 2, two);
    }

    @Test
    public void biggerScreen_largerBudget() {
        long small = ImageCacheBudget.memoryCacheBudgetBytes(
                W_1080, H_2400, 2, HUGE_MEMORY_CLASS_MB, false);
        long large = ImageCacheBudget.memoryCacheBudgetBytes(
                W_1440, H_3200, 2, HUGE_MEMORY_CLASS_MB, false);
        // 1440*3200*4*2 = 36,864,000
        assertEquals(36_864_000L, large);
        assertTrue("更大的屏幕应给出更大的预算", large > small);
    }

    // ── 封顶生效 + 内存等级参与 ──

    @Test
    public void hugeScreenOnSmallMemoryDevice_isCappedAtMemoryFraction() {
        // 8K 屏 × 8 屏远超任何封顶：预算必须落在封顶值而非屏数法目标值
        long budget = ImageCacheBudget.memoryCacheBudgetBytes(7680, 4320, 8, 64, false);
        assertEquals("超出封顶时预算须等于封顶值",
                ImageCacheBudget.capBytes(64, false), budget);
        assertTrue("预算须为正", budget > 0);
    }

    @Test
    public void differentMemoryClass_yieldsDifferentBudget_whenCapBinds() {
        long smallMem = ImageCacheBudget.memoryCacheBudgetBytes(W_1440, H_3200, 4, 128, false);
        long largeMem = ImageCacheBudget.memoryCacheBudgetBytes(W_1440, H_3200, 4, 512, false);
        assertTrue("内存等级更大 → 封顶更高 → 预算更大（封顶生效前提下）", largeMem > smallMem);
    }

    @Test
    public void cap_scalesWithMemoryClassByGlideRatios() {
        long normal256 = ImageCacheBudget.capBytes(256, false);
        long lowRam256 = ImageCacheBudget.capBytes(256, true);
        long normal512 = ImageCacheBudget.capBytes(512, false);
        // 性质校验：比例来自 Glide 常量 0.33 / 0.4（容差 1e-3，非同义反复重算）
        double ratio = (double) lowRam256 / (double) normal256;
        assertEquals("低内存/普通封顶之比须等于 0.33/0.4", 0.33 / 0.4, ratio, 1e-3);
        double scale = (double) normal512 / (double) normal256;
        assertEquals("封顶须随内存等级线性放大", 2.0, scale, 1e-3);
    }

    // ── 低内存设备档严格更保守 ──

    @Test
    public void lowRamDevice_strictlySmallerThanNormal() {
        // 屏数取 8：目标值 1440*3200*4*8 = 147,456,000 > 两档封顶，使「严格小于」可观察
        // （屏数小时封顶不生效，两档会相等——那正是取小的正确行为，不是本用例要断言的）
        long normal = ImageCacheBudget.memoryCacheBudgetBytes(W_1440, H_3200, 8, 256, false);
        long lowRam = ImageCacheBudget.memoryCacheBudgetBytes(W_1440, H_3200, 8, 256, true);
        assertTrue("低内存设备档必须严格小于普通档", lowRam < normal);
        assertEquals("普通档须落在其封顶值上", ImageCacheBudget.capBytes(256, false), normal);
        assertEquals("低内存档须落在其封顶值上", ImageCacheBudget.capBytes(256, true), lowRam);
    }

    @Test
    public void budget_neverExceedsCap_acrossMatrix() {
        long[] screensDims = {W_1080, 1440, 2160, 3840, 7680};
        int[] screenCounts = {1, 2, 3, 4};
        int[] memoryClasses = {16, 64, 128, 256, 512, 4096};
        for (long width : screensDims) {
            for (int screens : screenCounts) {
                for (int memoryClass : memoryClasses) {
                    for (boolean lowRam : new boolean[] {false, true}) {
                        long budget = ImageCacheBudget.memoryCacheBudgetBytes(
                                width, 2400, screens, memoryClass, lowRam);
                        long cap = ImageCacheBudget.capBytes(memoryClass, lowRam);
                        assertTrue("预算必须为正: " + width + "/" + screens + "/" + memoryClass,
                                budget > 0);
                        assertTrue("预算恒不超过封顶值: " + width + "/" + screens + "/"
                                        + memoryClass + "/lowRam=" + lowRam,
                                budget <= cap);
                    }
                }
            }
        }
    }

    // ── 非法输入：显式暴露错误，不静默兜底 ──

    @Test
    public void invalidInput_throwsInsteadOfSilentlyDefaulting() {
        assertThrows("屏宽 0", () -> ImageCacheBudget.memoryCacheBudgetBytes(
                0, H_2400, 2, HUGE_MEMORY_CLASS_MB, false));
        assertThrows("屏高负数", () -> ImageCacheBudget.memoryCacheBudgetBytes(
                W_1080, -1, 2, HUGE_MEMORY_CLASS_MB, false));
        assertThrows("屏数 0", () -> ImageCacheBudget.memoryCacheBudgetBytes(
                W_1080, H_2400, 0, HUGE_MEMORY_CLASS_MB, false));
        assertThrows("内存等级 0", () -> ImageCacheBudget.memoryCacheBudgetBytes(
                W_1080, H_2400, 2, 0, false));
        assertThrows("内存等级负数", () -> ImageCacheBudget.memoryCacheBudgetBytes(
                W_1080, H_2400, 2, -8, false));
        assertThrows("封顶：内存等级 0", () -> ImageCacheBudget.capBytes(0, false));
    }

    private static void assertThrows(String label, Runnable body) {
        try {
            body.run();
            fail("非法输入必须抛 IllegalArgumentException（禁静默兜底）: " + label);
        } catch (IllegalArgumentException expected) {
            // 预期
        }
    }
}
