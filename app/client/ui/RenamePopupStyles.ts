import { theme, vars } from 'app/client/ui2018/cssVars';
import {textarea} from 'app/client/ui/inputs';
import {cssTextInput} from 'app/client/ui2018/editableLabel';
import {IInputOptions, input, Observable, styled} from 'grainjs';


export const cssRenamePopup = styled('div', `
  display: flex;
  flex-direction: column;
  min-width: 280px;
  padding: 16px;
  background-color: ${theme.popupBg};
  border-radius: 2px;
  outline: none;
`);

export const cssLabel = styled('label', `
  color: ${theme.text};
  font-size: ${vars.xsmallFontSize};
  font-weight: ${vars.bigControlTextWeight};
  text-transform: uppercase;
  margin: 0 0 8px 0;
  &:not(:first-child) {
    margin-top: 16px;
  }
`);

const cssInputWithIcon = styled('div', `
  position: relative;
  display: flex;
  flex-direction: column;
`);

export const cssInput = styled((
  obs: Observable<string>,
  opts: IInputOptions,
  ...args) => input(obs, opts, cssTextInput.cls(''), ...args), `
  text-overflow: ellipsis;
  color: ${theme.inputFg};
  background-color: transparent;
  &:disabled {
    color: ${theme.inputDisabledFg};
    background-color: ${theme.inputDisabledBg};
    pointer-events: none;
  }
  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
  .${cssInputWithIcon.className} > &:disabled {
    padding-right: 28px;
  }
`);

export const cssTextArea = styled(textarea, `
  color: ${theme.inputFg};
  background-color: ${theme.mainPanelBg};
  border: 1px solid ${theme.inputBorder};
  width: 100%;
  padding: 3px 6px;
  outline: none;
  max-width: 100%;
  min-width: calc(280px - 16px*2);
  max-height: 500px;
  min-height: calc(3em * 1.5);
  resize: none;
  border-radius: 3px;
  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }

  &[readonly] {
    background-color: ${theme.inputDisabledBg};
    color: ${theme.inputDisabledFg};
  }
`);
