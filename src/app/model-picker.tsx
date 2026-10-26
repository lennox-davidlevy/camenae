/** @jsxImportSource solid-js */
import { For, Show } from "solid-js";
import { ConsoleModel, consoleModels, PaidConsoleModel, paidModel } from "../console-contract.js";
import "../ui/settings.css";

interface ModelPickerProps {
  model: string;
  disabled: boolean;
  onSelect: (model: ConsoleModel) => void;
}

// Models whose providers do not train on submitted data; the others get a notice.
const noTraining = ["longcat-2.5-preview-free", "space-bunny-free"];

export function ModelPicker(props: ModelPickerProps) {
  const paid = () => PaidConsoleModel.safeParse(props.model).success;

  return <section class="chat-model-picker" aria-label="Conversation model">
    <label>Model for this chat <select aria-label="Model for this chat" value={props.model} disabled={props.disabled} onChange={(event) => {
      const selected = ConsoleModel.safeParse(event.currentTarget.value);

      if (selected.success) props.onSelect(selected.data);
    }}><For each={ConsoleModel.options}>{(id) => <option value={id} selected={id === props.model}>{consoleModels[id]} · {paidModel(id) ? "Paid, needs a request cap" : "Free"}</option>}</For></select></label>
    <small>Applies to the next turn. Chat history is retained and sent to the selected model. Free-model pricing can change. <a href="https://opencode.ai/v2/docs/console/models#privacy" target="_blank" rel="noreferrer">Data-use terms ↗</a></small>
    <Show when={paid()}><small role="status">Billed per token to your Console key. Requests are refused unless a request cap is set in Settings.</small></Show>
    <Show when={!paid() && !noTraining.includes(props.model)}><small role="status">This provider may use submitted data to improve models. Nemotron is trial-only: do not submit personal or confidential data.</small></Show>
  </section>;
}
