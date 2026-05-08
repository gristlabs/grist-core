import { makeT } from "app/client/lib/localization";
import { textarea } from "app/client/ui/inputs";
import { cssSettingsPage } from "app/client/ui/SettingsLayout";
import { textButton } from "app/client/ui2018/buttons";
import { testId, theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { toggleSwitch } from "app/client/ui2018/toggleSwitch";
import { components, tokens } from "app/common/ThemePrefs";

import { dom, IDisposableOwner, keyframes, Observable, styled } from "grainjs";

export function HidableToggle(
  owner: IDisposableOwner,
  value: Observable<boolean | null>,
  options: { labelId?: string } = {},
) {
  return toggleSwitch(value, {
    args: [dom.hide(use => use(value) === null)],
    inputArgs: [options.labelId ? { "aria-labelledby": options.labelId } : undefined],
  });
}

export const cssPageContainer = styled(cssSettingsPage, `
  &-admin-pages {
    padding: 12px;
    font-size: ${vars.mediumFontSize};
    font-weight: ${vars.headerControlTextWeight};
  }
`);

/** Green text for positive/success status values. */
export const cssHappyText = styled("span", `
  color: ${theme.controlFg};
`);

/** Red text for error status values. */
export const cssErrorText = styled("span", `
  color: ${theme.errorText};
`);

/** Orange/amber text for warning/danger status values. */
export const cssDangerText = styled("div", `
  color: ${theme.dangerText};
`);

export const cssTextArea = styled(textarea, `
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};
  border: 1px solid ${theme.inputBorder};
  width: 100%;
  padding: 8px 12px;
  outline: none;
  resize: none;
  border-radius: 3px;

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
`);

export const cssWell = styled("div", `
  color: ${theme.text};
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border-radius: 10px;
  width: 100%;

  &-warning {
    border: 1px solid ${tokens.warningLight};
    --icon-color: ${tokens.warningLight};
  }

  &-error {
    border: 1px solid ${components.errorText};
    --icon-color: ${components.errorText};
  }
`);

export const cssIconWrapper = styled("div", `
  font-size: 13px;
  flex-shrink: 0;
  margin-top: 2px;
`);

export const cssWellTitle = styled("div", `
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
  margin-bottom: 8px;
`);

export const cssWellContent = styled("div", `
  font-size: ${vars.mediumFontSize};
  line-height: 1.4;
  & > p {
    margin: 0px;
  }
  & > p + p {
    margin-top: 8px;
  }
`);

export const cssFlexSpace = styled("div", `
  flex: 1 1 0;
`);

export const cssFadeUp = keyframes(`
  from {
    opacity: 0;
    transform: translateY(12px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
`);

export const cssFadeUpGristLogo = styled("div", `
  animation: ${cssFadeUp} 0.5s ease both;
  background-image: var(--icon-GristLogo);
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  height: 48px;
`);

export const cssFadeUpHeading = styled("div", `
  animation: ${cssFadeUp} 0.5s ease 0.08s both;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.5px;
  margin: 16px 0px 8px 0px;
  text-align: center;
`);

export const cssFadeUpSubHeading = styled("div", `
  animation: ${cssFadeUp} 0.5s ease 0.16s both;
  color: ${tokens.secondary};
  font-size: 15px;
  line-height: 1.5;
  margin-bottom: 24px;
  text-align: center;
`);

// --- Shared styles for section components (BaseUrlSection, EditionSection, etc.) ---

/** Flex column container for section content. */
export const cssSectionContainer = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 8px;
`);

/** Subdued description text within a section. */
export const cssSectionDescription = styled("div", `
  color: ${theme.lightText};
  font-size: ${vars.mediumFontSize};
  line-height: 1.5;
  margin-bottom: 4px;
`);

/** Inline status text for collapsed section display. */
export const cssSectionStatusText = styled("span", `
  display: inline-flex;
  align-items: center;
  gap: 4px;
`);

/** Inline row of small buttons (confirm, skip, etc.). */
export const cssSectionButtonRow = styled("div", `
  display: flex;
  gap: 8px;
  align-items: center;
`);

const cssSectionConfirmedRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
`);

const cssSectionConfirmedPill = styled("span", `
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: ${theme.controlPrimaryBg};
  font-size: ${vars.smallFontSize};
`);

const cssSectionSkippedPill = styled("span", `
  color: ${theme.controlPrimaryBg};
  font-size: ${vars.smallFontSize};
`);

/**
 * Builds the confirmed/skipped status row with a pencil-edit button.
 * Shared by all wizard section components.
 *
 * @param confirmed - observable controlling visibility of the whole row
 * @param onEdit - callback when the pencil is clicked (should reset confirmed)
 * @param options.skipped - if set and true, renders the skipped pill instead
 *   of the "Confirmed" pill
 * @param options.skippedLabel - text for the skipped pill (default: "For later")
 * @param options.testPrefix - prefix for test IDs
 */
export function buildConfirmedRow(
  confirmed: Observable<boolean>,
  onEdit: () => void,
  options: { skipped?: Observable<boolean>; skippedLabel?: string; testPrefix?: string } = {},
) {
  const tid = options.testPrefix ? (id: string) => testId(`${options.testPrefix}-${id}`) : testId;
  return dom.domComputed((use) => {
    if (!use(confirmed)) { return null; }
    const isSkipped = options.skipped ? use(options.skipped) : false;
    return cssSectionConfirmedRow(
      isSkipped ?
        cssSectionSkippedPill(options.skippedLabel || t("For later")) :
        cssSectionConfirmedPill(t("Confirmed")),
      textButton(
        icon("Pencil"),
        dom.on("click", onEdit),
        tid("edit"),
      ),
      tid("confirmed-row"),
    );
  });
}

const t = makeT("AdminPanelCss");
