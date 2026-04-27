/**
 * Shared header for QuickSetup steps: an optional icon, a title, and a
 * description. Each step uses this to keep type, spacing, and tone
 * consistent across the wizard.
 */
import { cardSurfaceShadow, cssCardSurface } from "app/client/ui/SettingsLayout";
import { bigPrimaryButton } from "app/client/ui2018/buttons";
import { theme, vars } from "app/client/ui2018/cssVars";
import { IconName } from "app/client/ui2018/IconList";
import { icon } from "app/client/ui2018/icons";

import { dom, DomContents, styled } from "grainjs";

export interface QuickSetupStepHeaderOptions {
  /** Optional icon shown before the title. */
  icon?: IconName;
  /** Step title (already translated by the caller). */
  title: string;
  /** Short description shown below the title (already translated). */
  description: string;
}

export function quickSetupStepHeader(opts: QuickSetupStepHeaderOptions): DomContents {
  return [
    cssQuickSetupStepTitle(
      opts.icon ? cssQuickSetupStepIcon(icon(opts.icon)) : null,
      dom("span", opts.title),
    ),
    cssQuickSetupStepDescription(opts.description),
  ];
}

const cssQuickSetupStepTitle = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 4px;
`);

const cssQuickSetupStepIcon = styled("div", `
  display: flex;
  --icon-color: ${theme.controlPrimaryBg};
`);

const cssQuickSetupStepDescription = styled("div", `
  font-size: ${vars.mediumFontSize};
  color: ${theme.lightText};
  line-height: 1.5;
  margin-bottom: 20px;
`);

/**
 * Bordered card used to wrap a sub-section of a QuickSetup step
 * (e.g. Base URL or Edition inside the Server step, the toggle list
 * inside the Apply & Restart step). Inherits the shared bordered look
 * (border, radius, drop shadow, solid background) from
 * {@link cssCardSurface} so it tracks the admin panel's outer cards.
 */
export const cssQuickSetupCard = styled(cssCardSurface, `
  padding: 16px 20px;
  margin-bottom: 16px;

  &:last-child {
    margin-bottom: 0;
  }
`);

/**
 * Big primary button with the shared card-surface drop shadow, so
 * "Continue" / "Apply and Continue" / "Go Live" all sit at the same
 * visual depth as the bordered cards on the page. The shadow drops
 * when the button is disabled.
 */
export const cssShadowedPrimaryButton = styled(bigPrimaryButton, `
  box-shadow: ${cardSurfaceShadow};
  &:disabled, &[disabled] {
    box-shadow: none;
  }
`);
