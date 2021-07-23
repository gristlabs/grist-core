import {NTextEditor} from 'app/client/widgets/NTextEditor';
import {CellValue} from "app/common/DocActions";


/**
 * A ReferenceListEditor offers an autocomplete of choices from the referenced table.
 */
export class ReferenceListEditor extends NTextEditor {
  public getCellValue(): CellValue {
    try {
      return ['L', ...JSON.parse(this.textInput.value)];
    } catch {
      return null;   // This is the default value for a reference list column.
    }
  }
}
