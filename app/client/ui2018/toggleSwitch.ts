import {testId, theme} from 'app/client/ui2018/cssVars';
import {components} from 'app/common/ThemePrefs';
import {dom, DomElementArg, Observable, styled} from 'grainjs';

interface ToggleSwitchOptions {
  label?: string;
  enableTransitions?: Observable<boolean>;
  args?: DomElementArg[];
  inputArgs?: DomElementArg[];
  labelArgs?: DomElementArg[];
}

export function toggleSwitch(value?: Observable<boolean|null>, options: ToggleSwitchOptions = {}) {
  const {label, args = [], inputArgs = [], labelArgs = []} = options;

  return cssToggleSwitch(
    value
    ? cssInput(
        {type: 'checkbox'},
        dom.prop('checked', value),
        dom.prop('value', use => use(value) ? '1' : '0'),
        dom.on('change', (_e, elem) => value.set(elem.checked)),
        ...inputArgs,
      )
    : cssInput({type: 'checkbox'}, ...inputArgs),
    cssSwitch(
      cssSwitchSlider(testId('toggle-switch-slider')),
      cssSwitchCircle(),
    ),
    !label ? null : cssLabel(
      label,
      ...labelArgs,
    ),
    dom.cls(`${cssToggleSwitch.className}--transitions`, options.enableTransitions || true),
    ...args,
    testId('toggle-switch'),
  );
}

const cssToggleSwitch = styled('label', `
  position: relative;
  display: flex;
  width: fit-content;
  cursor: pointer;
`);

const cssInput = styled('input', `
  position: absolute;
  height: 1px;
  width: 1px;
  top: 1px;
  left: 4px;
  margin: 0;
  opacity: 0;

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
  flex: none;
  margin: 0 auto;
  border-radius: 13px;

  &:hover {
    box-shadow: 0 0 2px ${components.switchHoverShadow};
  }
`);

const cssSwitchSlider = styled('div', `
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: ${components.switchInactiveSlider};
  border-radius: 13px;

  .${cssToggleSwitch.className}--transitions & {
    transition: background-color .4s;
  }

  /* border for inactive sliders, implemented like this to mitigate
  pixel-perfect positioning issues between slider and circle */
  &::after {
    content: "";
    position: absolute;
    inset: 0;
    box-shadow: inset 0 0 0 1px ${components.switchInactivePill};
    border-radius: 13px;
  }

  .${cssInput.className}:focus-visible + .${cssSwitch.className} > & {
    outline: 2px solid ${components.kbFocusHighlight};
    outline-offset: 1px;
  }

  .${cssInput.className}:checked + .${cssSwitch.className} > & {
    background-color: ${components.switchActiveSlider};
  }

  .${cssInput.className}:checked + .${cssSwitch.className} > &::after {
    box-shadow: none;
  }
`);

const cssSwitchCircle = styled('div', `
  position: absolute;
  z-index: 1;
  cursor: pointer;
  content: "";
  height: 11px;
  width: 11px;
  left: 3.5px;
  top: 0;
  bottom: 0;
  margin-top: auto;
  margin-bottom: auto;
  background-color: ${components.switchInactivePill};
  border-radius: 100%;

  .${cssToggleSwitch.className}--transitions & {
    transition: transform .4s;
  }

  .${cssInput.className}:checked + .${cssSwitch.className} > & {
    transform: translateX(12px);
    background-color: ${components.switchActivePill};
    height: 13px;
    width: 13px;
    box-shadow: none;
  }

  .${cssInput.className}:checked + .${cssSwitch.className} > &::after {
    position: absolute;
    z-index: 2;
    content: "";
    background-color: ${components.switchActiveSlider};
    mask-image: var(--icon-TickSwitch);
    mask-size: 10px;
    mask-repeat: no-repeat;
    mask-position: 1px center;
    inset: 0;
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
