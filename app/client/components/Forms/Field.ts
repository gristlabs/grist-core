import {FormView} from 'app/client/components/Forms/FormView';
import {Box, BoxModel, ignoreClick, RenderContext} from 'app/client/components/Forms/Model';
import * as style from 'app/client/components/Forms/styles';
import {ViewFieldRec} from 'app/client/models/DocModel';
import {Constructor} from 'app/common/gutil';
import {BindableValue, Computed, Disposable, dom, DomContents,
        IDomComponent, makeTestId, Observable, toKo} from 'grainjs';
import * as ko from 'knockout';

const testId = makeTestId('test-forms-');

/**
 * Base class for all field models.
 */
export class FieldModel extends BoxModel {

  public fieldRef = this.autoDispose(ko.pureComputed(() => toKo(ko, this.leaf)()));
  public field = this.view.gristDoc.docModel.viewFields.createFloatingRowModel(this.fieldRef);

  public question = Computed.create(this, (use) => {
    return use(this.field.question) || use(this.field.origLabel);
  });

  public description = Computed.create(this, (use) => {
    return use(this.field.description);
  });

  public colType = Computed.create(this, (use) => {
    return use(use(this.field.column).pureType);
  });

  public get leaf() {
    return this.props['leaf'] as Observable<number>;
  }

  public renderer = Computed.create(this, (use) => {
    const ctor = fieldConstructor(use(this.colType));
    const instance = new ctor(this.field);
    use.owner.autoDispose(instance);
    return instance;
  });

  constructor(box: Box, parent: BoxModel | null, view: FormView) {
    super(box, parent, view);
  }

  public async onDrop() {
    await super.onDrop();
    if (typeof this.leaf.get() === 'string') {
      this.leaf.set(await this.view.showColumn(this.leaf.get()));
    }
  }
  public render(context: RenderContext) {
    const model = this;

    return dom('div',
      testId('question'),
      style.cssLabel(
        testId('label'),
        dom.text(model.question)
      ),
      testType(this.colType),
      dom.domComputed(this.renderer, (renderer) => renderer.buildDom()),
      dom.maybe(model.description, (description) => [
        style.cssDesc(description, testId('description')),
      ]),
    );
  }


  public async deleteSelf() {
    const rowId = this.field.getRowId();
    const view = this.view;
    this.removeSelf();
    // The order here matters for undo.
    await this.save();
    // We are disposed at this point, be still can access the view.
    if (rowId) {
      await view.viewSection.removeField(rowId);
    }
  }
}

export abstract class Question extends Disposable implements IDomComponent {
  constructor(public field: ViewFieldRec) {
    super();
  }

  public abstract buildDom(): DomContents;
}


class TextModel extends Question {
  public buildDom() {
    return style.cssInput(
      dom.prop('name', this.field.colId),
      {type: 'text', tabIndex: "-1"},
      ignoreClick
    );
  }
}

class ChoiceModel extends Question {
  public buildDom() {
    const field = this.field;
    const choices: Computed<string[]> = Computed.create(this, use => {
      return use(use(field.origCol).widgetOptionsJson.prop('choices')) || [];
    });
    return style.cssSelect(
      {tabIndex: "-1"},
      ignoreClick,
      dom.prop('name', this.field.colId),
      dom.forEach(choices, (choice) => dom('option', choice, {value: choice})),
    );
  }
}

class ChoiceListModel extends Question {
  public buildDom() {
    const field = this.field;
    const choices: Computed<string[]> = Computed.create(this, use => {
      return use(use(field.origCol).widgetOptionsJson.prop('choices')) || [];
    });
    return dom('div',
      dom.prop('name', this.field.colId),
      dom.forEach(choices, (choice) => style.cssLabel(
        dom('input',
          dom.prop('name', this.field.colId),
          {type: 'checkbox', value: choice, style: 'margin-right: 5px;'}
        ),
        choice
      )),
      dom.maybe(use => use(choices).length === 0, () => [
        dom('div', 'No choices defined'),
      ]),
    );
  }
}

class BoolModel extends Question {
  public buildDom() {
    return dom('div',
      style.cssLabel(
        {style: 'display: flex; align-items: center; gap: 8px;'},
        dom('input',
          dom.prop('name', this.field.colId),
          {type: 'checkbox', name: 'choice', style: 'margin: 0px; padding: 0px;'}
        ),
        'Yes'
      ),
    );
  }
}

class DateModel extends Question {
  public buildDom() {
    return dom('div',
      dom('input',
        dom.prop('name', this.field.colId),
        {type: 'date', style: 'margin-right: 5px; width: 100%;'
      }),
    );
  }
}

class DateTimeModel extends Question {
  public buildDom() {
    return dom('div',
      dom('input',
        dom.prop('name', this.field.colId),
        {type: 'datetime-local', style: 'margin-right: 5px; width: 100%;'}
      ),
      dom.style('width', '100%'),
    );
  }
}


// TODO: decide which one we need and implement rest.
const AnyModel = TextModel;
const NumericModel = TextModel;
const IntModel = TextModel;
const RefModel = TextModel;
const RefListModel = TextModel;
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
