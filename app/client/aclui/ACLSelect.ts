import {theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {IOption, select} from 'app/client/ui2018/menus';
import {MaybeObsArray, Observable, styled} from 'grainjs';
import * as weasel from 'popweasel';

/**
 * A styled version of select() from ui2018/menus, for use in the AccessRules page.
 */
export function aclSelect<T>(obs: Observable<T>, optionArray: MaybeObsArray<IOption<T>>,
                             options: weasel.ISelectUserOptions = {}) {
  return cssSelect(obs, optionArray, {buttonArrow: cssSelectArrow('Collapse'), ...options});
}

export const cssSelect = styled(select, `
  height: 28px;
  width: 100%;
  border: 1px solid transparent;
  cursor: pointer;

  &:hover, &:focus, &.weasel-popup-open, &-active {
    border: 1px solid ${theme.selectButtonBorder};
    box-shadow: none;
  }
`);

const cssSelectCls = cssSelect.className;

const cssSelectArrow = styled(icon, `
  margin: 0 2px;
  pointer-events: none;
  display: none;

  .${cssSelectCls}:hover &, .${cssSelectCls}:focus &, .weasel-popup-open &, .${cssSelectCls}-active & {
    display: flex;
  }
`);
