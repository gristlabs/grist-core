import {ALL_INCLUSIVE_FILTER_JSON, ColumnFilter} from 'app/client/models/ColumnFilter';
import {GristObjCode} from 'app/plugin/GristData';
import {CellValue} from 'app/common/DocActions';
import {assert} from 'chai';

const L = GristObjCode.List;

describe('ColumnFilter', function() {
  it('should properly initialize from JSON spec', async function() {
    let filter = new ColumnFilter('{ "excluded": ["Alice", "Bob"] }');

    assert.isFalse(filter.includes('Alice'));
    assert.isFalse(filter.includes('Bob'));
    assert.isTrue(filter.includes('Carol'));

    filter = new ColumnFilter('{ "included": ["Alice", "Bob"] }');

    assert.isTrue(filter.includes('Alice'));
    assert.isTrue(filter.includes('Bob'));
    assert.isFalse(filter.includes('Carol'));

    filter = new ColumnFilter('');
    assert.isTrue(filter.includes('Alice'));
    assert.isTrue(filter.includes('Bob'));
    assert.isTrue(filter.includes('Carol'));
  });

  it('should allow adding and removing values to existing filter', async function() {
    let filter = new ColumnFilter('{ "excluded": ["Alice", "Bob"] }');

    assert.isFalse(filter.includes('Alice'));
    assert.isFalse(filter.includes('Bob'));
    assert.isTrue(filter.includes('Carol'));

    filter.add('Alice');
    filter.add('Carol');

    assert.isTrue(filter.includes('Alice'));
    assert.isFalse(filter.includes('Bob'));
    assert.isTrue(filter.includes('Carol'));

    filter.delete('Carol');

    assert.isTrue(filter.includes('Alice'));
    assert.isFalse(filter.includes('Bob'));
    assert.isFalse(filter.includes('Carol'));

    filter = new ColumnFilter('{ "included": ["Alice", "Bob"] }');
    assert.isTrue(filter.includes('Alice'));
    assert.isTrue(filter.includes('Bob'));
    assert.isFalse(filter.includes('Carol'));

    filter.delete('Alice');
    filter.add('Carol');
    assert.isFalse(filter.includes('Alice'));
    assert.isTrue(filter.includes('Bob'));
    assert.isTrue(filter.includes('Carol'));
  });

  it('should generate an all-inclusive filter from empty string/object or null', async function() {
    const filter = new ColumnFilter('');
    const defaultJson = filter.makeFilterJson();
    assert.equal(defaultJson, ALL_INCLUSIVE_FILTER_JSON);

    filter.clear();
    assert.equal(filter.makeFilterJson(), '{"included":[]}');

    filter.selectAll();
    assert.equal(filter.makeFilterJson(), defaultJson);

    // Check that the string 'null' initializes properly
    assert.equal(new ColumnFilter('null').makeFilterJson(), ALL_INCLUSIVE_FILTER_JSON);

    // Check that the empty object initializes properly
    assert.equal(new ColumnFilter('{}').makeFilterJson(), ALL_INCLUSIVE_FILTER_JSON);
  });

  it('should generate a proper FilterFunc and JSON string', async function() {
    const data = ['Carol', 'Alice', 'Bar', 'Bob', 'Alice', 'Baz'];
    const filterJson = '{"included":["Alice","Bob"]}';
    const filter = new ColumnFilter(filterJson);

    assert.equal(filter.makeFilterJson(), filterJson);
    assert.deepEqual(data.filter(filter.filterFunc.get()), ['Alice', 'Bob', 'Alice']);
    assert.isFalse(filter.hasChanged()); // `hasChanged` compares to the original JSON used to initialize ColumnFilter

    filter.add('Carol');
    assert.equal(filter.makeFilterJson(), '{"included":["Alice","Bob","Carol"]}');
    assert.deepEqual(data.filter(filter.filterFunc.get()), ['Carol', 'Alice', 'Bob', 'Alice']);
    assert.isTrue(filter.hasChanged());

    filter.delete('Alice');
    assert.equal(filter.makeFilterJson(), '{"included":["Bob","Carol"]}');
    assert.deepEqual(data.filter(filter.filterFunc.get()), ['Carol', 'Bob']);
    assert.isTrue(filter.hasChanged());

    filter.selectAll();
    assert.equal(filter.makeFilterJson(), '{"excluded":[]}');
    assert.deepEqual(data.filter(filter.filterFunc.get()), data);
    assert.isTrue(filter.hasChanged());

    filter.add('Alice');
    assert.equal(filter.makeFilterJson(), '{"excluded":[]}');
    assert.deepEqual(data.filter(filter.filterFunc.get()), data);
    assert.isTrue(filter.hasChanged());

    filter.delete('Alice');
    assert.equal(filter.makeFilterJson(), '{"excluded":["Alice"]}');
    assert.deepEqual(data.filter(filter.filterFunc.get()), ['Carol', 'Bar', 'Bob', 'Baz']);
    assert.isTrue(filter.hasChanged());

    filter.clear();
    assert.equal(filter.makeFilterJson(), '{"included":[]}');
    assert.deepEqual(data.filter(filter.filterFunc.get()), []);
    assert.isTrue(filter.hasChanged());

    filter.add('Alice');
    assert.equal(filter.makeFilterJson(), '{"included":["Alice"]}');
    assert.deepEqual(data.filter(filter.filterFunc.get()), ['Alice', 'Alice']);
    assert.isTrue(filter.hasChanged());

    filter.add('Bob');
    assert.equal(filter.makeFilterJson(), '{"included":["Alice","Bob"]}');
    assert.deepEqual(data.filter(filter.filterFunc.get()), ['Alice', 'Bob', 'Alice']);
    assert.isFalse(filter.hasChanged()); // We're back to the same state, so `hasChanged()` should be false
  });

  it('should generate a proper FilterFunc for Choice List columns', async function() {
    const data: CellValue[] = [[L, 'Alice', 'Carol'], [L, 'Alice', 'Bob'], [L, 'Bar'], [L, 'Bob'], null];
    const filterJson = '{"included":["Alice","Bob"]}';
    const filter = new ColumnFilter(filterJson, 'ChoiceList');

    assert.equal(filter.makeFilterJson(), filterJson);
    assert.deepEqual(data.filter(filter.filterFunc.get()),
                     [[L, 'Alice', 'Carol'], [L, 'Alice', 'Bob'], [L, 'Bob']]);
    assert.isFalse(filter.hasChanged()); // `hasChanged` compares to the original JSON used to initialize ColumnFilter

    filter.add('Bar');
    assert.equal(filter.makeFilterJson(), '{"included":["Alice","Bar","Bob"]}');
    assert.deepEqual(data.filter(filter.filterFunc.get()),
                     [[L, 'Alice', 'Carol'], [L, 'Alice', 'Bob'], [L, 'Bar'], [L, 'Bob']]);
    assert.isTrue(filter.hasChanged());

    filter.delete('Alice');
    assert.equal(filter.makeFilterJson(), '{"included":["Bar","Bob"]}');
    assert.deepEqual(data.filter(filter.filterFunc.get()),
                     [[L, 'Alice', 'Bob'], [L, 'Bar'], [L, 'Bob']]);
    assert.isTrue(filter.hasChanged());

    filter.selectAll();
    assert.equal(filter.makeFilterJson(), '{"excluded":[]}');
    assert.deepEqual(data.filter(filter.filterFunc.get()), data);
    assert.isTrue(filter.hasChanged());

    filter.add('Alice');
    assert.equal(filter.makeFilterJson(), '{"excluded":[]}');
    assert.deepEqual(data.filter(filter.filterFunc.get()), data);
    assert.isTrue(filter.hasChanged());

    filter.delete('Alice');
    assert.equal(filter.makeFilterJson(), '{"excluded":["Alice"]}');
    assert.deepEqual(data.filter(filter.filterFunc.get()),
                     [[L, 'Alice', 'Carol'], [L, 'Alice', 'Bob'], [L, 'Bar'], [L, 'Bob'], null]);
    assert.isTrue(filter.hasChanged());

    filter.clear();
    assert.equal(filter.makeFilterJson(), '{"included":[]}');
    assert.deepEqual(data.filter(filter.filterFunc.get()), []);
    assert.isTrue(filter.hasChanged());

    filter.add('Alice');
    assert.equal(filter.makeFilterJson(), '{"included":["Alice"]}');
    assert.deepEqual(data.filter(filter.filterFunc.get()),
                     [[L, 'Alice', 'Carol'], [L, 'Alice', 'Bob']]);
    assert.isTrue(filter.hasChanged());

    filter.add('Bob');
    assert.equal(filter.makeFilterJson(), '{"included":["Alice","Bob"]}');
    assert.deepEqual(data.filter(filter.filterFunc.get()),
                     [[L, 'Alice', 'Carol'], [L, 'Alice', 'Bob'], [L, 'Bob']]);
    assert.isFalse(filter.hasChanged()); // We're back to the same state, so `hasChanged()` should be false
  });
});
