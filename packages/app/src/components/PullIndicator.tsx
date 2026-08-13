import type { Component } from "solid-js";

type PullZone = "idle" | "pulling" | "refresh-ready" | "refreshing" | "settings-ready";

interface Props {
  zone: PullZone;
  distance: number;
  refreshThreshold: number;
  settingsThreshold: number;
}

const PullIndicator: Component<Props> = (props) => {
  const height = () => (props.zone === "settings-ready" ? props.settingsThreshold : props.distance);
  const opacity = () => Math.min(props.distance / props.refreshThreshold, 1);

  return (
    <div
      class="flex justify-center overflow-hidden"
      style={{
        height: `${height()}px`,
        opacity: opacity(),
        transition:
          props.zone === "idle" ? "height var(--durationFast) var(--curveDecelerateMid)" : "none",
      }}
    >
      <div class="flex items-center gap-2 py-2 [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)] select-none">
        <Switch>
          <Match when={props.zone === "refreshing"}>
            <span class="spinner w-4 h-4" />
            刷新中...
          </Match>
          <Match when={props.zone === "settings-ready"}>⚙️ 松手进入设置</Match>
          <Match when={props.zone === "refresh-ready"}>✨ 松开刷新 · 继续下拉进入设置</Match>
          <Match when={props.zone === "pulling" && props.distance < props.refreshThreshold}>
            ↓ 下拉刷新
          </Match>
          <Match when={props.zone === "pulling" && props.distance >= props.refreshThreshold}>
            ✨ 松开刷新
          </Match>
        </Switch>
      </div>
    </div>
  );
};

export default PullIndicator;
