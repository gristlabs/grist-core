/**
 * UI 2018 Buttons
 *
 * Four styles are include: basicButton, primaryButton, bigBasicButton, bigPrimaryButton.
 *
 * Buttons support passing in DomElementArgs, which can be used to register click handlers, set
 * the disabled property, and other HTML <button> element behaviors.
 *
 * Examples:
 *
 * `basicButton('Basic button', dom.on('click', () => alert('Basic button')))`
 * `primaryButton('Primary button', dom.prop('disabled', true))`
 */

import { colors, vars } from 'app/client/ui2018/cssVars';
import { tbind } from 'app/common/tbind';
import { dom, DomElementArg, styled } from 'grainjs';

export const cssButton = styled('button', `
  /* Resets */
  position: relative;
  outline: none;
  border-style: none;
  line-height: normal;

  /* Vars */
  font-size:     ${vars.mediumFontSize};
  letter-spacing: -0.08px;
  padding: 4px 8px;

  background-color: transparent;
  color:            ${vars.controlFg};
  --icon-color:     ${vars.controlFg};

  border:        ${vars.controlBorder};
  border-radius: ${vars.controlBorderRadius};

  cursor: pointer;

  &-large {
    font-weight: 500;
    padding: 12px 24px;
  }

  &-primary {
    background-color: ${vars.primaryBg};
    color:            ${vars.primaryFg};
    --icon-color:     ${vars.primaryFg};
    border-color:     ${vars.primaryBg};
  }

  &:hover {
    color:        ${vars.controlFgHover};
    --icon-color: ${vars.controlFgHover};
    border-color: ${vars.controlFgHover};
  }
  &-primary:hover {
    color:            ${vars.primaryFg};
    --icon-color:     ${vars.primaryFg};
    background-color: ${vars.primaryBgHover};
    border-color: ${vars.primaryBgHover};
  }
  &:disabled {
    cursor: not-allowed;
    color:        ${colors.light};
    --icon-color: ${colors.light};
    background-color: ${colors.slate};
    border-color: ${colors.slate};
  }

`);

interface IButtonProps {
  large?: boolean;
  primary?: boolean;
  link?: boolean;
}

/**
 * Helper to create a button or button-like link with requested properties.
 */
function button(props: IButtonProps, ...domArgs: DomElementArg[]) {
  const elem = props.link ? cssButtonLink(dom.cls(cssButton.className)) : cssButton();
  return dom.update(elem,
    cssButton.cls('-large', Boolean(props.large)),
    cssButton.cls('-primary', Boolean(props.primary)),
    ...domArgs
  );
}

// Button-creating functions, each taking ...DomElementArg arguments.
export const basicButton = tbind(button, null, {});
export const bigBasicButton = tbind(button, null, {large: true});
export const primaryButton = tbind(button, null, {primary: true});
export const bigPrimaryButton = tbind(button, null, {large: true, primary: true});

// Functions that create button-like <a> links, each taking ...DomElementArg arguments.
export const basicButtonLink = tbind(button, null, {link: true});
export const bigBasicButtonLink = tbind(button, null, {link: true, large: true});
export const primaryButtonLink = tbind(button, null, {link: true, primary: true});
export const bigPrimaryButtonLink = tbind(button, null, {link: true, large: true, primary: true});

const cssButtonLink = styled('a', `
  display: inline-block;
  &, &:hover, &:focus {
    text-decoration: none;
  }
`);

export const cssButtonGroup = styled('div', `
  display: flex;
  flex-direction: row;

  & > .${cssButton.className} {
    border-radius: 0;
  }

  & > .${cssButton.className}:first-child {
    border-top-left-radius: ${vars.controlBorderRadius};
    border-bottom-left-radius: ${vars.controlBorderRadius};
  }

  & > .${cssButton.className}:last-child {
    border-top-right-radius: ${vars.controlBorderRadius};
    border-bottom-right-radius: ${vars.controlBorderRadius};
  }
`);
