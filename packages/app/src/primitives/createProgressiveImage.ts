import type { Accessor } from "solid-js";
import {
  checkImageCache,
  isImagePrefetching,
  loadImage,
  resolveImageUrl,
} from "../utils/imageLoader";

/**
 * createProgressiveImage — 缩略图→原图渐进加载原语
 * （spec: docs/specs/webview-perf-round2.md §2.1，实施唯一依据）。
 *
 * 状态机：
 * 1. L1 命中（checkImageCache）→ 直挂 full，无渐进（字节已在缓存/磁盘，双资源记录反而浪费）。
 * 2. miss + thumb 有效 → thumb 先行占位 + `loadImage(full)` 预载，resolve 后经 URL 键守卫再切换。
 *    loadImage 自带 L1 命中 + inflight 去重（与 FeedList/VirtualFeed 预取同 Promise 合流；
 *    native 下经 PixivApi.prefetchImage 直接写盘，零字节进 JS 堆——因此 fullUrl/thumbUrl
 *    必须传原始 CDN URL，传 /pixiv-img/ 代理路径会让原生 OkHttp 拒绝相对 URL）。
 * 2.5. miss + full 预取在途（isImagePrefetching，FeedList/VirtualFeed 预取与卡片预载共享
 *      同一 inflight Promise）→ 跳过 thumb 直候 full，消除渐进的第二次网络加载
 *      （round4 A 线候选，spec: docs/specs/webview-perf-round4.md §A）；主层仍等预载
 *      resolve 才挂载（防拦截器 loadBytes 与 prefetchImage 跨写方并发下载）；预载失败/
 *      主层失败时延迟挂载 thumb 兜底（非静默降级）。兜底窗口由 skippedForInflight 标记
 *      收窄：仅「在途跳过且 full 未绘制」可达，full 绘制就绪即关闭；单段直载与 L1 命中
 *      不置位，迟发失败不重挂（与无本候选时行为一致）。
 * 3. thumb 失败 → 卸载缩略层 + warn（残破图标比纯背景更差；full 预载不受影响继续）。
 * 4. full 失败 → 停止切换 + warn；thumb 层常驻兜底（防白帧）。
 * 5. 双失败（thumb 与 full 均失败）→ failed=true，交由调用方渲染失败 UI。
 * 6. 无 thumb / thumb===full → 单段直载，行为等同现状（渐进无意义）。
 *
 * full 到位前主 img 不挂载（displaySrc 为空串），thumb 层先行占位（防白帧/兜底）；
 * full 真实绘制就绪（主 img load 事件，onDisplayLoad）后卸载缩略层——回收双层常驻的
 * 合成/解码成本（B1，issue #358）；full 失败路径 fullPainted 保持 false，thumb 层保留兜底。
 */

export interface ProgressiveImageOptions {
  /** 原图 URL（原始 CDN URL，非代理路径）；响应式 accessor，变化时状态机重跑并作废旧回调 */
  fullUrl: Accessor<string>;
  /** 缩略图 URL（原始 CDN URL）；空串视为无 thumb，走单段直载 */
  thumbUrl: Accessor<string>;
}

export interface ProgressiveImageState {
  /**
   * 缩略层 src（代理 URL）；undefined = 不挂载缩略层（L1 命中 / 单段直载 / thumb 已失败 /
   * full 预取在途跳过——后者的失败兜底见下方 catch 与 onDisplayError 的延迟挂载）；
   * 空串 = full 已绘制完成、缩略层已卸载（full 失败时保持原代理 URL 兜底）
   */
  thumbSrc: Accessor<string | undefined>;
  /** 主层 src（代理 URL）；空串 = 主 img 不挂载（full 尚未就绪，防白帧） */
  displaySrc: Accessor<string>;
  /** 主层 <img> onLoad（= full 真实绘制就绪）：置位后 thumbSrc 收窄为空串，调用方卸载缩略层 */
  onDisplayLoad: (e: Event) => void;
  /** 缩略层 <img> onError（失败矩阵第 3 条） */
  onThumbError: () => void;
  /** 主层 <img> onError（full 图在 <img> 阶段失败，与预载失败同归失败矩阵第 4 条） */
  onDisplayError: () => void;
  /** 双失败（thumb 与 full 均失败）——失败矩阵第 5 条的终态 */
  failed: Accessor<boolean>;
}

export function createProgressiveImage(options: ProgressiveImageOptions): ProgressiveImageState {
  const [rawThumbSrc, setThumbSrc] = createSignal<string | undefined>(undefined);
  const [displaySrc, setDisplaySrc] = createSignal("");
  const [thumbFailed, setThumbFailed] = createSignal(false);
  const [fullFailed, setFullFailed] = createSignal(false);
  // full 真实绘制就绪标记（B1，issue #358）：主 img load 事件置位；绘制完成后 thumb 层卸载，
  // 回收双层常驻的合成/解码成本。full 失败（预载 reject / 主 img onError）保持 false → thumb 兜底。
  const [fullPainted, setFullPainted] = createSignal(false);
  // 在途跳过标记（round4 A 线；review P2 收窄）：渐进分支因预取在途而未挂 thumb 时置位；
  // full 绘制就绪（onDisplayLoad）即清除——此后主图迟发失败不再重挂 thumb，与无本候选时
  // 行为一致。单段直载（thumb===full）与 L1 命中路径不置位，onDisplayError 延迟兜底不误伤
  // （否则会对刚失败的同一 URL 二次发起必然失败的请求，终态违反「单段路径 failed 不适用」）。
  const [skippedForInflight, setSkippedForInflight] = createSignal(false);

  // thumb 层挂载 accessor：fullPainted 后收窄为空串，调用方 <Show>/条件渲染据此卸载 thumb img；
  // 空串（绘制后卸载）与 undefined（从未挂载/thumb 失败）语义分离，供测试与调用方区分
  const thumbSrc = () => (fullPainted() ? "" : rawThumbSrc());

  // URL 键守卫：fullUrl/thumbUrl 每次变化自增 generation，预载回调回来时已过期即丢弃，
  // 防止快速滚动下旧响应覆盖新卡片的展示（竞态防护硬约束）
  let generation = 0;

  createEffect(() => {
    const full = options.fullUrl();
    const thumb = options.thumbUrl();
    const gen = ++generation;

    // 新一轮 URL：重置失败标记与绘制就绪标记（generation 切换 → 新图重新渐进，thumb 层重新挂载兜底）
    setThumbFailed(false);
    setFullFailed(false);
    setFullPainted(false);
    setSkippedForInflight(false);

    if (!full) {
      setThumbSrc(undefined);
      setDisplaySrc("");
      return;
    }

    // L1 命中：checkImageCache 返回代理 URL（走浏览器 HTTP 缓存，0ms），直挂无渐进
    const cached = checkImageCache(full);
    if (cached) {
      setThumbSrc(undefined);
      setDisplaySrc(cached);
      return;
    }

    // 单段直载：无 thumb 或 thumb===full 时渐进零收益，行为等同现状
    if (!thumb || thumb === full) {
      setThumbSrc(undefined);
      setDisplaySrc(resolveImageUrl(full));
      return;
    }

    // 渐进：thumb 先行占位；主 img 不挂载（防白帧），thumb 层兜底至 full 绘制就绪。
    // 例外（round4 A 线）：full 预取已在途（FeedList/VirtualFeed 预取与卡片预载共享同一
    // inflight Promise，isImagePrefetching 命中）→ 跳过 thumb 直候 full，消除渐进的
    // 第二次网络加载；主层仍等预载 resolve 才挂载（防白帧 + 避免拦截器 loadBytes 与
    // prefetchImage 跨写方并发下载）。预取失败由下方 catch 延迟挂载 thumb 兜底。
    setDisplaySrc("");
    if (isImagePrefetching(full)) {
      setSkippedForInflight(true);
      setThumbSrc(undefined);
    } else {
      setThumbSrc(resolveImageUrl(thumb));
    }

    void loadImage(full).then(
      (loaded) => {
        if (gen !== generation) return; // URL 键守卫：陈旧回调丢弃
        setDisplaySrc(loaded.url || resolveImageUrl(full));
      },
      (err: unknown) => {
        if (gen !== generation) return;
        // full 失败：停止切换 + warn；thumb 层保持常驻兜底，双失败才置 failed
        console.warn("[createProgressiveImage] full 预载失败，thumb 兜底:", full, err);
        setFullFailed(true);
        // 在途跳过 thumb 的卡片（round4 A 线）：预载失败时延迟挂载 thumb 兜底
        // （非静默降级，warn 已上方输出；thumb 已挂载或已失败时不重复挂载）
        if (!rawThumbSrc() && !thumbFailed() && thumb) {
          setThumbSrc(resolveImageUrl(thumb));
        }
      },
    );
  });

  // 卸载后拦截 in-flight 预载回调，防止向已销毁作用域的 signal 写入
  onCleanup(() => {
    generation++;
  });

  // 主 img load 事件（= full 真实绘制就绪）：置位后 thumbSrc 收窄为空串，thumb 层从 DOM 卸载。
  // L1 命中 / 单段直载路径主 img 同样触发 load，但本就无 thumb 层，置位无副作用。
  // 签名带事件参数（与 <img> onLoad 对齐），实现无需读取事件本身。
  const onDisplayLoad = (_e: Event) => {
    setFullPainted(true);
    // 兜底窗口随绘制就绪关闭（review P2）：此后主图迟发失败不再重挂 thumb，与现状一致
    setSkippedForInflight(false);
  };

  const onThumbError = () => {
    if (!thumbFailed()) {
      console.warn("[createProgressiveImage] thumb 加载失败:", options.thumbUrl());
    }
    setThumbFailed(true);
    setThumbSrc(undefined); // 卸载缩略层；full 预载继续
  };

  const onDisplayError = () => {
    console.warn("[createProgressiveImage] 主图加载失败:", options.fullUrl());
    setFullFailed(true);
    if (thumbSrc()) {
      // 渐进路径：主层挂载后失败，卸载主层露出下方 thumb 兜底
      setDisplaySrc("");
    } else if (skippedForInflight() && options.thumbUrl() && !thumbFailed()) {
      // 在途跳过 thumb 的卡片（round4 A 线）：主层失败时延迟挂载 thumb 兜底并卸载主层
      // （thumb 层渲染在主层下方，主层破图态不卸载会遮挡兜底；warn 已输出，非静默降级）。
      // skippedForInflight 门控：单段直载（thumb===full）与 L1 命中卡不进入本分支，
      // 不会重挂刚失败的同一 URL（review P2 回归防护）
      console.warn(
        "[createProgressiveImage] 主图失败且 thumb 曾被在途跳过，延迟挂载兜底:",
        options.thumbUrl(),
      );
      setDisplaySrc("");
      setThumbSrc(resolveImageUrl(options.thumbUrl()));
    }
    // 单段路径无 thumb 层，保持现状（浏览器默认破图态），failed 语义不适用
  };

  // 双失败才置 failed：单 thumb 失败时 full 仍可成功；单 full 失败时 thumb 兜底可见
  const failed = () => thumbFailed() && fullFailed();

  return { thumbSrc, displaySrc, onDisplayLoad, onThumbError, onDisplayError, failed };
}
