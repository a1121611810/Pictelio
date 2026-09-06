package io.pictelio.app.directaccess;

import java.io.IOException;

/**
 * 远端 IP 表拉取端口（ticket #388 T3）：从托管 JSON 文件拉取直连 IP 表原文。
 * 托管文件与 {@code packages/website/version.json} 同目录同机制——raw.githubusercontent
 * 直读 main 分支即生效，零部署改动（远端通道先例：update-check）。
 *
 * <p><b>契约</b>：
 * <ol>
 *   <li>返回值 = 托管文件的<b>原始响应体字符串</b>（UTF-8 文本），形状契约与字段语义由
 *       {@link DirectAccessConfig#parseRemoteDoc} 裁定（本端口只负责传输，不负责解析）；</li>
 *   <li>任何传输层失败（网络不可达 / 非 2xx / 空响应体 / 超时）抛 {@link IOException}——
 *       调用方按「拉取失败」语义降级（保留上次有效表，否则内置表兜底）+ warn，禁静默；</li>
 *   <li><b>自举安全</b>：生产实现必须使用<b>专用不路由</b>的 HTTP client——未来直连路由
 *       装配在共享 client（PixivApiCore）上时，本拉取器不得被路由（否则 IP 表拉取自身
 *       走直连 → 自举死锁）；</li>
 *   <li>实现必须线程安全（后台 executor 单飞串行调用，但契约上不作串行假设）。</li>
 * </ol>
 */
public interface IpTableFetcher {

    /**
     * 拉取托管 IP 表文件原文。
     *
     * @return 响应体原文（UTF-8 解码；调用方负责形状校验与解析）
     * @throws IOException 任何传输层失败（调用方按拉取失败降级 + warn）
     */
    String fetchJson() throws IOException;
}
