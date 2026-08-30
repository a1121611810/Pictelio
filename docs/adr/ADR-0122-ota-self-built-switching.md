# ADR-0122: OTA web bundle 切换机制自研而非引入 @capgo/capacitor-updater

web bundle 的运行时切换只需 Capacitor 官方原语（`setServerBasePath` / `setServerAssetPath`，官方 issue #1228 背书的唯一正道），#245 原型已用约 350 行自研 OtaPlugin 在设备上跑通四场景（好包下次启动生效 / 坏签名拒装 / 启动崩溃 10s 回滚 / 门槛阻断）。生产必修的四个坑（本地服务器响应缺 `Cache-Control`、notifyReady 需版本握手防陈旧文档误报、切换与 WebView 首导航竞态、回滚清 pending + 幂等重装）中三个的修复语义位于自有代码——capgo 没有对应机制（其 `notifyAppReady` 无版本参数），引入意味着 fork 打补丁（MPL-2.0 文件级 copyleft 义务）并废弃已验证的证据链。故裁决（#246，2026-08-30）：**自研硬化**。

## Considered Options

- **capgo 手动模式**（rejected）：#241 调研曾推荐（当时自研未验证），其切换原语与本方案同源，但 #245 之后增量反转——capgo 的核心增量（统计上报/摇一摇菜单/channel/加密/delta/下载服务）在「手动模式 + GitHub Releases 分发 + 灰度排除」的既定决策下全部用不上，而坑②④需 patch 第三方 5860 行主文件。
- **先 spike capgo 对比再定**（rejected）：自研证据已四场景全绿且含坑修复，对比实验的预期收益不抵一轮设备验证成本。

## Consequences

- 下载重试退避、孤儿清理、多版本磁盘清理、APK 升级清 OTA（`resetWhenUpdate` 同构）等长尾由本仓自维护（均为百行级，已列入实施规格 `docs/specs/ota-web-bundle.md`）。
- 未来如需 delta 更新、端到端加密、channel 分发，需自实现或届时重新评估 capgo（切换原语不变，迁移面限于插件层）。
- Ed25519 验签捆绑 `bcprov-jdk18on` lightweight API（不注册 JCA provider），公钥走 `buildConfigField`，私钥仓外（详见 `docs/research/ota-ed25519-android.md`）。
