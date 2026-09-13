package io.pictelio.app;

import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

/**
 * 插件网络卸载器（ADR-0159 决策 1）：把阻塞网络 I/O 移出 Capacitor 桥线程。
 *
 * <p>Capacitor Bridge 用单个 HandlerThread 串行执行所有 @PluginMethod，request()/
 * prefetchImage() 的同步 OkHttp execute（connect+read 超时上限 45s）会把
 * Preferences.set 等其他插件调用在桥队列挂起（引擎切换 5s 写超时的根因）。
 * 本类包装插件自有的固定上界线程池：{@link #dispatch} 提交后调用线程立即返回，
 * 任务在工作线程执行，成功经 onSuccess、异常经 onFailure 在工作线程回调
 * （PluginCall 线程安全，Capacitor 标准异步插件模式）。
 *
 * <p>捕获 Throwable（而非仅 Exception）：任务在工作线程抛 Error 时若不映射，
 * PluginCall 将永无回音（JS Promise 永挂）；原桥线程实现中该异常最终也会落到
 * Capacitor 调用层的错误路径。onSuccess 内抛出的异常同样映射 onFailure——
 * 与原插件方法 try 块「执行体 + 结果映射」的覆盖范围等价。
 *
 * <p>线程名带 PictelioNet- 前缀便于 logcat 诊断；daemon 线程随插件进程存活，
 * 无需 shutdown（ADR-0159 后果节）。
 */
final class PluginNetworkDispatcher {

    /** 线程序号（线程命名去重，logcat 可读） */
    private static final AtomicInteger SEQ = new AtomicInteger();

    private final ExecutorService executor;

    PluginNetworkDispatcher() {
        // 固定上界（ADR-0159 复审 #3）：OkHttp Dispatcher 的 maxRequests 只约束 enqueue()
        // 异步调用，同步 execute() 不受限——cached 无界池在弱网慢请求堆积 + Feed 连发
        // 时可膨胀出数十工作线程（每线程 ~1MB 栈），低端机内存不可控。上界 8 对齐共享
        // OkHttp 客户端 per-host 10 的意图（排队在池队列完成，不占桥线程）。
        this.executor = Executors.newFixedThreadPool(8, r -> {
            Thread t = new Thread(r, "PictelioNet-" + SEQ.incrementAndGet());
            t.setDaemon(true);
            return t;
        });
    }

    /**
     * 提交任务并立即返回（调用线程不等待任务完成）。
     *
     * @param task      阻塞任务（网络 I/O），在工作线程执行
     * @param onSuccess 任务成功后携带结果在工作线程回调
     * @param onFailure 任务或 onSuccess 抛 Throwable 时携带异常在工作线程回调
     * @param <T>       任务结果类型（request 为 JSObject，prefetch 为 PrefetchResult）
     */
    <T> void dispatch(Callable<T> task, Consumer<T> onSuccess, Consumer<Throwable> onFailure) {
        executor.execute(() -> {
            try {
                onSuccess.accept(task.call());
            } catch (Throwable t) {
                onFailure.accept(t);
            }
        });
    }
}
