import {sanitizeHTML} from 'app/client/ui/sanitizeHTML';
import {basicButton} from 'app/client/ui2018/buttons';
import {colors, theme, vars} from 'app/client/ui2018/cssVars';
import {BindableValue, dom, IDomArgs, styled, subscribeBindable} from 'grainjs';
import {marked} from 'marked';

export {
  cssLabel,
  cssDesc,
  cssInput,
  cssFieldEditor,
  cssSelectedOverlay,
  cssControls,
  cssControlsLabel,
  cssAddElement,
  cssAddText,
  cssFormContainer,
  cssFormEdit,
  cssFormEditBody,
  cssSection,
  cssStaticText,
};

const cssFormEditBody = styled('div', `
  width: 100%;
  overflow: auto;
  padding-top: 52px;
`);

const cssFormEdit = styled('div', `
  color: ${theme.text};
  background-color: ${theme.leftPanelBg};
  display: flex;
  flex-direction: column;
  flex-basis: 0px;
  align-items: center;
  justify-content: space-between;
  position: relative;

  --section-background: #739bc31f; /* On white background this is almost #f1f5f9 (slate-100 on tailwind palette)  */
  &, &-preview {
    background-color: ${theme.leftPanelBg};
    overflow: auto;
    min-height: 100%;
    width: 100%;
    position: relative;
    flex-basis: 0px;
  }
`);

const cssLabel = styled('label', `
  font-size: 15px;
  font-weight: normal;
  margin-bottom: 8px;
  user-select: none;
  display: block;
`);

const cssDesc = styled('div', `
  font-size: 10px;
  font-weight: 400;
  margin-top: 4px;
  color: ${colors.slate};
  white-space: pre-wrap;
`);

const cssInput = styled('input', `
  flex: auto;
  width: 100%;
  font-size: inherit;
  padding: 4px 8px;
  border: 1px solid #D9D9D9;
  border-radius: 3px;
  outline: none;
  cursor-events: none;

  &-invalid {
    color: red;
  }
`);

export const cssSelect = styled('select', `
  flex: auto;
  width: 100%;
  font-size: inherit;
  padding: 4px 8px;
  border: 1px solid #D9D9D9;
  border-radius: 3px;
  outline: none;
  cursor-events: none;

  &-invalid {
    color: red;
  }
`);

const cssFieldEditor = styled('div._cssFieldEditor', `
  position: relative;
  cursor: pointer;
  user-select: none;
  outline: none;
  &:hover:not(:has(&:hover)), &-selected {
    outline: 1px solid ${colors.lightGreen};
  }
  &:active:not(:has(&:active)) {
    outline: 1px solid ${colors.darkGreen};
  }
  &-drag-hover {
    outline: 2px dashed ${colors.lightGreen};
    outline-offset: 2px;
  }
  &-cut {
    outline: 2px dashed ${colors.orange};
    outline-offset: 2px;
  }

  .${cssFormEdit.className}-preview & {
    outline: 0px !import;
  }
`);

const cssSelectedOverlay = styled('div', `
  background: ${colors.selection};
  inset: 0;
  position: absolute;
  opacity: 0;
  outline: none;
  .${cssFieldEditor.className}-selected > & {
    opacity: 1;
  }

  .${cssFormEdit.className}-preview & {
    display: none;
  }
`);

const cssControls = styled('div', `
  display: none;
  position: absolute;
  margin-top: -18px;
  margin-left: -1px;
  .${cssFieldEditor.className}:hover:not(:has(.${cssFieldEditor.className}:hover)) > &,
  .${cssFieldEditor.className}:active:not(:has(.${cssFieldEditor.className}:active)) > &,
  .${cssFieldEditor.className}-selected > & {
    display: flex;
  }

  .${cssFormEdit.className}-preview & {
    display: none !important;
  }
`);

const cssControlsLabel = styled('div', `
  background: ${colors.lightGreen};
  color: ${colors.light};
  padding: 1px 2px;
  min-width: 24px;
`);

const cssAddElement = styled('div', `
  position: relative;
  min-height: 32px;
  cursor: pointer;
  display: flex;
  justify-content: center;
  align-items: center;
  padding-right: 8px;
  --icon-color: ${colors.lightGreen};
  align-self: stretch;
  border: 2px dashed ${colors.darkGrey};
  background: ${colors.lightGrey};
  opacity: 0.7;
  &:hover {
    border: 2px dashed ${colors.darkGrey};
    background: ${colors.lightGrey};
    opacity: 1;
  }
  &-hover {
    outline: 2px dashed ${colors.lightGreen};
    outline-offset: 2px;
  }
`);

const cssAddText = styled('div', `
  color: ${colors.slate};
  border-radius: 4px;
  padding: 2px 4px;
  font-size: 12px;
  z-index: 1;
  &:before {
    content: "Add a field";
  }
  .${cssAddElement.className}-hover &:before {
    content: "Drop here";
  }
`);

const cssSection = styled('div', `
  position: relative;
  background-color: var(--section-background);
  color: ${theme.text};
  align-self: center;
  margin: 0px auto;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  min-height: 50px;
  padding: 10px;
  .${cssFormEdit.className}-preview & {
    background: transparent;
    border-radius: unset;
    padding: 0px;
    min-height: auto;
  }
`);

export const cssColumns = styled('div', `
  --css-columns-count: 2;
  background-color: var(--section-background);
  display: grid;
  grid-template-columns: repeat(var(--css-columns-count), 1fr) 32px;
  gap: 8px;
  padding: 12px 4px;

  .${cssFormEdit.className}-preview & {
    background: transparent;
    border-radius: unset;
    padding: 0px;
    grid-template-columns: repeat(var(--css-columns-count), 1fr);
    min-height: auto;
  }
`);


export const cssColumn = styled('div', `
  position: relative;
  &-empty, &-add-button {
    position: relative;
    min-height: 32px;
    cursor: pointer;
    display: flex;
    justify-content: center;
    align-items: center;
    padding-right: 8px;
    --icon-color: ${colors.slate};
    align-self: stretch;
    transition: height 0.2s ease-in-out;
    border: 2px dashed ${colors.darkGrey};
    background: ${colors.lightGrey};
    color: ${colors.slate};
    border-radius: 4px;
    padding: 2px 4px;
    font-size: 12px;
  }

  &-selected {
    border: 2px dashed ${colors.slate};
  }

  &-empty:hover, &-add-button:hover {
    border: 2px dashed ${colors.slate};
  }

  &-drag-over {
    outline: 2px dashed ${colors.lightGreen};
  }

  &-add-button {
    align-self: flex-end;
  }

  .${cssFormEdit.className}-preview &-add-button {
    display: none;
  }

  .${cssFormEdit.className}-preview &-empty {
    background: transparent;
    border-radius: unset;
    padding: 0px;
    min-height: auto;
    border: 0px;
  }
`);

const cssFormContainer = styled('div', `
  padding: 32px;
  background-color: ${theme.mainPanelBg};
  border: 1px solid ${theme.menuBorder};
  color: ${theme.text};
  width: 640px;
  align-self: center;
  margin: 0px auto;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  gap: 16px;
  max-width: calc(100% - 32px);
`);

export const cssButtonGroup = styled('div', `
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  padding: 0px 24px 0px 24px;
  margin-bottom: 16px;
  gap: 8px;
`);

export const cssIconButton = styled(basicButton, `
  padding: 3px 8px;
  font-size: ${vars.smallFontSize};
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 24px;

  &-standard {
    background-color: ${theme.leftPanelBg};
  }
  &-warning {
    color: ${theme.controlPrimaryFg};
    background-color: ${theme.toastWarningBg};
    border: none;
  }
  &-warning:hover {
    color: ${theme.controlPrimaryFg};
    background-color: #B8791B;
    border: none;
  }
`);

const cssStaticText = styled('div', `
  min-height: 1.5rem;
`);

export function markdown(obs: BindableValue<string>, ...args: IDomArgs<HTMLDivElement>) {
  return dom('div', el => {
    dom.autoDisposeElem(el, subscribeBindable(obs, val => {
      el.innerHTML = sanitizeHTML(marked(val));
    }));
  }, ...args);
}

export const cssDrag = styled('div.test-forms-drag', `
  position: absolute;
  pointer-events: none;
  top: 2px;
  left: 2px;
  width: 1px;
  height: 1px;
`);

export const cssPreview = styled('iframe', `
  height: 100%;
  border: 0px;
`);

export const cssSwitcher = styled('div', `
  flex-shrink: 0;
  margin-top: 24px;
  width: 100%;
`);

export const cssSwitcherMessage = styled('div', `
  display: flex;
  padding: 0px 16px 0px 16px;
  margin-bottom: 16px;
`);

export const cssSwitcherMessageBody = styled('div', `
  flex-grow: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 0px 32px 0px 32px;
`);

export const cssSwitcherMessageDismissButton = styled('div', `
  align-self: flex-start;
  flex-shrink: 0;
  padding: 0px;
  border-radius: 4px;
  cursor: pointer;
  --icon-color: ${theme.controlSecondaryFg};

  &:hover {
    background-color: ${theme.hover};
  }
`);

export const cssParagraph = styled('div', `
  margin-bottom: 16px;
`);
