package io.pictelio.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

/**
 * 送达通道 · 触达探测的原生薄桥（spec docs/specs/notification-delivery-probe.md / ADR-0220 决策 4、6、10）。
 *
 * <p>本模块只做两件 JS 侧做不到的事：
 * <ol>
 *   <li><b>权限状态查询</b>——通知权限是系统状态，JS 无任何 API 可读（决策 10：
 *       探测报告必须写明「权限到底拿到没有」，否则「没数据」与「没人点」不可区分）；</li>
 *   <li><b>发一条汇总通知</b>——{@code NotificationManager} 只能从宿主发起。</li>
 * </ol>
 *
 * <p><b>刻意不做的事</b>（避免与 spec 冲突）：
 * <ul>
 *   <li><b>不申请权限</b>——决策 3：只查询状态、拒绝后<em>不重复询问</em>。
 *       自动弹权限框等于替用户做决定，且第二次弹会被当作骚扰；降级路径是已交付的
 *       外环未读角标（零新增成本）。</li>
 *   <li><b>不逐条发</b>——决策 6：一次轮询 = 一条汇总，条数只进文案。</li>
 * </ul>
 *
 * <p><b>点击落点（#940）</b>：通知带 {@code setContentIntent}，点开启动 LynxActivity
 *   并带上目标页与 {@code clickId}。本模块<strong>不</strong>关心冷/热——那是 Activity 层
 *   的进程状态，由 LynxActivity 分派到两个不同的事件名（冷 / 热），
 *   JS 侧据此把点击拆成 {@code clickedCold} / {@code clickedWarm}。
 *
 * <p>⚠️ {@code clickId} 在**每次投递**时重新生成：冷启动那一跳要广播 4 次对抗渲染竞态，
 *   而计数不是幂等的（同 id 的 4 次到达只应记 1 次）——id 相同是去重的前提。
 *
 * <p>⚠️ <b>本桥<strong>不</strong>申请权限、不写计数</b>（决策 3 / 13）：计数由 JS 侧 store
 *   单写（ADR-0220 §5：复用 PictelioPrefs，无需新建存储模块）。
 *
 * <p><b>文案为什么在宿主侧组装</b>：语言是 JS 侧 i18n 核心的模块级 ref，切语言即时生效；
 *   而本模块的通知<b>只能在</b>宿主发。若让 JS 把成品文案传进来，「条数 → 文案」这条
 *   真正的组装逻辑就落在 JS，宿主侧无从覆盖（#939 AC-7 要的正是宿主侧覆盖）。
 *   故折中：<b>JS 只传当前 locale</b>，组装与文案表留在宿主，两种语言各一份、无动态 import。
 *
 * <p>⚠️ <b>计数不走本模块</b>（决策 13：不上传；存储复用既有偏好存储）。
 *   本模块只发不记；「发了几个 / 点了几个」由 JS 侧 store 持有（单写者，无需跨端比对键名）。
 */
public class PictelioNotificationModule extends LynxModule {

    private static final String TAG = "PictelioNotification";

    /** 通知渠道 id：与文案解耦，改文案不动 id（改 id 会丢用户侧已建渠道的设置）。 */
    public static final String CHANNEL_ID = "pictelio_delivery_probe";

    /** 固定通知 id：连续多轮探测互相覆盖而不是堆叠（探测关心的是「有没有送达」，不是攒通知）。 */
    private static final int NOTIFICATION_ID = 1001;

    public PictelioNotificationModule(Context context) {
        super(context);
    }

    private static NotificationManager managerOf(Context ctx) {
        return (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
    }

    /** Lynx 注入的是 LynxContext，取其宿主 Context（与 PictelioClipboardModule 同款）。 */
    private Context hostContext() {
        return ((LynxContext) mContext).getContext();
    }

    /**
     * 权限状态查询。Callback 约定：{@code (granted:Boolean, err:String|null)}。
     *
     * <p>⚠️ <b>禁传 null</b>——真机 CallbackImpl 遇 null 会崩（PictelioClipboardModuleTest
     * 已就同一约定钉过用例）。失败时传 {@code (false, msg)}：对 JS 而言「拿不到权限」
     * 与「没有权限」都应走降级轨，分不开也不能靠抛异常暴露。
     */
    @LynxMethod
    public void areNotificationsEnabled(Callback callback) {
        try {
            NotificationManager nm = managerOf(hostContext());
            if (nm == null) {
                // 拿不到通知管理器：按未授予处理（降级），不抛
                callback.invoke(false, "notification manager unavailable");
                return;
            }
            callback.invoke(notificationsEnabledNow(nm), null);
        } catch (Exception e) {
            Log.w(TAG, "权限状态查询失败（按未授予降级）", e);
            callback.invoke(false, String.valueOf(e.getMessage()));
        }
    }

    /**
     * 发一条<strong>汇总</strong>通知（决策 6：一次轮询一条，不论该批有几条更新）。
     *
     * @param unreadCount 未读条数，进文案
     * @param locale      当前语言，取 JS i18n 核心的 locale ref（"zh-CN" / "en"）
     * @param callback    {@code (posted:Boolean, err:String|null)}
     */
    @LynxMethod
    public void postSummary(int unreadCount, String locale, Callback callback) {
        try {
            Context ctx = hostContext();
            NotificationManager nm = managerOf(ctx);
            if (nm == null) {
                callback.invoke(false, "notification manager unavailable");
                return;
            }
            if (!notificationsEnabledNow(nm)) {
                // 权限被拒：安静降级，不重复询问（决策 3）
                callback.invoke(false, "permission not granted");
                return;
            }
            postTo(ctx, nm, unreadCount, locale);
            callback.invoke(true, null);
        } catch (Exception e) {
            // 禁静默降级：发不出去必须可见（否则「没人点」会被误读成「没发出去」）
            Log.w(TAG, "汇总通知发送失败", e);
            callback.invoke(false, String.valueOf(e.getMessage()));
        }
    }

    // ─── 包可见静态缝：JVM 单测直接驱动这些方法 ───────────────────────────────
    // LynxModule 构造函数需要 LynxContext，仓库内没有先例构造模块实例
    // （见 PictelioClipboardModuleTest 的驱动方式说明），故把可测部分拆成静态缝。

    /**
     * 权限状态。minSdk 28 ⇒ {@code areNotificationsEnabled()}（API 24 起）恒可用，
     * <strong>无</strong>低版本分支：{@code POST_NOTIFICATIONS} 在 API 33 才存在，
     * 给它加低版本回退只会造出「永远判未授予」的死分支。
     */
    static boolean notificationsEnabledNow(NotificationManager nm) {
        return nm.areNotificationsEnabled();
    }

    /**
     * 条数 → 文案（#939 AC-7 的被测对象）。
     *
     * <p>⚠️ <strong>不读通知正文</strong>（决策 9 + ADR-0188）：通知正文是日文 HTML 片段，
     * 剥标签后仍是外语且可能剧透。汇总通知只说条数，用户点进去自己看。
     */
    static String summaryText(int unreadCount, String locale) {
        if ("en".equals(locale)) {
            return unreadCount > 0
                    ? "You have " + unreadCount + (unreadCount == 1 ? " new notification" : " new notifications")
                    : "You have new notifications";
        }
        return unreadCount > 0 ? "你有 " + unreadCount + " 条新通知" : "你有新通知";
    }

    /** 渠道名（用户在系统设置里可见，故同样跟随语言）。 */
    static String channelName(String locale) {
        return "en".equals(locale) ? "Update reminders" : "更新提醒";
    }

    /** 渠道描述。 */
    static String channelDescription(String locale) {
        return "en".equals(locale)
                ? "Reminders when followed artists and watchlisted series have new content"
                : "关注的作者与追更系列有新内容时提醒";
    }

    /** 通知渠道：Android 8+ 不建渠道的通知<strong>必不显示</strong>（静默失败）。 */
    static void ensureChannel(Context ctx, NotificationManager nm, String locale) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, channelName(locale), NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription(channelDescription(locale));
        nm.createNotificationChannel(ch);
    }

    /** 真正的投递动作。抽成静态缝以便单测回读系统通知（#939 AC-7）。 */
    static void postTo(Context ctx, NotificationManager nm, int unreadCount, String locale) {
        ensureChannel(ctx, nm, locale);
        Notification n = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
                .setContentTitle("Pictelio")
                .setContentText(summaryText(unreadCount, locale))
                .setAutoCancel(true)
                .setContentIntent(clickIntent(ctx))
                .build();
        nm.notify(NOTIFICATION_ID, n);
    }

    /**
     * 点击意图：指向 {@link NotificationTapActivity} 中转，由它在<strong>点击瞬间</strong>判定进程状态
     *     再转交 LynxActivity（#940）。
     *
     * <p>⚠️ <strong>必须走 Broadcast 而不是直接 getActivity</strong>：只有接收器能在**点击瞬间**
     *   于 App 进程内执行，从而回答「点击之前 App 是否已经活着」。
     *   任何 Activity 侧信号（bundleLoaded、onCreate/onNewIntent 哪个回调）都在点击之后才可观测，
     *   真机已实证两次判反。
     *
     * <p>⚠️ {@code clickId} 用<strong>投递时刻</strong>而不是点击时刻：PendingIntent 在
     *   投递时就定型了，而「同一次投递的多窗重发携带同一个 id」正是 JS 去重要的性质。
     */
    static PendingIntent clickIntent(Context ctx, long clickId) {
        Intent tap = new Intent(ctx, NotificationTapActivity.class);
        tap.putExtra(LynxActivity.EXTRA_NOTIFICATION_CLICK_ID, clickId);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        // ⚠️ 必须是 getActivity：getBroadcast + 接收器里 startActivity 会被 Android 10+ 的
        //   后台 Activity 启动限制拦掉（实测接收器日志打了、App 没起来）。
        //   中转 Activity 由系统发起 ⇒ 豁免 BAL，且它此刻在前台，转发也合法。
        return PendingIntent.getActivity(ctx, NOTIFICATION_ID, tap, flags);
    }

    static PendingIntent clickIntent(Context ctx) {
        return clickIntent(ctx, System.currentTimeMillis());
    }
}
