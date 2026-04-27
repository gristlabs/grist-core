import { icon } from "app/client/ui2018/icons";
import { unstyledButton } from "app/client/ui2018/unstyled";
import { inlineStyle } from "app/common/gutil";
import { tokens } from "app/common/ThemePrefs";

import { BindableValue, Disposable, dom, DomContents, makeTestId, Observable, styled } from "grainjs";

const testId = makeTestId("test-stepper-");

export interface StepperProps {
  activeStep: Observable<number>;
  steps: Step[];
}

export interface Step {
  completed: BindableValue<boolean>;
  label: string;
}

export class Stepper extends Disposable {
  private _activeStep: Observable<number>;
  private _steps: Step[];

  constructor(props: StepperProps) {
    super();

    this._activeStep = props.activeStep;
    this._steps = props.steps;
  }

  public buildDom(): DomContents {
    return cssStepper(
      inlineStyle("--steps", this._steps.length),
      cssTrack(
        cssTrackFill(
          dom.style("width", use => `${(use(this._activeStep) / (this._steps.length - 1)) * 100}%`),
        ),
      ),
      ...this._steps.map(({ label, completed }, i) =>
        cssStep(
          cssStep.cls("-active", use => use(this._activeStep) === i),
          cssStep.cls("-completed", completed),
          dom.on("click", () => this._activeStep.set(i)),
          testId(`step-${i}`),
          cssStepIcon(
            dom.domComputed(completed, c => c ? cssIcon("Tick") : String(i + 1)),
          ),
          cssStepLabel(label),
        ),
      ),
    );
  }
}

const STEP_ICON_SIZE = 34;

const STEP_PADDING = 4;

const STEP_RADIUS = (STEP_ICON_SIZE + (2 * STEP_PADDING)) / 2;

const cssStepper = styled("div", `
  column-gap: 16px;
  display: flex;
  position: relative;
`);

const cssTrack = styled("div", `
  background: ${tokens.decorationSecondary};
  height: 3px;
  left: calc(50% / var(--steps));
  position: absolute;
  right: calc(50% / var(--steps));
  top: ${STEP_RADIUS}px;
  transform: translateY(-50%);
`);

const cssTrackFill = styled("div", `
  background: ${tokens.primary};
  border-radius: 2px;
  height: 100%;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
`);

const cssStep = styled(unstyledButton, `
  cursor: pointer;
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  overflow: hidden;
  padding: ${STEP_PADDING}px;
  user-select: none;
  z-index: 1;

  &:focus-visible {
    outline: 3px solid ${tokens.primary};
    outline-offset: 2px;
  }
`);

const cssStepIcon = styled("div", `
  --icon-color: ${tokens.white};

  align-items: center;
  align-self: center;
  background: ${tokens.bg};
  border: 3px solid ${tokens.decorationSecondary};
  border-radius: 50%;
  color: ${tokens.secondary};
  display: flex;
  font-weight: 700;
  justify-content: center;
  height: ${STEP_ICON_SIZE}px;
  transition: background 0.3s, border-color 0.3s, color 0.3s;
  width: ${STEP_ICON_SIZE}px;

  .${cssStep.className}-completed & {
    background: ${tokens.primary};
    border-color: ${tokens.primary};
    color: ${tokens.white};
  }

  .${cssStep.className}-active & {
    background: ${tokens.primary};
    border-color: ${tokens.primary};
    color: ${tokens.white};
  }
`);

const cssIcon = styled(icon, `
  height: 20px;
  width: 20px;
`);

const cssStepLabel = styled("div", `
  color: ${tokens.secondary};
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.2px;
  margin-top: 6px;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  transition: color 0.3s;
  white-space: nowrap;

  .${cssStep.className}-active & {
    color: ${tokens.body};
    font-weight: 600;
  }
`);
