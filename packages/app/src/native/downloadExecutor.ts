// ─── 下载执行器接线（webview 引擎）：模块加载即注册到 downloadStore ───
// 生产插件 = Android PictelioDownloaderPlugin；web/dev 下插件方法 reject → 任务显式失败（无静默）。
import { registerPlugin } from "@capacitor/core";
import { setDownloadExecutor } from "../stores/downloadStore";
import {
  createCapacitorDownloadExecutor,
  type PictelioDownloaderNative,
} from "../utils/capacitorDownloadExecutor";

export const pictelioDownloader = registerPlugin<PictelioDownloaderNative>("PictelioDownloader");

setDownloadExecutor(createCapacitorDownloadExecutor(pictelioDownloader));
