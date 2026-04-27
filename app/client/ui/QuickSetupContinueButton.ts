/**
 * Shared "Continue" / "Apply and Continue" button for QuickSetup steps.
 *
 * Each step's section conforms to {@link QuickSetupSection} so the button's
 * label and click behaviour can be driven uniformly:
 *
 *   - Nothing dirty             -> "Continue", advance on click.
 *   - Pending changes           -> "Apply and Continue", apply (which may
 *                                  restart the server) and then advance.
 *   - Applying                  -> "Applying...", disabled.
 *
 * Sections may override the label for step-specific cases (e.g. sandbox's
 * "Skip and Continue" when env-locked, or server's "Confirm base URL to
 * continue" pre-confirmation messages) by implementing `customLabel`.
 */
import { makeT } from "app/client/lib/localization";
import { reportError } from "app/client/models/errors";
import { cssShadowedPrimaryButton } from "app/client/ui/QuickSetupStepHeader";

import { Computed, dom, DomElementArg, Observable, styled, UseCBOwner } from "grainjs";

const t = makeT("QuickSetupContinueButton");

export interface QuickSetupSection {
  /** True when the step's content is in a state the user can move past. */
  canProceed: Computed<boolean>;
  /** True when there are saved-but-not-yet-effective changes (e.g. waiting on a restart). */
  hasPendingChanges: Computed<boolean>;
  /** True while {@link applyPendingChanges} is in flight. */
  isApplying: Observable<boolean>;
  /**
   * Persist any pending changes and (if needed) restart the server.
   * No-op if nothing is pending. Owns its own `isApplying` flag.
   */
  applyPendingChanges(): Promise<void>;
  /** Optional per-step label override. Return null/undefined to use the default labels. */
  customLabel?(use: UseCBOwner): string | null | undefined;
}

/**
 * Renders the standard QuickSetup continue button. After a successful
 * apply, calls `onAfter` to let the wizard advance.
 */
export function quickSetupContinueButton(
  section: QuickSetupSection,
  onAfter: () => void,
  ...args: DomElementArg[]
) {
  return cssQuickSetupContinueRow(
    cssShadowedPrimaryButton(
      dom.text((use) => {
        if (use(section.isApplying)) { return t("Applying..."); }
        const override = section.customLabel?.(use);
        if (override) { return override; }
        return use(section.hasPendingChanges) ? t("Apply and Continue") : t("Continue");
      }),
      dom.boolAttr("disabled", use => !use(section.canProceed) || use(section.isApplying)),
      dom.on("click", async () => {
        if (section.isApplying.get()) { return; }
        try {
          await section.applyPendingChanges();
        } catch (err) {
          reportError(err as Error);
          return;
        }
        onAfter();
      }),
      ...args,
    ),
  );
}

const cssQuickSetupContinueRow = styled("div", `
  display: flex;
  justify-content: flex-end;
  margin-top: 24px;
`);
