import { textarea } from "app/client/ui/inputs";
import { cssSettingsPage } from "app/client/ui/SettingsLayout";
import { theme, vars } from "app/client/ui2018/cssVars";
import { toggleSwitch } from "app/client/ui2018/toggleSwitch";
import { components, tokens } from "app/common/ThemePrefs";

import { dom, IDisposableOwner, keyframes, Observable, styled } from "grainjs";

export interface AdminPanelControls {
  needsRestart: Observable<boolean>;
  restartGrist: () => Promise<void>;
}

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
