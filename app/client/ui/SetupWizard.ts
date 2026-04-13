import {
  cssFadeUp,
  cssFadeUpGristLogo,
  cssFadeUpHeading,
  cssFadeUpSubHeading,
} from "app/client/ui/AdminPanelCss";
import { Stepper } from "app/client/ui2018/Stepper";
import { tokens } from "app/common/ThemePrefs";

import { BindableValue, Disposable, dom, DomContents, makeTestId, Observable, styled } from "grainjs";

const testId = makeTestId("test-setup-wizard-");

// =========================================================================
// Component
// =========================================================================

/**
 * A multi-step setup wizard with a stepper bar and animated content cards.
 *
 * Each step receives the `activeStep` observable so it can navigate
 * forward/backward. Steps can optionally be `plain` (no card chrome)
 * or carry a `completed` observable for the stepper checkmark.
 *
 * ```
 * dom.create(SetupWizard, {
 *   title: "Quick setup",
 *   subtitle: "Configure Grist for your environment.",
 *   steps: [
 *     {
 *       label: "Server",
 *       buildDom: (activeStep) => dom("div",
 *         dom("p", "Server settings here..."),
 *         bigPrimaryButton("Continue", dom.on("click", () => activeStep.set(1))),
 *       ),
 *     },
 *     {
 *       label: "Auth",
 *       plain: true,
 *       buildDom: (activeStep) => dom("div",
 *         dom.create(HeroCard, { ... }),
 *         bigPrimaryButton("Continue", dom.on("click", () => activeStep.set(2))),
 *       ),
 *     },
 *     {
 *       label: "Done",
 *       buildDom: () => dom("div", "All set!"),
 *     },
 *   ],
 * })
 * ```
 */
export class SetupWizard extends Disposable {
  public readonly activeStep: Observable<number>;

  constructor(private _options: SetupWizardOptions) {
    super();
    this.activeStep = Observable.create(this, _options.initialStep ?? 0);
  }

  public buildDom() {
    const o = this._options;
    const steps = o.steps.map(s => ({
      ...s,
      completed: s.completed ?? Observable.create(this, false),
    }));

    return cssMainContent(
      cssFadeUpGristLogo(),
      cssFadeUpHeading(o.title),
      cssFadeUpSubHeading(o.subtitle),
      cssStepper(
        dom.create(Stepper, { activeStep: this.activeStep, steps }),
      ),
      dom.domComputed(this.activeStep, i => {
        const step = steps[i];
        if (!step) { return null; }
        return cssStepContent(
          cssStepContent.cls("-plain", Boolean(step.plain)),
          testId("step-content"),
          step.buildDom(this.activeStep),
        );
      }),
      testId("wizard"),
    );
  }
}

// =========================================================================
// Types
// =========================================================================

export interface WizardStep {
  label: string;
  /** When true, the step content card has no border, shadow, or padding. */
  plain?: boolean;
  /** Whether this step is marked as completed in the stepper. Defaults to false. */
  completed?: BindableValue<boolean>;
  /** Build the step content. Receives activeStep observable for navigation. */
  buildDom(activeStep: Observable<number>): DomContents;
}

export interface SetupWizardOptions {
  title: string;
  subtitle: string;
  steps: WizardStep[];
  /** Initial step index. Defaults to 0. */
  initialStep?: number;
}

// =========================================================================
// Styled components
// =========================================================================

const cssMainContent = styled("div", `
  margin: 0 auto;
  max-width: 640px;
  padding: 56px 24px 64px;
  width: 100%;
`);

const cssStepper = styled("div", `
  animation: ${cssFadeUp} 0.5s ease 0.24s both;
`);

const cssStepContent = styled("div", `
  animation: ${cssFadeUp} 0.5s ease 0.24s both;
  background: ${tokens.bg};
  border: 1px solid ${tokens.decorationSecondary};
  border-radius: 12px;
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.04),
    0 8px 24px rgba(0, 0, 0, 0.06);
  margin: 24px auto;
  max-width: 520px;
  padding: 28px 32px;
  &-plain {
    border: none;
    box-shadow: none;
    padding: 0;
    background: none;
  }
`);
