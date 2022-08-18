import * as roles from 'app/common/roles';
import {assert} from 'chai';

describe('roles', function() {
  describe('getStrongestRole', function() {
    it('should return the strongest role', function() {
      assert.equal(roles.getStrongestRole(roles.OWNER, roles.EDITOR), roles.OWNER);
      assert.equal(roles.getStrongestRole(roles.OWNER, roles.VIEWER, null), roles.OWNER);
      assert.equal(roles.getStrongestRole(roles.EDITOR, roles.VIEWER), roles.EDITOR);
      assert.equal(roles.getStrongestRole(roles.VIEWER), roles.VIEWER);
      assert.equal(roles.getStrongestRole(roles.VIEWER, roles.GUEST), roles.VIEWER);
      assert.equal(roles.getStrongestRole(roles.OWNER, roles.GUEST), roles.OWNER);
      assert.equal(roles.getStrongestRole(null, roles.GUEST), roles.GUEST);
      assert.equal(roles.getStrongestRole(null, roles.EDITOR), roles.EDITOR);
      assert.equal(roles.getStrongestRole(roles.EDITOR, roles.EDITOR, roles.EDITOR), roles.EDITOR);
      assert.equal(roles.getStrongestRole(roles.EDITOR, roles.OWNER, roles.EDITOR), roles.OWNER);
      assert.equal(roles.getStrongestRole(null, null, roles.EDITOR, roles.VIEWER, roles.EDITOR), roles.EDITOR);
      assert.equal(roles.getStrongestRole(null, null, null), null);

      assert.throws(() => roles.getStrongestRole(undefined as any, roles.EDITOR), /Invalid role undefined/);
      assert.throws(() => roles.getStrongestRole(undefined as any, null), /Invalid role undefined/);
      assert.throws(() => roles.getStrongestRole(undefined as any, undefined), /Invalid role undefined/);
      assert.throws(() => roles.getStrongestRole('XXX' as any, roles.EDITOR), /Invalid role XXX/);
      assert.throws(() => roles.getStrongestRole('XXX' as any, null), /Invalid role XXX/);
      assert.throws(() => roles.getStrongestRole('XXX' as any, 'YYY'), /Invalid role XXX/);
      assert.throws(() => roles.getStrongestRole(), /No roles given/);
    });
  });

  describe('getWeakestRole', function() {
    it('should return the weakest role', function() {
      assert.equal(roles.getWeakestRole(roles.OWNER, roles.EDITOR), roles.EDITOR);
      assert.equal(roles.getWeakestRole(roles.OWNER, roles.VIEWER, null), null);
      assert.equal(roles.getWeakestRole(roles.EDITOR, roles.VIEWER), roles.VIEWER);
      assert.equal(roles.getWeakestRole(roles.VIEWER), roles.VIEWER);
      assert.equal(roles.getWeakestRole(roles.VIEWER, roles.GUEST), roles.GUEST);
      assert.equal(roles.getWeakestRole(roles.OWNER, roles.GUEST), roles.GUEST);
      assert.equal(roles.getWeakestRole(null, roles.EDITOR), null);
      assert.equal(roles.getWeakestRole(roles.EDITOR, roles.EDITOR, roles.EDITOR), roles.EDITOR);
      assert.equal(roles.getWeakestRole(roles.EDITOR, roles.OWNER, roles.EDITOR), roles.EDITOR);
      assert.equal(roles.getWeakestRole(null, null, roles.EDITOR, roles.VIEWER, roles.EDITOR), null);
      assert.equal(roles.getWeakestRole(roles.OWNER, roles.OWNER), roles.OWNER);

      assert.throws(() => roles.getWeakestRole(undefined as any, roles.EDITOR), /Invalid role undefined/);
      assert.throws(() => roles.getWeakestRole(undefined as any, null), /Invalid role undefined/);
      assert.throws(() => roles.getWeakestRole(undefined as any, undefined), /Invalid role undefined/);
      assert.throws(() => roles.getWeakestRole('XXX' as any, roles.EDITOR), /Invalid role XXX/);
      assert.throws(() => roles.getWeakestRole('XXX' as any, null), /Invalid role XXX/);
      assert.throws(() => roles.getWeakestRole('XXX' as any, 'YYY'), /Invalid role XXX/);
      assert.throws(() => roles.getWeakestRole(), /No roles given/);
    });
  });
});
