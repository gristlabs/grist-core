import {textarea} from 'app/client/ui/inputs';
import {sanitizeHTML} from 'app/client/ui/sanitizeHTML';
import {basicButton, basicButtonLink} from 'app/client/ui2018/buttons';
import {colors, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {BindableValue, dom, DomElementArg, IDomArgs, Observable, styled, subscribeBindable} from 'grainjs';
import {marked} from 'marked';

export const cssFormView = styled('div.flexauto.flexvbox', `
  color: ${theme.text};
  display: flex;
  flex-direction: column;
  flex-basis: 0px;
  align-items: center;
  justify-content: space-between;
  position: relative;
  background-color: ${theme.leftPanelBg};
  overflow: auto;
  min-height: 100%;
  width: 100%;
`);

export const cssFormContainer = styled('div', `
  background-color: ${theme.mainPanelBg};
  border: 1px solid ${theme.modalBorderDark};
  color: ${theme.text};
  width: 600px;
  align-self: center;
  margin: 0px auto;
  border-radius: 3px;
  display: flex;
  flex-direction: column;
  max-width: calc(100% - 32px);
  padding-top: 20px;
  padding-left: 48px;
  padding-right: 48px;
  gap: 8px;
`);



export const cssFieldEditor = styled('div.hover_border.field_editor', `
  position: relative;
  cursor: pointer;
  user-select: none;
  outline: none;
  padding: 8px;
  border-radius: 3px;
  margin-bottom: 4px;
  --hover-visible: hidden;
  transition: transform 0.2s ease-in-out;
  &:hover:not(:has(.hover_border:hover),&-cut) {
    --hover-visible: visible;
    outline: 1px solid ${colors.lightGreen};
  }
  &-selected:not(&-cut) {
    background: #F7F7F7;
    outline: 1px solid ${colors.lightGreen};
    --selected-block: block;
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
  &-FormDescription {
    margin-bottom: 10px;
  }
  &-drag-above {
    transform: translateY(2px);
  }
  &-drag-below {
    transform: translateY(-2px);
  }
`);

export const cssSectionEditor = styled('div', `
  border-radius: 3px;
  padding: 16px;
  border: 1px solid ${theme.modalBorderDark};
`);


export const cssSection = styled('div', `
  position: relative;
  color: ${theme.text};
  margin: 0px auto;
  min-height: 50px;
  .${cssFormView.className}-preview & {
    background: transparent;
    border-radius: unset;
    padding: 0px;
    min-height: auto;
  }
`);

export const cssLabel = styled('label', `
  font-size: 15px;
  font-weight: normal;
  user-select: none;
  display: block;
  margin: 0px;
`);

export const cssCheckboxLabel = styled('label', `
  font-size: 15px;
  font-weight: normal;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0px;
  margin-bottom: 8px;
`);

export function textbox(obs: Observable<string|undefined>, ...args: DomElementArg[]): HTMLInputElement {
  return dom('input',
    dom.prop('value', u => u(obs) || ''),
    dom.on('input', (_e, elem) => obs.set(elem.value)),
    ...args,
  );
}

export const cssEditableLabel = styled(textarea, `
  font-weight: normal;
  outline: none;
  display: block;
  padding: 0px;
  border: 0px;
  width: 100%;
  margin: 0px;
  background: transparent;
  cursor: pointer;
  min-height: 1.5rem;

  color: ${colors.darkText};
  font-size: 12px;
  font-weight: 700;

  &::placeholder {
    font-style: italic
  }
  &-edit {
    cursor: auto;
    background: ${theme.inputBg};
    outline: 2px solid black;
    outline-offset: 1px;
    border-radius: 2px;
  }
  &-normal {
    color: ${colors.darkText};
    font-size: 15px;
    font-weight: normal;
  }
`);

export const cssDesc = styled('div', `
  font-size: 12px;
  font-weight: 400;
  margin-top: 4px;
  color: ${theme.darkText};
  white-space: pre-wrap;
  font-style: italic;
  font-weight: 400;
  line-height: 1.6;
`);

export const cssInput = styled('input', `
  font-size: inherit;
  padding: 4px 8px;
  border: 1px solid #D9D9D9;
  border-radius: 3px;
  outline: none;
  cursor-events: none;

  &-invalid {
    color: red;
  }
  &[type="number"], &[type="date"], &[type="datetime-local"], &[type="text"] {
    width: 100%;
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


export const cssFieldEditorContent = styled('div', `

`);

export const cssSelectedOverlay = styled('div._cssSelectedOverlay', `
  inset: 0;
  position: absolute;
  opacity: 0;
  outline: none;
  .${cssFieldEditor.className}-selected > & {
    opacity: 1;
  }

  .${cssFormView.className}-preview & {
    display: none;
  }
`);


export const cssControlsLabel = styled('div', `
  background: ${colors.lightGreen};
  color: ${colors.light};
  padding: 1px 2px;
  min-width: 24px;
`);

export const cssPlusButton = styled('div', `
  position: relative;
  min-height: 32px;
  cursor: pointer;
  display: flex;
  justify-content: center;
  align-items: center;
`);

export const cssCircle = styled('div', `
  border-radius: 50%;
  width: 24px;
  height: 24px;
  background-color: ${colors.lightGreen};
  color: ${colors.light};
  display: flex;
  justify-content: center;
  align-items: center;
  .${cssPlusButton.className}:hover & {
    background: ${colors.darkGreen};
  }
`);

export const cssPlusIcon = styled(icon, `
 --icon-color: ${colors.light};
`);

export const cssAddText = styled('div', `
  color: ${colors.slate};
  border-radius: 4px;
  padding: 2px 4px;
  font-size: 12px;
  z-index: 1;
  &:before {
    content: "Add a field";
  }
  .${cssPlusButton.className}-hover &:before {
    content: "Drop here";
  }
`);

export const cssPadding = styled('div', `
`);

export const cssColumns = styled('div', `
  --css-columns-count: 2;
  display: grid;
  grid-template-columns: repeat(var(--css-columns-count), 1fr) 32px;
  gap: 8px;
  padding: 12px 4px;

  .${cssFormView.className}-preview & {
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

  .${cssFormView.className}-preview &-add-button {
    display: none;
  }

  .${cssFormView.className}-preview &-empty {
    background: transparent;
    border-radius: unset;
    padding: 0px;
    min-height: auto;
    border: 0px;
  }
`);

export const cssButtonGroup = styled('div', `
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  padding: 0px 24px 0px 24px;
  gap: 8px;
  /* So that the height is 40px in normal state */
  padding-top: calc((40px - 24px) / 2);
  padding-bottom: calc((40px - 24px) / 2);
`);


export const cssIconLink = styled(basicButtonLink, `
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
  &-frameless {
    background-color: transparent;
    border: none;
  }
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
  &-frameless {
    background-color: transparent;
    border: none;
  }
`);

export const cssMarkdownRendered = styled('div', `
  min-height: 1.5rem;
  font-size: 15px;
  & textarea {
    font-size: 15px;
  }
  & strong {
    font-weight: 600;
  }
  &-alignment-left {
    text-align: left;
  }
  &-alignment-center {
    text-align: center;
  }
  &-alignment-right {
    text-align: right;
  }
  & hr {
    border-color: ${colors.darkGrey};
    margin: 8px 0px;
  }
  &-separator {
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  &-separator hr {
    margin: 0px;
  }
`);

export const cssMarkdownRender = styled('div', `
  & > p:last-child {
    margin-bottom: 0px;
  }
  & h1 {
    font-size: 24px;
    margin: 4px 0px;
    font-weight: normal;
  }
  & h2 {
    font-size: 22px;
    margin: 4px 0px;
    font-weight: normal;
  }
  & h3 {
    font-size: 16px;
    margin: 4px 0px;
    font-weight: normal;
  }
  & h4 {
    font-size: 13px;
    margin: 4px 0px;
    font-weight: normal;
  }
  & h5 {
    font-size: 11px;
    margin: 4px 0px;
    font-weight: normal;
  }
  & h6 {
    font-size: 10px;
    margin: 4px 0px;
    font-weight: normal;
  }
`);

export function markdown(obs: BindableValue<string>, ...args: IDomArgs<HTMLDivElement>) {
  return cssMarkdownRender(el => {
    dom.autoDisposeElem(el, subscribeBindable(obs, val => {
      el.innerHTML = sanitizeHTML(marked(val));
    }));
  }, ...args);
}

export const cssDrop = styled('div.test-forms-drag', `
  position: absolute;
  pointer-events: none;
  top: 2px;
  left: 2px;
  width: 1px;
  height: 1px;
`);

export const cssDragWrapper = styled('div', `
  position: absolute;
  inset: 0px;
  left: -16px;
  top: 0px;
  height: 100%;
  width: 16px;
`);

export const cssDrag = styled(icon, `
  position: absolute;
  visibility: var(--hover-visible, hidden);
  top: calc(50% - 16px / 2);
  width: 16px;
  height: 16px;
  --icon-color: ${colors.lightGreen};
  &-top {
    top: 16px;
  }
`);


export const cssPreview = styled('iframe', `
  height: 100%;
  width: 100%;
  border: 0px;
`);

export const cssSwitcher = styled('div', `
  flex-shrink: 0;
  margin-top: 24px;
  border-top: 1px solid ${theme.modalBorder};
  margin-left: -48px;
  margin-right: -48px;
`);

export const cssSwitcherMessage = styled('div', `
  display: flex;
  padding: 0px 16px 0px 16px;
`);

export const cssSwitcherMessageBody = styled('div', `
  flex-grow: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 10px 32px;
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

export const cssFormEditBody = styled('div', `
  width: 100%;
  overflow: auto;
  padding-top: 52px;
  padding-bottom: 24px;
`);

export const cssRemoveButton = styled('div', `
  position: absolute;
  right: 11px;
  top: 11px;
  border-radius: 3px;
  background: ${colors.darkGrey};
  display: none;
  height: 16px;
  width: 16px;
  align-items: center;
  justify-content: center;
  line-height: 0px;
  z-index: 3;
  & > div {
    height: 13px;
    width: 13px;
  }
  &:hover {
    background: ${colors.mediumGreyOpaque};
    cursor: pointer;
  }
  .${cssFieldEditor.className}-selected > &,
  .${cssFieldEditor.className}:hover > & {
    display: flex;
  }
  &-right {
    right: -20px;
  }
`);

export function saveControls(editMode: Observable<boolean>, save: (ok: boolean) => void) {
  return [
    dom.onKeyDown({
      Enter$: (ev) => {
        // if shift ignore
        if (ev.shiftKey) {
          return;
        }
        ev.stopPropagation();
        ev.preventDefault();
        save(true);
        editMode.set(false);
        if (ev.target && 'blur' in ev.target) {
          (ev.target as any).blur();
        }
      },
      Escape: (ev) => {
        save(false);
        editMode.set(false);
        if (ev.target && 'blur' in ev.target) {
          (ev.target as any).blur();
        }
      }
    }),
    dom.on('blur', (ev) => {
      if (!editMode.isDisposed() && editMode.get()) {
        save(true);
        editMode.set(false);
      }
    }),
  ];
}
