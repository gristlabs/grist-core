import {assert} from 'chai';
import {ColumnsToMap, mapColumnNames, mapColumnNamesBack} from 'app/plugin/grist-plugin-api';

describe('PluginApi', function () {
  it('should map columns according to configuration', function () {
    const columns: ColumnsToMap = ['Foo', {name: 'Bar', allowMultiple: true}, {name: 'Baz', optional: true}];
    let mappings: any = {Foo: null, Bar: ['A', 'B'], Baz: null};
    const record = {A: 1, B: 2, id: 1};
    // When there are not mappings, it should return original data.
    assert.deepEqual(
      record,
      mapColumnNames(record)
    );
    assert.deepEqual(
      record,
      mapColumnNamesBack(record)
    );
    // Foo is not mapped, should be null.
    assert.isNull(
      mapColumnNames(record, {
        mappings,
        columns,
      })
    );
    assert.isNull(
      mapColumnNames([record], {
        mappings,
        columns,
      })
    );
    // Map Foo to A
    mappings = {...mappings, Foo: 'A'};
    // Should map as Foo is mapped
    assert.deepEqual(mapColumnNames(record, {mappings, columns}), {id: 1, Foo: 1, Bar: [1, 2]});
    assert.deepEqual(mapColumnNames([record], {mappings, columns}), [{id: 1, Foo: 1, Bar: [1, 2]}]);
    assert.deepEqual(mapColumnNamesBack([{id: 1, Foo: 1, Bar: [1, 2]}], {mappings, columns}), [record]);
    // Map Baz
    mappings = {...mappings, Baz: 'B'};
    assert.deepEqual(mapColumnNames(record, {mappings, columns}), {id: 1, Foo: 1, Bar: [1, 2], Baz: 2});
    assert.deepEqual(mapColumnNames([record], {mappings, columns}), [{id: 1, Foo: 1, Bar: [1, 2], Baz: 2}]);
    assert.deepEqual(mapColumnNamesBack([{id: 1, Foo: 1, Bar: [1, 2], Baz: 5}], {mappings, columns}),
                     [{id: 1, A: 1, B: 5}]);
  });
  it('should ignore when there are not mappings requested', function () {
    const columns: ColumnsToMap|undefined = undefined;
    const mappings: any = undefined;
    const record = {A: 1, B: 2, id: 1};
    assert.deepEqual(
      mapColumnNames(record, {
        mappings,
        columns,
      }),
      record
    );
  });
});
