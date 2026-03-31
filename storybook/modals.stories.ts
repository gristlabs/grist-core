import { bigBasicButton, bigPrimaryButton } from "app/client/ui2018/buttons";
import {
  confirmModal, cssModalBody, cssModalButtons, cssModalTitle, modal, saveModal,
} from "app/client/ui2018/modals";

import { action } from "@storybook/addon-actions";
import { Computed, dom, Observable, styled } from "grainjs";

export default {
  title: "Modals",
  parameters: {
    docs: { codePanel: true, source: { type: "code" } },
  },
};

/**
 * Grist modal dialogs: `modal()`, `saveModal()`, and `confirmModal()`.
 *
 * ```
 * import { modal, saveModal, confirmModal } from "app/client/ui2018/modals";
 * import { cssModalTitle, cssModalBody, cssModalButtons } from "app/client/ui2018/modals";
 *
 * // Simple modal with custom content:
 * modal((ctl) => [
 *   cssModalTitle("Hello"),
 *   cssModalBody("Some content here"),
 *   cssModalButtons(
 *     bigPrimaryButton("OK", dom.on("click", () => ctl.close())),
 *   ),
 * ])
 *
 * // Save modal with built-in Save/Cancel and async work tracking:
 * saveModal((ctl, owner) => ({
 *   title: "Rename",
 *   body: dom("input", ...),
 *   saveFunc: () => server.rename(newName),
 * }))
 *
 * // Quick confirm dialog:
 * confirmModal("Delete this?", "Delete", () => deleteItem())
 * ```
 *
 * Modals append to `document.body` and manage their own backdrop.
 * `saveModal` disables Save while `saveFunc()` is running.
 * `confirmModal` is a shorthand for save modals with a single confirm action.
 */
export const Overview = {
  render: () => cssRow(
    bigPrimaryButton("Open modal", dom.on("click", () =>
      modal(ctl => [
        cssModalTitle("Example modal"),
        cssModalBody("This is a simple Grist modal dialog."),
        cssModalButtons(
          bigPrimaryButton("OK", dom.on("click", () => {
            action("modal")("OK clicked");
            ctl.close();
          })),
          bigBasicButton("Cancel", dom.on("click", () => ctl.close())),
        ),
      ]),
    )),
  ),
  parameters: { docs: { source: { type: "code",
    transform: () => `modal((ctl) => [\n` +
      `  cssModalTitle("Example modal"),\n` +
      `  cssModalBody("This is a simple Grist modal dialog."),\n` +
      `  cssModalButtons(\n` +
      `    bigPrimaryButton("OK", dom.on("click", () => ctl.close())),\n` +
      `    bigBasicButton("Cancel", dom.on("click", () => ctl.close())),\n` +
      `  ),\n` +
      `])` } } },
};

/**
 * `saveModal()` provides built-in Save/Cancel buttons and async work tracking.
 * The Save button is disabled while `saveFunc()` runs.
 */
export const SaveModal = {
  render: () =>
    bigPrimaryButton("Open save modal", dom.on("click", () =>
      saveModal((ctl, owner) => {
        const name = Observable.create(owner, "Untitled");
        return {
          title: "Rename document",
          body: dom("div",
            dom("label", "Name: ",
              dom("input",
                dom.prop("value", name),
                dom.on("input", (_ev, el) => name.set(el.value)),
                { style: "margin-left: 8px; padding: 4px 8px;" },
              ),
            ),
          ),
          saveFunc: async () => {
            action("saveModal")(`Saved as "${name.get()}"`);
            // Simulate async work
            await new Promise(r => setTimeout(r, 500));
          },
        };
      }),
    )),
  parameters: { docs: { source: { type: "code",
    transform: () => `saveModal((ctl, owner) => {\n` +
      `  const name = Observable.create(owner, "Untitled");\n` +
      `  return {\n` +
      `    title: "Rename document",\n` +
      `    body: dom("input", dom.prop("value", name), ...),\n` +
      `    saveFunc: () => server.rename(name.get()),\n` +
      `  };\n` +
      `})` } } },
};

/**
 * `confirmModal()` is a shorthand for a confirm/cancel dialog.
 */
export const ConfirmModal = {
  render: () =>
    bigPrimaryButton("Open confirm modal", dom.on("click", () =>
      confirmModal(
        "Delete this document?",
        "Delete",
        () => { action("confirmModal")("Confirmed!"); },
        { explanation: dom("div", "This action cannot be undone.") },
      ),
    )),
  parameters: { docs: { source: { type: "code",
    transform: () => `confirmModal(\n` +
      `  "Delete this document?",\n` +
      `  "Delete",\n` +
      `  () => deleteDocument(),\n` +
      `  { explanation: dom("div", "This action cannot be undone.") },\n` +
      `)` } } },
};

/**
 * Modals can disable closing with `noEscapeKey` and `noClickAway`,
 * useful for blocking operations like spinners.
 */
export const NonDismissible = {
  render: () =>
    bigPrimaryButton("Open non-dismissible", dom.on("click", () =>
      modal(ctl => [
        cssModalTitle("Working..."),
        cssModalBody("This modal can only be closed via the button."),
        cssModalButtons(
          bigPrimaryButton("Done", dom.on("click", () => ctl.close())),
        ),
      ], { noEscapeKey: true, noClickAway: true }),
    )),
  parameters: { docs: { source: { type: "code",
    transform: () => `modal((ctl) => [\n` +
      `  cssModalTitle("Working..."),\n` +
      `  cssModalBody("..."),\n` +
      `  cssModalButtons(bigPrimaryButton("Done", dom.on("click", () => ctl.close()))),\n` +
      `], { noEscapeKey: true, noClickAway: true })` } } },
};

/**
 * `saveModal` with `saveDisabled` — the Save button stays disabled
 * until a condition is met (here, non-empty input).
 */
export const ConditionalSave = {
  render: () =>
    bigPrimaryButton("Open conditional save", dom.on("click", () =>
      saveModal((ctl, owner) => {
        const name = Observable.create(owner, "");
        const isEmpty = Computed.create(owner, name, (_use, val) => val.trim() === "");
        return {
          title: "Create new page",
          body: dom("div",
            dom("label", "Page name: ",
              dom("input",
                dom.prop("value", name),
                dom.on("input", (_ev, el) => name.set(el.value)),
                { placeholder: "Enter a name...", style: "margin-left: 8px; padding: 4px 8px;" },
              ),
            ),
          ),
          saveDisabled: isEmpty,
          saveFunc: async () => {
            action("saveModal")(`Created page "${name.get()}"`);
          },
        };
      }),
    )),
  parameters: { docs: { source: { type: "code",
    transform: () => `saveModal((ctl, owner) => {\n` +
      `  const name = Observable.create(owner, "");\n` +
      `  const isEmpty = Computed.create(owner, name, (use, v) => !v.trim());\n` +
      `  return {\n` +
      `    title: "Create new page",\n` +
      `    body: dom("input", ...),\n` +
      `    saveDisabled: isEmpty,\n` +
      `    saveFunc: () => server.createPage(name.get()),\n` +
      `  };\n` +
      `})` } } },
};

const cssRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 16px;
`);
