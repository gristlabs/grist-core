import {theme, vars} from 'app/client/ui2018/cssVars';
import {icon as gristIcon} from 'app/client/ui2018/icons';
import {styled} from 'grainjs';

export const container = styled('div', `
  display: flex;
  justify-content: center;
  overflow: auto;
`);

export const accountPage = styled('div', `
  max-width: 600px;
  margin-top: auto;
  margin-bottom: auto;
  padding: 16px;
`);

export const content = styled('div', `
  flex: 1 1 300px;
`);

export const textBtn = styled('button', `
  font-size: ${vars.mediumFontSize};
  color: ${theme.controlFg};
  cursor: pointer;
  margin-left: 16px;
  background-color: transparent;
  border: none;
  padding: 0;
  text-align: left;
  min-width: 110px;

  &:hover {
    color: ${theme.controlHoverFg};
  }
`);

export const icon = styled(gristIcon, `
  background-color: ${theme.controlFg};
  margin: 0 4px 2px 0;

  .${textBtn.className}:hover > & {
    background-color: ${theme.controlHoverFg};
  }
`);

export const description = styled('div', `
  color: ${theme.lightText};
  font-size: 13px;
`);

export const flexGrow = styled('div', `
  flex-grow: 1;
`);

export const name = styled(flexGrow, `
  color: ${theme.text};
  word-break: break-word;
`);

export const email = styled('div', `
  color: ${theme.text};
  word-break: break-word;
`);

export const loginMethod = styled(flexGrow, `
  color: ${theme.text};
  word-break: break-word;
`);

export const warning = styled('div', `
  color: ${theme.errorText};
`);

export const header = styled('div', `
  height: 32px;
  line-height: 32px;
  margin: 28px 0 16px 0;
  color: ${theme.text};
  font-size: ${vars.xxxlargeFontSize};
  font-weight: ${vars.headerControlTextWeight};
`);

export const subHeader = styled('div', `
  color: ${theme.text};
  padding: 8px 0;
  vertical-align: top;
  font-weight: bold;
  display: block;
`);

export const inlineSubHeader = styled(subHeader, `
  display: inline-block;
  min-width: 110px;
`);

export const dataRow = styled('div', `
  margin: 8px 0px;
  display: flex;
  align-items: baseline;
  gap: 2px;
`);
