import {assert} from 'chai';
import {MethodAccess} from 'app/client/components/WidgetFrame';
import {AccessLevel} from 'app/common/CustomWidget';

describe('WidgetFrame', function () {
  it('should define access level per method', function () {
    class SampleApi {
      public none() {
        return true;
      }
      public read_table() {
        return true;
      }

      public full() {}
      public notMentioned() {}
    }
    const checker = new MethodAccess<SampleApi>()
      .require(AccessLevel.none, 'none')
      .require(AccessLevel.read_table, 'read_table')
      .require(AccessLevel.full, 'full');

    const directTest = () => {
      assert.isTrue(checker.check(AccessLevel.none, 'none'));
      assert.isFalse(checker.check(AccessLevel.none, 'read_table'));
      assert.isFalse(checker.check(AccessLevel.none, 'full'));

      assert.isTrue(checker.check(AccessLevel.read_table, 'none'));
      assert.isTrue(checker.check(AccessLevel.read_table, 'read_table'));
      assert.isFalse(checker.check(AccessLevel.read_table, 'full'));

      assert.isTrue(checker.check(AccessLevel.full, 'none'));
      assert.isTrue(checker.check(AccessLevel.full, 'read_table'));
      assert.isTrue(checker.check(AccessLevel.full, 'full'));
    };
    directTest();

    // Check that for any other method, access is denied.
    assert.isFalse(checker.check(AccessLevel.none, 'notMentioned'));
    assert.isFalse(checker.check(AccessLevel.read_table, 'notMentioned'));
    // Even though access is full, the method was not mentioned, so it should be denied.
    assert.isFalse(checker.check(AccessLevel.full, 'notMentioned'));

    // Now add a default rule.
    checker.require(AccessLevel.none, '*');
    assert.isTrue(checker.check(AccessLevel.none, 'notMentioned'));
    assert.isTrue(checker.check(AccessLevel.read_table, 'notMentioned'));
    assert.isTrue(checker.check(AccessLevel.full, 'notMentioned'));
    directTest();

    checker.require(AccessLevel.read_table, '*');
    assert.isFalse(checker.check(AccessLevel.none, 'notMentioned'));
    assert.isTrue(checker.check(AccessLevel.read_table, 'notMentioned'));
    assert.isTrue(checker.check(AccessLevel.full, 'notMentioned'));
    directTest();

    checker.require(AccessLevel.full, '*');
    assert.isFalse(checker.check(AccessLevel.none, 'notMentioned'));
    assert.isFalse(checker.check(AccessLevel.read_table, 'notMentioned'));
    assert.isTrue(checker.check(AccessLevel.full, 'notMentioned'));
    directTest();
  });
});
