package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.Shadows;
import org.robolectric.shadows.ShadowNotificationManager;

/**
 * 通知薄桥 JVM 行为测试（spec docs/specs/notification-delivery-probe.md / #939 AC-7）。
 *
 * <p>oracle：
 * <ul>
 *   <li><b>文案形态</b> = 「条数进文案」这条业务规则本身（#939 AC-1），
 *       而非从实现反推——期望串在本文件里独立写出；</li>
 *   <li><b>投递确实发生</b> = 回读系统通知表（ShadowNotificationManager），不是「调用没抛异常」；</li>
 *   <li><b>渠道确实建了</b> = 回读 NotificationManager 的渠道表——Android 8+
 *       缺渠道的通知<strong>静默不显示</strong>，不建渠道等于「发成功但用户看不见」。</li>
 * </ul>
 *
 * <p>驱动方式：直接调包可见静态缝（{@code summaryText} / {@code ensureChannel} / {@code postTo}）
 * ——LynxModule 构造函数需要 LynxContext，仓库无先例构造模块实例（先例 PictelioClipboardModuleTest）。
 *
 * <p>sdk 选 28：本仓 minSdk 为 28，且本版 Robolectric 的上限低于 targetSdk 36。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class PictelioNotificationModuleTest {

    private static final String ZH = "zh-CN";
    private static final String EN = "en";

    private static Context ctx() {
        return ApplicationProvider.getApplicationContext();
    }

    private static NotificationManager nm() {
        return (NotificationManager) ctx().getSystemService(Context.NOTIFICATION_SERVICE);
    }

    private static ShadowNotificationManager shadow() {
        return Shadows.shadowOf(nm());
    }

    /** ShadowNotificationManager 的按 id 取渠道是 protected，故从公开的渠道表里筛。 */
    private static NotificationChannel channel() {
        for (NotificationChannel c : shadow().getNotificationChannels()) {
            if (PictelioNotificationModule.CHANNEL_ID.equals(c.getId())) return c;
        }
        return null;
    }

    // ─── 条数 → 文案（#939 AC-1：内容为未读条数） ────────────────────────────

    @Test
    public void summaryText_中文_条数进文案() {
        assertEquals("你有 3 条新通知", PictelioNotificationModule.summaryText(3, ZH));
        assertEquals("你有 1 条新通知", PictelioNotificationModule.summaryText(1, ZH));
    }

    @Test
    public void summaryText_中文_零条不发数字() {
        // 0 条不该出现在文案里：判定链此时本就不该走到这里（no-unread），
        // 但真走到了就不能显示「0 条」这种自相矛盾的话。
        assertEquals("你有新通知", PictelioNotificationModule.summaryText(0, ZH));
    }

    @Test
    public void summaryText_英文_单复数分词() {
        assertEquals("You have 1 new notification", PictelioNotificationModule.summaryText(1, EN));
        assertEquals("You have 5 new notifications", PictelioNotificationModule.summaryText(5, EN));
    }

    @Test
    public void summaryText_语言跟随传入locale() {
        // 渠道与正文都进系统设置/通知栏，用户能看见 ⇒ 不能写死一种语言。
        assertEquals(PictelioNotificationModule.summaryText(2, ZH), "你有 2 条新通知");
        assertEquals(PictelioNotificationModule.summaryText(2, EN), "You have 2 new notifications");
    }

    @Test
    public void summaryText_未知语言回退源语言() {
        // locale 传了脏值不该崩也不该出半吊子文案（i18n 缺 key 同款回退语义）
        assertEquals("你有 2 条新通知", PictelioNotificationModule.summaryText(2, "xx-YY"));
        assertEquals("你有 2 条新通知", PictelioNotificationModule.summaryText(2, null));
    }

    // ─── 渠道（#939 AC-5 / 缺渠道必不显示） ───────────────────────────────────

    @Test
    public void ensureChannel_渠道被建出来且名字跟随语言() {
        PictelioNotificationModule.ensureChannel(ctx(), nm(), ZH);
        NotificationChannel ch = channel();
        assertNotNull("渠道未创建 ⇒ Android 8+ 上这条通知必不显示（静默失败）", ch);
        assertEquals("更新提醒", ch.getName());
    }

    @Test
    public void ensureChannel_重复调用是更新同名渠道而非抛异常() {
        PictelioNotificationModule.ensureChannel(ctx(), nm(), ZH);
        PictelioNotificationModule.ensureChannel(ctx(), nm(), EN);
        NotificationChannel ch = channel();
        assertNotNull(ch);
        assertEquals("同 id 再建是更新名，不是抛 AlreadyExists", "Update reminders", ch.getName());
    }

    // ─── 投递（#939 AC-1：真机上收到一条） ────────────────────────────────────

    @Test
    public void postTo_通知真的落到系统通知表() {
        PictelioNotificationModule.postTo(ctx(), nm(), 4, ZH);
        assertEquals(1, shadow().size());
    }

    @Test
    public void postTo_正文是条数不是通知原文() {
        // ⚠️ #939 AC-1「不泄露具体文本」：正文只能是条数。
        // 通知原文是日文 HTML 片段，出现在这里就等于剧透。
        PictelioNotificationModule.postTo(ctx(), nm(), 7, ZH);
        // ⚠️ 用 getAllNotifications 而非 getNotification(int)：后者是无 tag 重载，
        // 与 nm.notify(id, n) 的默认 tag 对不上，取回 null。
        Notification posted = shadow().getAllNotifications().get(0);
        String text = posted.extras.getString(Notification.EXTRA_TEXT);
        assertEquals("你有 7 条新通知", text);
    }

    @Test
    public void postTo_连续多轮互相覆盖而非堆叠() {        // 探测关心的是「有没有送达」，堆一屏同 id 通知只会干扰用户且无额外信息量。
        PictelioNotificationModule.postTo(ctx(), nm(), 1, ZH);
        PictelioNotificationModule.postTo(ctx(), nm(), 2, ZH);
        assertEquals("同 id 覆盖，不堆叠", 1, shadow().size());
    }

    // ─── 权限查询（#939 AC-3：不发、且不重复询问） ────────────────────────────

    @Test
    public void notificationsEnabledNow_反映系统开关而非硬编码() {
        // 若这里返回的是常量 true，权限被拒的用户也会被判「该发」——
        // 表现为「什么都测不到」，且报告里看不出是权限问题。
        shadow().setNotificationsEnabled(false);
        assertEquals(false, PictelioNotificationModule.notificationsEnabledNow(nm()));
        shadow().setNotificationsEnabled(true);
        assertEquals(true, PictelioNotificationModule.notificationsEnabledNow(nm()));
    }

    @Test
    public void notificationsEnabledNow_权限被拒时不抛且判未授予() {
        // AC-3/AC-4：权限被拒是**常态分支**，不是异常路径。
        // 若这里抛出去，JS 侧拿不到 (false, msg) 形态的回调，降级到角标的链路就断了。
        shadow().setNotificationsEnabled(false);
        assertEquals(false, PictelioNotificationModule.notificationsEnabledNow(nm()));
    }

    // ─── 点击意图（#940：contentIntent 为 null 就是 ADR-0220 §6-3 的「点了没点」）──

    @Test
    public void postTo_通知带点击意图() {
        PictelioNotificationModule.postTo(ctx(), nm(), 1, ZH);
        android.app.PendingIntent pi = shadow().getAllNotifications().get(0).contentIntent;
        assertNotNull(
                "点击意图为 null ⇒ 点了通知直接消失而无反应（ADR-0220 §6-3），#940 的核心交付", pi);
    }

    @Test
    public void postTo_点击意图带落点与clickId() {
        // 载荷只承载 clickId（lynx 4.0.1 的 JavaOnlyArray.of 只实证过单个 Long），
        // 冷/热由**事件名**区分；clickId 缺失则 JS 无法去重，一次点击会被记 4 次。
        PictelioNotificationModule.postTo(ctx(), nm(), 1, ZH);
        android.app.PendingIntent pi = shadow().getAllNotifications().get(0).contentIntent;
        assertNotNull(pi);
        android.content.Intent saved = Shadows.shadowOf(pi).getSavedIntent();
        assertNotNull("拿不到 PendingIntent 内的 Intent，载荷断言无从谈起", saved);
        // 落点目标由接收器在点击瞬间补上，PendingIntent 里只带 clickId
        assertEquals("PendingIntent 必须指向中转 Activity（才能在点击瞬间判定进程是否已运行，且豁免 BAL）",
                NotificationTapActivity.class.getName(), saved.getComponent().getClassName());
        assertTrue("clickId 缺失 ⇒ 一次点击记 4 次",
                saved.getLongExtra(LynxActivity.EXTRA_NOTIFICATION_CLICK_ID, 0L) > 0L);
    }

    @Test
    public void 点击意图的clickId就是本轮传入的那个() {
        // 去重键必须逐轮不同，否则第二轮的点击会被第一轮的记录吃掉。
        // ⚠️ 不断言 PendingIntent 的 hashCode：Robolectric 的影子按 requestCode 算，
        //   同一个 requestCode + 不同 extras 也会相等 —— 拿它当判别式是假断言。
        android.content.Intent saved = Shadows.shadowOf(
                PictelioNotificationModule.clickIntent(ctx(), 4242L)).getSavedIntent();
        assertNotNull(saved);
        assertEquals("载荷里的 clickId 必须就是本轮传入的那个",
                4242L, saved.getLongExtra(LynxActivity.EXTRA_NOTIFICATION_CLICK_ID, -1L));
    }
}
