/**
 * Shared header for QuickSetup steps: an optional icon, a title, and a
 * description. Each step uses this to keep type, spacing, and tone
 * consistent across the wizard.
 */
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
