import { testId, theme } from 'app/client/ui2018/cssVars';
import { components } from 'app/common/ThemePrefs';
import { dom, DomElementArg, Observable, styled } from 'grainjs';

interface ToggleSwitchOptions {
  label?: string;
  /**
   * By default, the toggle switch internally uses a hidden input checkbox element,
   * that is checked/unchecked when the toggle switch is clicked and that updates
   * the passed value observable accordingly.
   *
   * If `false`, the toggle switch doesn't generate an input element and doesn't respond
   * to clicks or keyboard focuses. If you specifically need an interactive switch that doesn't
   * generate a hidden input, you can pass additional dom `args` to do what you want.
   */
  useHiddenInput?: boolean;
  enableTransitions?: Observable<boolean>;
  /**
   * grainjs dom args to apply on the wrapping element.
   */
  args?: DomElementArg[];
  /**
   * grainjs dom args to apply on the hidden input element.
   */
  inputArgs?: DomElementArg[];
  /**
   * grainjs dom args to apply on the label element.
   */
  labelArgs?: DomElementArg[];
}

/**
 * Renders a toggle switch with an optional label.
 *
 * @param value - An observable that can contain a boolean or null value that is linked to the toggle switch.
 *                When the observed value changes, the toggle switch UI updates.
 *                If not provided, the toggle renders in "toggled off" state and
 *                internally sets options.useHiddenInput to false.
 * @param options - see ToggleSwitchOptions
 */
export function toggleSwitch(value?: Observable<boolean|null>, options: ToggleSwitchOptions = {}) {
  const { label, useHiddenInput = true, args = [], inputArgs = [], labelArgs = [] } = options;

  const useInput = useHiddenInput && value;
  return cssToggleSwitch(
    useInput ?
      cssInput(
        { type: 'checkbox' },
        dom.prop('checked', value),
        dom.prop('value', use => use(value) ? '1' : '0'),
        dom.on('change', (_e, elem) => value.set(elem.checked)),
        ...inputArgs,
      ) :
      undefined,
    value ? dom.cls(`${cssToggleSwitch.className}--checked`, use => !!use(value)) : undefined,
    cssSwitch(
      cssSwitchSlider(testId('toggle-switch-slider')),
      cssSwitchCircle(testId('toggle-switch-circle')),
    ),
    label ? cssLabel(label, ...labelArgs) : null,
    dom.cls(`${cssToggleSwitch.className}--transitions`, options.enableTransitions ?? true),
    testId('toggle-switch'),
    ...args,
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

  .${cssToggleSwitch.className}--checked .${cssSwitch.className} > & {
    background-color: ${components.switchActiveSlider};
  }

  .${cssToggleSwitch.className}--checked .${cssSwitch.className} > &::after {
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

  .${cssToggleSwitch.className}--checked .${cssSwitch.className} > & {
    transform: translateX(12px);
    background-color: ${components.switchActivePill};
    height: 13px;
    width: 13px;
    box-shadow: none;
  }

  .${cssToggleSwitch.className}--checked .${cssSwitch.className} > &::after {
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
