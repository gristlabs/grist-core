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
  // "Any" means that any type is allowed (unless strictType is true).
  public type: string;
  // If true, the column type is strict and cannot be any type.
  public strictType: boolean;
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
    this.strictType = typeof def === 'string' ? false : (def.strictType ?? false);
  }

  /**
   * Does the column type matches this definition.
   *
   * Here are use case examples, for better understanding (Any is treated as a star):
   * 1. Widget sets "Text", user can map to "Text" or "Any".
   * 2. Widget sets "Any", user can map to "Int", "Toggle", "Any" and any other type.
   * 3. Widget sets "Text,Int", user can map to "Text", "Int", "Any"
   *
   * With strictType, the Any in the widget is treated as Any, not a star.
   * 1. Widget sets "Text", user can map to "Text".
   * 2. Widget sets "Any", user can map to "Any". Not to "Text", "Int", etc. NOTICE: here Any in widget is not a star,
   *    widget expects Any as a type so "Toggle" column won't be allowed.
   * 3. Widget sets "Text,Int", user can only map to "Text", "Int".
   * 4. Widget sets "Text,Any", user can only map to "Text", "Any".
   */
  public canByMapped(pureType: string) {
    const isAny = pureType === "Any" || this.type === "Any";
    return this.type.split(',').includes(pureType) || (isAny && !this.strictType);
  }
}
