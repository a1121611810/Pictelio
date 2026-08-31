import type { Component } from "solid-js";
import { downloadAndExtractUgoira, type UgoiraFrame } from "../api/illust";
import { ugoiraMode } from "../stores/settingsStore";
import PixivImage from "./PixivImage";

interface Props {
  illustId: number;
  coverUrl: string;
  onClose: () => void;
  /** 内联模式：在页面内原地播放，不占全屏 */
  inline?: boolean;
  /** 内联模式用于 aspect-ratio，优先于 width/height */
  aspectRatio?: string;
  /** 内联模式回退用，仅当 aspectRatio 未提供时生效 */
  width?: number;
  height?: number;
  /** 预加载的帧数据（由父组件提供时跳过内部加载流程） */
  preloadedFrames?: UgoiraFrame[];
  /**
   * ADR-0127 渐进模式：父组件持有响应式帧列表（首帧就绪即挂载，后续帧就绪追加）。
   * frames() 返回当前全部已就绪帧；done() 表示流式取帧已结束（列表不再增长）。
   * 提供本 prop 时跳过内部加载流程，播放器到列表尾部等待新帧（不停止不报错）。
   */
  streaming?: {
    frames: () => UgoiraFrame[];
    done: () => boolean;
  };
}

const UgoiraViewer: Component<Props> = (props) => {
  const [frames, setFrames] = createSignal<UgoiraFrame[]>([]);
  const [currentFrame, setCurrentFrame] = createSignal(0);
  const [status, setStatus] = createSignal<"loading" | "playing" | "paused">("loading");
  const [error, setError] = createSignal<string | null>(null);
  const [frameAspectRatio, setFrameAspectRatio] = createSignal<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let blobUrls: string[] = [];

  /** 当前帧列表：渐进模式读父组件响应式列表；静态模式读内部/预加载列表 */
  const frameList = (): UgoiraFrame[] =>
    props.streaming ? props.streaming.frames() : (props.preloadedFrames ?? frames());

  onMount(async () => {
    // 渐进模式：数据由父组件流式提供，直接开始播放（首帧就绪时已挂载）
    if (props.streaming) {
      setStatus("playing");
      scheduleNext(0);
      return;
    }
    // 如果父组件已预加载帧数据，跳过加载流程
    if (props.preloadedFrames && props.preloadedFrames.length > 0) {
      setFrames(props.preloadedFrames);
      setStatus("playing");
      scheduleNext(0);
      return;
    }

    const [err, result] = await tryAsync(
      downloadAndExtractUgoira(props.illustId, undefined, ugoiraMode()),
    );
    if (err) {
      console.error("[UgoiraViewer] Error:", err);
      setError((err as Error).message || "加载动图失败");
      setStatus("paused");
    } else {
      blobUrls = result.blobUrls;
      setFrames(result.frames);
      setStatus("playing");
      scheduleNext(0);
    }
  });

  /**
   * 播放调度：播 index 帧 → 按 delay 调度下一帧。
   * 渐进模式：到达当前列表尾部且流式未结束 → 50ms 轮询等待新帧（不停止不报错）；
   * 流式结束/静态模式 → 回到 0 循环。
   */
  function scheduleNext(index: number) {
    if (timer) {
      clearTimeout(timer);
    }
    const list = frameList();
    const frame = list[index];
    if (!frame) {
      if (props.streaming && !props.streaming.done()) {
        // 尾部等待新帧
        timer = setTimeout(() => scheduleNext(index), 50);
      } else if (props.streaming && list.length > 0) {
        // 流式已结束：从 0 循环（列表非空）
        timer = setTimeout(() => scheduleNext(0), 50);
      }
      return;
    }
    setCurrentFrame(index);
    const nextIndex = index + 1;
    if (nextIndex >= list.length) {
      if (props.streaming && !props.streaming.done()) {
        // 尾部等待新帧（当前帧保持显示）
        timer = setTimeout(() => scheduleNext(nextIndex), 50);
        return;
      }
      timer = setTimeout(() => scheduleNext(0), frame.delay);
      return;
    }
    timer = setTimeout(() => scheduleNext(nextIndex), frame.delay);
  }

  function togglePause() {
    if (status() === "playing") {
      if (timer) {
        clearTimeout(timer);
      }
      timer = null;
      setStatus("paused");
    } else if (status() === "paused" && frameList().length > 0) {
      setStatus("playing");
      scheduleNext(currentFrame());
    }
  }

  onCleanup(() => {
    if (timer) {
      clearTimeout(timer);
    }
    for (const url of blobUrls) {
      URL.revokeObjectURL(url);
    }
  });

  // 帧加载完成后，测量第一帧的实际宽高比，更新容器
  createEffect(() => {
    if (status() === "playing" && frameList().length > 0) {
      const url = frameList()[0].url;
      const img = new Image();
      let alive = true;
      img.onload = () => {
        if (alive) {
          setFrameAspectRatio(`${img.naturalWidth} / ${img.naturalHeight}`);
        }
      };
      img.src = url;
      onCleanup(() => {
        alive = false;
      });
    }
  });

  // Inline mode wrapper
  const containerStyle = (): Record<string, string> => {
    if (props.inline) {
      // 帧加载完成后优先用帧的实际尺寸
      if (frameAspectRatio()) {
        return { "aspect-ratio": frameAspectRatio()! };
      }
      if (props.aspectRatio) {
        return { "aspect-ratio": props.aspectRatio };
      }
      if (props.width && props.height) {
        return { "aspect-ratio": `${props.width} / ${props.height}` };
      }
    }
    return {};
  };

  return (
    <div
      class={
        props.inline
          ? "w-full overflow-hidden cursor-pointer"
          : "fixed inset-0 z-50 touch-none select-none flex items-start justify-center cursor-pointer"
      }
      style={
        props.inline
          ? { ...containerStyle(), "background-color": "var(--colorNeutralBackground2)" }
          : { "background-color": "var(--colorOverlayBackground)" }
      }
      onClick={togglePause}
    >
      {/* Close button — only in full-screen mode */}
      {!props.inline && (
        <button
          class="absolute top-4 left-4 w-10 h-10 flex items-center justify-center rounded-[var(--borderRadiusCircular)] bg-[var(--colorOverlaySurface)] text-[var(--colorOverlayForeground)] text-xl hover:bg-[var(--colorOverlaySurfaceHover)] active:bg-[var(--colorOverlaySurfaceHover)] transition-all duration-[var(--durationFast)] border-none outline-none appearance-none cursor-pointer z-10"
          onClick={(e) => {
            e.stopPropagation();
            props.onClose();
          }}
          aria-label="关闭"
        >
          ←
        </button>
      )}

      {/* Status: loading — full-screen: text badge; inline: centered spinner */}
      {status() === "loading" && !props.inline && (
        <div class="absolute top-4 right-4 px-2.5 py-1 rounded-[var(--borderRadiusCircular)] bg-[var(--colorOverlaySurface)] text-[var(--colorOverlayForeground)] text-[var(--fontSizeBase200)] font-medium z-10">
          加载中...
        </div>
      )}

      {status() === "paused" && (
        <div
          class="px-2.5 py-1 rounded-[var(--borderRadiusCircular)] bg-[var(--colorOverlaySurface)] text-[var(--colorOverlayForeground)] text-[var(--fontSizeBase200)] font-medium z-10"
          classList={{
            "absolute top-4 right-4": !props.inline,
            "absolute top-2 right-2": props.inline,
          }}
        >
          已暂停
        </div>
      )}

      {/* Error state */}
      {error() && (
        <div
          class="text-center px-6"
          classList={{
            "text-[var(--colorOverlayForeground)]": !props.inline,
            "text-[var(--colorNeutralForeground1)] absolute inset-0 flex flex-col items-center justify-center bg-[var(--colorNeutralBackground2)]":
              props.inline,
          }}
        >
          <p class="[font-size:var(--fontSizeBase300)] mb-4">{error()}</p>
          <fluent-button appearance="secondary" on:click={props.onClose}>
            返回
          </fluent-button>
        </div>
      )}

      {/* Cover image (shown while loading or if error) */}
      {(status() === "loading" || error()) && (
        <PixivImage
          src={props.coverUrl}
          alt="cover"
          loading="eager"
          class={`${!props.inline ? "max-w-full max-h-full" : "w-full h-full"} object-cover object-top`}
          draggable={false}
        />
      )}

      {/* Inline loading: spinner overlay */}
      {status() === "loading" && props.inline && (
        <div class="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div
            class="rounded-full"
            style={{
              width: "32px",
              height: "32px",
              border: "3px solid var(--colorNeutralStroke2)",
              "border-top-color": "var(--colorBrandForeground1)",
              animation: "spin 500ms linear infinite",
            }}
          />
        </div>
      )}

      {/* Frame playback */}
      {status() !== "loading" && !error() && frameList().length > 0 && (
        <img
          src={frameList()[currentFrame()]!.url}
          alt={`frame ${currentFrame() + 1}`}
          classList={{
            "max-w-full max-h-full object-contain object-top": !props.inline,
            "w-full h-full object-cover object-top": props.inline,
          }}
          draggable={false}
        />
      )}
    </div>
  );
};

export default UgoiraViewer;
