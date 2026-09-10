// ─── 系统分享接线（webview 引擎）：模块加载即注册到 downloadStore ───
import { registerPlugin } from "@capacitor/core";
import { setDownloadSharer } from "../stores/downloadStore";
import { createCapacitorSharer, type PictelioShareNative } from "../utils/capacitorShare";

export const pictelioShare = registerPlugin<PictelioShareNative>("PictelioShare");
setDownloadSharer(createCapacitorSharer(pictelioShare));
