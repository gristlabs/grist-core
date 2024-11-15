import {makeId} from 'app/server/lib/idUtils';
import {assert} from 'chai';

describe('idUtils', function() {
  this.timeout(10000);

  it('makes distinct ids with consistent length', function() {
    const ids = new Set<string>();
    for (let i = 0; i < 10000; i++) {
      const id = makeId();
      assert.lengthOf(id, 22);
      assert.equal(ids.has(id), false);
      ids.add(id);
    }
  });
});
