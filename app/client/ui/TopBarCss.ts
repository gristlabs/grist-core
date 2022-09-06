import {theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {styled} from 'grainjs';

export const cssHoverCircle = styled('div', `
  width: 32px;
  height: 32px;
  background: none;
  border-radius: 16px;

  &:hover, &.weasel-popup-open {
    background-color: ${theme.hover};
  }

  &-disabled:hover {
    background: none;
  }
`);

export const cssTopBarBtn = styled(icon, `
  width: 32px;
  height: 32px;
  padding: 8px 8px;
  cursor: pointer;
  -webkit-mask-size: 16px 16px;
  background-color: ${theme.topBarButtonPrimaryFg};

  .${cssHoverCircle.className}-disabled & {
    background-color: ${theme.topBarButtonDisabledFg};
    cursor: default;
  }
  &-slate { background-color: ${theme.topBarButtonSecondaryFg}; }
  &-error { background-color: ${theme.topBarButtonErrorFg}; }
`);
