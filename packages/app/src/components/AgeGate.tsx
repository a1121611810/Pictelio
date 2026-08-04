import { type Component } from "solid-js";
import FluentDialog from "./ui/FluentDialog";
import { setAgeConfirmation } from "../stores/settingsStore";

function confirmAdult() {
  setAgeConfirmation(true, true);
}

function confirmMinor() {
  setAgeConfirmation(true, false);
}

const AgeGate: Component = () => {
  return (
    <FluentDialog open aria-label="年龄确认">
      <h3 slot="title">年龄确认</h3>
      <p>你是否已满 18 周岁？本应用包含 R-18 / R-18G 内容，未成年人请在监护人指导下使用。</p>
      <fluent-button slot="actions" appearance="primary" on:click={confirmAdult}>
        已满 18 岁
      </fluent-button>
      <fluent-button slot="actions" appearance="secondary" on:click={confirmMinor}>
        未满 18 岁
      </fluent-button>
    </FluentDialog>
  );
};

export default AgeGate;
