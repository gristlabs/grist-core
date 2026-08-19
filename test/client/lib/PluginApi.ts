import { mapColumnNames, mapColumnNamesBack } from "app/plugin/grist-plugin-api";

import { assert } from "chai";

describe("PluginApi", function() {
  it("should map columns according to configuration", function() {
    let mappings: any = { Foo: null, Bar: ["A", "B"], Baz: null };
    const record = { A: 1, B: 2, id: 1 };
    // When there are not mappings, it should return original data.
    assert.deepEqual(
      record,
      mapColumnNames(record),
    );
    assert.deepEqual(
      record,
      mapColumnNamesBack(record),
    );
    // Foo is not mapped, so it is left out of the result.
    assert.deepEqual(
      mapColumnNames(record, { mappings }),
      { id: 1, Bar: [1, 2] },
    );
    assert.deepEqual(
      mapColumnNames([record], { mappings }),
      [{ id: 1, Bar: [1, 2] }],
    );
    // Map Foo to A
    mappings = { ...mappings, Foo: "A" };
    // Should map as Foo is mapped
    assert.deepEqual(mapColumnNames(record, { mappings }), { id: 1, Foo: 1, Bar: [1, 2] });
    assert.deepEqual(mapColumnNames([record], { mappings }), [{ id: 1, Foo: 1, Bar: [1, 2] }]);
    assert.deepEqual(mapColumnNamesBack([{ id: 1, Foo: 1, Bar: [1, 2] }], { mappings }), [record]);
    // Map Baz
    mappings = { ...mappings, Baz: "B" };
    assert.deepEqual(mapColumnNames(record, { mappings }), { id: 1, Foo: 1, Bar: [1, 2], Baz: 2 });
    assert.deepEqual(mapColumnNames([record], { mappings }), [{ id: 1, Foo: 1, Bar: [1, 2], Baz: 2 }]);
    assert.deepEqual(mapColumnNamesBack([{ id: 1, Foo: 1, Bar: [1, 2], Baz: 5 }], { mappings }),
      [{ id: 1, A: 1, B: 5 }]);
  });
  it("should ignore when there are not mappings requested", function() {
    const mappings: any = undefined;
    const record = { A: 1, B: 2, id: 1 };
    assert.deepEqual(
      mapColumnNames(record, { mappings }),
      record,
    );
  });
});
