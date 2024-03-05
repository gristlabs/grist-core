import {colors, vars} from 'app/client/ui2018/cssVars';
import {styled} from 'grainjs';

export const label = styled('div', `
  &-required::after {
    content: "*";
    color: ${vars.primaryBg};
    margin-left: 4px;
  }
`);

export const paragraph = styled('div', `
  &-alignment-left {
    text-align: left;
  }
  &-alignment-center {
    text-align: center;
  }
  &-alignment-right {
    text-align: right;
  }
`);

export const section = styled('div', `
  border-radius: 3px;
  border: 1px solid ${colors.darkGrey};
  padding: 24px;
  margin-top: 24px;

  & > div + div {
    margin-top: 16px;
  }
`);

export const columns = styled('div', `
  display: grid;
  grid-template-columns: repeat(var(--grist-columns-count), 1fr);
  gap: 4px;
`);

export const submit = styled('div', `
  display: flex;
  justify-content: center;
  align-items: center;

  & input[type="submit"] {
    background-color: ${vars.primaryBg};
    border: 1px solid ${vars.primaryBg};
    color: white;
    padding: 10px 24px;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
    line-height: inherit;
  }
  & input[type="submit"]:hover {
    border-color: ${vars.primaryBgHover};
    background-color: ${vars.primaryBgHover};
  }
`);

// TODO: break up into multiple variables, one for each field type.
export const field = styled('div', `
  display: flex;
  flex-direction: column;

  & input[type="text"],
  & input[type="date"],
  & input[type="datetime-local"],
  & input[type="number"] {
    height: 27px;
    padding: 4px 8px;
    border: 1px solid ${colors.darkGrey};
    border-radius: 3px;
    outline: none;
  }
  & input[type="text"] {
    font-size: 13px;
    outline-color: ${vars.primaryBg};
    outline-width: 1px;
    line-height: inherit;
    width: 100%;
    color: ${colors.dark};
    background-color: ${colors.light};
  }
  & input[type="datetime-local"],
  & input[type="date"] {
    width: 100%;
    line-height: inherit;
  }
  & input[type="checkbox"] {
    -webkit-appearance: none;
    -moz-appearance: none;
    padding: 0;
    flex-shrink: 0;
    display: inline-block;
    width: 16px;
    height: 16px;
    --radius: 3px;
    position: relative;
    margin-right: 8px;
    vertical-align: baseline;
  }
  & input[type="checkbox"]:checked:enabled,
  & input[type="checkbox"]:indeterminate:enabled {
    --color: ${vars.primaryBg};
  }
  & input[type="checkbox"]:disabled {
    --color: ${colors.darkGrey};
    cursor: not-allowed;
  }
  & input[type="checkbox"]::before,
  & input[type="checkbox"]::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    height: 16px;
    width: 16px;
    box-sizing: border-box;
    border: 1px solid var(--color, ${colors.darkGrey});
    border-radius: var(--radius);
  }
  & input[type="checkbox"]:checked::before,
  & input[type="checkbox"]:disabled::before,
  & input[type="checkbox"]:indeterminate::before {
    background-color: var(--color);
  }
  & input[type="checkbox"]:not(:checked):indeterminate::after {
    -webkit-mask-image: var(--icon-Minus);
  }
  & input[type="checkbox"]:not(:disabled)::after {
    background-color: ${colors.light};
  }
  & input[type="checkbox"]:checked::after,
  & input[type="checkbox"]:indeterminate::after {
    content: '';
    position: absolute;
    height: 16px;
    width: 16px;
    -webkit-mask-image: var(--icon-Tick);
    -webkit-mask-size: contain;
    -webkit-mask-position: center;
    -webkit-mask-repeat: no-repeat;
    background-color: ${colors.light};
  }
  & > .${label.className} {
    color: ${colors.dark};
    font-size: 13px;
    font-style: normal;
    font-weight: 700;
    line-height: 16px; /* 145.455% */
    margin-top: 8px;
    margin-bottom: 8px;
    display: block;
  }
`);

export const error = styled('div', `
  text-align: center;
  color: ${colors.error};
  min-height: 22px;
`);

export const toggle = styled('label', `
  position: relative;
  cursor: pointer;
  display: inline-flex;
  align-items: center;

  & input[type='checkbox'] {
    position: absolute;
  }
  & > span {
    margin-left: 8px;
  }
`);

export const gristSwitchSlider = styled('div', `
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  border-radius: 17px;
  -webkit-transition: .4s;
  transition: .4s;

  &:hover {
    box-shadow: 0 0 1px #2196F3;
  }
`);

export const gristSwitchCircle = styled('div', `
  position: absolute;
  cursor: pointer;
  content: "";
  height: 13px;
  width: 13px;
  left: 2px;
  bottom: 2px;
  background-color: white;
  border-radius: 17px;
  -webkit-transition: .4s;
  transition: .4s;
`);

export const gristSwitch = styled('div', `
  position: relative;
  width: 30px;
  height: 17px;
  display: inline-block;
  flex: none;

  input:checked + & > .${gristSwitchSlider.className} {
    background-color: ${vars.primaryBg};
  }

  input:checked + & > .${gristSwitchCircle.className} {
    -webkit-transform: translateX(13px);
    -ms-transform: translateX(13px);
    transform: translateX(13px);
  }
`);

export const checkboxList = styled('div', `
  display: flex;
  flex-direction: column;
  gap: 4px;
`);

export const checkbox = styled('label', `
  display: flex;

  &:hover {
    --color: ${colors.hover};
  }
`);

export const select = styled('select', `
  padding: 4px 8px;
  border-radius: 3px;
  border: 1px solid ${colors.darkGrey};
  font-size: 13px;
  outline-color: ${vars.primaryBg};
  outline-width: 1px;
  background: white;
  line-height: inherit;
  height: 27px;
  flex: auto;
  width: 100%;
`);
