import * as modelUtil from 'app/client/models/modelUtil';
// This is circular import, but only for types so it's fine.
import type {DocModel, ViewFieldRec} from 'app/client/models/DocModel';
import * as UserType from 'app/client/widgets/UserType';
import {ifNotSet} from 'app/common/gutil';
import * as ko from 'knockout';
import intersection from "lodash/intersection";
import isEqual from "lodash/isEqual";
import zip from 'lodash/zip';

export class ViewFieldConfig {
  /** If there are multiple columns selected in the viewSection */
  public multiselect: ko.Computed<boolean>;
  /** If all selected columns have the same widget list. */
  public sameWidgets: ko.Computed<boolean>;
  /** Widget options for a field or multiple fields. Doesn't contain style options */
  public options: CommonOptions;
  /** Style options for a field or multiple fields  */
  public style: ko.Computed<StyleOptions>;
  /** Header style options for a field or multiple fields  */
  public headerStyle: ko.Computed<StyleOptions>;

  // Rest of the options mimic the same options from ViewFieldRec.
  public wrap: modelUtil.KoSaveableObservable<boolean|undefined>;
  public widget: ko.Computed<string|undefined>;
  public alignment: modelUtil.KoSaveableObservable<string|undefined>;
  public fields: ko.PureComputed<ViewFieldRec[]>;
  constructor(private _field: ViewFieldRec, private _docModel: DocModel) {
    // Everything here will belong to a _field, this class is just a builder.
    const owner = _field;

    // Get all selected fields from the viewSection, if there is only one field
    // selected (or the selection is empty) return it in an array.
    this.fields = owner.autoDispose(ko.pureComputed(() => {
      const list = this._field.viewSection().selectedFields();
      if (!list || !list.length) {
        return [_field];
      }
      // Make extra sure that field and column is not disposed, most of the knockout
      // based entities, don't dispose their computed observables. As we keep references
      // for them, it can happen that some of them are disposed while we are still
      // computing something (mainly when columns are removed or restored using undo).
      return list.filter(f => !f.isDisposed() && !f.column().isDisposed());
    }));

    // Just a helper field to see if we have multiple selected columns or not.
    this.multiselect = owner.autoDispose(ko.pureComputed(() => this.fields().length > 1));

    // Calculate if all columns share the same allowed widget list (like for Numeric type
    // we have normal TextBox and Spinner). This will be used to allow the user to change
    // this type if such columns are selected.
    this.sameWidgets = owner.autoDispose(ko.pureComputed(() => {
      const list = this.fields();
      // If we have only one field selected, list is always the same.
      if (list.length <= 1) { return true; }
      // Now get all widget list and calculate intersection of the Sets.
      // Widget types are just strings defined in UserType.
      const widgets = list.map(c =>
        Object.keys(UserType.typeDefs[c.column().pureType()]?.widgets ?? {})
      );
      return intersection(...widgets).length === widgets[0]?.length;
    }));

    // Changing widget type is not trivial, as we need to carefully reset all
    // widget options to their default values, and there is a nuance there.
    this.widget = owner.autoDispose(ko.pureComputed({
      read: () => {
        // For single column, just return its widget type.
        if (!this.multiselect()) {
          return this._field.widget();
        }
        // If all have the same value, return it, otherwise
        // return a default value for this option "undefined"
        const values = this.fields().map(f => f.widget());
        if (allSame(values)) {
          return values[0];
        } else {
          return undefined;
        }
      },
      write: (widget) => {
        // Go through all the fields, and reset them all.
        for(const field of this.fields.peek()) {
          // Reset the entire JSON, so that all options revert to their defaults.
          const previous = field.widgetOptionsJson.peek();
          // We don't need to bundle anything (actions send in the same tick, are bundled
          // by default).
          field.widgetOptionsJson.setAndSave({
            widget,
            // Persists color settings across widgets (note: we cannot use `field.fillColor` to get the
            // current value because it returns a default value for `undefined`. Same for `field.textColor`.
            fillColor: previous.fillColor,
            textColor: previous.textColor,
          }).catch(reportError);
        }
      }
    }));

    // Calculate common options for all column types (and their widgets).
    // We will use this, to know which options are allowed to be changed
    // when multiple columns are selected.
    const commonOptions = owner.autoDispose(ko.pureComputed(() => {
      const fields = this.fields();
      // Put all options of first widget in the Set, and then remove
      // them one by one, if they are not present in other fields.
      let options: Set<string>|null = null;
      for(const field of fields) {
        // First get the data, and prepare initial set.
        const widget = field.widget() || '';
        const widgetOptions = UserType.typeDefs[field.column().pureType()]?.widgets[widget]?.options;
        if (!widgetOptions) { continue; }
        if (!options) { options = new Set(Object.keys(widgetOptions)); }
        else {
          // And now remove options that are not common.
          const newOptions = new Set(Object.keys(widgetOptions));
          for(const key of options) {
            if (!newOptions.has(key)) {
              options.delete(key);
            }
          }
        }
      }
      return options ?? new Set();
    }));

    // Prepare our "multi" widgetOptionsJson, that can read and save
    // options for multiple columns.
    const options = modelUtil.savingComputed({
      read: () => {
        // For one column, just proxy this to the field.
        if (!this.multiselect()) {
          return this._field.widgetOptionsJson();
        }
        // Assemble final json object.
        const result: any = {};
        // First get all widgetOption jsons from all columns/fields.
        const optionList = this.fields().map(f => f.widgetOptionsJson());
        // And fill only those that are common
        const common = commonOptions();
        for(const key of common) {
          // Setting null means that this options is there, but has no value.
          result[key] = null;
          // If all columns have the same value, use it.
          if (allSame(optionList.map(v => v[key]))) {
            result[key] = optionList[0][key] ?? null;
          }
        }
        return result;
      },
      write: (setter, value) => {
        if (!this.multiselect.peek()) {
          return setter(this._field.widgetOptionsJson, value);
        }
        // When the creator panel is saving widgetOptions, it will pass
        // our virtual widgetObject, which has nulls for mixed values.
        // If this option wasn't changed (set), we don't want to save it.
        value = {...value};
        for(const key of Object.keys(value)) {
          if (value[key] === null) {
            delete value[key];
          }
        }
        // Now update all options, for all fields, by amending the options
        // object from the field/column.
        for(const item of this.fields.peek()) {
          const previous = item.widgetOptionsJson.peek();
          setter(item.widgetOptionsJson, {
            ...previous,
            ...value,
          });
        }
      }
    });

    // We need some additional information about each property.
    this.options = owner.autoDispose(extendObservable(modelUtil.objObservable(options), {
      // Property is not supported by set of columns if it is not a common option.
      disabled: prop => ko.pureComputed(() => !commonOptions().has(prop)),
      // Property has mixed value, if not all options are the same.
      mixed: prop => ko.pureComputed(() => !allSame(this.fields().map(f => f.widgetOptionsJson.prop(prop)()))),
      // Property has empty value, if all options are empty (are null, undefined, empty Array or empty Object).
      empty: prop => ko.pureComputed(() => allEmpty(this.fields().map(f => f.widgetOptionsJson.prop(prop)()))),
    }));

    // This is repeated logic for wrap property in viewFieldRec,
    // every field has wrapping implicitly set to true on a card view.
    this.wrap = modelUtil.fieldWithDefault(
      this.options.prop('wrap'),
      () => this._field.viewSection().parentKey() !== 'record'
    );

    this.alignment = this.options.prop('alignment');

    // Style options are a bit different, as they are saved when style picker is disposed.
    // By the time it happens, fields may have changed (since user might have clicked some other column).
    // To support this use case we need to compute a snapshot of fields, and use it to save style. Style
    // picker will be rebuild every time fields change, and it will have access to last selected fields
    // when it will be disposed.
    this.style = ko.pureComputed(() => {
      const fields = this.fields();
      const multiSelect = fields.length > 1;
      const savableOptions = modelUtil.savingComputed({
        read: () => {
          // For one column, just proxy this to the field.
          if (!multiSelect) {
            return this._field.widgetOptionsJson();
          }
          // Assemble final json object.
          const result: any = {};
          // First get all widgetOption jsons from all columns/fields.
          const optionList = fields.map(f => f.widgetOptionsJson());
          // And fill only those that are common
          for(const key of ['textColor', 'fillColor', 'fontBold',
                            'fontItalic', 'fontUnderline', 'fontStrikethrough']) {
            // Setting null means that this options is there, but has no value.
            result[key] = null;
            // If all columns have the same value, use it.
            if (allSame(optionList.map(v => v[key]))) {
              result[key] = optionList[0][key] ?? null;
            }
          }
          return result;
        },
        write: (setter, value) => {
          if (!multiSelect) {
            return setter(this._field.widgetOptionsJson, value);
          }
          // When the creator panel is saving widgetOptions, it will pass
          // our virtual widgetObject, which has nulls for mixed values.
          // If this option wasn't changed (set), we don't want to save it.
          value = {...value};
          for(const key of Object.keys(value)) {
            if (value[key] === null) {
              delete value[key];
            }
          }
          // Now update all options, for all fields, by amending the options
          // object from the field/column.
          for(const item of fields) {
            const previous = item.widgetOptionsJson.peek();
            setter(item.widgetOptionsJson, {
              ...previous,
              ...value,
            });
          }
        }
      });
      // Style picker needs to be able revert to previous value, if user cancels.
      const state = fields.map(f => f.style.peek());
      // We need some additional information about each property.
      const result: StyleOptions = extendObservable(modelUtil.objObservable(savableOptions), {
        // Property has mixed value, if not all options are the same.
        mixed: prop => ko.pureComputed(() => !allSame(fields.map(f => f.widgetOptionsJson.prop(prop)()))),
        // Property has empty value, if all options are empty (are null, undefined, empty Array or empty Object).
        empty: prop => ko.pureComputed(() => allEmpty(fields.map(f => f.widgetOptionsJson.prop(prop)()))),
      });
      result.revert = () => { zip(fields, state).forEach(([f, s]) => f!.style(s!)); };
      return result;
    });

    this.headerStyle = ko.pureComputed(() => {
      const fields = this.fields();
      const multiSelect = fields.length > 1;
      const savableOptions = modelUtil.savingComputed({
        read: () => {
          // For one column, just proxy this to the field.
          if (!multiSelect) {
            return this._field.widgetOptionsJson();
          }
          // Assemble final json object.
          const result: any = {};
          // First get all widgetOption jsons from all columns/fields.
          const optionList = fields.map(f => f.widgetOptionsJson());
          // And fill only those that are common
          for(const key of ['headerTextColor', 'headerFillColor', 'headerFontBold',
                            'headerFontItalic', 'headerFontUnderline', 'headerFontStrikethrough']) {
            // Setting null means that this options is there, but has no value.
            result[key] = null;
            // If all columns have the same value, use it.
            if (allSame(optionList.map(v => v[key]))) {
              result[key] = optionList[0][key] ?? null;
            }
          }
          return result;
        },
        write: (setter, value) => {
          if (!multiSelect) {
            return setter(this._field.widgetOptionsJson, value);
          }
          // When the creator panel is saving widgetOptions, it will pass
          // our virtual widgetObject, which has nulls for mixed values.
          // If this option wasn't changed (set), we don't want to save it.
          value = {...value};
          for(const key of Object.keys(value)) {
            if (value[key] === null) {
              delete value[key];
            }
          }
          // Now update all options, for all fields, by amending the options
          // object from the field/column.
          for(const item of fields) {
            const previous = item.widgetOptionsJson.peek();
            setter(item.widgetOptionsJson, {
              ...previous,
              ...value,
            });
          }
        }
      });
      // Style picker needs to be able revert to previous value, if user cancels.
      const state = fields.map(f => f.headerStyle.peek());
      // We need some additional information about each property.
      const result: StyleOptions = extendObservable(modelUtil.objObservable(savableOptions), {
        // Property has mixed value, if not all options are the same.
        mixed: prop => ko.pureComputed(() => !allSame(fields.map(f => f.widgetOptionsJson.prop(prop)()))),
        // Property has empty value, if all options are empty (are null, undefined, empty Array or empty Object).
        empty: prop => ko.pureComputed(() => allEmpty(fields.map(f => f.widgetOptionsJson.prop(prop)()))),
      });
      result.revert = () => { zip(fields, state).forEach(([f, s]) => f!.headerStyle(s!)); };
      return result;
    });
  }

  // Helper for Choice/ChoiceList columns, that saves widget options and renames values in a document
  // in one bundle
  public async updateChoices(renames: Record<string, string>, options: any){
    const hasRenames = !!Object.entries(renames).length;
    const tableId = this._field.column.peek().table.peek().tableId.peek();
    if (this.multiselect.peek()) {
      this._field.config.options.update(options);
      const colIds = this.fields.peek().map(f => f.colId.peek());
      return this._docModel.docData.bundleActions("Update choices configuration", () => Promise.all([
        this._field.config.options.save(),
        !hasRenames ? null : this._docModel.docData.sendActions(
          colIds.map(colId => ["RenameChoices", tableId, colId, renames])
        )
      ]));
    } else {
      const column = this._field.column.peek();
      // In case this column is being transformed - using Apply Formula to Data, bundle the action
      // together with the transformation.
      const actionOptions = {nestInActiveBundle: column.isTransforming.peek()};
      this._field.widgetOptionsJson.update(options);
      return this._docModel.docData.bundleActions("Update choices configuration", () => Promise.all([
        this._field.widgetOptionsJson.save(),
        !hasRenames ? null
        : this._docModel.docData.sendAction(["RenameChoices", tableId, column.colId.peek(), renames])
      ]), actionOptions);
    }

  }
}

/**
 * Deeply checks that all elements in a list are equal. Equality is checked by first
 * converting "empty like" elements to null and then deeply comparing the elements.
 */
function allSame(arr: any[]) {
  if (arr.length <= 1) { return true; }
  const first = ifNotSet(arr[0], null);
  const same = arr.every(next => {
    return isEqual(ifNotSet(next, null), first);
  });
  return same;
}

/**
 * Checks if every item in a list is empty (empty like in empty string, null, undefined, empty Array or Object)
 */
function allEmpty(arr: any[]) {
  if (arr.length === 0) { return true; }
  return arr.every(item => ifNotSet(item, null) === null);
}

/**
 * Extended version of widget options observable that contains information about mixed and empty values.
 */
type CommonOptions = modelUtil.SaveableObjObservable<any> & {
  disabled(prop: string): ko.Computed<boolean>,
  mixed(prop: string): ko.Computed<boolean>,
  empty(prop: string): ko.Computed<boolean>,
}

/**
 * Extended version of widget options observable that contains information about mixed and empty styles, and supports
 * reverting to a previous value.
 */
type StyleOptions = modelUtil.SaveableObjObservable<any> & {
  mixed(prop: string): ko.Computed<boolean>,
  empty(prop: string): ko.Computed<boolean>,
  revert(): void;
}

// This is helper that adds disabled computed to an ObjObservable, it follows
// the same pattern as `prop` helper.
function extendObservable(
  obs: modelUtil.SaveableObjObservable<any>,
  options: { [key: string]: (prop: string) => ko.PureComputed<boolean> }
) {
  const result = obs as any;
  for(const key of Object.keys(options)) {
    const cacheKey = `__${key}`;
    result[cacheKey] = new Map();
    result[key] = (prop: string) => {
      if (!result[cacheKey].has(prop)) {
        result[cacheKey].set(prop, options[key](prop));
      }
      return result[cacheKey].get(prop);
    };
  }

  return result;
}
