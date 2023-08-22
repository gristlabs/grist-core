import {CellValue} from 'app/common/DocActions';
import {AclMatchFunc, InfoView} from 'app/common/GranularAccessClause';
import {compileAclFormula} from 'app/server/lib/ACLFormula';
import {makeExceptionalDocSession} from 'app/server/lib/DocSession';
import {User} from 'app/server/lib/GranularAccess';
import {assert} from 'chai';
import {createDocTools} from 'test/server/docTools';
import * as testUtils from 'test/server/testUtils';

describe('ACLFormula', function() {
  this.timeout(10000);

  // Turn off logging for this test, and restore afterwards.
  testUtils.setTmpLogLevel('error');

  const docTools = createDocTools();
  const fakeSession = makeExceptionalDocSession('system');

  function getInfoView(row: Record<string, CellValue>): InfoView {
    return {
      get: (colId: string) => row[colId],
      toJSON: () => row,
    };
  }

  const V = getInfoView;    // A shortcut.

  it('should correctly interpret parsed ACL formulas', async function() {
    const docName = 'docdata1';
    const activeDoc1 = await docTools.createDoc(docName);
    let compiled: AclMatchFunc;

    const resourceRef = (await activeDoc1.applyUserActions(fakeSession,
      [['AddRecord', '_grist_ACLResources', null, {tableId: '*', colIds: '*'}]])).retValues[0];
    const ruleRef = (await activeDoc1.applyUserActions(fakeSession,
      [['AddRecord', '_grist_ACLRules', null, {resource: resourceRef}]])).retValues[0];

    async function setAndCompile(aclFormula: string): Promise<AclMatchFunc> {
      await activeDoc1.applyUserActions(fakeSession, [['UpdateRecord', '_grist_ACLRules', ruleRef, {aclFormula}]]);
      const {tableData} = await activeDoc1.fetchQuery(
        fakeSession, {tableId: '_grist_ACLRules', filters: {id: [ruleRef]}});
      assert(tableData[3].aclFormulaParsed, "Expected aclFormulaParsed to be populated");
      const parsedFormula = String(tableData[3].aclFormulaParsed[0]);
      return compileAclFormula(JSON.parse(parsedFormula));
    }

    compiled = await setAndCompile("user.Email == 'X@'");
    assert.equal(compiled({user: new User({Email: 'X@'})}), true);
    assert.equal(compiled({user: new User({Email: 'Y@'})}), false);
    assert.equal(compiled({user: new User({Email: 'X'}), rec: V({Email: 'Y@'})}), false);
    assert.equal(compiled({user: new User({Name: 'X@'})}), false);

    compiled = await setAndCompile("user.Role in ('editors', 'owners')");
    assert.equal(compiled({user: new User({Role: 'editors'})}), true);
    assert.equal(compiled({user: new User({Role: 'owners'})}), true);
    assert.equal(compiled({user: new User({Role: 'viewers'})}), false);
    assert.equal(compiled({user: new User({Role: null})}), false);
    assert.equal(compiled({user: new User({})}), false);

    // Opposite of the previous formula.
    compiled = await setAndCompile("user.Role not in ('editors', 'owners')");
    assert.equal(compiled({user: new User({Role: 'editors'})}), false);
    assert.equal(compiled({user: new User({Role: 'owners'})}), false);
    assert.equal(compiled({user: new User({Role: 'viewers'})}), true);
    assert.equal(compiled({user: new User({Role: null})}), true);
    assert.equal(compiled({user: new User({})}), true);

    compiled = await setAndCompile("rec.office == 'Seattle' and user.email in ['sally@', 'xie@']");
    assert.throws(() => compiled({user: new User({email: 'xie@'})}), /Missing row data 'rec'/);
    assert.equal(compiled({user: new User({email: 'xie@'}), rec: V({})}), false);
    assert.equal(compiled({user: new User({email: 'xie@'}), rec: V({office: null})}), false);
    assert.equal(compiled({user: new User({email: 'xie@home'}), rec: V({office: 'Seattle'})}), false);
    assert.equal(compiled({user: new User({email: 'xie@'}), rec: V({office: 'Seattle'})}), true);
    assert.equal(compiled({user: new User({email: 'sally@'}), rec: V({office: 'Seattle'})}), true);
    assert.equal(compiled({user: new User({email: 'sally@'}), rec: V({office: 'Chicago'})}), false);
    assert.equal(compiled({user: new User({email: null}), rec: V({office: null})}), false);
    assert.equal(compiled({user: new User({}), rec: V({})}), false);

    // This is not particularly meaningful, but involves more combinations.
    compiled = await setAndCompile(
      "user.IsAdmin or rec.assigned is None or (not newRec.HasDuplicates and rec.StatusIndex <= newRec.StatusIndex)");
    assert.equal(compiled({user: new User({IsAdmin: true})}), true);
    assert.equal(compiled({user: new User({IsAdmin: 17})}), true);
    assert.throws(() => compiled({user: new User({IsAdmin: 0.0})}), /Missing row data 'rec'/);
    assert.throws(
      () => compiled({user: new User({IsAdmin: 0.0}), rec: V({assigned: true})}),
      /Missing row data 'newRec'/
    );
    assert.equal(compiled({user: new User({IsAdmin: 0.0}), rec: V({}), newRec: V({})}), false);
    assert.equal(compiled({user: new User({IsAdmin: false}), rec: V({assigned: 0}), newRec: V({})}), false);
    assert.equal(compiled({user: new User({IsAdmin: false}), rec: V({assigned: null})}), true);
    assert.equal(compiled({user: new User({IsAdmin: true}), rec: V({assigned: 'never'})}), true);
    assert.equal(compiled({user: new User({IsAdmin: false}), rec: V({assigned: 'None'}),
      newRec: V({HasDuplicates: 1})}), false);
    assert.equal(compiled({user: new User({IsAdmin: false}), rec: V({assigned: 1, StatusIndex: 1}),
      newRec: V({HasDuplicates: false, StatusIndex: 1})}), true);
    assert.equal(compiled({user: new User({IsAdmin: false}), rec: V({assigned: 1, StatusIndex: 1}),
      newRec: V({HasDuplicates: false, StatusIndex: 17})}), true);
    assert.equal(compiled({user: new User({IsAdmin: false}), rec: V({assigned: 1, StatusIndex: 1}),
      newRec: V({StatusIndex: 17})}), true);
    assert.equal(compiled({user: new User({IsAdmin: false}), rec: V({assigned: 1, StatusIndex: 2}),
      newRec: V({HasDuplicates: false, StatusIndex: 1})}), false);
    assert.equal(compiled({user: new User({IsAdmin: false}), rec: V({assigned: 1, StatusIndex: 1}),
      newRec: V({HasDuplicates: true, StatusIndex: 17})}), false);

    // Test arithmetic.
    compiled = await setAndCompile(
      "rec.A <= rec.B + 1 and rec.A >= rec.B - 1 and rec.A < rec.C * 2.5 and rec.A > rec.C / 2.5 and rec.A % 2 != 0");
    assert.equal(compiled({user: new User({}), rec: V({A: 3, B: 3, C: 3})}), true);
    assert.equal(compiled({user: new User({}), rec: V({A: 3, B: 4, C: 3})}), true);
    assert.equal(compiled({user: new User({}), rec: V({A: 3, B: 2, C: 3})}), true);
    assert.equal(compiled({user: new User({}), rec: V({A: 3, B: 4.001, C: 3})}), false);
    assert.equal(compiled({user: new User({}), rec: V({A: 3, B: 1.999, C: 3})}), false);
    assert.equal(compiled({user: new User({}), rec: V({A: 6, B: 6, C: 6})}), false);     // A can't be even.
    // C of 3 establishes the range for A of (1.2 - 7.5).
    assert.equal(compiled({user: new User({}), rec: V({A: 1.2, B: 1, C: 3})}), false);
    assert.equal(compiled({user: new User({}), rec: V({A: 1.3, B: 1, C: 3})}), true);
    assert.equal(compiled({user: new User({}), rec: V({A: 7.4, B: 7, C: 3})}), true);
    assert.equal(compiled({user: new User({}), rec: V({A: 7.5, B: 7, C: 3})}), false);

    // Test is/is-not.
    compiled = await setAndCompile(
      "rec.A is True or rec.B is not False");
    assert.equal(compiled({user: new User({}), rec: V({A: true})}), true);
    assert.equal(compiled({user: new User({}), rec: V({A: 2})}), true);
    assert.equal(compiled({user: new User({}), rec: V({A: 2, B: false})}), false);
    assert.equal(compiled({user: new User({}), rec: V({A: 2, B: null})}), true);
    assert.equal(compiled({user: new User({}), rec: V({A: 0, B: null})}), true);
    assert.equal(compiled({user: new User({}), rec: V({A: null, B: true})}), true);
    assert.equal(compiled({user: new User({}), rec: V({A: null, B: 2})}), true);
    assert.equal(compiled({user: new User({}), rec: V({A: null, B: false})}), false);
    assert.equal(compiled({user: new User({}), rec: V({A: null, B: 0})}), true);

    // Test nested attribute lookups.
    compiled = await setAndCompile('user.office.city == "New York"');
    assert.equal(compiled({user: new User({office: V({city: "New York"})})}), true);
    assert.equal(compiled({user: new User({office: V({city: "Boston"})})}), false);
    assert.equal(compiled({user: new User({office: V({city: null})})}), false);
    assert.throws(() => compiled({user: new User({})}), /No value for 'user.office'/);
    assert.equal(compiled({user: new User({office: 5})}), false);
    assert.throws(() => compiled({user: new User({office: null})}), /No value for 'user.office'/);
  });
});
