package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import android.content.Intent;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * 落点中转 Activity 的转发行为（JVM 行为测试，#940）。
 *
 * <p>oracle = <b>转交出去的 Intent 本身就是规格</b>：落点目标与 clickId 必须原样出现在
 * LynxActivity 收到的 intent 里。契约门禁只能读源码形态，验不了「载荷真的被带过去」——
 * 而这正是双轴 review 判出的阻塞项（门禁把中转文件读进来却从未断言它）。
 *
 * <p>⚠️ 载荷缺失的后果特别隐蔽：{@code LynxActivity} 用 {@code getLongExtra(..., 0L)}
 * 兜底 ⇒ clickId 恒为 0 ⇒ 所有点击共享同一个去重键 ⇒ 第一次计数、**之后每一次点击
 * 都被当成重复静默吞掉**，`clicked` 冻结在 1 而 `sent` 持续上涨，产出一个看起来很像真的
 * 0 点击率。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class NotificationTapActivityTest {

    private static Intent tapIntent(long clickId) {
        Intent i = new Intent();
        i.setClass(org.robolectric.RuntimeEnvironment.getApplication(), NotificationTapActivity.class);
        i.putExtra(LynxActivity.EXTRA_NOTIFICATION_CLICK_ID, clickId);
        return i;
    }

    private static Intent nextIntentOf(NotificationTapActivity activity) {
        Intent next = org.robolectric.Shadows.shadowOf(activity).getNextStartedActivity();
        assertNotNull("中转没有转交任何 Activity ⇒ 点通知等于没点", next);
        return next;
    }

    @Test
    public void 转交给LynxActivity的落点目标正确() {
        NotificationTapActivity a =
                Robolectric.buildActivity(NotificationTapActivity.class, tapIntent(4242L)).setup().get();
        Intent next = nextIntentOf(a);
        assertEquals(LynxActivity.class.getName(), next.getComponent().getClassName());
        assertEquals(
                LynxActivity.TARGET_NOTIFICATIONS,
                next.getStringExtra(LynxActivity.EXTRA_NOTIFICATION_TARGET));
    }

    @Test
    public void clickId被原样带到落点Intent() {
        NotificationTapActivity a =
                Robolectric.buildActivity(NotificationTapActivity.class, tapIntent(4242L)).setup().get();
        Intent next = nextIntentOf(a);
        assertEquals(
                "clickId 丢失 ⇒ 所有点击共享去重键 0，第二次起全被当重复吞掉",
                4242L, next.getLongExtra(LynxActivity.EXTRA_NOTIFICATION_CLICK_ID, -1L));
    }

}
