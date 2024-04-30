import {theme} from 'app/client/ui2018/cssVars';
import {styled} from 'grainjs';

export const cssRadioInput = styled('input', `
  appearance: none;
  width: 16px;
  height: 16px;
  margin: 0px !important;
  border-radius: 50%;
  background-clip: content-box;
  border: 1px solid ${theme.checkboxBorder};
  background-color: ${theme.checkboxBg};
  flex-shrink: 0;
  &:hover {
    border: 1px solid ${theme.checkboxBorderHover};
  }
  &:disabled {
    background-color: 1px solid ${theme.checkboxDisabledBg};
  }
  &:checked {
    padding: 2px;
    background-color: ${theme.controlPrimaryBg};
    border: 1px solid ${theme.controlPrimaryBg};
  }
`);
