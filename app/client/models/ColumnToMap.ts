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
  // Type of the column that widget expects. Might be a single or a comma separated list of types.
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
    this.type = this.type.split(',').map(t => t.trim()).filter(Boolean).join(',');
    this.typeDesc = this.type.split(',')
      .map(t => String(UserType.typeDefs[t]?.label ?? "any").toLowerCase()).join(', ');
    this.allowMultiple = typeof def === 'string' ? false : (def.allowMultiple ?? false);
  }

  /**
   * Does the column type matches this definition.
   */
  public canByMapped(pureType: string) {
    return this.type.split(',').includes(pureType)
      || pureType === "Any"
      || this.type === "Any";
  }
}
