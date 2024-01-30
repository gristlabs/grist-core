import {AttachmentsEditor} from 'app/client/widgets/AttachmentsEditor';
import {AttachmentsWidget} from 'app/client/widgets/AttachmentsWidget';
import CheckBoxEditor from 'app/client/widgets/CheckBoxEditor';
import ChoiceEditor from 'app/client/widgets/ChoiceEditor';
import {ChoiceListCell} from 'app/client/widgets/ChoiceListCell';
import {ChoiceListEditor} from 'app/client/widgets/ChoiceListEditor';
import {ChoiceTextBox} from 'app/client/widgets/ChoiceTextBox';
import DateEditor from 'app/client/widgets/DateEditor';
import DateTextBox from 'app/client/widgets/DateTextBox';
import DateTimeEditor from 'app/client/widgets/DateTimeEditor';
import DateTimeTextBox from 'app/client/widgets/DateTimeTextBox';
import {HyperLinkEditor} from 'app/client/widgets/HyperLinkEditor';
import {HyperLinkTextBox} from 'app/client/widgets/HyperLinkTextBox';
import {NewAbstractWidget} from 'app/client/widgets/NewAbstractWidget';
import {NewBaseEditor} from 'app/client/widgets/NewBaseEditor';
import {NTextBox} from 'app/client/widgets/NTextBox';
import {NTextEditor} from 'app/client/widgets/NTextEditor';
import {NumericEditor} from 'app/client/widgets/NumericEditor';
import {NumericTextBox} from 'app/client/widgets/NumericTextBox';
import {Reference} from 'app/client/widgets/Reference';
import {ReferenceEditor} from 'app/client/widgets/ReferenceEditor';
import {ReferenceList} from 'app/client/widgets/ReferenceList';
import {ReferenceListEditor} from 'app/client/widgets/ReferenceListEditor';
import {Spinner} from 'app/client/widgets/Spinner';
import {ToggleCheckBox, ToggleSwitch} from 'app/client/widgets/Toggle';
import {getWidgetConfiguration} from 'app/client/widgets/UserType';
import {GristType} from 'app/plugin/GristData';

/**
 * Convert the name of a widget to its implementation.
 */
export const nameToWidget = {
  'TextBox': NTextBox,
  'TextEditor': NTextEditor,
  'NumericTextBox': NumericTextBox,
  'NumericEditor': NumericEditor,
  'HyperLinkTextBox': HyperLinkTextBox,
  'HyperLinkEditor': HyperLinkEditor,
  'Spinner': Spinner,
  'CheckBox': ToggleCheckBox,
  'CheckBoxEditor': CheckBoxEditor,
  'Reference': Reference,
  'Switch': ToggleSwitch,
  'ReferenceEditor': ReferenceEditor,
  'ReferenceList': ReferenceList,
  'ReferenceListEditor': ReferenceListEditor,
  'ChoiceTextBox': ChoiceTextBox,
  'ChoiceEditor': ChoiceEditor,
  'ChoiceListCell': ChoiceListCell,
  'ChoiceListEditor': ChoiceListEditor,
  'DateTimeTextBox': DateTimeTextBox,
  'DateTextBox': DateTextBox,
  'DateEditor': DateEditor,
  'AttachmentsWidget': AttachmentsWidget,
  'AttachmentsEditor': AttachmentsEditor,
  'DateTimeEditor': DateTimeEditor,
};


export interface WidgetConstructor {create: (...args: any[]) => NewAbstractWidget}

/** return a good class to instantiate for viewing a widget/type combination */
export function getWidgetConstructor(widget: string, type: string): WidgetConstructor {
  const {config} = getWidgetConfiguration(widget, type as GristType);
  return nameToWidget[config.cons as keyof typeof nameToWidget] as any;
}

/** return a good class to instantiate for editing a widget/type combination */
export function getEditorConstructor(widget: string, type: string): typeof NewBaseEditor {
  const {config} = getWidgetConfiguration(widget, type as GristType);
  return nameToWidget[config.editCons as keyof typeof nameToWidget] as any;
}
