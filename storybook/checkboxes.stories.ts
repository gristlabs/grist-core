import {
  circleCheckbox, labeledCircleCheckbox, labeledSquareCheckbox,
  radioCheckboxOption, squareCheckbox,
} from "app/client/ui2018/checkbox";
import { toggleSwitch } from "app/client/ui2018/toggleSwitch";

import { dom, Observable, styled } from "grainjs";

export default {
  title: "Checkboxes & Toggles",
  parameters: {
    docs: { codePanel: true, source: { type: "code" } },
  },
};

/**
 * Checkboxes, radio-style options, and toggle switches.
 *
 * ```
 * import { squareCheckbox, labeledSquareCheckbox } from "app/client/ui2018/checkbox";
 * import { circleCheckbox, labeledCircleCheckbox } from "app/client/ui2018/checkbox";
 * import { radioCheckboxOption } from "app/client/ui2018/checkbox";
 * import { toggleSwitch } from "app/client/ui2018/toggleSwitch";
 *
 * const enabled = Observable.create(owner, false);
 *
 * // Bare checkbox
 * squareCheckbox(enabled)
 *
 * // Checkbox with label
 * labeledSquareCheckbox(enabled, "Enable feature")
 *
 * // Disabled checkbox
 * squareCheckbox(enabled, dom.prop("disabled", true))
 *
 * // Toggle switch with label
 * toggleSwitch(enabled, { label: "Dark mode" })
 * ```
 *
 * All checkboxes take an `Observable<boolean>` and optional DOM args.
 * Use **square** for general toggles, **circle** for radio-like selections.
 * Use **toggleSwitch** for on/off settings.
 */
export const Overview = {
  render: (_args: any, { owner }: any) => {
    const checked = Observable.create(owner, false);
    const toggled = Observable.create(owner, false);
    return cssColumn(
      cssRow(
        squareCheckbox(checked),
        circleCheckbox(Observable.create(owner, true)),
        toggleSwitch(toggled),
      ),
      cssRow(
        labeledSquareCheckbox(Observable.create(owner, false), "Square with label"),
        labeledCircleCheckbox(Observable.create(owner, true), "Circle with label"),
        toggleSwitch(Observable.create(owner, true), { label: "Toggle with label" }),
      ),
    );
  },
};

/**
 * Square checkboxes: the default choice for boolean settings.
 */
export const SquareCheckbox = {
  render: (_args: any, { owner }: any) => {
    const obs = Observable.create(owner, false);
    return cssColumn(
      squareCheckbox(obs),
      labeledSquareCheckbox(Observable.create(owner, true), "Checked"),
      labeledSquareCheckbox(Observable.create(owner, false), "Unchecked"),
      labeledSquareCheckbox(Observable.create(owner, false), "Disabled", dom.prop("disabled", true)),
      labeledSquareCheckbox(Observable.create(owner, true), "Checked & disabled", dom.prop("disabled", true)),
    );
  },
  parameters: { docs: { source: { type: "code",
    transform: () => `const enabled = Observable.create(owner, false);\n` +
      `squareCheckbox(enabled)\n` +
      `labeledSquareCheckbox(enabled, "Enable feature")\n` +
      `labeledSquareCheckbox(enabled, "Disabled", dom.prop("disabled", true))` } } },
};

/**
 * Circle checkboxes: used for radio-like selections where only
 * one option in a group should be active.
 */
export const CircleCheckbox = {
  render: (_args: any, { owner }: any) => cssColumn(
    labeledCircleCheckbox(Observable.create(owner, false), "Option A"),
    labeledCircleCheckbox(Observable.create(owner, true), "Option B (selected)"),
    labeledCircleCheckbox(Observable.create(owner, false), "Disabled", dom.prop("disabled", true)),
  ),
  parameters: { docs: { source: { type: "code",
    transform: () => `labeledCircleCheckbox(obs, "Option A")` } } },
};

/**
 * `radioCheckboxOption()` ties circle checkboxes to a shared observable,
 * so selecting one deselects the others — like radio buttons.
 */
export const RadioOptions = {
  render: (_args: any, { owner }: any) => {
    const selected = Observable.create(owner, "read" as string);
    return cssColumn(
      radioCheckboxOption(selected, "read", dom("span", "Can view")),
      radioCheckboxOption(selected, "write", dom("span", "Can edit")),
      radioCheckboxOption(selected, "admin", dom("span", "Is owner")),
      dom("div", "Selected: ", dom.text(selected)),
    );
  },
  parameters: { docs: { source: { type: "code",
    transform: () => `const role = Observable.create(owner, "read");\n` +
      `radioCheckboxOption(role, "read", dom("span", "Can view"))\n` +
      `radioCheckboxOption(role, "write", dom("span", "Can edit"))\n` +
      `radioCheckboxOption(role, "admin", dom("span", "Is owner"))` } } },
};

/**
 * Checkboxes with a padded, bordered wrapper — the kind of box-style affordance used
 * for radio-style options or settings groups. Extend any checkbox builder with
 * `styled(squareCheckbox, …)` (or `styled(labeledSquareCheckbox, …)`) to add padding,
 * border, hover styles, etc. directly on the surrounding `cssLabel`.
 *
 * `radioCheckboxOption` is the built-in helper that follows this pattern; it composes
 * `labeledCircleCheckbox` with `cssBlockCheckbox` (padding + border + radio-like
 * pointer-events) and ties a group of options to a shared observable.
 */
export const PaddedWrapper = {
  render: (_args: any, { owner }: any) => {
    const a = Observable.create(owner, true);
    const b = Observable.create(owner, false);
    const role = Observable.create<"a" | "b">(owner, "a");
    return cssColumn(
      cssPaddedSquareCheckbox(a),
      cssPaddedLabeledSquareCheckbox(b, "labeledSquareCheckbox with padding"),
      radioCheckboxOption(role, "a", dom("span", "radioCheckboxOption")),
    );
  },
};

/**
 * Toggle switch with animated slide transition.
 * Pass an `Observable<boolean>` and optional `{ label }`.
 */
export const ToggleSwitch = {
  render: (_args: any, { owner }: any) => {
    const on = Observable.create(owner, false);
    const withLabel = Observable.create(owner, true);
    return cssColumn(
      cssRow(
        toggleSwitch(on),
        dom("span", dom.text(use => use(on) ? "ON" : "OFF")),
      ),
      toggleSwitch(withLabel, { label: "Enable notifications" }),
      toggleSwitch(Observable.create(owner, false), { label: "Without transitions",
        enableTransitions: Observable.create(owner, false) }),
    );
  },
  parameters: { docs: { source: { type: "code",
    transform: () => `const enabled = Observable.create(owner, false);\n` +
      `toggleSwitch(enabled)\n` +
      `toggleSwitch(enabled, { label: "Enable notifications" })` } } },
};

const cssRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 16px;
`);

const cssColumn = styled("div", `
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
`);

const cssPadded = `
  padding: 10px 8px;
  border: 1px solid #888;
  border-radius: 3px;
`;
const cssPaddedSquareCheckbox = styled(squareCheckbox, cssPadded);
const cssPaddedLabeledSquareCheckbox = styled(labeledSquareCheckbox, cssPadded);
