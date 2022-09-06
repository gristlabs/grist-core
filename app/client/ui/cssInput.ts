import {theme, vars} from 'app/client/ui2018/cssVars';
import {styled} from 'grainjs';

export const cssInput = styled('input', `
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};
  height: 30px;
  width: 100%;
  font-size: ${vars.mediumFontSize};
  border-radius: 3px;
  padding: 5px;
  border: 1px solid ${theme.inputBorder};
  outline: none;

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
`);
