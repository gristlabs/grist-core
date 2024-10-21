/**
 * Test of the UI for Granular Access Control, part 3.
 */
import { assert, driver } from 'mocha-webdriver';
import { assertChanged, assertSaved, enterRulePart, findDefaultRuleSet,
         findRuleSet, findTable, getRules, hasExtraAdd, removeRules,
         removeTable } from 'test/nbrowser/aclTestUtils';
import * as gu from 'test/nbrowser/gristUtils';
import { setupTestSuite } from 'test/nbrowser/testUtils';

describe("AccessRules3", function() {
  this.timeout(40000);
  const cleanup = setupTestSuite();
  let docId: string;

  before(async function() {
    // Import a test document we've set up for this.
    const mainSession = await gu.session().teamSite.user('user1').login();
    docId = (await mainSession.tempDoc(cleanup, 'ACL-Test.grist', {load: false})).id;

    // Share it with a few users.
    const api = mainSession.createHomeApi();
    await api.updateDocPermissions(docId, { users: {
      [gu.translateUser("user2").email]: 'owners',
      [gu.translateUser("user3").email]: 'editors',
    } });
    return docId;
  });

  afterEach(() => gu.checkForErrors());

  describe('SeedRule special', function() {

    // When a tooltip is present, it introduces this extra text into getText() result.
    const tooltipMarker = "\n?";

    it('can add initial rules based on SeedRule special', async function() {
      // Open Access Rules page.
      const mainSession = await gu.session().teamSite.user('user1').login();
      await mainSession.loadDoc(`/doc/${docId}`);
      await driver.find('.test-tools-access-rules').click();
      await driver.findWait('.test-rule-set', 2000);

      // Check seed rule checkbox is unselected.
      const seedRule = await driver.find('div.test-rule-special-SeedRule');
      const checkbox = seedRule.find('input[type=checkbox]');
      assert.equal(await checkbox.isSelected(), false);

      // Expand and check there's an empty rule.
      await driver.find('.test-rule-special-SeedRule .test-rule-special-expand').click();
      await assertSaved();
      await getRules(seedRule);
      assert.deepEqual(await getRules(seedRule),
                       [{ formula: 'Everyone', perm: '' }]);
      assert.equal(await hasExtraAdd(seedRule), false);

      // Adding rules for a new table/column should look the same as always.
      await driver.findContentWait('button', /Add Table Rules/, 2000).click();
      await driver.findContentWait('.grist-floating-menu li', /FinancialsTable/, 3000).click();
      await assertChanged();
      let fin = findTable(/FinancialsTable/);
      assert.deepEqual(await getRules(fin),
                       [{ formula: 'Everyone', perm: '', res: 'All' }]);
      await fin.find('.test-rule-table-menu-btn').click();
      await driver.findContent('.grist-floating-menu li', /Add Column Rule/).click();
      assert.deepEqual(await getRules(fin),
                       [{ formula: 'Everyone', perm: '', res: '[Add Column]' },
                        { formula: 'Everyone', perm: '', res: 'All' + tooltipMarker }]);
      await removeTable(/FinancialsTable/);
      await assertSaved();

      // Now check the box, and see we get the rule we expect.
      await checkbox.click();
      await assertChanged();
      assert.deepEqual(await getRules(seedRule),
                       [{ formula: 'user.Access in [OWNER]', perm: '+R+U+C+D' }]);
      assert.equal(await hasExtraAdd(seedRule), true);

      // New table rules should start off with that rule.
      await driver.findContentWait('button', /Add Table Rules/, 2000).click();
      await driver.findContentWait('.grist-floating-menu li', /FinancialsTable/, 3000).click();
      fin = findTable(/FinancialsTable/);
      assert.deepEqual(await getRules(fin),
                       [{ formula: 'user.Access in [OWNER]', perm: '+R+U+C+D', res: 'All' },
                        { formula: 'Everyone Else', perm: '', res: 'All' }]);
      assert.equal(await hasExtraAdd(fin), false);

      // New column rules should start off with that rule.
      await fin.find('.test-rule-table-menu-btn').click();
      await driver.findContent('.grist-floating-menu li', /Add Column Rule/).click();
      assert.deepEqual(await getRules(fin),
                       [{ formula: 'user.Access in [OWNER]', perm: '+R+U', res: '[Add Column]' },
                        { formula: 'Everyone Else', perm: '', res: '[Add Column]' },
                        { formula: 'user.Access in [OWNER]', perm: '+R+U+C+D', res: 'All' + tooltipMarker },
                        { formula: 'Everyone Else', perm: '', res: 'All' + tooltipMarker }]);

      // Make sure that removing and re-adding default rules works as expected.
      await removeRules(findDefaultRuleSet(/FinancialsTable/));
      assert.equal(await findDefaultRuleSet(/FinancialsTable/).isPresent(), false);
      assert.deepEqual(await getRules(fin),
                       [{ formula: 'user.Access in [OWNER]', perm: '+R+U', res: '[Add Column]' },
                        { formula: 'Everyone Else', perm: '', res: '[Add Column]' }]);
      await fin.find('.test-rule-table-menu-btn').click();
      await driver.findContent('.grist-floating-menu li', /Add Table-wide Rule/).click();
      assert.deepEqual(await getRules(fin),
                       [{ formula: 'user.Access in [OWNER]', perm: '+R+U', res: '[Add Column]' },
                        { formula: 'Everyone Else', perm: '', res: '[Add Column]' },
                        { formula: 'user.Access in [OWNER]', perm: '+R+U+C+D', res: 'All' + tooltipMarker },
                        { formula: 'Everyone Else', perm: '', res: 'All' + tooltipMarker }]);
      await removeTable(/FinancialsTable/);

      // Check that we can tweak the seed rules if we want.
      await seedRule.find('.test-rule-part .test-rule-add').click();
      await enterRulePart(seedRule, 1, 'user.Access in [EDITOR]', 'Deny All', 'memo1');
      assert.equal(await checkbox.getAttribute('disabled'), 'true');

      // New table rules should include the seed rules.
      await driver.findContentWait('button', /Add Table Rules/, 2000).click();
      await driver.findContentWait('.grist-floating-menu li', /FinancialsTable/, 3000).click();
      fin = findTable(/FinancialsTable/);
      assert.deepEqual(await getRules(fin),
                       [{ formula: 'user.Access in [EDITOR]', perm: '-R-U-C-D', res: 'All', memo: 'memo1'},
                        { formula: 'user.Access in [OWNER]', perm: '+R+U+C+D', res: 'All' },
                        { formula: 'Everyone Else', perm: '', res: 'All' }]);
      assert.equal(await hasExtraAdd(fin), false);
      await removeTable(/FinancialsTable/);

      // Check that returning to the single OWNER rule gets us back to an uncomplicated
      // selected checkbox.
      await assertChanged();
      assert.equal(await checkbox.getAttribute('disabled'), 'true');
      assert.equal(await checkbox.isSelected(), false);
      await seedRule.find('.test-rule-part .test-rule-remove').click();
      assert.equal(await checkbox.getAttribute('disabled'), null);
      assert.equal(await checkbox.isSelected(), true);

      // Check that removing that rule deselected the checkbox and collapses rule list.
      await seedRule.find('.test-rule-part .test-rule-remove').click();
      assert.equal(await checkbox.getAttribute('disabled'), null);
      assert.equal(await checkbox.isSelected(), false);
      await assertSaved();
      assert.lengthOf(await seedRule.findAll('.test-rule-set'), 0);

      // Expand again, and make sure we are back to default.
      await driver.find('.test-rule-special-SeedRule .test-rule-special-expand').click();
      assert.lengthOf(await seedRule.findAll('.test-rule-set'), 1);
      assert.deepEqual(await getRules(seedRule),
                       [{ formula: 'Everyone', perm: '' }]);
      await assertSaved();
    });

    it('can have a SeedRule special that refers to columns', async function() {
      // Open Access Rules page.
      const mainSession = await gu.session().teamSite.user('user1').login();
      await mainSession.loadDoc(`/doc/${docId}`);
      await driver.find('.test-tools-access-rules').click();
      await driver.findWait('.test-rule-set', 2000);

      // Check seed rule checkbox is unselected.
      const seedRule = await driver.find('div.test-rule-special-SeedRule');
      const checkbox = seedRule.find('input[type=checkbox]');
      assert.equal(await checkbox.isSelected(), false);

      // Now check the box, and see we get the default rule we expect.
      await checkbox.click();
      await assertChanged();
      await driver.find('.test-rule-special-SeedRule .test-rule-special-expand').click();
      assert.deepEqual(await getRules(seedRule),
                       [{ formula: 'user.Access in [OWNER]', perm: '+R+U+C+D' }]);
      assert.equal(await hasExtraAdd(seedRule), true);

      // Tweak the seed rule to refer to a column.
      await seedRule.find('.test-rule-part .test-rule-add').click();
      await enterRulePart(seedRule, 1, 'rec.Year == 1', 'Deny All', 'memo1');
      assert.equal(await checkbox.getAttribute('disabled'), 'true');

      // New table rules should include the seed rule.
      await driver.findContentWait('button', /Add Table Rules/, 2000).click();
      await driver.findContentWait('.grist-floating-menu li', /FinancialsTable/, 3000).click();
      let fin = findTable(/FinancialsTable/);
      assert.deepEqual(await getRules(fin),
                       [{ formula: 'rec.Year == 1', perm: '-R-U-C-D', res: 'All', memo: 'memo1'},
                        { formula: 'user.Access in [OWNER]', perm: '+R+U+C+D', res: 'All' },
                        { formula: 'Everyone Else', perm: '', res: 'All' }]);
      assert.equal(await hasExtraAdd(fin), false);
      await removeTable(/FinancialsTable/);

      // Tweak the seed rule to refer to a column that won't exist.
      await enterRulePart(seedRule, 1, 'rec.Unreal == 1', 'Deny All', 'memo1');
      assert.equal(await checkbox.getAttribute('disabled'), 'true');

      // New table rules should include the seed rule, and show an error.
      await driver.findContentWait('button', /Add Table Rules/, 2000).click();
      await driver.findContentWait('.grist-floating-menu li', /FinancialsTable/, 3000).click();
      fin = findTable(/FinancialsTable/);
      assert.deepEqual(await getRules(fin),
                       [{ formula: 'rec.Unreal == 1', perm: '-R-U-C-D', res: 'All', memo: 'memo1',
                          error: 'Invalid columns: Unreal' },
                        { formula: 'user.Access in [OWNER]', perm: '+R+U+C+D', res: 'All' },
                        { formula: 'Everyone Else', perm: '', res: 'All' }]);
      assert.equal(await hasExtraAdd(fin), false);
      await removeTable(/FinancialsTable/);

      // Check that returning to the single OWNER rule gets us back to an uncomplicated
      // selected checkbox.
      await assertChanged();
      assert.equal(await checkbox.getAttribute('disabled'), 'true');
      assert.equal(await checkbox.isSelected(), false);
      await seedRule.find('.test-rule-part .test-rule-remove').click();
      assert.equal(await checkbox.getAttribute('disabled'), null);
      assert.equal(await checkbox.isSelected(), true);

      // Check that removing that rule deselected the checkbox and collapses rule list.
      await seedRule.find('.test-rule-part .test-rule-remove').click();
      assert.equal(await checkbox.getAttribute('disabled'), null);
      assert.equal(await checkbox.isSelected(), false);
      await assertSaved();
      assert.lengthOf(await seedRule.findAll('.test-rule-set'), 0);

      // Expand again, and make sure we are back to default.
      await driver.find('.test-rule-special-SeedRule .test-rule-special-expand').click();
      assert.lengthOf(await seedRule.findAll('.test-rule-set'), 1);
      assert.deepEqual(await getRules(seedRule),
                       [{ formula: 'Everyone', perm: '' }]);
      await assertSaved();
    });

    it('can save and reload SeedRule special', async function() {
      const mainSession = await gu.session().teamSite.user('user1').login();
      await mainSession.loadDoc(`/doc/${docId}`);
      await driver.find('.test-tools-access-rules').click();
      await driver.findWait('.test-rule-set', 2000);

      // Initially nothing is selected and all is saved.
      let seedRule = await driver.find('div.test-rule-special-SeedRule');
      let checkbox = seedRule.find('input[type=checkbox]');
      assert.equal(await checkbox.isSelected(), false);
      await assertSaved();

      // Clicking the checkbox is immediately save-able.
      await checkbox.click();
      await assertChanged();

      // Save, and check state is correctly persisted.
      await driver.find('.test-rules-save').click();
      await gu.waitForServer();
      seedRule = await driver.findWait('div.test-rule-special-SeedRule', 2000);
      checkbox = seedRule.find('input[type=checkbox]');
      assert.equal(await checkbox.isSelected(), true);
      await assertSaved();

      // Expand and ensure we see the expected rule.
      await driver.find('.test-rule-special-SeedRule .test-rule-special-expand').click();
      assert.deepEqual(await getRules(seedRule),
                       [{ formula: 'user.Access in [OWNER]', perm: '+R+U+C+D' }]);
      assert.equal(await hasExtraAdd(seedRule), true);

      // Now unselect the checkbox, and make sure that we can save+reload.
      await checkbox.click();
      await assertChanged();
      await driver.find('.test-rules-save').click();
      await gu.waitForServer();
      seedRule = await driver.findWait('div.test-rule-special-SeedRule', 2000);
      checkbox = seedRule.find('input[type=checkbox]');
      assert.equal(await checkbox.isSelected(), false);
      await assertSaved();
      await driver.find('.test-rule-special-SeedRule .test-rule-special-expand').click();
      assert.deepEqual(await getRules(seedRule),
                       [{ formula: 'Everyone', perm: '' }]);
      assert.equal(await hasExtraAdd(seedRule), false);

      // Select the checkbox again, and save. Then make a custom change.
      await checkbox.click();
      await assertChanged();
      await driver.find('.test-rules-save').click();
      await gu.waitForServer();
      seedRule = await driver.findWait('div.test-rule-special-SeedRule', 2000);
      checkbox = seedRule.find('input[type=checkbox]');
      assert.equal(await checkbox.isSelected(), true);
      await driver.find('.test-rule-special-SeedRule .test-rule-special-expand').click();
      await seedRule.find('.test-rule-part .test-rule-add').click();
      await enterRulePart(seedRule, 1, 'user.Access in [EDITOR]', 'Deny All', 'memo2');
      assert.equal(await checkbox.getAttribute('disabled'), 'true');
      assert.deepEqual(await getRules(seedRule),
                       [{ formula: 'user.Access in [EDITOR]', perm: '-R-U-C-D', memo: 'memo2' },
                        { formula: 'user.Access in [OWNER]', perm: '+R+U+C+D' }]);
      await assertChanged();

      // Save the custom change, and make sure we can reload it.
      await driver.find('.test-rules-save').click();
      await gu.waitForServer();
      seedRule = await driver.findWait('div.test-rule-special-SeedRule', 2000);
      checkbox = seedRule.find('input[type=checkbox]');
      assert.equal(await checkbox.isSelected(), false);
      assert.equal(await checkbox.getAttribute('disabled'), 'true');
      assert.deepEqual(await getRules(seedRule),
                       [{ formula: 'user.Access in [EDITOR]', perm: '-R-U-C-D', memo: 'memo2' },
                        { formula: 'user.Access in [OWNER]', perm: '+R+U+C+D' }]);
      await assertSaved();

      // Undo; should now again have the simple checked checkbox for seed rules.
      await gu.undo();
      seedRule = await driver.findWait('div.test-rule-special-SeedRule', 2000);
      checkbox = seedRule.find('input[type=checkbox]');
      assert.equal(await checkbox.isSelected(), true);
    });

    it('does not include unavailable bits when saving', async function() {
      // Open Access Rules page.
      const mainSession = await gu.session().teamSite.user('user1').login();
      await mainSession.loadDoc(`/doc/${docId}`);
      await driver.find('.test-tools-access-rules').click();
      await driver.findWait('.test-rule-set', 2000);

      // Click the seed rule checkbox.
      const seedRule = await driver.find('div.test-rule-special-SeedRule');
      assert.equal(await seedRule.find('input[type=checkbox]').isSelected(), true);

      // New table AND column rules should start off with that rule.
      await driver.findContentWait('button', /Add Table Rules/, 2000).click();
      await driver.findContentWait('.grist-floating-menu li', /FinancialsTable/, 3000).click();
      let fin = findTable(/FinancialsTable/);
      await fin.find('.test-rule-table-menu-btn').click();
      await driver.findContent('.grist-floating-menu li', /Add Column Rule/).click();
      const ruleSet = findRuleSet(/FinancialsTable/, 1);
      await ruleSet.find('.test-rule-resource .test-select-open').click();
      await driver.findContent('.test-select-menu li', 'Year').click();
      assert.deepEqual(await getRules(fin),
                       [{ formula: 'user.Access in [OWNER]', perm: '+R+U', res: 'Year\n[Add Column]' },
                        { formula: 'Everyone Else', perm: '', res: 'Year\n[Add Column]' },
                        { formula: 'user.Access in [OWNER]', perm: '+R+U+C+D', res: 'All' + tooltipMarker },
                        { formula: 'Everyone Else', perm: '', res: 'All' + tooltipMarker }]);

      // Check that the Save button is enabled, and save.
      await gu.userActionsCollect();
      await assertChanged();
      await driver.find('.test-rules-save').click();
      await gu.waitForServer();

      // This is the important check of this test: that for a column rule, we only save the "read"
      // and "update" bits.
      await gu.userActionsVerify([
        ["BulkAddRecord", "_grist_ACLResources", [-1, -2], {
          colIds: ["Year", "*"],
          tableId: ["FinancialsTable", "FinancialsTable"],
        }],
        ["BulkAddRecord", "_grist_ACLRules", [-1, -2], {
          resource: [-1, -2],
          aclFormula: ["user.Access in [OWNER]", "user.Access in [OWNER]"],
          // Specifically, we care that this permissionsText includes only RU bits for column rules.
          permissionsText: ["+RU", "+CRUD"],
          rulePos: [1/3, 2/3],
          memo: ["", ""],
        }],
      ]);
      await assertSaved();

      // Rules still look correct after saving.
      fin = findTable(/FinancialsTable/);
      assert.deepEqual(await getRules(fin),
                       [{ formula: 'user.Access in [OWNER]', perm: '+R+U', res: 'Year' },
                        { formula: 'user.Access in [OWNER]', perm: '+R+U+C+D', res: 'All' + tooltipMarker }]);
    });
  });

});
