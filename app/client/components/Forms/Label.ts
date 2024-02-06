import * as css from './styles';
import {buildEditor} from 'app/client/components/Forms/Editor';
import {BoxModel} from 'app/client/components/Forms/Model';
import {stopEvent} from 'app/client/lib/domUtils';
import {not} from 'app/common/gutil';
import {Computed, dom, Observable} from 'grainjs';

export class LabelModel extends BoxModel {
  public edit = Observable.create(this, false);

  protected defaultValue = '';

  public render(): HTMLElement {
    let element: HTMLTextAreaElement;
    const text = this.prop('text', this.defaultValue) as Observable<string|undefined>;
    const cssClass = this.prop('cssClass', '') as Observable<string>;
    const editableText = Observable.create(this, text.get() || '');
    const overlay = Computed.create(this, use => !use(this.edit));

    this.autoDispose(text.addListener((v) => editableText.set(v || '')));

    const save = (ok: boolean) => {
      if (ok) {
        text.set(editableText.get());
        void this.parent?.save().catch(reportError);
      } else {
        editableText.set(text.get() || '');
      }
    };

    const mode = (edit: boolean) => {
      if (this.isDisposed() || this.edit.isDisposed()) { return; }
      if (this.edit.get() === edit) { return; }
      this.edit.set(edit);
    };

    return buildEditor(
      {
        box: this,
        editMode: this.edit,
        overlay,
        click: (ev) => {
          stopEvent(ev);
          // If selected, then edit.
          if (!this.selected.get()) { return; }
          if (document.activeElement === element) { return; }
          editableText.set(text.get() || '');
          this.edit.set(true);
          setTimeout(() => {
            element.focus();
            element.select();
          }, 10);
        },
        content: element = css.cssEditableLabel(
          editableText,
          {onInput: true, autoGrow: true},
          {placeholder: `Empty label`},
          dom.on('click', ev => {
            stopEvent(ev);
          }),
          // Styles saved (for titles and such)
          css.cssEditableLabel.cls(use => `-${use(cssClass)}`),
          // Disable editing if not in edit mode.
          dom.boolAttr('readonly', not(this.edit)),
          // Pass edit to css.
          css.cssEditableLabel.cls('-edit', this.edit),
          // Attach default save controls (Enter, Esc) and so on.
          css.saveControls(this.edit, save),
          // Turn off resizable for textarea.
          dom.style('resize', 'none'),
        ),
      },
      dom.onKeyDown({Enter$: (ev) => {
        // If no in edit mode, change it.
        if (!this.edit.get()) {
          mode(true);
          ev.stopPropagation();
          ev.stopImmediatePropagation();
          ev.preventDefault();
          return;
        }
      }})
    );
  }
}
