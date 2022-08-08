import {colors, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {styled} from 'grainjs';

export const cssIcon = styled(icon, `
  flex: 0 0 auto;
  --icon-color: ${colors.slate};
`);

export const cssLabel = styled('div', `
  text-transform: uppercase;
  margin: 16px 16px 12px 16px;
  font-size: ${vars.xsmallFontSize};
`);

export const cssRow = styled('div', `
  display: flex;
  margin: 8px 16px;
  align-items: center;
  &-top-space {
    margin-top: 24px;
  }
  &-disabled {
    color: ${colors.slate};
  }
`);

export const cssBlockedCursor = styled('span', `
  &, & * {
    cursor: not-allowed !important;
  }
`);

export const cssButtonRow = styled(cssRow, `
  margin-left: 0;
  margin-right: 0;
  & > button {
    margin-left: 16px;
  }
`);

export const cssSeparator = styled('div', `
  border-bottom: 1px solid ${colors.mediumGrey};
  margin-top: 16px;
`);
