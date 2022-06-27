import {colors, vars} from 'app/client/ui2018/cssVars';
import {styled} from 'grainjs';

export const cssInput = styled('input', `
  height: 30px;
  width: 100%;
  font-size: ${vars.mediumFontSize};
  border-radius: 3px;
  padding: 5px;
  border: 1px solid ${colors.darkGrey};
  outline: none;
`);
