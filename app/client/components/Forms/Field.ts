import {buildEditor} from 'app/client/components/Forms/Editor';
import {FormView} from 'app/client/components/Forms/FormView';
import {BoxModel, ignoreClick} from 'app/client/components/Forms/Model';
import * as css from 'app/client/components/Forms/styles';
import {stopEvent} from 'app/client/lib/domUtils';
import {refRecord} from 'app/client/models/DocModel';
import {autoGrow} from 'app/client/ui/forms';
import {squareCheckbox} from 'app/client/ui2018/checkbox';
import {colors} from 'app/client/ui2018/cssVars';
import {Box} from 'app/common/Forms';
import {Constructor} from 'app/common/gutil';
import {
  BindableValue,
  Computed,
  Disposable,
  dom,
  DomContents,
  DomElementArg,
  IDomArgs,
  makeTestId,
  MultiHolder,
  observable,
  Observable,
  styled,
  toKo
} from 'grainjs';
import * as ko from 'knockout';

const testId = makeTestId('test-forms-');

/**
 * Container class for all fields.
 */
export class FieldModel extends BoxModel {

  /**
   * Edit mode, (only one element can be in edit mode in the form editor).
   */
  public edit = Observable.create(this, false);
  public fieldRef = this.autoDispose(ko.pureComputed(() => toKo(ko, this.leaf)()));
  public field = refRecord(this.view.gristDoc.docModel.viewFields, this.fieldRef);
  public colId = Computed.create(this, (use) => use(use(this.field).colId));
  public column = Computed.create(this, (use) => use(use(this.field).column));
  public question = Computed.create(this, (use) => {
    const field = use(this.field);
    if (field.isDisposed() || use(field.id) === 0) { return ''; }
    return use(field.question) || use(field.origLabel);
  });

  public description = Computed.create(this, (use) => {
    const field = use(this.field);
    return use(field.description);
  });

  /**
   * Column type of the field.
   */
  public colType = Computed.create(this, (use) => {
    const field = use(this.field);
    return use(use(field.column).pureType);
  });

  /**
   * Field row id.
   */
  public get leaf() {
    return this.prop('leaf') as Observable<number>;
  }

  public get required() {
    return this.prop('formRequired', false) as Observable<boolean|undefined>;
  }

  /**
   * A renderer of question instance.
   */
  public renderer = Computed.create(this, (use) => {
    const ctor = fieldConstructor(use(this.colType));
    const instance = new ctor(this);
    use.owner.autoDispose(instance);
    return instance;
  });

  constructor(box: Box, parent: BoxModel | null, view: FormView) {
    super(box, parent, view);

    this.question.onWrite(value => {
      this.field.peek().question.setAndSave(value).catch(reportError);
    });

    this.autoDispose(
      this.selected.addListener((now, then) => {
        if (!now && then) {
          setImmediate(() => !this.edit.isDisposed() && this.edit.set(false));
        }
      })
    );
  }

  public async afterDrop() {
    // Base class does good job of handling drop.
    await super.afterDrop();
    if (this.isDisposed()) { return; }

    // Except when a field is dragged from the creator panel, which stores colId instead of fieldRef (as there is no
    // field yet). In this case, we need to create a field.
    if (typeof this.leaf.get() === 'string') {
      this.leaf.set(await this.view.showColumn(this.leaf.get()));
    }
  }

  public override render(...args: IDomArgs<HTMLElement>): HTMLElement {
    // Updated question is used for editing, we don't save on every key press, but only on blur (or enter, etc).
    const save = (value: string) => {
      value = value?.trim();
      // If question is empty or same as original, don't save.
      if (!value || value === this.field.peek().question()) {
        return;
      }
      this.field.peek().question.setAndSave(value).catch(reportError);
    };
    const overlay = Observable.create(null, true);

    const content = dom.domComputed(this.renderer, (r) => r.buildDom({
      edit: this.edit,
      overlay,
      onSave: save,
    }, ...args));

    return buildEditor({
        box: this,
        overlay,
        removeIcon: 'CrossBig',
        removeTooltip: 'Hide',
        editMode: this.edit,
        content,
      },
      dom.on('dblclick', () => this.selected.get() && this.edit.set(true)),
    );
  }

  public async deleteSelf() {
    const rowId = this.field.peek().id.peek();
    const view = this.view;
    const root = this.root();
    this.removeSelf();
    // The order here matters for undo.
    await root.save(async () => {
      // Make sure to save first layout without this field, otherwise the undo won't work properly.
      await root.save();
      // We are disposed at this point, be still can access the view.
      if (rowId) {
        await view.viewSection.removeField(rowId);
      }
    });
  }
}

export abstract class Question extends Disposable {
  constructor(public model: FieldModel) {
    super();
  }

  public buildDom(props: {
    edit: Observable<boolean>,
    overlay: Observable<boolean>,
    onSave: (value: string) => void,
  }, ...args: IDomArgs<HTMLElement>) {
    return css.cssPadding(
      testId('question'),
      testType(this.model.colType),
      this.renderLabel(props, dom.style('margin-bottom', '5px')),
      this.renderInput(),
      ...args
    );
  }

  public abstract renderInput(): DomContents;

  protected renderLabel(props: {
    edit: Observable<boolean>,
    onSave: (value: string) => void,
  }, ...args: DomElementArg[]) {
    const {edit, onSave} = props;

    const scope = new MultiHolder();

    // When in edit, we will update a copy of the question.
    const draft = Observable.create(scope, this.model.question.get());
    scope.autoDispose(
      this.model.question.addListener(q => draft.set(q)),
    );
    const controller = Computed.create(scope, (use) => use(draft));
    controller.onWrite(value => {
      if (this.isDisposed() || draft.isDisposed()) { return; }
      if (!edit.get()) { return; }
      draft.set(value);
    });

    // Wire up save method.
    const saveDraft = (ok: boolean) => {
      if (this.isDisposed() || draft.isDisposed()) { return; }
      if (!ok || !edit.get() || !controller.get()) {
        controller.set(this.model.question.get());
        return;
      }
      onSave(controller.get());
    };
    let element: HTMLTextAreaElement;

    scope.autoDispose(
      props.edit.addListener((now, then) => {
        if (now && !then) {
          // When we go into edit mode, we copy the question into draft.
          draft.set(this.model.question.get());
          // And focus on the element.
          setTimeout(() => {
            element?.focus();
            element?.select();
          }, 10);
        }
      })
    );

    return [
      dom.autoDispose(scope),
      element = css.cssEditableLabel(
        controller,
        {onInput: true},
        // Attach common Enter,Escape, blur handlers.
        css.saveControls(edit, saveDraft),
        // Autoselect whole text when mounted.
        // Auto grow for textarea.
        autoGrow(controller),
        // Enable normal menu.
        dom.on('contextmenu', stopEvent),
        dom.style('resize', 'none'),
        testId('label'),
        css.cssEditableLabel.cls('-edit', props.edit),
        // When selected, we want to be able to edit the label by clicking it
        // so we need to make it relative and z-indexed.
        dom.style('position', u => u(this.model.selected) ? 'relative' : 'static'),
        dom.style('z-index', '2'),
        dom.on('click', (ev) => {
          if (this.model.selected.get() && !props.edit.get()) {
            props.edit.set(true);
            ev.stopPropagation();
          }
        }),
        ...args,
      ),
    ];
  }
}


class TextModel extends Question {
  public renderInput() {
    return css.cssInput(
      dom.prop('name', u => u(u(this.model.field).colId)),
      {disabled: true},
      {type: 'text', tabIndex: "-1"},
    );
  }
}

class ChoiceModel extends Question {
  protected choices: Computed<string[]> = Computed.create(this, use => {
    // Read choices from field.
    const list = use(use(use(this.model.field).origCol).widgetOptionsJson.prop('choices')) || [];

    // Make sure it is array of strings.
    if (!Array.isArray(list) || list.some((v) => typeof v !== 'string')) {
      return [];
    }
    return list;
  });

  protected choicesWithEmpty = Computed.create(this, use => {
    const list = Array.from(use(this.choices));
    // Add empty choice if not present.
    if (list.length === 0 || list[0] !== '') {
      list.unshift('');
    }
    return list;
  });

  public renderInput(): HTMLElement {
    const field = this.model.field;
    return css.cssSelect(
      {tabIndex: "-1"},
      ignoreClick,
      dom.prop('name', use => use(use(field).colId)),
      dom.forEach(this.choicesWithEmpty, (choice) => dom('option', choice, {value: choice})),
    );
  }
}

class ChoiceListModel extends ChoiceModel {
  public renderInput() {
    const field = this.model.field;
    return dom('div',
      dom.prop('name', use => use(use(field).colId)),
      dom.forEach(this.choices, (choice) => css.cssCheckboxLabel(
        squareCheckbox(observable(false)),
        choice
      )),
      dom.maybe(use => use(this.choices).length === 0, () => [
        dom('div', 'No choices defined'),
      ]),
    );
  }
}

class BoolModel extends Question {
  public override buildDom(props: {
    edit: Observable<boolean>,
    overlay: Observable<boolean>,
    question: Observable<string>,
    onSave: () => void,
  }) {
    return css.cssPadding(
      testId('question'),
      testType(this.model.colType),
      cssToggle(
        this.renderInput(),
        this.renderLabel(props, css.cssEditableLabel.cls('-normal')),
      ),
    );
  }
  public override renderInput() {
    const value = Observable.create(this, true);
    return dom('div.widget_switch',
      dom.style('--grist-actual-cell-color', colors.lightGreen.toString()),
      dom.cls('switch_on', value),
      dom.cls('switch_transition', true),
      dom('div.switch_slider'),
      dom('div.switch_circle'),
    );
  }
}

class DateModel extends Question {
  public renderInput() {
    return dom('div',
      css.cssInput(
        dom.prop('name', this.model.colId),
        {type: 'date', style: 'margin-right: 5px; width: 100%;'
      }),
    );
  }
}

class DateTimeModel extends Question {
  public renderInput() {
    return dom('div',
      css.cssInput(
        dom.prop('name', this.model.colId),
        {type: 'datetime-local', style: 'margin-right: 5px; width: 100%;'}
      ),
      dom.style('width', '100%'),
    );
  }
}

class RefListModel extends Question {
  protected choices = this._subscribeForChoices();

  public renderInput() {
    return dom('div',
      dom.prop('name', this.model.colId),
      dom.forEach(this.choices, (choice) => css.cssCheckboxLabel(
        squareCheckbox(observable(false)),
        String(choice[1] ?? '')
      )),
      dom.maybe(use => use(this.choices).length === 0, () => [
        dom('div', 'No choices defined'),
      ]),
    ) as HTMLElement;
  }

  private _subscribeForChoices() {
    const tableId = Computed.create(this, use => {
      const refTable = use(use(this.model.column).refTable);
      return refTable ? use(refTable.tableId) : '';
    });

    const colId = Computed.create(this, use => {
      const dispColumnIdObs = use(use(this.model.column).visibleColModel);
      return use(dispColumnIdObs.colId);
    });

    const observer = this.model.view.gristDoc.columnObserver(this, tableId, colId);

    return Computed.create(this, use => {
      const unsorted = use(observer);
      unsorted.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
      return unsorted.slice(0, 50); // TODO: pagination or a waning
    });
  }
}

class RefModel extends RefListModel {
  protected withEmpty = Computed.create(this, use => {
    const list = Array.from(use(this.choices));
    // Add empty choice if not present.
    list.unshift([0, '']);
    return list;
  });

  public renderInput() {
    return css.cssSelect(
      {tabIndex: "-1"},
      ignoreClick,
      dom.prop('name', this.model.colId),
      dom.forEach(this.withEmpty, (choice) => dom('option', String(choice[1] ?? ''), {value: String(choice[0])})),
    );
  }
}

// TODO: decide which one we need and implement rest.
const AnyModel = TextModel;
const NumericModel = TextModel;
const IntModel = TextModel;
const AttachmentsModel = TextModel;


function fieldConstructor(type: string): Constructor<Question> {
  switch (type) {
    case 'Any': return AnyModel;
    case 'Bool': return BoolModel;
    case 'Choice': return ChoiceModel;
    case 'ChoiceList': return ChoiceListModel;
    case 'Date': return DateModel;
    case 'DateTime': return DateTimeModel;
    case 'Int': return IntModel;
    case 'Numeric': return NumericModel;
    case 'Ref': return RefModel;
    case 'RefList': return RefListModel;
    case 'Attachments': return AttachmentsModel;
    default: return TextModel;
  }
}

/**
 * Creates a hidden input element with element type. Used in tests.
 */
function testType(value: BindableValue<string>) {
  return dom('input', {type: 'hidden'}, dom.prop('value', value), testId('type'));
}

const cssToggle = styled('div', `
  display: flex;
  align-items: center;
  gap: 8px;
  --grist-actual-cell-color: ${colors.lightGreen};
`);
