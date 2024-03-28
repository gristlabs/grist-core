import {FormLayoutNode, SELECT_PLACEHOLDER} from 'app/client/components/FormRenderer';
import {buildEditor} from 'app/client/components/Forms/Editor';
import {FormView} from 'app/client/components/Forms/FormView';
import {BoxModel, ignoreClick} from 'app/client/components/Forms/Model';
import * as css from 'app/client/components/Forms/styles';
import {stopEvent} from 'app/client/lib/domUtils';
import {refRecord} from 'app/client/models/DocModel';
import {autoGrow} from 'app/client/ui/forms';
import {squareCheckbox} from 'app/client/ui2018/checkbox';
import {colors} from 'app/client/ui2018/cssVars';
import {isBlankValue} from 'app/common/gristTypes';
import {Constructor, not} from 'app/common/gutil';
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
  public required: Computed<boolean>;
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

  /**
   * A renderer of question instance.
   */
  public renderer = Computed.create(this, (use) => {
    const ctor = fieldConstructor(use(this.colType));
    const instance = new ctor(this);
    use.owner.autoDispose(instance);
    return instance;
  });

  constructor(box: FormLayoutNode, parent: BoxModel | null, view: FormView) {
    super(box, parent, view);

    this.required = Computed.create(this, (use) => {
      const field = use(this.field);
      return Boolean(use(field.widgetOptionsJson.prop('formRequired')));
    });
    this.required.onWrite(value => {
      this.field.peek().widgetOptionsJson.prop('formRequired').setAndSave(value).catch(reportError);
    });

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
    }));

    return buildEditor({
        box: this,
        overlay,
        removeIcon: 'CrossBig',
        removeTooltip: 'Hide',
        editMode: this.edit,
        content,
      },
      dom.on('dblclick', () => this.selected.get() && this.edit.set(true)),
      ...args
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
    return css.cssQuestion(
      testId('question'),
      testType(this.model.colType),
      this.renderLabel(props, dom.style('margin-bottom', '5px')),
      this.renderInput(),
      css.cssQuestion.cls('-required', this.model.required),
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
      css.cssRequiredWrapper(
        testId('label'),
        // When in edit - hide * and change display from grid to display
        css.cssRequiredWrapper.cls('-required', use => Boolean(use(this.model.required) && !use(this.model.edit))),
        dom.maybe(props.edit, () => [
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
            css.cssEditableLabel.cls('-edit'),
            testId('label-editor'),
          ),
        ]),
        dom.maybe(not(props.edit), () => [
          css.cssRenderedLabel(
            dom.text(controller),
            testId('label-rendered'),
          ),
        ]),
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
    const choices = use(use(this.model.field).widgetOptionsJson.prop('choices'));

    // Make sure it is an array of strings.
    if (!Array.isArray(choices) || choices.some((choice) => typeof choice !== 'string')) {
      return [];
    } else {
      return choices;
    }
  });

  public renderInput(): HTMLElement {
    const field = this.model.field;
    return css.cssSelect(
      {tabIndex: "-1"},
      ignoreClick,
      dom.prop('name', use => use(use(field).colId)),
      dom('option', SELECT_PLACEHOLDER, {value: ''}),
      dom.forEach(this.choices, (choice) => dom('option', choice, {value: choice})),
    );
  }
}

class ChoiceListModel extends ChoiceModel {
  private _choices = Computed.create(this, use => {
    // Support for 30 choices. TODO: make limit dynamic.
    return use(this.choices).slice(0, 30);
  });

  public renderInput() {
    const field = this.model.field;
    return dom('div',
      dom.prop('name', use => use(use(field).colId)),
      dom.forEach(this._choices, (choice) => css.cssCheckboxLabel(
        squareCheckbox(observable(false)),
        choice
      )),
      dom.maybe(use => use(this._choices).length === 0, () => [
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
    return css.cssQuestion(
      testId('question'),
      testType(this.model.colType),
      cssToggle(
        this.renderInput(),
        this.renderLabel(props, css.cssLabelInline.cls('')),
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
  protected options = this._getOptions();

  public renderInput() {
    return dom('div',
      dom.prop('name', this.model.colId),
      dom.forEach(this.options, (option) => css.cssCheckboxLabel(
        squareCheckbox(observable(false)),
        option.label,
      )),
      dom.maybe(use => use(this.options).length === 0, () => [
        dom('div', 'No values in show column of referenced table'),
      ]),
    ) as HTMLElement;
  }

  private _getOptions() {
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
      return use(observer)
        .filter(([_id, value]) => !isBlankValue(value))
        .map(([id, value]) => ({label: String(value), value: String(id)}))
        .sort((a, b) => a.label.localeCompare(b.label))
        .slice(0, 30); // TODO: make limit dynamic.
    });
  }
}

class RefModel extends RefListModel {
  public renderInput() {
    return css.cssSelect(
      {tabIndex: "-1"},
      ignoreClick,
      dom.prop('name', this.model.colId),
      dom('option', SELECT_PLACEHOLDER, {value: ''}),
      dom.forEach(this.options, ({label, value}) => dom('option', label, {value})),
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
  display: grid;
  align-items: center;
  grid-template-columns: auto 1fr;
  gap: 8px;
  padding: 4px 0px;
  --grist-actual-cell-color: ${colors.lightGreen};
`);
