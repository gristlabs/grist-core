import {theme} from 'app/client/ui2018/cssVars';
import {dom, DomElementArg, Observable, styled} from 'grainjs';

interface ToggleSwitchOptions {
  label?: string;
  args?: DomElementArg[];
  inputArgs?: DomElementArg[];
  labelArgs?: DomElementArg[];
}

export function toggleSwitch(value: Observable<boolean>, options: ToggleSwitchOptions = {}) {
  const {label, args = [], inputArgs = [], labelArgs = []} = options;

  return cssToggleSwitch(
    cssInput(
      {type: 'checkbox'},
      dom.prop('checked', value),
      dom.prop('value', use => use(value) ? '1' : '0'),
      dom.on('change', (_e, elem) => value.set(elem.checked)),
      ...inputArgs,
    ),
    cssSwitch(
      cssSwitchSlider(),
      cssSwitchCircle(),
    ),
    !label ? null : cssLabel(
      label,
      ...labelArgs,
    ),
    ...args,
  );
}

const cssToggleSwitch = styled('label', `
  position: relative;
  display: inline-flex;
  margin-top: 8px;
  cursor: pointer;
`);

const cssInput = styled('input', `
  position: absolute;
  height: 1px;
  width: 1px;
  top: 1px;
  left: 4px;
  margin: 0;

  &::before, &::after {
    height: 1px;
    width: 1px;
  }
  &:focus {
    outline: none;
  }
`);

const cssSwitch = styled('div', `
  position: relative;
  width: 30px;
  height: 17px;
  display: inline-block;
  flex: none;
`);

const cssSwitchSlider = styled('div', `
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: ${theme.switchSliderFg};
  border-radius: 17px;
  -webkit-transition: background-color .4s;
  transition: background-color .4s;

  .${cssInput.className}:focus + .${cssSwitch.className} > & {
    outline: 2px solid ${theme.controlPrimaryHoverBg};
    outline-offset: 1px;
  }

  .${cssInput.className}:checked + .${cssSwitch.className} > & {
    background-color: ${theme.controlPrimaryBg};
  }
`);

const cssSwitchCircle = styled('div', `
  position: absolute;
  cursor: pointer;
  content: "";
  height: 13px;
  width: 13px;
  left: 2px;
  bottom: 2px;
  background-color: ${theme.switchCircleFg};
  border-radius: 17px;
  -webkit-transition: transform .4s;
  transition: transform .4s;

  .${cssInput.className}:checked + .${cssSwitch.className} > & {
     -webkit-transform: translateX(13px);
    -ms-transform: translateX(13px);
    transform: translateX(13px);
  }
`);

const cssLabel = styled('span', `
  color: ${theme.text};
  margin-left: 8px;
  font-size: 13px;
  font-weight: 400;
  line-height: 16px;
  overflow-wrap: anywhere;
`);
