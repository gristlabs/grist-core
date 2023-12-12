import * as css from './styles';
import {BoxModel, RenderContext} from 'app/client/components/Forms/Model';
import {textarea} from 'app/client/ui/inputs';
import {theme} from 'app/client/ui2018/cssVars';
import {Computed, dom, Observable, styled} from 'grainjs';

export class ParagraphModel extends BoxModel {
  public edit = Observable.create(this, false);

  public render(context: RenderContext) {
    const box = this;
    context.overlay.set(false);
    const editMode = box.edit;
    let element: HTMLElement;
    const text = this.prop('text', '**Lorem** _ipsum_ dolor') as Observable<string|undefined>;
    const properText = Computed.create(this, (use) => {
      const savedText = use(text);
      if (!savedText) { return ''; }
      if (typeof savedText !== 'string') { return ''; }
      return savedText;
    });
    properText.onWrite((val) => {
      if (typeof val !== 'string') { return; }
      text.set(val);
      this.parent?.save().catch(reportError);
    });

    box.edit.addListener((val) => {
      if (!val) { return; }
      setTimeout(() => element.focus(), 0);
    });

    return css.cssStaticText(
      css.markdown(use => use(properText) || '', dom.cls('_preview'), dom.hide(editMode)),
      dom.maybe(use => !use(properText) && !use(editMode), () => cssEmpty('(empty)')),
      dom.on('dblclick', () => {
        editMode.set(true);
      }),
      css.cssStaticText.cls('-edit', editMode),
      dom.maybe(editMode, () => [
        cssTextArea(properText, {},
          (el) => {
            element = el;
          },
          dom.onKeyDown({
            Enter$: (ev) => {
              // if shift ignore
              if (ev.shiftKey) {
                return;
              }
              ev.stopPropagation();
              ev.preventDefault();
              editMode.set(false);
            },
            Escape$: (ev) => {
              ev.stopPropagation();
              ev.preventDefault();
              editMode.set(false);
            }
          }),
          dom.on('blur', () => {
            editMode.set(false);
          }),
        ),
      ])
    );
  }
}


const cssTextArea = styled(textarea, `
  color: ${theme.inputFg};
  background-color: ${theme.mainPanelBg};
  border: 0px;
  width: 100%;
  padding: 3px 6px;
  outline: none;
  max-height: 300px;
  min-height: calc(3em * 1.5);
  resize: none;
  border-radius: 3px;
  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
  &[readonly] {
    background-color: ${theme.inputDisabledBg};
    color: ${theme.inputDisabledFg};
  }
`);

const cssEmpty = styled('div', `
  color: ${theme.inputPlaceholderFg};
  font-style: italic;
`);
