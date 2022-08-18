import {getInitials} from 'app/client/ui/UserImage';
import {assert} from 'chai';

describe('AppModel', function() {
  describe('getInitials', function() {
    it('should extract initials', () => {
      assert.equal(getInitials({name: "Foo Bar"}), "FB");
      assert.equal(getInitials({name: " foo  bar cat"}), "fb");
      assert.equal(getInitials({name: " foo-bar cat"}), "fc");
      assert.equal(getInitials({name: "foo-bar"}), "f");
      assert.equal(getInitials({name: "  Something"}), "S");
      assert.equal(getInitials({name: "  Something", email: 'test@...'}), "S");
      assert.equal(getInitials({name: "", email: 'test@...'}), "t");
      assert.equal(getInitials({name: " ", email: 'test@...'}), "t");
      assert.equal(getInitials({email: 'something@example.com'}), "s");
    });
  });
});
