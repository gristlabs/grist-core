import { DocState } from 'app/common/UserAPI';
import { HashUtil } from 'app/server/lib/HashUtil';
import { assert } from 'chai';

describe('HashUtil', function() {
  const states: DocState[] = [{n: 4, h: '4123'}, {n: 3, h: '3123'}, {n: 2, h: '2123'}, {n: 1, h: '1123'}];
  const finder = new HashUtil(states);

  it('understands HEAD', function() {
    assert.equal(finder.hashToOffset('HEAD'), 0);
    assert.throws(() => finder.hashToOffset('head'));
  });

  it('understands HASH', function() {
    assert.equal(finder.hashToOffset('3123'), 1);
    assert.throws(() => finder.hashToOffset('312355'));
  });

  it('understands ~', function() {
    assert.equal(finder.hashToOffset('3123~'), 2);
    assert.equal(finder.hashToOffset('3123~1'), 2);
    assert.equal(finder.hashToOffset('3123~2'), 3);
    assert.equal(finder.hashToOffset('3123~3'), 4);
    assert.equal(finder.hashToOffset('HEAD~'), 1);
    assert.equal(finder.hashToOffset('HEAD~~'), 2);
    assert.equal(finder.hashToOffset('HEAD~~~'), 3);
    assert.equal(finder.hashToOffset('HEAD~~~~'), 4);
    assert.equal(finder.hashToOffset('4123'), 0);
    assert.equal(finder.hashToOffset('4123~2~'), 3);
    assert.equal(finder.hashToOffset('4123~1~1~1'), 3);
    assert.equal(finder.hashToOffset('4123~~~1'), 3);
    assert.throws(() => finder.hashToOffset('~'));
    assert.throws(() => finder.hashToOffset('~~'));
    assert.throws(() => finder.hashToOffset('~e'));
    assert.throws(() => finder.hashToOffset('HEAD~e'));
  });

  it('understands ^', function() {
    assert.equal(finder.hashToOffset('3123^1'), 2);
    assert.equal(finder.hashToOffset('3123^1^1'), 3);
    assert.equal(finder.hashToOffset('3123^1^1^1'), 4);
    assert.equal(finder.hashToOffset('HEAD^1'), 1);
    assert.equal(finder.hashToOffset('HEAD^'), 1);
    assert.equal(finder.hashToOffset('HEAD^^'), 2);
    assert.throws(() => finder.hashToOffset('^'));
    assert.throws(() => finder.hashToOffset('HEAD^2'));
    assert.throws(() => finder.hashToOffset('HEAD^e'));
  });

  it('understands combinations of ^ and ~', function() {
    assert.equal(finder.hashToOffset('HEAD^1~'), 2);
    assert.equal(finder.hashToOffset('HEAD~^1'), 2);
    assert.equal(finder.hashToOffset('HEAD~^1~2'), 4);
    assert.equal(finder.hashToOffset('HEAD~^1~^1'), 4);
    assert.equal(finder.hashToOffset('HEAD~^1~1^1'), 4);
  });
});
