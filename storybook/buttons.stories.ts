import { cssButtonIconAndText, cssButtonText } from "app/client/ui/AdminTogglesCss";
import * as buttons from "app/client/ui2018/buttons";
import { cssIconButton, icon } from "app/client/ui2018/icons";

import { action } from "@storybook/addon-actions";
import { dom, Observable, styled } from "grainjs";

export default {
  title: "Buttons",
  parameters: {
    docs: { codePanel: true, source: { type: "code" } },
  },
  args: {
    label: "Button",
    disabled: false,
    action: action("Button"),
  },
  decorators: [
    (story: any, context: any) => {
      context.args.domArgs = [
        context.args.label,
        dom.prop("disabled", context.args.disabled),
        dom.on("click", context.args.action),
      ];
      return story();
    },
  ],
};

function source(funcName: string) {
  const transform = (_code: string, ctx: any) => `${funcName}(${JSON.stringify(ctx.args.label)}, ...)`;
  return { parameters: { docs: { source: { type: "code", transform } } } };
}

function makeButton(funcName: keyof typeof buttons, label: string) {
  return {
    args: { label },
    render: (args: any) => (buttons[funcName] as any)(...args.domArgs),
    ...source(funcName),
  };
}

/**
 * Standard Grist button functions. Each takes a label and optional
 * grainjs DOM args (event handlers, `dom.prop(...)`, `dom.cls(...)`, etc.).
 *
 * ```
 * import { primaryButton, basicButton } from "app/client/ui2018/buttons";
 *
 * primaryButton("Save", dom.on("click", () => save()));
 * basicButton("Cancel", dom.prop("disabled", obs), dom.on("click", ...));
 * ```
 *
 * Use **primaryButton** for the main action, **basicButton** for secondary.
 * The "big" variants are for prominent placements (e.g. welcome screens).
 * **textButton** renders as a plain text link.
 */
export const Overview = {
  render: (args: any, context: any) => [
    cssRow(
      buttons.basicButton(...context.args.domArgs),
      buttons.primaryButton(...context.args.domArgs),
      buttons.dangerButton(...context.args.domArgs),
      buttons.bigBasicButton(...context.args.domArgs),
      buttons.bigPrimaryButton(...context.args.domArgs),
      buttons.bigDangerButton(...context.args.domArgs),
      buttons.textButton(...context.args.domArgs),
    ),
    cssRow(
      cssIconButton(icon("Plus"), ...context.args.domArgs.slice(1)),
      buttons.primaryButton(
        cssButtonIconAndText(icon("Plus"), cssButtonText(context.args.label)),
        ...context.args.domArgs.slice(1),
      ),
    ),
  ],
};

export const BasicButton = makeButton("basicButton", "Cancel");
export const PrimaryButton = makeButton("primaryButton", "Save");
export const BigBasicButton = makeButton("bigBasicButton", "Cancel");
export const BigPrimaryButton = makeButton("bigPrimaryButton", "Save");
export const DangerButton = makeButton("dangerButton", "Delete");
export const BigDangerButton = makeButton("bigDangerButton", "Delete");
export const TextButton = makeButton("textButton", "Edit");

/**
 * `cssIconButton` is a small 24×24 icon-only button (from `icons.ts`).
 * Typically wraps an `icon(...)` call.
 *
 * ```
 * import { cssIconButton, icon } from "app/client/ui2018/icons";
 *
 * cssIconButton(icon("Plus"), dom.on("click", () => addItem()));
 * ```
 */
export const IconButton = {
  render: (args: any) => cssRow(
    cssIconButton(icon("Plus"), ...args.domArgs.slice(1)),
    cssIconButton(icon("Remove"), ...args.domArgs.slice(1)),
    cssIconButton(icon("Dots"), ...args.domArgs.slice(1)),
  ),
  parameters: { docs: { source: { type: "code",
    transform: () => `cssIconButton(icon("Plus"), dom.on("click", ...))` } } },
};

/**
 * `cssButtonIconAndText` pairs an icon with a text label inside a button.
 * Used with `cssButtonText` (from `AdminTogglesCss`).
 *
 * ```
 * import { cssButtonIconAndText, cssButtonText } from "app/client/ui/AdminTogglesCss";
 *
 * bigBasicButton(cssButtonIconAndText(icon("Heart"), cssButtonText("Sponsor")));
 * ```
 */
export const ButtonIconAndText = {
  render: (args: any) => cssRow(
    buttons.basicButton(
      cssButtonIconAndText(icon("Settings"), cssButtonText(args.label)),
      ...args.domArgs.slice(1),
    ),
    buttons.primaryButton(
      cssButtonIconAndText(icon("Plus"), cssButtonText(args.label)),
      ...args.domArgs.slice(1),
    ),
    buttons.bigBasicButton(
      cssButtonIconAndText(icon("Remove"), cssButtonText(args.label)),
      ...args.domArgs.slice(1),
    ),
  ),
  parameters: { docs: { source: { type: "code",
    transform: (_code: string, ctx: any) =>
      `primaryButton(
  cssButtonIconAndText(icon("Plus"), cssButtonText(${JSON.stringify(ctx.args.label)})),
  dom.on("click", ...)\n)` } },
  },
};

export const InteractivityExample = (args: any, { owner }: any) => {
  const clickCount = Observable.create(owner, 0);
  return [
    buttons.primaryButton(
      dom.text(use => `Clicked ${use(clickCount)} times`),
      dom.on("click", () => clickCount.set(clickCount.get() + 1)),
    ),
    " ",
    buttons.basicButton("Reset", dom.on("click", () => clickCount.set(0))),
  ];
};

const cssRow = styled("div", `
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
`);
