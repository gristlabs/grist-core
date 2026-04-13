import { CardList, HeroCard, ItemCard } from "app/client/ui/SetupCard";
import { SetupWizard } from "app/client/ui/SetupWizard";
import { bigPrimaryButton } from "app/client/ui2018/buttons";

import { action } from "@storybook/addon-actions";
import { dom, Observable, styled } from "grainjs";

export default {
  title: "Setup / Sandboxing Step",
};

export const SandboxingStep = () => {
  const selected = Observable.create(null, "gvisor");
  const makeRadio = (key: string) => ({
    checked: (use: any) => use(selected) === key,
    onSelect: () => { action(`Select ${key}`)(); selected.set(key); },
    name: "sandbox",
  });

  return dom.create(SetupWizard, {
    title: "Quick setup",
    subtitle: "Configure Grist for your environment.",
    initialStep: 1,
    steps: [
      { label: "Server", buildDom: () => dom("div", "Server settings...") },
      {
        label: "Sandboxing",
        buildDom: (activeStep) => dom("div",
          dom("h3", cssStepTitle.cls(""),
            cssSandboxIcon("</>")),
          cssStepTitle("Sandboxing"),
          cssStepDescription(
            "Grist runs user formulas as Python code. Sandboxing isolates this execution to " +
            "protect your server. Without it, document formulas can access the full system.",
          ),
          dom.create(HeroCard, {
            indicator: (use: any) => use(selected) === "gvisor" ? "success" : "pending",
            radio: makeRadio("gvisor"),
            header: "gVisor",
            tags: [{ label: "Recommended" }],
            badges: [{ label: "Ready", variant: "primary" }],
            text: "Your system supports gVisor — the fastest and most battle-tested sandbox. " +
              "Each document's formulas run in their own isolated container, separated from " +
              "each other and the network.",
          }),
          dom.create(CardList, {
            header: "Hide other options",
            collapsible: true,
            initiallyCollapsed: true,
            items: [
              dom.create(ItemCard, {
                radio: { ...makeRadio("pyodide"), disabled: true },
                header: "Pyodide",
                badges: [{ label: "Not available", variant: "error" }],
                text: "Works on any platform. Formulas run in WebAssembly — fully compatible " +
                  "but slower than gVisor.",
                error: { header: "", message: "Pyodide not installed" },
              }),
              dom.create(ItemCard, {
                radio: { ...makeRadio("macos"), disabled: true },
                header: "macOS Sandbox",
                badges: [{ label: "Not available", variant: "error" }],
                text: "Uses the built-in macOS sandbox. Good isolation for local use on a Mac.",
                error: { header: "", message: "Not macOS" },
              }),
              dom.create(ItemCard, {
                indicator: (use: any) => use(selected) === "none" ? "active" : undefined,
                radio: makeRadio("none"),
                header: "No Sandbox",
                badges: [{ label: "Not recommended", variant: "warning" }],
                text: "Formulas have full system access. Only appropriate when you trust every " +
                  "document and its authors.",
              }),
            ],
          }),
          cssContinueRow(
            bigPrimaryButton("Continue",
              dom.on("click", () => {
                action("Continue")();
                activeStep.set(activeStep.get() + 1);
              }),
            ),
          ),
        ),
      },
      { label: "Authentication", buildDom: () => dom("div", "Auth settings...") },
      { label: "Backups", buildDom: () => dom("div", "Backup settings...") },
      { label: "Apply & Restart", buildDom: () => dom("div", "Ready to apply.") },
    ],
  });
};

const cssStepTitle = styled("div", `
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
`);

const cssSandboxIcon = styled("span", `
  font-family: monospace;
  margin-right: 8px;
  opacity: 0.5;
`);

const cssStepDescription = styled("div", `
  font-size: 14px;
  color: #666;
  line-height: 1.5;
  margin-bottom: 20px;
`);

const cssContinueRow = styled("div", `
  display: flex;
  justify-content: stretch;
  margin-top: 24px;
  & > * {
    flex: 1;
  }
`);
