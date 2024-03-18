import {emptyPermissionSet, PartialPermissionSet, PermissionKey,
        summarizePermissions, summarizePermissionSet} from 'app/common/ACLPermissions';
import {makePartialPermissions, parsePermissions, permissionSetToText} from 'app/common/ACLPermissions';
import {mergePartialPermissions, mergePermissions, trimPermissions} from 'app/common/ACLPermissions';
import {assert} from 'chai';

describe("ACLPermissions", function() {
  const empty = emptyPermissionSet();

  it('should convert short permissions to permissionSet', function() {
    assert.deepEqual(parsePermissions('all'),
      { read: "allow", create: "allow", update: "allow", delete: "allow", schemaEdit: "allow" });
    assert.deepEqual(parsePermissions('none'),
      { read: "deny", create: "deny", update: "deny", delete: "deny", schemaEdit: "deny" });
    assert.deepEqual(parsePermissions('all'), parsePermissions('+CRUDS'));
    assert.deepEqual(parsePermissions('none'), parsePermissions('-CRUDS'));

    assert.deepEqual(parsePermissions('+R'), {...empty, read: "allow"});
    assert.deepEqual(parsePermissions('-R'), {...empty, read: "deny"});
    assert.deepEqual(parsePermissions('+S'), {...empty, schemaEdit: "allow"});
    assert.deepEqual(parsePermissions(''), empty);
    assert.deepEqual(parsePermissions('+CUD-R'),
      {create: "allow", update: "allow", delete: "allow", read: "deny", schemaEdit: ""});
    assert.deepEqual(parsePermissions('-R+CUD'),
      {create: "allow", update: "allow", delete: "allow", read: "deny", schemaEdit: ""});
    assert.deepEqual(parsePermissions('+R-CUD'),
      {create: "deny", update: "deny", delete: "deny", read: "allow", schemaEdit: ""});
    assert.deepEqual(parsePermissions('-CUD+R'),
      {create: "deny", update: "deny", delete: "deny", read: "allow", schemaEdit: ""});

    assert.throws(() => parsePermissions('R'), /Invalid permissions specification "R"/);
    assert.throws(() => parsePermissions('x'), /Invalid permissions specification "x"/);
    assert.throws(() => parsePermissions('-R\n'), /Invalid permissions specification "-R\\n"/);
  });

  it('should convert permissionSets to short string', function() {
    assert.equal(permissionSetToText({read: "allow"}), '+R');
    assert.equal(permissionSetToText({read: "deny"}), '-R');
    assert.equal(permissionSetToText({schemaEdit: "allow"}), '+S');
    assert.equal(permissionSetToText({}), '');
    assert.equal(permissionSetToText({create: "allow", update: "allow", delete: "allow", read: "deny"}), '+CUD-R');
    assert.equal(permissionSetToText({create: "deny", update: "deny", delete: "deny", read: "allow"}), '+R-CUD');

    assert.equal(permissionSetToText(parsePermissions('+CRUDS')), 'all');
    assert.equal(permissionSetToText(parsePermissions('-CRUDS')), 'none');
  });

  it('should allow merging PermissionSets', function() {
    function mergeDirect(a: string, b: string) {
      const aParsed = parsePermissions(a);
      const bParsed = parsePermissions(b);
      return permissionSetToText(mergePermissions([aParsed, bParsed], ([_a, _b]) => _a || _b));
    }
    testMerge(mergeDirect);
  });

  it('should allow merging PermissionSets via PartialPermissionSet', function() {
    // In practice, we work with more generalized PartialPermissionValues. Ensure that this
    // pathway produces the same results.
    function mergeViaPartial(a: string, b: string) {
      const aParsed = parsePermissions(a);
      const bParsed = parsePermissions(b);
      return permissionSetToText(mergePartialPermissions(aParsed, bParsed));
    }
    testMerge(mergeViaPartial);
  });

  function testMerge(merge: (a: string, b: string) => string) {
    assert.equal(merge("+R", "-R"), "+R");
    assert.equal(merge("+C-D", "+CDS-RU"), "+CS-RUD");
    assert.equal(merge("all", "+R-CUDS"), "all");
    assert.equal(merge("none", "-R+CUDS"), "none");
    assert.equal(merge("all", "none"), "all");
    assert.equal(merge("none", "all"), "none");
    assert.equal(merge("", "+RU-CD"), "+RU-CD");
    assert.equal(merge("-S", "+RU-CD"), "+RU-CDS");
  }


  it('should merge PartialPermissionSets', function() {
    function merge(a: Partial<PartialPermissionSet>, b: Partial<PartialPermissionSet>): PartialPermissionSet {
      return mergePartialPermissions({...empty, ...a}, {...empty, ...b});
    }

    // Combining single bits.
    assert.deepEqual(merge({read: 'allow'}, {read: 'deny'}), {...empty, read: 'allow'});
    assert.deepEqual(merge({read: 'deny'}, {read: 'allow'}), {...empty, read: 'deny'});
    assert.deepEqual(merge({read: 'mixed'}, {read: 'deny'}), {...empty, read: 'mixed'});
    assert.deepEqual(merge({read: 'mixed'}, {read: 'allow'}), {...empty, read: 'mixed'});
    assert.deepEqual(merge({read: 'allowSome'}, {read: 'allow'}), {...empty, read: 'allow'});
    assert.deepEqual(merge({read: 'allowSome'}, {read: 'allowSome'}), {...empty, read: 'allowSome'});
    assert.deepEqual(merge({read: 'allowSome'}, {read: 'deny'}), {...empty, read: 'mixed'});
    assert.deepEqual(merge({read: 'allowSome'}, {read: 'denySome'}), {...empty, read: 'mixed'});
    assert.deepEqual(merge({read: 'denySome'}, {read: 'deny'}), {...empty, read: 'deny'});
    assert.deepEqual(merge({read: 'denySome'}, {read: 'denySome'}), {...empty, read: 'denySome'});
    assert.deepEqual(merge({read: 'denySome'}, {read: 'allow'}), {...empty, read: 'mixed'});
    assert.deepEqual(merge({read: 'denySome'}, {read: 'allowSome'}), {...empty, read: 'mixed'});

    // Combining multiple bits.
    assert.deepEqual(merge(
        {read: 'allowSome', create: 'allow', update: 'denySome', delete: 'deny'},
        {read: 'deny', create: 'denySome', update: 'deny', delete: 'denySome', schemaEdit: 'deny'}
      ),
      {read: 'mixed', create: 'allow', update: 'deny', delete: 'deny', schemaEdit: 'deny'}
    );

    assert.deepEqual(merge(makePartialPermissions(parsePermissions("all")), parsePermissions("+U-D")),
      {read: 'allowSome', create: 'allowSome', update: 'allow', delete: 'mixed', schemaEdit: 'allowSome'}
    );
    assert.deepEqual(merge(parsePermissions("+U-D"), makePartialPermissions(parsePermissions("all"))),
      {read: 'allowSome', create: 'allowSome', update: 'allow', delete: 'deny', schemaEdit: 'allowSome'}
    );
  });

  it('should support trimPermissions', function() {
    const trim = (permissionsText: string, availableBits: PermissionKey[]) =>
      permissionSetToText(trimPermissions(parsePermissions(permissionsText), availableBits));
    assert.deepEqual(trim("+CRUD", ["read", "update"]), "+RU");
    assert.deepEqual(trim("all", ["read", "update"]), "+RU");
    assert.deepEqual(trim("-C+R-U+D-S", ["update", "read"]), "+R-U");
    assert.deepEqual(trim("none", ["read", "update", "create", "delete", "schemaEdit"]), "none");
    assert.deepEqual(trim("none", ["read", "update", "create", "delete"]), "-CRUD");
    assert.deepEqual(trim("none", ["read"]), "-R");
  });

  it ('should allow summarization of permission sets', function() {
    assert.deepEqual(summarizePermissionSet(parsePermissions("+U-D")), 'mixed');
    assert.deepEqual(summarizePermissionSet(parsePermissions("+U+D")), 'allow');
    assert.deepEqual(summarizePermissionSet(parsePermissions("-U-D")), 'deny');
    assert.deepEqual(summarizePermissionSet(parsePermissions("-U-D")), 'deny');
    assert.deepEqual(summarizePermissionSet(parsePermissions("none")), 'deny');
    assert.deepEqual(summarizePermissionSet(parsePermissions("all")), 'allow');
    assert.deepEqual(summarizePermissionSet(parsePermissions("")), 'mixed');
    assert.deepEqual(summarizePermissionSet(parsePermissions("+CRUDS")), 'allow');
    assert.deepEqual(summarizePermissionSet(parsePermissions("-CRUDS")), 'deny');
    assert.deepEqual(summarizePermissionSet({...empty, read: 'allow', update: 'allowSome'}), 'allow');
    assert.deepEqual(summarizePermissionSet({...empty, read: 'allowSome', update: 'allow'}), 'allow');
    assert.deepEqual(summarizePermissionSet({...empty, read: 'allowSome', update: 'allowSome'}), 'allow');
    assert.deepEqual(summarizePermissionSet({...empty, read: 'allow', update: 'denySome'}), 'mixed');
    assert.deepEqual(summarizePermissionSet({...empty, read: 'denySome', update: 'allowSome'}), 'mixed');
    assert.deepEqual(summarizePermissionSet({...empty, read: 'denySome', update: 'deny'}), 'deny');
  });

  it ('should allow summarization of permissions', function() {
    assert.deepEqual(summarizePermissions(['allow', 'deny']), 'mixed');
    assert.deepEqual(summarizePermissions(['allow', 'allow']), 'allow');
    assert.deepEqual(summarizePermissions(['deny', 'allow']), 'mixed');
    assert.deepEqual(summarizePermissions(['deny', 'deny']), 'deny');
    assert.deepEqual(summarizePermissions(['allow']), 'allow');
    assert.deepEqual(summarizePermissions(['deny']), 'deny');
    assert.deepEqual(summarizePermissions([]), 'mixed');
    assert.deepEqual(summarizePermissions(['allow', 'allow', 'deny']), 'mixed');
    assert.deepEqual(summarizePermissions(['allow', 'allow', 'allow']), 'allow');
  });
});
