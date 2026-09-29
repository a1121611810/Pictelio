package io.pictelio.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import androidx.appcompat.app.AppCompatActivity;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;

/**
 * 全屏模式「闩锁」回归防线（#689 缺陷现场；spec lynx-night-mode.md §4.7 + lynx-systembars D5）。
 *
 * <p>回归对象（**删掉修复即变红**）：
 * <ul>
 *   <li>旧实现：{@code statusBarHidden} 仅在 LynxActivity.onCreate 读到设置键为 true 时写入；
 *       运行时开关（{@code PictelioAppModule.setSystemBarsHidden} → {@code applySystemBarsHidden}）
 *       不回写该字段。后果：用户「全屏 → 退出全屏」后字段仍为 true → 状态栏外观下发被
 *       {@code resolveStatusBarAppearance} **永久跳过**（单向闩锁：状态栏图标深浅再也不跟随外观）。</li>
 *   <li>修复：{@code applySystemBarsHidden(activity, hidden)} 内回写闩锁
 *       （{@code activity instanceof LynxActivity → syncStatusBarHidden(hidden)}），hide/show 双向同步。</li>
 * </ul>
 *
 * <p>测试手法：{@code Robolectric.buildActivity(LynxActivity.class).get()} 只构造 + attach
 * （**不走 onCreate**——onCreate 需要 LynxEnv 原生依赖，JVM 不可用），因此可安全断言实例字段；
 * 该路径正是 {@code applySystemBarsHidden} 的调用形态（模块传入 Activity 引用）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 31)
public class LynxStatusBarLatchTest {

    @Test
    public void applySystemBarsHidden_syncsLatchBothDirections() {
        ActivityController<LynxActivity> controller = Robolectric.buildActivity(LynxActivity.class);
        LynxActivity activity = controller.get();
        assertFalse("初始：非全屏（未读全屏设置键）", activity.isStatusBarHidden());

        LynxActivity.applySystemBarsHidden(activity, true);
        assertTrue("隐藏后闩锁置位（外观下发应跳过 = 无 UI 反馈点）", activity.isStatusBarHidden());

        LynxActivity.applySystemBarsHidden(activity, false);
        assertFalse("显示后闩锁必须解除（#689 单向闩锁回归点）", activity.isStatusBarHidden());
    }

    @Test
    public void applySystemBarsHidden_nonLynxHost_doesNotCrash() {
        // 模块签名取 AppCompatActivity（full 包下 MainActivity 也走同一入口）：
        // instanceof 分支不得对非 Lynx 宿主抛错
        ActivityController<AppCompatActivity> controller =
                Robolectric.buildActivity(AppCompatActivity.class).setup();
        AppCompatActivity activity = controller.get();
        LynxActivity.applySystemBarsHidden(activity, true);
        LynxActivity.applySystemBarsHidden(activity, false);
    }
}
