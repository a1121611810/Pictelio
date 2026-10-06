package io.pictelio.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

/**
 * 通知落点的**中转 Activity**（#940 / ADR-0220 决策 9）。
 *
 * <p>存在的理由有两个，缺一不可：
 * <ol>
 *   <li><b>唯一能在「点击瞬间」于本进程内执行、又能合法拉起 App 的位置。</b>
 *       直接 {@code PendingIntent.getActivity(LynxActivity)} 拿不到点击瞬间的判据
 *       （Activity 侧一切信号都在点击之后才可观测，真机已判反两次）；
 *       而改用 {@code PendingIntent.getBroadcast} + 接收器里 {@code startActivity} 会被
 *       <strong>Android 10+ 的后台 Activity 启动限制（BAL）拦掉</strong>，
 *       实测接收器日志打出来了、App 却没起来 —— 通知退回成「点了没反应」。</li>
 *   <li>本 Activity 由系统发起（{@code PendingIntent.getActivity}），<strong>豁免 BAL</strong>；
 *       它自己此刻已在前台，再 {@code startActivity} 转发给 LynxActivity 也合法。</li>
 * </ol>
 *
 * <p>它只在 {@code onCreate} 里做两件事：记下判据（此刻静态字段还是初值 ⇒ 进程是否新起）、
 * 转发。不渲染任何界面（清单里配 {@code NoDisplay} 主题），用户看不到。
 */
public class NotificationTapActivity extends Activity {

    private static final String TAG = "NotificationTapActivity";

    /**
     * 点击瞬间「本进程此前是否已渲染过 JS」。由本中转在 onCreate 里写入，
     * 随后 LynxActivity（在**同一进程**内）读取。
     *
     * <p>⚠️ 这是一次传递而非常驻状态：判断必须在点击瞬间做出，之后再推断就晚了。
     */
    static volatile boolean wasRunningAtTap = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 此刻进程若为本次点击新起，LynxActivity.sProcessRendered 仍是初值 ⇒ 判据成立
        // ⚠️ 读**持久**的前台标记，不是进程内静态：Android 在把本中转投递进来之前，
        //   会先重建任务栈顶的 LynxActivity（进程随之起来、bundle 秒加载），
        //   此刻任何进程级静态都已经被这次点击自己写好，读出来恒为「已运行」。
        boolean wasBackgrounded = LynxActivity.wasAppBackgroundedAtTap(getApplicationContext());
        wasRunningAtTap = !wasBackgrounded;
        Log.i(
                TAG,
                "通知点击中转：点击瞬间用户已离开App="
                        + wasRunningAtTap
                        + " pid="
                        + android.os.Process.myPid()
                        + " 本进程已有LynxActivity实例="
                        + LynxActivity.hasLiveInstance());

        Intent src = getIntent();
        Intent next = new Intent(this, LynxActivity.class);
        next.setAction(Intent.ACTION_VIEW);
        next.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        next.putExtra(LynxActivity.EXTRA_NOTIFICATION_TARGET, LynxActivity.TARGET_NOTIFICATIONS);
        next.putExtra(
                LynxActivity.EXTRA_NOTIFICATION_CLICK_ID,
                src == null ? 0L : src.getLongExtra(LynxActivity.EXTRA_NOTIFICATION_CLICK_ID, 0L));
        startActivity(next);
        finish();
    }
}
