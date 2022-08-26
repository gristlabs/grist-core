import * as UserType from 'app/client/widgets/UserType';
import {ColumnToMap} from 'app/plugin/CustomSectionAPI';

/**
 * Helper that wraps custom widget's column definition and expands all the defaults.
 */
export class ColumnToMapImpl implements Required<ColumnToMap> {
  // Name of the column Custom Widget expects.
  public name: string;
  // Label to show instead of the name.
  public title: string;
  // Human description of the column.
  public description: string;
  // If column is optional (used only on the UI).
  public optional: boolean;
  // Type of the column that widget expects.
  public type: string;
  // Description of the type (used to show a placeholder).
  public typeDesc: string;
  // Allow multiple column assignment (like Series in Charts).
  public allowMultiple: boolean;
  constructor(def: string|ColumnToMap) {
    this.name = typeof def === 'string' ? def : def.name;
    this.title = typeof def === 'string' ? def : (def.title ?? def.name);
    this.description = typeof def === 'string' ? '' : (def.description ?? '');
    this.optional = typeof def === 'string' ? false : (def.optional ?? false);
    this.type = typeof def === 'string' ? 'Any' : (def.type ?? 'Any');
    this.typeDesc = String(UserType.typeDefs[this.type]?.label ?? "any").toLowerCase();
    this.allowMultiple = typeof def === 'string' ? false : (def.allowMultiple ?? false);
  }

  /**
   * Does the column type matches this definition.
   */
  public canByMapped(pureType: string) {
    return pureType === this.type
      || pureType === "Any"
      || this.type === "Any";
  }
}
