import {checkName} from 'app/client/ui/AccountPage';
import {assert} from 'chai';


describe("AccountPage", function() {
  describe("isValidName", function() {
    it("should detect invalid name", function() {

      assert.equal(checkName('santa'), true);
      assert.equal(checkName('_santa'), true);
      assert.equal(checkName("O'Neil"), true);
      assert.equal(checkName("Emily"), true);
      assert.equal(checkName("santa(2)"), true);
      assert.equal(checkName("Dr. noname"), true);
      assert.equal(checkName("santa-klaus"), true);
      assert.equal(checkName("Noémie"), true);
      assert.equal(checkName("张伟"), true);

      assert.equal(checkName(',,__()'), false);
      assert.equal(checkName('<foo>'), false);
      assert.equal(checkName('<foo>'), false);
      assert.equal(checkName('(bar)'), false);
      assert.equal(checkName('foo <baz>'), false);
      assert.equal(checkName('-foo'), false);
      assert.equal(checkName("'foo"), false);
      assert.equal(checkName(' Bob'), false);

      assert.equal(checkName('='), false);
      assert.equal(checkName('santa='), false);
    });
  });
});
