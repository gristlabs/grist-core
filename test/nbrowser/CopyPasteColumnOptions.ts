/**
 * Test for copy-pasting from a Grist column into a blank column, which should copy the options.
 */
import {safeJsonParse} from 'app/common/gutil';
import {GristObjCode} from 'app/plugin/GristData';
import {assert} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('CopyPasteColumnOptions', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  const clipboard = gu.getLockableClipboard();
  afterEach(() => gu.checkForErrors());
  gu.bigScreen();

  it('should copy column options into blank columns', async function() {
    const session = await gu.session().login();
    const doc = await session.tempDoc(cleanup, 'CopyOptions.grist');
    const api = session.createHomeApi().getDocAPI(doc.id);
    const data1 = await api.getRows("Table1");
    const data2 = await api.getRows("Table2");

    assert.deepEqual(data1, {
      "id": [1],
      "manualSort": [1],
      "A": [1041465600],
      "B": [1044057600],
      "C": [1],
      "D": [[GristObjCode.List, 1, 1]],
      "E": ["01/02/03"],
      "F": [[GristObjCode.List, "01/02/03"]],
      "G": ["01/02/03"],
      "gristHelper_Display": [[GristObjCode.Date, 1041465600]],
      "gristHelper_Display2": [[GristObjCode.List, [GristObjCode.Date, 1044057600], [GristObjCode.Date, 1044057600]]],
      "gristHelper_ConditionalRule": [true],
    });

    // Initially Table2 is completely empty, all the columns are blank and of type Any
    assert.deepEqual(data2, {
      "id": [],
      "manualSort": [],
      "A": [],
      "B": [],
      "C2": [],
      "D2": [],
      "E": [],
      "F": [],
      "G": [],
    });

    // Copy all the data from Table1 to Table2, which will copy the column options
    await gu.getCell({section: 'TABLE1', col: 0, rowNum: 1}).click();
    await gu.sendKeys(await gu.selectAllKey());
    await clipboard.lockAndPerform(async (cb) => {
      await cb.copy();
      await gu.getCell({section: 'TABLE2', col: 0, rowNum: 1}).click();
      await cb.paste();
    });
    await gu.waitForServer();

    // Now Table2 contains essentially the same data as Table1
    // Table2 just has slightly different column names to test display formulas,
    // and conditional formatting is not copied at the moment.
    data1.C2 = data1.C;
    data1.D2 = data1.D;
    delete data1.C;
    delete data1.D;
    delete data1.gristHelper_ConditionalRule;
    // Actual difference: G is a Text column, so its type was guessed as Date and the string was parsed
    data1.G = [981158400];
    assert.deepEqual(await api.getRows("Table2"), data1);

    // Second check that the data is the same, and also that it's formatted the same
    const cols1 = ["A", "B", "C", "D", "E", "F", "G"];
    const cols2 = ["A", "B", "C2", "D2", "E", "F", "G"];
    assert.deepEqual(
      await gu.getVisibleGridCells({cols: cols1, rowNums: [1], section: "TABLE1"}),
      await gu.getVisibleGridCells({cols: cols2, rowNums: [1], section: "TABLE2"}),
    );

    // Check that the column options are essentially the same in both tables
    const cols = await api.getRecords("_grist_Tables_column");
    const cleanCols = cols.map(
      ({
         id,
         fields: {
           parentId,
           colId,
           type,
           visibleCol,
           displayCol,
           rules,
           widgetOptions,
           formula
         }
       }) => ({
        id,
        parentId,
        colId,
        type,
        visibleCol,
        displayCol,
        rules,
        formula,
        widgetOptions: safeJsonParse(widgetOptions as string, ""),
      }));

    assert.deepEqual(cleanCols, [
      {
        "id": 1,
        "parentId": 1,
        "colId": "manualSort",
        "type": "ManualSortPos",
        "visibleCol": 0,
        "displayCol": 0,
        "rules": null,
        "formula": "",
        "widgetOptions": ""
      }, {
        "id": 2,
        "parentId": 1,
        "colId": "A",
        "type": "Date",
        "visibleCol": 0,
        "displayCol": 0,
        "rules": null,
        "formula": "",
        "widgetOptions": {
          "widget": "TextBox",
          "dateFormat": "MM/DD/YY",
          "isCustomDateFormat": false,
          "alignment": "left"
        }
      }, {
        "id": 3,
        "parentId": 1,
        "colId": "B",
        "type": "Date",
        "visibleCol": 0,
        "displayCol": 0,
        "rules": null,
        "formula": "",
        "widgetOptions": {
          "widget": "TextBox",
          "dateFormat": "DD/MM/YY",
          "isCustomDateFormat": true,
          "alignment": "center"
        }
      }, {
        "id": 4,
        "parentId": 1,
        "colId": "C",
        "type": "Ref:Table1",
        "visibleCol": 2,
        "displayCol": 5,
        "rules": null,
        "formula": "",
        "widgetOptions": {"widget": "Reference", "alignment": "left", "fillColor": "#FECC81"}
      }, {
        "id": 5,
        "parentId": 1,
        "colId": "gristHelper_Display",
        "type": "Any",
        "visibleCol": 0,
        "displayCol": 0,
        "rules": null,
        "formula": "$C.A",
        "widgetOptions": ""
      }, {
        "id": 6,
        "parentId": 1,
        "colId": "D",
        "type": "RefList:Table1",
        "visibleCol": 3,
        "displayCol": 7,
        "rules": null,
        "formula": "",
        "widgetOptions": {"widget": "Reference", "alignment": "left", "rulesOptions": [], "wrap": true}
      }, {
        "id": 7,
        "parentId": 1,
        "colId": "gristHelper_Display2",
        "type": "Any",
        "visibleCol": 0,
        "displayCol": 0,
        "rules": null,
        "formula": "$D.B",
        "widgetOptions": ""
      }, {
        "id": 8,
        "parentId": 1,
        "colId": "E",
        "type": "Choice",
        "visibleCol": 0,
        "displayCol": 0,
        "rules": null,
        "formula": "",
        "widgetOptions": {"widget": "TextBox", "alignment": "left", "choices": ["01/02/03"], "choiceOptions": {}}
      }, {
        "id": 9,
        "parentId": 1,
        "colId": "F",
        "type": "ChoiceList",
        "visibleCol": 0,
        "displayCol": 0,
        "rules": [GristObjCode.List, 21],  // Not copied into the new table
        "formula": "",
        "widgetOptions": {
          "widget": "TextBox",
          "choices": ["01/02/03", "foo"],
          "choiceOptions": {},
          "alignment": "left",
          "rulesOptions": [{"fillColor": "#BC77FC", "textColor": "#000000"}]  // Not copied into the new table
        }
      }, {
        "id": 10,
        "parentId": 1,
        "colId": "G",
        "type": "Text",
        "visibleCol": 0,
        "displayCol": 0,
        "rules": null,
        "formula": "",
        "widgetOptions": {"widget": "TextBox", "alignment": "left", "rulesOptions": []}
      },

      /////////////////
      ///// Table2 starts here. Most of the column options are now the same.
      /////////////////
      {
        "id": 13,
        "parentId": 2,
        "colId": "manualSort",
        "type": "ManualSortPos",
        "visibleCol": 0,
        "displayCol": 0,
        "rules": null,
        "formula": "",
        "widgetOptions": ""
      }, {
        "id": 14,
        "parentId": 2,
        "colId": "A",
        "type": "Date",
        "visibleCol": 0,
        "displayCol": 0,
        "rules": null,
        "formula": "",
        "widgetOptions": {
          "widget": "TextBox",
          "dateFormat": "MM/DD/YY",
          "isCustomDateFormat": false,
          "alignment": "left"
        }
      }, {
        "id": 15,
        "parentId": 2,
        "colId": "B",
        "type": "Date",
        "visibleCol": 0,
        "displayCol": 0,
        "rules": null,
        "formula": "",
        "widgetOptions": {
          "widget": "TextBox",
          "dateFormat": "DD/MM/YY",
          "isCustomDateFormat": true,
          "alignment": "center"
        }
      }, {
        "id": 16,
        "parentId": 2,
        "colId": "C2",
        "type": "Ref:Table1",
        "visibleCol": 2,
        "displayCol": 22,
        "rules": null,
        "formula": "",
        "widgetOptions": {"widget": "Reference", "alignment": "left", "fillColor": "#FECC81"}
      }, {
        "id": 17,
        "parentId": 2,
        "colId": "D2",
        "type": "RefList:Table1",
        "visibleCol": 3,
        "displayCol": 23,
        "rules": null,
        "formula": "",
        "widgetOptions": {"widget": "Reference", "alignment": "left", "wrap": true}
      }, {
        "id": 18,
        "parentId": 2,
        "colId": "E",
        "type": "Choice",
        "visibleCol": 0,
        "displayCol": 0,
        "rules": null,
        "formula": "",
        "widgetOptions": {"widget": "TextBox", "alignment": "left", "choices": ["01/02/03"], "choiceOptions": {}}
      }, {
        "id": 19,
        "parentId": 2,
        "colId": "F",
        "type": "ChoiceList",
        "visibleCol": 0,
        "displayCol": 0,
        "rules": null,
        "formula": "",
        "widgetOptions": {"widget": "TextBox", "choices": ["01/02/03", "foo"], "choiceOptions": {}, "alignment": "left"}
      }, {
        // Actual difference: the original 'G' is a Text column, so in the new column the type was guessed as Date
        "id": 20,
        "parentId": 2,
        "colId": "G",
        "type": "Date",
        "visibleCol": 0,
        "displayCol": 0,
        "rules": null,
        "formula": "",
        "widgetOptions": {
          "timeFormat": "",
          "isCustomTimeFormat": true,
          "isCustomDateFormat": true,
          "dateFormat": "YY/MM/DD"
        }
      }, {
        "id": 21,
        // This is in Table1, it's here because it was created in the fixture after Table2
        // No similar column is in Table2 because conditional formatting is not copied
        "parentId": 1,
        "colId": "gristHelper_ConditionalRule",
        "type": "Any",
        "visibleCol": 0,
        "displayCol": 0,
        "rules": null,
        "formula": "True",
        "widgetOptions": ""
      }, {
        "id": 22,
        "parentId": 2,
        "colId": "gristHelper_Display",
        "type": "Any",
        "visibleCol": 0,
        "displayCol": 0,
        "rules": null,
        "formula": "$C2.A",  // Correctly 'renamed' from $C.A
        "widgetOptions": ""
      }, {
        "id": 23,
        "parentId": 2,
        "colId": "gristHelper_Display2",
        "type": "Any",
        "visibleCol": 0,
        "displayCol": 0,
        "rules": null,
        "formula": "$D2.B",  // Correctly 'renamed' from $D.A
        "widgetOptions": ""
      }]
    );
  });

});
