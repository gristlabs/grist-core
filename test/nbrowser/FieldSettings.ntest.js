/**
 * When a field is present in multiple views, the different copies of it may use common or
 * separate settings. This test verifies these behaviors and switching between them.
 */

import { assert } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

describe('FieldSettings.ntest', function() {
  const cleanup = test.setupTestSuite(this);
  gu.bigScreen();

  before(async function() {
    await gu.supportOldTimeyTestCode();
    await gu.useFixtureDoc(cleanup, "FieldSettings.grist", true);

    await gu.actions.selectTabView("Rates");
    await gu.waitForServer();
    await gu.openSidePane('field');
  });

  afterEach(async function() {
    await gu.userActionsCollect(false);
    return gu.checkForErrors();
  });

  async function checkSections(position, settingsFunc, expectedBySection) {
    await gu.waitForServer();
    for (let sectionName in expectedBySection) {
      let [cellText, settingsValue] = expectedBySection[sectionName];
      const cell = await gu.getCell(Object.assign({section: sectionName}, position));
      await gu.clickCell(cell);
      assert.equal(await cell.text(), cellText);
      assert.equal(await settingsFunc(), settingsValue);
    }
  }


  it('should respect common settings for regular options', async function() {
    await gu.userActionsCollect(true);

    // Sections 'A' and 'B' use common settings, and 'C' uses separate.
    // Check that changing the setting in A affects B, but does not affect C.
    await gu.clickCell({section: 'A', rowNum: 1, col: 1});
    assert.equal(await gu.dateFormat(), 'YYYY-MM-DD');
    await gu.dateFormat('MM/DD/YYYY');
    await checkSections({rowNum: 1, col: 1}, () => gu.dateFormat(), {
      A: ['01/02/2012', 'MM/DD/YYYY'],
      B: ['01/02/2012', 'MM/DD/YYYY'],
      C: ['2012-01-02', 'YYYY-MM-DD'],
    });

    // Check that changing C does not affect A or B.
    await gu.dateFormat('MMMM Do, YYYY');
    await checkSections({rowNum: 1, col: 1}, () => gu.dateFormat(), {
      A: ['01/02/2012', 'MM/DD/YYYY'],
      B: ['01/02/2012', 'MM/DD/YYYY'],
      C: ['January 2nd, 2012', 'MMMM Do, YYYY'],
    });

    // Verify actions emitted. These are obtained from pasting the output, but the important thing
    // about them is that it's one action for each change, one for the table, one for the field.
    await gu.userActionsVerify([
      ["UpdateRecord", "_grist_Tables_column", 15, {"widgetOptions":
        '{"widget":"TextBox","dateFormat":"MM/DD/YYYY","isCustomDateFormat":false,"alignment":"left"}'}],
      ["UpdateRecord", "_grist_Views_section_field", 145, {"widgetOptions":
        '{"widget":"TextBox","dateFormat":"MMMM Do, YYYY","isCustomDateFormat":false,"alignment":"left"}'}],
    ]);

    // Undo, checking that the 2 actions only require 2 undos, and verify.
    await gu.undo(2);
    await checkSections({rowNum: 1, col: 1}, () => gu.dateFormat(), {
      A: ['2012-01-02', 'YYYY-MM-DD'],
      B: ['2012-01-02', 'YYYY-MM-DD'],
      C: ['2012-01-02', 'YYYY-MM-DD'],
    });
  });


  it('should respect common settings for visibleCol', async function() {
    // Same as above but for changing "visibleCol", which involves extra actions to update the
    // display helper column.
    await gu.userActionsCollect(true);
    await gu.clickCell({section: 'A', rowNum: 1, col: 0});
    assert.equal(await $('.test-fbuilder-ref-col-select .test-select-row').text(), 'Full Name');
    await gu.setVisibleCol('Last Name');
    await checkSections({rowNum: 2, col: 0}, () => $('.test-fbuilder-ref-col-select .test-select-row').text(), {
      A: ['Klein', 'Last Name'],
      B: ['Klein', 'Last Name'],
      C: ['Klein, Cordelia', 'Full Name'],
    });
    await gu.userActionsVerify([
      ["UpdateRecord", "_grist_Tables_column", 12, {"visibleCol":3}],
      ["SetDisplayFormula", "Rates", null, 12, "$Person.Last_Name"],
    ]);

    await gu.clickCell({section: 'C', rowNum: 1, col: 0});
    await gu.setVisibleCol('First Name');
    await checkSections({rowNum: 2, col: 0}, () => $('.test-fbuilder-ref-col-select .test-select-row').text(), {
      A: ['Klein', 'Last Name'],
      B: ['Klein', 'Last Name'],
      C: ['Cordelia', 'First Name'],
    });
    await gu.userActionsVerify([
      ["UpdateRecord", "_grist_Views_section_field", 141, {"visibleCol":2}],
      ["SetDisplayFormula", "Rates", 141, null, "$Person.First_Name"],
    ]);

    // Same for changing "visibleCol" to the special "RowID" value.
    await gu.clickCell({section: 'A', rowNum: 1, col: 0});
    await gu.setVisibleCol('Row ID');
    await checkSections({rowNum: 2, col: 0}, () => $('.test-fbuilder-ref-col-select .test-select-row').text(), {
      A: ['People[14]', 'Row ID'],
      B: ['People[14]', 'Row ID'],
      C: ['Cordelia', 'First Name'],
    });
    await gu.userActionsVerify([
      ["UpdateRecord", "_grist_Tables_column", 12, {"visibleCol":0}],
      ["SetDisplayFormula", "Rates", null, 12, ""],
    ]);

    // Undo here so we can verify that per-field "Row ID" choice overrides per-column choice.
    await gu.undo();

    await gu.userActionsCollect(true);
    await gu.clickCell({section: 'C', rowNum: 1, col: 0});
    await gu.setVisibleCol('Row ID');
    await checkSections({rowNum: 2, col: 0}, () => $('.test-fbuilder-ref-col-select .test-select-row').text(), {
      A: ['Klein', 'Last Name'],
      B: ['Klein', 'Last Name'],
      C: ['People[14]', 'Row ID'],
    });

    // Verify actions emitted.
    await gu.userActionsVerify([
      ["UpdateRecord", "_grist_Views_section_field", 141, {"visibleCol":0}],
      ["SetDisplayFormula", "Rates", 141, null, ""],
    ]);

    // Undo; we made 4 actions, but already ran one undo earlier.
    await gu.undo(3);
    await checkSections({rowNum: 2, col: 0}, () => $('.test-fbuilder-ref-col-select .test-select-row').text(), {
      A: ['Klein, Cordelia', 'Full Name'],
      B: ['Klein, Cordelia', 'Full Name'],
      C: ['Klein, Cordelia', 'Full Name'],
    });
  });


  it('should allow switching to separate settings', async function() {
    // Switch B to use separate settings.
    await gu.userActionsCollect(true);
    await gu.clickCell({section: 'B', rowNum: 1, col: 1});
    await gu.fieldSettingsUseSeparate();

    await gu.userActionsVerify([
      ["UpdateRecord", "_grist_Views_section_field", 140, {"widgetOptions":
        '{"widget":"TextBox","dateFormat":"YYYY-MM-DD","isCustomDateFormat":false,"alignment":"left"}'}],
    ]);

    // Verify that options are preserved.
    await checkSections({rowNum: 1, col: 1}, () => gu.dateFormat(), {
      A: ['2012-01-02', 'YYYY-MM-DD'],
      B: ['2012-01-02', 'YYYY-MM-DD'],
      C: ['2012-01-02', 'YYYY-MM-DD'],
    });

    // Change option in B and see that A and C are not affected.
    await gu.clickCell({section: 'B', rowNum: 1, col: 1});
    await gu.dateFormat('MM/DD/YYYY');
    await checkSections({rowNum: 1, col: 1}, () => gu.dateFormat(), {
      A: ['2012-01-02', 'YYYY-MM-DD'],
      B: ['01/02/2012', 'MM/DD/YYYY'],
      C: ['2012-01-02', 'YYYY-MM-DD'],
    });

    // Change option in A and see that B is not affected.
    await gu.clickCell({section: 'A', rowNum: 1, col: 1});
    await gu.dateFormat('MMMM Do, YYYY');
    await checkSections({rowNum: 1, col: 1}, () => gu.dateFormat(), {
      A: ['January 2nd, 2012', 'MMMM Do, YYYY'],
      B: ['01/02/2012', 'MM/DD/YYYY'],
      C: ['2012-01-02', 'YYYY-MM-DD'],
    });

    await gu.undo(3);
  });


  it('should allow switching to separate settings for visibleCol', async function() {
    // Same as above for changing 'visibleCol' option; after separating, try changing B, then A.
    await gu.userActionsCollect(true);
    await gu.clickCell({section: 'B', rowNum: 2, col: 0});
    await gu.fieldSettingsUseSeparate();
    await gu.userActionsVerify([
      ["UpdateRecord", "_grist_Views_section_field", 136, {"widgetOptions":'{"widget":"Reference"}'}],
      ["UpdateRecord", "_grist_Views_section_field", 136, {"visibleCol":4}],
      ["SetDisplayFormula", "Rates", 136, null, "$Person.Full_Name"],
    ]);

    await gu.setVisibleCol('First Name');
    await gu.clickCell({section: 'A', rowNum: 2, col: 0});
    await gu.setVisibleCol('Last Name');
    await checkSections({rowNum: 2, col: 0}, () => $('.test-fbuilder-ref-col-select .test-select-row').text(), {
      A: ['Klein', 'Last Name'],
      B: ['Cordelia', 'First Name'],
      C: ['Klein, Cordelia', 'Full Name'],
    });
    await gu.undo(3);
  });


  it('should allow reverting to common settings', async function() {
    // Change column in C to use different settings from A.
    await gu.clickCell({section: 'C', rowNum: 1, col: 1});
    await gu.dateFormat('MMMM Do, YYYY');
    await checkSections({rowNum: 1, col: 1}, () => gu.dateFormat(), {
      A: ['2012-01-02', 'YYYY-MM-DD'],
      B: ['2012-01-02', 'YYYY-MM-DD'],
      C: ['January 2nd, 2012', 'MMMM Do, YYYY'],
    });

    // Revert C to use common settings. Check that it matches A.
    await gu.userActionsCollect(true);
    await gu.fieldSettingsRevertToCommon();
    await checkSections({rowNum: 1, col: 1}, () => gu.dateFormat(), {
      A: ['2012-01-02', 'YYYY-MM-DD'],
      B: ['2012-01-02', 'YYYY-MM-DD'],
      C: ['2012-01-02', 'YYYY-MM-DD'],
    });
    await gu.userActionsVerify([
      ["UpdateRecord", "_grist_Views_section_field", 145, {"widgetOptions":""}],
    ]);
    await gu.undo(2);
  });


  it('should allow reverting to common settings for visibleCol', async function() {
    // Same as above for reverting 'visiblecCol'.
    await gu.clickCell({section: 'C', rowNum: 2, col: 0});
    await gu.setVisibleCol('Last Name');
    await checkSections({rowNum: 2, col: 0}, () => $('.test-fbuilder-ref-col-select .test-select-row').text(), {
      A: ['Klein, Cordelia', 'Full Name'],
      B: ['Klein, Cordelia', 'Full Name'],
      C: ['Klein', 'Last Name'],
    });
    await gu.userActionsCollect(true);
    await gu.fieldSettingsRevertToCommon();
    await checkSections({rowNum: 2, col: 0}, () => $('.test-fbuilder-ref-col-select .test-select-row').text(), {
      A: ['Klein, Cordelia', 'Full Name'],
      B: ['Klein, Cordelia', 'Full Name'],
      C: ['Klein, Cordelia', 'Full Name'],
    });
    await gu.userActionsVerify([
      ["UpdateRecord", "_grist_Views_section_field", 141, {"widgetOptions":""}],
      ["UpdateRecord", "_grist_Views_section_field", 141, {"visibleCol":0}],
      ["SetDisplayFormula", "Rates", 141, null, ""],
    ]);
    await gu.undo(2);
  });


  it('should allow saving separate settings as common', async function() {
    // Change column C to use different settings from A.
    await gu.clickCell({section: 'C', rowNum: 1, col: 1});
    await gu.dateFormat('MMMM Do, YYYY');
    await checkSections({rowNum: 1, col: 1}, () => gu.dateFormat(), {
      A: ['2012-01-02', 'YYYY-MM-DD'],
      B: ['2012-01-02', 'YYYY-MM-DD'],
      C: ['January 2nd, 2012', 'MMMM Do, YYYY'],
    });

    // Save C settings as common settings. Check that A and B now match.
    await gu.userActionsCollect(true);
    await gu.fieldSettingsSaveAsCommon();
    await checkSections({rowNum: 1, col: 1}, () => gu.dateFormat(), {
      A: ['January 2nd, 2012', 'MMMM Do, YYYY'],
      B: ['January 2nd, 2012', 'MMMM Do, YYYY'],
      C: ['January 2nd, 2012', 'MMMM Do, YYYY'],
    });
    await gu.userActionsVerify([
      ["UpdateRecord", "_grist_Tables_column", 15, {"widgetOptions":
        '{"widget":"TextBox","dateFormat":"MMMM Do, YYYY","isCustomDateFormat":false,"alignment":"left"}'}],
      ["UpdateRecord", "_grist_Views_section_field", 145, {"widgetOptions":""}],
    ]);
    await gu.undo(2);
    await checkSections({rowNum: 1, col: 1}, () => gu.dateFormat(), {
      A: ['2012-01-02', 'YYYY-MM-DD'],
      B: ['2012-01-02', 'YYYY-MM-DD'],
      C: ['2012-01-02', 'YYYY-MM-DD'],
    });
  });


  it('should allow saving separate settings as common for visibleCol', async function() {
    // Same as above for saving 'visiblecCol'.
    await gu.clickCell({section: 'C', rowNum: 2, col: 0});
    await gu.setVisibleCol('Last Name');
    await checkSections({rowNum: 2, col: 0}, () => $('.test-fbuilder-ref-col-select .test-select-row').text(), {
      A: ['Klein, Cordelia', 'Full Name'],
      B: ['Klein, Cordelia', 'Full Name'],
      C: ['Klein', 'Last Name'],
    });
    await gu.userActionsCollect(true);
    await gu.fieldSettingsSaveAsCommon();
    await checkSections({rowNum: 2, col: 0}, () => $('.test-fbuilder-ref-col-select .test-select-row').text(), {
      A: ['Klein', 'Last Name'],
      B: ['Klein', 'Last Name'],
      C: ['Klein', 'Last Name'],
    });
    await gu.userActionsVerify([
      ["UpdateRecord", "_grist_Tables_column", 12, {"visibleCol":3}],
      ["SetDisplayFormula", "Rates", null, 12, "$Person.Last_Name"],
      ["UpdateRecord", "_grist_Views_section_field", 141, {"widgetOptions":""}],
      ["UpdateRecord", "_grist_Views_section_field", 141, {"visibleCol":0}],
      ["SetDisplayFormula", "Rates", 141, null, ""],
    ]);
    await gu.undo(2);
    await checkSections({rowNum: 2, col: 0}, () => $('.test-fbuilder-ref-col-select .test-select-row').text(), {
      A: ['Klein, Cordelia', 'Full Name'],
      B: ['Klein, Cordelia', 'Full Name'],
      C: ['Klein, Cordelia', 'Full Name'],
    });
  });
});
