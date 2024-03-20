import {FormLayoutNode} from 'app/client/components/FormRenderer';
import {buildEditor} from 'app/client/components/Forms/Editor';
import {BoxModel} from 'app/client/components/Forms/Model';
import * as css from 'app/client/components/Forms/styles';
import {textarea} from 'app/client/ui/inputs';
import {theme} from 'app/client/ui2018/cssVars';
import {not} from 'app/common/gutil';
import {Computed, dom, Observable, styled} from 'grainjs';
import {v4 as uuidv4} from 'uuid';

export class ParagraphModel extends BoxModel {
  public edit = Observable.create(this, false);

  protected defaultValue = '**Lorem** _ipsum_ dolor';
  protected cssClass = '';

  private _overlay = Computed.create(this, not(this.selected));

  public override render(): HTMLElement {
    const box = this;
    const editMode = box.edit;
    let element: HTMLElement;
    const text = this.prop('text', this.defaultValue) as Observable<string|undefined>;

    // There is a spacial hack here. We might be created as a separator component, but the rendering
    // for separator looks bad when it is the only content, so add a special case for that.
    const isSeparator = Computed.create(this, (use) => use(text) === '---');

    return buildEditor({
      box: this,
      overlay: this._overlay,
      editMode,
      content: css.cssMarkdownRendered(
        css.markdown(use => use(text) || '', dom.hide(editMode)),
        dom.maybe(use => !use(text) && !use(editMode), () => cssEmpty('(empty)')),
        css.cssMarkdownRendered.cls('-separator', isSeparator),
        dom.on('click', () => {
          if (!editMode.get() && this.selected.get()) {
            editMode.set(true);
          }
        }),
        css.cssMarkdownRendered.cls('-edit', editMode),
        css.cssMarkdownRendered.cls(u => `-alignment-${u(box.prop('alignment', 'left'))}`),
        this.cssClass ? dom.cls(this.cssClass, not(editMode)) : null,
        dom.maybe(editMode, () => {
          const draft = Observable.create(null, text.get() || '');
          setTimeout(() => element?.focus(), 10);
          return [
            element = cssTextArea(draft, {autoGrow: true, onInput: true},
              cssTextArea.cls('-edit', editMode),
              css.saveControls(editMode, (ok) => {
                if (ok && editMode.get()) {
                  text.set(draft.get());
                  this.save().catch(reportError);
                }
              })
            ),
          ];
        }),
      )
    });
  }
}

export function Paragraph(text: string, alignment?: 'left'|'right'|'center'): FormLayoutNode {
  return {id: uuidv4(), type: 'Paragraph', text, alignment};
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
  &-edit {
    cursor: auto;
    background: ${theme.inputBg};
    outline: 2px solid black;
    outline-offset: 1px;
    border-radius: 2px;
  }
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
