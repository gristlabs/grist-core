import {theme, vars} from 'app/client/ui2018/cssVars';
import {styled} from 'grainjs';

export const cssUserInfo = styled('div', `
  padding: 12px 24px 12px 16px;
  min-width: 200px;
  display: flex;
  align-items: center;
`);

export const cssUserName = styled('div', `
  margin-left: 8px;
  font-size: ${vars.mediumFontSize};
  font-weight: ${vars.headerControlTextWeight};
  color: ${theme.text};
`);

export const cssEmail = styled('div', `
  margin-top: 4px;
  font-size: ${vars.smallFontSize};
  font-weight: initial;
  color: ${theme.lightText};
`);
