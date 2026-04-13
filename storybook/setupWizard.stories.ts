import { SetupWizard } from "app/client/ui/SetupWizard";
import { bigPrimaryButton } from "app/client/ui2018/buttons";

import { action } from "@storybook/addon-actions";
import { dom, Observable, styled } from "grainjs";

export default {
  title: "Setup / SetupWizard",
};

export const Default = {
  args: {
    title: "Quick setup",
    subtitle: "Configure Grist for your environment.",
    initialStep: 0,
    stepCount: 5,
    step1Label: "Server",
    step2Label: "Sandboxing",
    step3Label: "Authentication",
    step4Label: "Backups",
    step5Label: "Apply & restart",
  },
  argTypes: {
    initialStep: { control: { type: "range", min: 0, max: 4, step: 1 } },
    stepCount: { control: { type: "range", min: 2, max: 6, step: 1 } },
  },
  render: (args: any) => {
    const labels = [
      args.step1Label, args.step2Label, args.step3Label,
      args.step4Label, args.step5Label, "Extra step",
    ].slice(0, args.stepCount);

    return dom.create(SetupWizard, {
      title: args.title,
      subtitle: args.subtitle,
      initialStep: args.initialStep,
      steps: labels.map((label: string, i: number) => ({
        label,
        buildDom: (activeStep: Observable<number>) => dom("div",
          dom("p", `This is the content for step "${label}".`),
          cssContinueRow(
            i > 0 ? bigPrimaryButton("Back", dom.on("click", () => {
              action("Back")();
              activeStep.set(activeStep.get() - 1);
            })) : null,
            i < labels.length - 1 ? bigPrimaryButton("Continue", dom.on("click", () => {
              action("Continue")();
              activeStep.set(activeStep.get() + 1);
            })) : null,
            i === labels.length - 1 ? bigPrimaryButton("Finish",
              dom.on("click", action("Finish")),
            ) : null,
          ),
        ),
      })),
    });
  },
};

export const PlainStep = {
  render: () => dom.create(SetupWizard, {
    title: "Setup",
    subtitle: "A wizard with a plain (borderless) step.",
    steps: [
      {
        label: "Normal",
        buildDom: (activeStep: Observable<number>) => dom("div",
          dom("p", "This step has the default card styling."),
          cssContinueRow(
            bigPrimaryButton("Continue", dom.on("click", () => activeStep.set(1))),
          ),
        ),
      },
      {
        label: "Plain",
        plain: true,
        buildDom: (activeStep: Observable<number>) => dom("div",
          dom("p", "This step has no border, shadow, or padding (plain: true)."),
          cssContinueRow(
            bigPrimaryButton("Back", dom.on("click", () => activeStep.set(0))),
            bigPrimaryButton("Continue", dom.on("click", () => activeStep.set(2))),
          ),
        ),
      },
      {
        label: "Done",
        buildDom: () => dom("div",
          dom("p", "All done!"),
        ),
      },
    ],
  }),
};

export const WithCompletedSteps = {
  render: () => {
    const completed = [
      Observable.create(null, true),
      Observable.create(null, true),
      Observable.create(null, false),
    ];
    return dom.create(SetupWizard, {
      title: "Progress example",
      subtitle: "Steps 1 and 2 are already completed.",
      initialStep: 2,
      steps: [
        {
          label: "Server",
          completed: completed[0],
          buildDom: () => dom("div", dom("p", "Server configuration.")),
        },
        {
          label: "Auth",
          completed: completed[1],
          buildDom: () => dom("div", dom("p", "Authentication setup.")),
        },
        {
          label: "Finish",
          completed: completed[2],
          buildDom: (activeStep: Observable<number>) => dom("div",
            dom("p", "Click Finish to mark this step as completed."),
            cssContinueRow(
              bigPrimaryButton("Finish", dom.on("click", () => {
                action("Finish")();
                completed[2].set(true);
              })),
            ),
          ),
        },
      ],
    });
  },
};

const cssContinueRow = styled("div", `
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 24px;
`);
