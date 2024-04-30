import * as AceEditor from 'app/client/components/AceEditor';
import {createGroup} from 'app/client/components/commands';
import {makeT} from 'app/client/lib/localization';
import {buildHighlightedCode} from 'app/client/ui/CodeHighlight';
import {theme} from 'app/client/ui2018/cssVars';
import {createMobileButtons, getButtonMargins} from 'app/client/widgets/EditorButtons';
import {EditorPlacement, ISize} from 'app/client/widgets/EditorPlacement';
import {initializeAceOptions} from 'app/client/widgets/FormulaEditor';
import {IEditorCommandGroup} from 'app/client/widgets/NewBaseEditor';
import {ISuggestionWithValue} from 'app/common/ActiveDocAPI';
import {
  Computed,
  Disposable,
  dom,
  DomElementArg,
  Holder,
  IDisposableOwner,
  Observable,
  styled,
} from 'grainjs';

const t = makeT('DropdownConditionEditor');

interface BuildDropdownConditionEditorOptions {
  value: Computed<string>;
  disabled: Computed<boolean>;
  onSave(value: string): Promise<void>;
  onDispose(): void;
  getAutocompleteSuggestions(prefix: string): ISuggestionWithValue[];
}

/**
 * Builds an editor for dropdown conditions.
 *
 * Dropdown conditions are client-evaluated predicate formulas used to filter
 * items shown in autocomplete dropdowns for Choice and Reference type columns.
 *
 * Unlike Python formulas, dropdown conditions only support a very limited set of
 * features. They are a close relative of ACL formulas, sharing the same underlying
 * parser and compiler.
 *
 * See `sandbox/grist/predicate_formula.py` and `app/common/PredicateFormula.ts` for
 * more details on parsing and compiling, respectively.
 */
export function buildDropdownConditionEditor(
  owner: IDisposableOwner,
  options: BuildDropdownConditionEditorOptions,
  ...args: DomElementArg[]
) {
  const {value, disabled, onSave, onDispose, getAutocompleteSuggestions} = options;
  return dom.create(buildHighlightedCode,
    value,
    {maxLines: 1},
    dom.cls(cssDropdownConditionField.className),
    dom.cls('disabled'),
    cssDropdownConditionField.cls('-disabled', disabled),
    {tabIndex: '-1'},
    dom.on('focus', (_, refElem) => openDropdownConditionEditor(owner, {
      refElem,
      value,
      onSave,
      onDispose,
      getAutocompleteSuggestions,
    })),
    ...args,
  );
}

function openDropdownConditionEditor(owner: IDisposableOwner, options: {
  refElem: Element;
  value: Computed<string>;
  onSave: (value: string) => Promise<void>;
  onDispose: () => void;
  getAutocompleteSuggestions(prefix: string): ISuggestionWithValue[];
}) {
  const {refElem, value, onSave, onDispose, getAutocompleteSuggestions} = options;

  const saveAndDispose = async () => {
    const editorValue = editor.getValue();
    if (editorValue !== value.get()) {
      await onSave(editorValue);
    }
    if (editor.isDisposed()) { return; }

    editor.dispose();
  };

  const commands: IEditorCommandGroup = {
    fieldEditCancel: () => editor.dispose(),
    fieldEditSaveHere: () => editor.blur(),
    fieldEditSave: () => editor.blur(),
  };

  const editor = DropdownConditionEditor.create(owner, {
    editValue: value.get(),
    commands,
    onBlur: saveAndDispose,
    getAutocompleteSuggestions,
  });
  editor.attach(refElem);
  editor.onDispose(() => onDispose());
}

interface DropdownConditionEditorOptions {
  editValue: string;
  commands: IEditorCommandGroup;
  onBlur(): Promise<void>;
  getAutocompleteSuggestions(prefix: string): ISuggestionWithValue[];
}

class DropdownConditionEditor extends Disposable {
  private _aceEditor: any;
  private _dom: HTMLElement;
  private _editorPlacement!: EditorPlacement;
  private _placementHolder = Holder.create(this);
  private _isEmpty: Computed<boolean>;

  constructor(private _options: DropdownConditionEditorOptions) {
    super();

    const initialValue = _options.editValue;
    const editorState = Observable.create(this, initialValue);

    this._aceEditor = this.autoDispose(AceEditor.create({
      calcSize: this._calcSize.bind(this),
      editorState,
      getSuggestions: _options.getAutocompleteSuggestions,
    }));

    this._isEmpty = Computed.create(this, editorState, (_use, state) => state === '');
    this.autoDispose(this._isEmpty.addListener(() => this._updateEditorPlaceholder()));

    const commandGroup = this.autoDispose(createGroup({
      ..._options.commands,
    }, this, true));

    this._dom = cssDropdownConditionEditorWrapper(
      cssDropdownConditionEditor(
        createMobileButtons(_options.commands),
        this._aceEditor.buildDom((aceObj: any) => {
          initializeAceOptions(aceObj);
          const val = initialValue;
          const pos = val.length;
          this._aceEditor.setValue(val, pos);
          this._aceEditor.attachCommandGroup(commandGroup);
          if (val === '') {
            this._updateEditorPlaceholder();
          }
        })
      ),
    );
  }

  public attach(cellElem: Element): void {
    this._editorPlacement = EditorPlacement.create(this._placementHolder, this._dom, cellElem, {
      margins: getButtonMargins(),
    });
    this.autoDispose(this._editorPlacement.onReposition.addListener(this._aceEditor.resize, this._aceEditor));
    this._aceEditor.onAttach();
    this._updateEditorPlaceholder();
    this._aceEditor.resize();
    this._aceEditor.getEditor().focus();
    this._aceEditor.getEditor().on('blur', () => this._options.onBlur());
  }

  public getValue(): string {
    return this._aceEditor.getValue();
  }

  public blur() {
    this._aceEditor.getEditor().blur();
  }

  private _updateEditorPlaceholder() {
    const editor = this._aceEditor.getEditor();
    const shouldShowPlaceholder = editor.session.getValue().length === 0;
    if (editor.renderer.emptyMessageNode) {
      // Remove the current placeholder if one is present.
      editor.renderer.scroller.removeChild(editor.renderer.emptyMessageNode);
    }
    if (!shouldShowPlaceholder) {
      editor.renderer.emptyMessageNode = null;
    } else {
      editor.renderer.emptyMessageNode = cssDropdownConditionPlaceholder(t('Enter condition.'));
      editor.renderer.scroller.appendChild(editor.renderer.emptyMessageNode);
    }
  }

  private _calcSize(elem: HTMLElement, desiredElemSize: ISize) {
    const placeholder: HTMLElement | undefined = this._aceEditor.getEditor().renderer.emptyMessageNode;
    if (placeholder) {
      return this._editorPlacement.calcSizeWithPadding(elem, {
        width: placeholder.scrollWidth,
        height: placeholder.scrollHeight,
      });
    } else {
      return this._editorPlacement.calcSizeWithPadding(elem, {
        width: desiredElemSize.width,
        height: desiredElemSize.height,
      });
    }
  }
}

const cssDropdownConditionField = styled('div', `
  flex: auto;
  cursor: pointer;
  margin-top: 4px;

  &-disabled {
    opacity: 0.4;
    pointer-events: none;
  }
`);

const cssDropdownConditionEditorWrapper = styled('div.default_editor.formula_editor_wrapper', `
  border-radius: 3px;
`);

const cssDropdownConditionEditor = styled('div', `
  background-color: ${theme.aceEditorBg};
  padding: 5px;
  z-index: 10;
  overflow: hidden;
  flex: none;
  min-height: 22px;
  border-radius: 3px;
`);

const cssDropdownConditionPlaceholder = styled('div', `
  color: ${theme.lightText};
  font-style: italic;
  white-space: nowrap;
`);
