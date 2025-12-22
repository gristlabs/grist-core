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

import { theme, vars } from 'app/client/ui2018/cssVars';
import { tbind } from 'app/common/tbind';
import { components, tokens } from 'app/common/ThemePrefs';
import { BindableValue, dom, DomElementArg, styled } from 'grainjs';

export const cssButton = styled('button', `
  /* Resets */
  position: relative;
  outline: none;
  border-style: none;
  line-height: normal;
  user-select: none;

  /* Vars */
  font-size:     ${vars.mediumFontSize};
  letter-spacing: -0.08px;
  padding: 4px 8px;

  background-color: transparent;
  color:            ${theme.controlFg};
  --icon-color:     ${theme.controlFg};

  border:        ${theme.controlBorder};
  border-radius: ${vars.controlBorderRadius};

  cursor: pointer;

  outline-offset: 2px;

  &-large {
    font-weight: 500;
    padding: 10px 24px;
    min-height: 40px;
  }

  &-primary {
    background-color: ${theme.controlPrimaryBg};
    color:            ${theme.controlPrimaryFg};
    --icon-color:     ${theme.controlPrimaryFg};
    border-color:     ${theme.controlPrimaryBg};
  }

  &:hover {
    color:        ${theme.controlHoverFg};
    --icon-color: ${theme.controlHoverFg};
    border-color: ${theme.controlHoverFg};
  }
  &-primary:hover {
    color:            ${theme.controlPrimaryFg};
    --icon-color:     ${theme.controlPrimaryFg};
    background-color: ${theme.controlPrimaryHoverBg};
    border-color: ${theme.controlPrimaryHoverBg};
  }
  &:disabled {
    cursor: not-allowed;
    color:        ${theme.controlDisabledFg};
    --icon-color: ${theme.controlDisabledFg};
    background-color: ${theme.controlDisabledBg};
    border-color: ${theme.controlDisabledBg};
  }
`);

interface IButtonProps {
  large?: BindableValue<boolean>;
  primary?: BindableValue<boolean>;
  link?: boolean;
}

/**
 * Helper to create a button or button-like link with requested properties.
 */
export function button(props: IButtonProps, ...domArgs: DomElementArg[]) {
  const elem = props.link ? cssButtonLink(dom.cls(cssButton.className)) : cssButton();
  return dom.update(elem,
    cssButton.cls('-large', props.large ?? false),
    cssButton.cls('-primary', props.primary ?? false),
    ...domArgs,
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

// Button that looks like a link (have no background and no border).
// On text button hover, allow theme to show a background and/or border.
// It's done with a pseudo-element to add some "padding" to the background without moving the content.
export const textButton = styled(cssButton, `
  position: relative;
  z-index: 1;
  border: none;
  padding: 0px;
  text-align: left;
  background-color: inherit !important;
  &:disabled, &[aria-disabled="true"] {
    color: ${theme.controlPrimaryBg};
    opacity: 0.4;
  }
  &:hover::after {
    z-index: -1;
    content: '';
    position: absolute;
    inset: -3px;
    left: -6px;
    right: -6px;
    border-radius: ${tokens.controlBorderRadius};
    background-color: ${components.textButtonHoverBg};
    border: 1px solid ${components.textButtonHoverBorder};
  }
  &-hover-bg-padding-none:hover::after {
    top: 0px;
    bottom: 0px;
  }
  &-hover-bg-padding-sm:hover::after {
    inset: -1px;
    left: -3px;
    right: -3px;
  }
  &:active::after {
    border-color: transparent;
    background-color: transparent;
  }
`);

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
