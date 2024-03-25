import {driver, Key} from "mocha-webdriver";
import {assert} from "chai";
import * as gu from "./gristUtils";
import {setupTestSuite} from "./testUtils";
import {UserAPIImpl} from 'app/common/UserAPI';

describe('GridViewNewColumnMenu', function () {
  const STANDARD_WAITING_TIME = 1000;
  this.timeout('2m');
  const cleanup = setupTestSuite();
  gu.bigScreen();
  let api: UserAPIImpl;
  let docId: string;
  let session: gu.Session;

  before(async function () {
    session = await gu.session().login({showTips:true});
    api = session.createHomeApi();
    docId = await session.tempNewDoc(cleanup, 'ColumnMenu');
    await gu.dismissBehavioralPrompts();

    // Add a table that will be used for lookups.
    await gu.sendActions([
      ['AddTable', 'Person', [
        {id: "Name"},
        {id: "Age", type: 'Numeric'},
        {id: 'Hobby', type: 'ChoiceList', widgetOptions: JSON.stringify({choices: ['Books', 'Cars']})},
        {id: 'Employee', type: 'Choice', widgetOptions: JSON.stringify({choices: ['Y', 'N']})},
        {id: "Birthday date", type: 'Date', label: 'Birthday date'},
        {id: "Member", type: 'Bool'},
        {id: "SeenAt", type: 'DateTime:UTC'},
        {id: "Photo", type: 'Attachments'},
        {id: "Fun", type: 'Any', formula: '44'},
        {id: 'Parent', type: 'Ref:Person'},
        {id: 'Children', type: 'RefList:Person'},
      ]],
      ['AddRecord', 'Person', null, {Name: "Bob", Age: 12}],
      ['AddRecord', 'Person', null, {Name: "Robert", Age: 34, Parent: 1}],
    ]);
  });

  describe('sections', function () {
    revertEach();

    it('looks ok for an empty document', async function () {
      await clickAddColumn();
      await hasAddNewColumMenu();
      await hasShortcuts();
      await closeAddColumnMenu();
    });

    it('has lookup columns', async function () {
      await gu.sendActions([
        // Create a table that we can reference to.
        ['AddTable', 'Reference', [
          {id: "Name"},
          {id: "Age"},
          {id: "City"}
        ]],
        // Add some data to the table.
        ['AddRecord', 'Reference', null, {Name: "Bob", Age: 12, City: "New York"}],
        ['AddRecord', 'Reference', null, {Name: "Robert", Age: 34, City: "Łódź"}],
        // And a Ref column in the main table to that table.
        ['AddColumn', 'Table1', 'Reference', {type: 'Ref:Reference'}],
      ]);

      await clickAddColumn();
      await hasAddNewColumMenu();
      await hasShortcuts();
      await hasLookupMenu('Reference');
      await closeAddColumnMenu();
    });
  });

  describe('column creation', function () {
    revertEach();

    it('should show rename menu after a new column click', async function () {
      await clickAddColumn();
      await driver.findWait('.test-new-columns-menu-add-new', STANDARD_WAITING_TIME).click();
      await gu.waitForServer();
      await driver.findWait('.test-column-title-popup', STANDARD_WAITING_TIME, 'rename menu is not present');
      await closeAddColumnMenu();
    });

    it('should create a new column', async function () {
      await clickAddColumn();
      await driver.findWait('.test-new-columns-menu-add-new', STANDARD_WAITING_TIME).click();
      await gu.waitForServer();
      //discard rename menu
      await driver.findWait('.test-column-title-close', STANDARD_WAITING_TIME).click();
      //check if new column is present
      const columns = await gu.getColumnNames();
      assert.include(columns, 'D', 'new column is not present');
      assert.lengthOf(columns, 4, 'wrong number of columns');

      // check that single undo removes new column
      await gu.undo();

      const columns2 = await gu.getColumnNames();
      assert.notInclude(columns2, 'D', 'new column is still present');
      assert.lengthOf(columns2, 3, 'wrong number of columns');
    });

    it('should support inserting before selected column', async function () {
      await gu.openColumnMenu('A', 'Insert column to the left');
      await driver.findWait(".test-new-columns-menu", STANDARD_WAITING_TIME);
      await gu.sendKeys(Key.ENTER);
      await gu.waitForServer();
      await driver.findWait('.test-column-title-close', STANDARD_WAITING_TIME).click();
      const columns = await gu.getColumnNames();
      assert.deepEqual(columns, ['D', 'A', 'B', 'C']);
    });

    it('should support inserting after selected column', async function () {
      await gu.openColumnMenu('A', 'Insert column to the right');
      await driver.findWait(".test-new-columns-menu", STANDARD_WAITING_TIME);
      await gu.sendKeys(Key.ENTER);
      await gu.waitForServer();
      await driver.findWait('.test-column-title-close', STANDARD_WAITING_TIME).click();
      const columns = await gu.getColumnNames();
      assert.deepEqual(columns, ['A', 'D', 'B', 'C']);
    });

    it('should support inserting after the last visible column', async function () {
      await gu.openColumnMenu('C', 'Insert column to the right');
      await driver.findWait(".test-new-columns-menu", STANDARD_WAITING_TIME);
      await gu.sendKeys(Key.ENTER);
      await gu.waitForServer();
      await driver.findWait('.test-column-title-close', STANDARD_WAITING_TIME).click();
      const columns = await gu.getColumnNames();
      assert.deepEqual(columns, ['A', 'B', 'C', 'D']);
    });

    it('should skip showing menu when inserting with keyboard shortcuts', async function () {
      await gu.sendKeys(Key.chord(Key.ALT, '='));
      await gu.waitForServer();
      assert.isFalse(await driver.find('.test-new-columns-menu').isPresent());
      await gu.sendKeys(Key.ENTER);
      let columns = await gu.getColumnNames();
      assert.deepEqual(columns, ['A', 'B', 'C', 'D']);
      await gu.sendKeys(Key.chord(Key.SHIFT, Key.ALT, '='));
      await gu.waitForServer();
      assert.isFalse(await driver.find('.test-new-columns-menu').isPresent());
      await gu.sendKeys(Key.ENTER);
      columns = await gu.getColumnNames();
      assert.deepEqual(columns, ['A', 'B', 'C', 'E', 'D']);
    });
  });

  describe('create column with type', function () {
    revertThis();
    const columnsThatShouldTriggerSideMenu = [
      "Reference",
      "Reference List"
    ];

    const optionsToBeDisplayed = [
      "Text",
      "Numeric",
      "Integer",
      "Toggle",
      "Date",
      "DateTime",
      "Choice",
      "Choice List",
      "Reference",
      "Reference List",
      "Attachment",
    ].map((option) => ({type:option, testClass: option.toLowerCase().replace(' ', '-')}));


    describe('on desktop', function () {
        gu.bigScreen();

      it('should show "Add Column With type" option', async function () {
        // open add new colum menu
        await clickAddColumn();
        // check if "Add Column With type" option is present
        const addWithType = await driver.findWait(
          '.test-new-columns-menu-add-with-type',
          100,
          'Add Column With Type is not present');
        assert.equal(await addWithType.getText(), 'Add column with type');
      });

      it('should display reference column popup when opened for the first time', async function(){
        await gu.enableTips(session.email);
        // open add new colum menu
        await clickAddColumn();
        // select "Add Column With type" option
        await driver.findWait('.test-new-columns-menu-add-with-type', STANDARD_WAITING_TIME).click();
        // wait for submenu to appear
        await driver.findWait('.test-new-columns-menu-add-with-type-submenu', STANDARD_WAITING_TIME);
        // check if popup is showed
        await driver.findWait('.test-behavioral-prompt',
          STANDARD_WAITING_TIME,
          'Reference column popup is not present');
        // close popup
        await gu.dismissBehavioralPrompts();
        // close menu
        await closeAddColumnMenu();
        // open it again
        await clickAddColumn();
        await driver.findWait('.test-new-columns-menu-add-with-type', STANDARD_WAITING_TIME).click();
        await driver.findWait('.test-new-columns-menu-add-with-type-submenu', STANDARD_WAITING_TIME);
        // popup should not be showed
        assert.isFalse(await driver.find('.test-behavioral-prompt').isPresent());
        await closeAddColumnMenu();
      });

      for (const option of optionsToBeDisplayed) {
        it(`should allow to select column type ${option.type}`, async function () {
          // open add new colum menu
          await clickAddColumn();
          // select "Add Column With type" option
          await driver.findWait('.test-new-columns-menu-add-with-type', STANDARD_WAITING_TIME).click();
          // wait for submenu to appear
          await driver.findWait('.test-new-columns-menu-add-with-type-submenu', STANDARD_WAITING_TIME);
          // check if it is present in the menu
          const element = await driver.findWait(
            `.test-new-columns-menu-add-${option.testClass}`.toLowerCase(),
            100,
            `${option.type} option is not present`);
          // click on the option and check if column is added with a proper type
          await element.click();
          await gu.waitForServer();
          //discard rename menu
          await driver.findWait('.test-column-title-close', STANDARD_WAITING_TIME).click();
          //check if new column is present
          await gu.selectColumn('D');
          await gu.openColumnPanel();
          const type = await gu.getType();
          assert.equal(type, option.type);

          await gu.undo(1);
        });
      }

      for (const optionsTriggeringMenu of optionsToBeDisplayed.filter((option) =>
        columnsThatShouldTriggerSideMenu.includes(option.type))) {
        it(`should open Right Menu on Column section after choosing ${optionsTriggeringMenu.type}`, async function(){
          await gu.enableTips(session.email);
          //close right panel just in case.
          await gu.toggleSidePanel("right", "close");
          // open add new colum menu
          await clickAddColumn();
          // select "Add Column With type" option
          await driver.findWait('.test-new-columns-menu-add-with-type', STANDARD_WAITING_TIME).click();
          // wait for submenu to appear
          await driver.findWait('.test-new-columns-menu-add-with-type-submenu', STANDARD_WAITING_TIME);
          // check if it is present in the menu
          const element = await driver.findWait(
            `.test-new-columns-menu-add-${optionsTriggeringMenu.testClass}`.toLowerCase(),
            STANDARD_WAITING_TIME,
            `${optionsTriggeringMenu.type} option is not present`);
          // click on the option and check if column is added with a proper type
          await element.click();
          await gu.waitForServer();
          //discard rename menu
          await driver.findWait('.test-column-title-close', STANDARD_WAITING_TIME).click();
          // Wait for the side panel animation.
          await gu.waitForSidePanel();
          //check if right menu is opened on column section
          await gu.waitForSidePanel();
          assert.isTrue(await driver.find('.test-right-tab-field').isDisplayed());
          await gu.toggleSidePanel("right", "close");
          await gu.undo(1);
        });

        it(`should show referenceColumnsConfig in right Column section
         when ${optionsTriggeringMenu.type} type is chosen`,
          async function(){
          //close right panel just in case.
          await gu.toggleSidePanel("right", "close");
          await gu.enableTips(session.email);
          await driver.executeScript('resetDismissedPopups()');
          // open add new colum menu
          await clickAddColumn();
          // select "Add Column With type" option
          await driver.findWait('.test-new-columns-menu-add-with-type', STANDARD_WAITING_TIME).click();
          // wait for submenu to appear
          await driver.findWait('.test-new-columns-menu-add-with-type-submenu', STANDARD_WAITING_TIME);
          // check if it is present in the menu
          const element = await driver.findWait(
            `.test-new-columns-menu-add-${optionsTriggeringMenu.testClass}`.toLowerCase(),
            STANDARD_WAITING_TIME,
            `${optionsTriggeringMenu.type} option is not present`);
          // click on the option and check if column is added with a proper type
          await element.click();
          await gu.waitForServer();
          //discard rename menu
          await driver.findWait('.test-column-title-close', STANDARD_WAITING_TIME).click();
          //check if referenceColumnsConfig is present
          await gu.waitToPass(async ()=> assert.isTrue(
            await driver.findContentWait(
              '.test-behavioral-prompt-title',
              'Reference Columns',
               STANDARD_WAITING_TIME*2
               ).isDisplayed()
            ), 5000);
          await gu.dismissBehavioralPrompts();
          await gu.toggleSidePanel("right", "close");
          await gu.undo(1);
        });
      }
    });

    describe('on mobile', function () {
      gu.narrowScreen();
      for (const optionsTriggeringMenu of optionsToBeDisplayed.filter((option) =>
      columnsThatShouldTriggerSideMenu.includes(option.type))) {
        it('should not show Right Menu when user is on the mobile/narrow screen', async function() {
          await gu.enableTips(session.email);
          //close right panel just in case.
          await gu.toggleSidePanel("right", "close");
          // open add new colum menu
          await clickAddColumn();
          // select "Add Column With type" option
          await driver.findWait('.test-new-columns-menu-add-with-type', STANDARD_WAITING_TIME).click();
          // wait for submenu to appear
          await driver.findWait('.test-new-columns-menu-add-with-type-submenu', STANDARD_WAITING_TIME);
          // check if it is present in the menu
          const element = await driver.findWait(
            `.test-new-columns-menu-add-${optionsTriggeringMenu.testClass}`.toLowerCase(),
            STANDARD_WAITING_TIME,
            `${optionsTriggeringMenu.type} option is not present`);
          // click on the option and check if column is added with a proper type
          await element.click();
          await gu.waitForServer();
          //discard rename menu
          await driver.findWait('.test-column-title-close', STANDARD_WAITING_TIME).click();
          //check if right menu is opened on column section
          assert.isFalse(await driver.find('.test-right-tab-field').isPresent());
          await gu.toggleSidePanel("right", "close");
          await gu.undo(1);
        });
      }
    });
  });

  describe('create formula column', function(){
    revertThis();
    it('should show "create formula column" option with tooltip', async function () {
      // open add new colum menu
      await clickAddColumn();
      // check if "create formula column" option is present
      const addWithType = await driver.findWait('.test-new-columns-menu-add-formula', STANDARD_WAITING_TIME,
        'Add formula column is not present');
      // check if it has a tooltip button
      const tooltip = await addWithType.findWait('.test-info-tooltip', STANDARD_WAITING_TIME,
        'Tooltip button is not present');
      // check if tooltip is show after hovering
      await tooltip.mouseMove();
      const tooltipContainer = await driver.findWait('.test-info-tooltip-popup',
        100,
        'Tooltip is not shown');
      // check if tooltip is showing valid message
      const tooltipText = await tooltipContainer.getText();
      assert.include(tooltipText,
        'Formulas support many Excel functions, full Python syntax, and include a helpful AI Assistant.',
        'Tooltip is showing wrong message');
      // check if link in tooltip has a proper href
      const hrefAddress = await tooltipContainer.findWait('a',
        100,
        'Tooltip link is not present');
      assert.equal(await hrefAddress.getText(), 'Learn more.');
      assert.equal(await hrefAddress.getAttribute('href'),
        'https://support.getgrist.com/formulas',
        'Tooltip link has wrong href');
    });

    it('should allow to select formula column', async function () {
      // open column panel - we will need it later
      await gu.openColumnPanel();
      // open add new colum menu
      await clickAddColumn();
      // select "create formula column" option
      await driver.findWait('.test-new-columns-menu-add-formula', STANDARD_WAITING_TIME).click();
      //check if new column is present
      await gu.waitForServer();
      // there should not be a rename popup
      assert.isFalse(await driver.find('test-column-title-popup').isPresent());
      // check if editor popup is opened
      await driver.findWait('.test-floating-editor-popup', 200, 'Editor popup is not present');
      // write some formula
      await gu.sendKeys('1+1');
      await driver.find('.test-formula-editor-save-button').click();
      await gu.waitForServer();
      // check if column is created with a proper type
      const type = await gu.columnBehavior();
      assert.equal(type, 'Formula Column');

    });
  });


  describe('hidden columns', function () {
    revertThis();

    it('hides hidden column section from < 5 columns', async function () {
      await gu.sendActions([
        ['AddVisibleColumn', 'Table1', 'New1', {type: 'Any'}],
        ['AddVisibleColumn', 'Table1', 'New2', {type: 'Any'}],
        ['AddVisibleColumn', 'Table1', 'New3', {type: 'Any'}],
      ]);
      await gu.openWidgetPanel();
      await clickAddColumn();
      assert.isFalse(await driver.find(".new-columns-menu-hidden-columns").isPresent(), 'hidden section is present');
      await closeAddColumnMenu();
    });

    describe('inline menu section', function () {
      revertEach();

      it('shows hidden section as inlined for 1 to 5 hidden columns', async function () {
        // Check that the hidden section is present and has the expected columns.
        const checkSection = async (...columns: string[]) => {
          await clickAddColumn();
          await driver.findWait(".test-new-columns-menu-hidden-columns-header",
            STANDARD_WAITING_TIME,
            'hidden section is not present');
          for (const column of columns) {
            assert.isTrue(
              await driver.findContent('.test-new-columns-menu-hidden-column-inlined', column).isPresent(),
              `column ${column} is not present`
            );
          }
          await closeAddColumnMenu();
        };

        await gu.moveToHidden('A');
        await checkSection('A');
        await gu.moveToHidden('B');
        await gu.moveToHidden('C');
        await gu.moveToHidden('New1');
        await gu.moveToHidden('New2');
        await checkSection('A', 'B', 'C', 'New1', 'New2');
      });

      it('should add hidden column at the end', async function () {
        let columns = await gu.getColumnNames();
        assert.deepEqual(columns, ['A', 'B', 'C', 'New1', 'New2', 'New3']);

        // Hide 'A' and add it back.
        await gu.moveToHidden('A');
        await clickAddColumn();
        await driver.findContent('.test-new-columns-menu-hidden-column-inlined', 'A').click();
        await gu.waitForServer();

        // Now check that the column was added at the end.
        columns = await gu.getColumnNames();
        assert.deepEqual(columns, ['B', 'C', 'New1', 'New2', 'New3', 'A']);
      });
    });

    describe('submenu section', function () {
      before(async function () {
        await gu.sendActions([
          ['AddVisibleColumn', 'Table1', 'New4', {type: 'Any'}],
        ]);
      });

      after(async function () {
        await gu.sendActions([
          ['RemoveColumn', 'Table1', 'New4'],
        ]);
      });

      it('more than 5 hidden columns, section should be in submenu', async function () {
        // Hide all columns except A.
        const columns = await gu.getColumnNames();
        for (const column of columns.slice(1)) {
          await gu.moveToHidden(column);
        }

        // Make sure they are hidden.
        assert.deepEqual(await gu.getColumnNames(), ['A']);

        // Now make sure we see all of them in the submenu.
        await clickAddColumn();
        await driver.findWait(".test-new-columns-menu-hidden-columns-menu",
          STANDARD_WAITING_TIME,
          'hidden section is not present');
        assert.isFalse(await driver.find(".test-new-columns-menu-hidden-columns-header").isPresent());

        // We don't see any hidden columns in the main menu.
        assert.isFalse(await driver.find(".test-new-columns-menu-hidden-column-inlined").isPresent());

        // Now expand the submenu and check that we see all the hidden columns.
        await driver.find(".test-new-columns-menu-hidden-columns-menu").click();

        // And we should see all the hidden columns.
        for (const column of columns.slice(1)) {
          assert.isTrue(
            await driver.findContentWait('.test-new-columns-menu-hidden-column-collapsed',
              column,
              STANDARD_WAITING_TIME).isDisplayed(),
            `column ${column} is not present`
          );
        }

        // Add B column.
        await driver.findContent('.test-new-columns-menu-hidden-column-collapsed', 'B').click();
        await gu.waitForServer();

        // Now check that the column was added at the end.
        const columns2 = await gu.getColumnNames();
        assert.deepEqual(columns2, ['A', 'B']);

        // Hide it again.
        await gu.undo();
      });

      it('submenu should be searchable', async function () {
        await clickAddColumn();
        await driver.find(".test-new-columns-menu-hidden-columns-menu").click();
        await driver.findWait('.test-searchable-menu-input', STANDARD_WAITING_TIME).click();
        await gu.sendKeys('New');
        await checkResult(['New1', 'New2', 'New3', 'New4']);

        await gu.sendKeys('2');
        await checkResult(['New2']);

        await gu.sendKeys('dummy');
        await checkResult([]);

        await gu.clearInput();
        await checkResult(['B', 'C', 'New1', 'New2', 'New3', 'New4']);

        await gu.sendKeys(Key.ESCAPE);
        assert.isFalse(await isMenuPresent());

        // Show it once again and add B and C.
        await clickAddColumn();
        await driver.find(".test-new-columns-menu-hidden-columns-menu").click();
        await driver.findContentWait('.test-new-columns-menu-hidden-column-collapsed',
          'B',
          STANDARD_WAITING_TIME).click();
        await gu.waitForServer();

        await clickAddColumn();
        // Now this column is inlined.
        await driver.findContentWait(".test-new-columns-menu-hidden-column-inlined",
          'C',
          STANDARD_WAITING_TIME).click();
        await gu.waitForServer();

        // Make sure they are added at the end.
        const columns = await gu.getColumnNames();
        assert.deepEqual(columns, ['A', 'B', 'C']);

        async function checkResult(cols: string[]) {
          await gu.waitToPass(async () => {
            assert.deepEqual(
              await collapsedHiddenColumns(),
              cols
            );
          }, STANDARD_WAITING_TIME);
        }
      });
    });
  });

  const COLUMN_LABELS = [
    "Name", "Age", "Hobby", "Employee", "Birthday date", "Member", "SeenAt", "Photo", "Fun", "Parent", "Children"
  ];

  describe('lookups from Reference columns', function () {
    revertThis();

    before(async function () {
      await gu.sendActions([
        ['AddVisibleColumn', 'Table1', 'Person', {type: 'Ref:Person'}],
        ['AddVisibleColumn', 'Table1', 'Employees', {type: 'RefList:Person'}],
      ]);
      await gu.openColumnPanel();

      // Add color to the name column to make sure it is not added to the lookup menu.
      await gu.openPage('Person');
      await gu.getCell('Name', 1).click();
      await gu.openCellColorPicker();
      await gu.setFillColor('#FD8182');
      await driver.find('.test-colors-save').click();
      await gu.waitForServer();

      // And add conditional rule here. We will test if style rules are not copied over.
      await gu.addInitialStyleRule();
      await gu.openStyleRuleFormula(0);
      await gu.sendKeys('True');
      await gu.sendKeys(Key.ENTER);
      await gu.waitForServer();

      await gu.openCellColorPicker(0);
      await gu.setFillColor('#FD8182');
      await driver.find('.test-colors-save').click();
      await gu.waitForServer();

      await gu.openPage('Table1');
    });

    it('should show only 2 reference columns', async function () {
      await clickAddColumn();
      await gu.waitToPass(async () => {
        const labels =  await driver.findAll('.test-new-columns-menu-lookup', (el) => el.getText());
        assert.deepEqual(
          labels,
          ['Person [Person]', 'Person [Employees]'],
        );
      });
      await closeAddColumnMenu();
    });

    it('should suggest to add every column from a reference', async function () {
      await clickAddColumn();
      await driver.findWait('.test-new-columns-menu-lookup-Person', STANDARD_WAITING_TIME).click();
      await gu.waitToPass(async () => {
        const allColumns = await driver.findAll('.test-new-columns-menu-lookup-column', (el) => el.getText());
        assert.deepEqual(allColumns, COLUMN_LABELS);
      });
      await closeAddColumnMenu();
    });

    // Now add each column and make sure it is added with a proper name.
    for(const column of COLUMN_LABELS) {
      it(`should insert ${column} with a proper name and type from a Ref column`, async function () {
        const revert = await gu.begin();
        await clickAddColumn();
        await driver.findWait('.test-new-columns-menu-lookup-Person', STANDARD_WAITING_TIME).click();
        await driver.findContentWait(`.test-new-columns-menu-lookup-column`, column, STANDARD_WAITING_TIME).click();
        await gu.waitForServer();

        const columns = await gu.getColumnNames();
        assert.deepEqual(columns, ['A', 'B', 'C', 'Person', 'Employees', `Person_${column}`]);

        // This should be a formula column.
        assert.equal(await gu.columnBehavior(), "Formula Column");

        // And the formula should be correct.
        await driver.find('.formula_field_sidepane').click();
        assert.equal(await gu.getFormulaText(), `$Person.${column.replace(" ", "_")}`);
        await gu.sendKeys(Key.ESCAPE);

        switch (column) {
          case "Name":
            // This should be a text column.
            assert.equal(await gu.getType(), 'Text');
            // We should have color but no rules.
            await gu.openCellColorPicker();
            assert.equal(await driver.find(".test-fill-hex").value(), '#FD8182');
            await driver.find('.test-colors-cancel').click();
            assert.equal(0, await gu.styleRulesCount());
            break;
          case "Age":
            // This should be a numeric column.
            assert.equal(await gu.getType(), 'Numeric');
            break;
          case "Hobby": {
            // This should be a choice column.
            assert.equal(await gu.getType(), 'Choice List');
            // And the choices should be correct.
            const labels = await driver.findAll('.test-choice-list-entry-label', el => el.getText());
            assert.deepEqual(labels, ['Books', 'Cars']);
            break;
          }
          case "Employee": {
            // This should be a choice column.
            assert.equal(await gu.getType(), 'Choice');
            // And the choices should be correct.
            const labels = await driver.findAll('.test-choice-list-entry-label', el => el.getText());
            assert.deepEqual(labels, ['Y', 'N']);
            break;
          }
          case "Birthday date":
            // This should be a date column.
            assert.equal(await gu.getType(), 'Date');
            break;
          case "Member":
            // This should be a boolean column.
            assert.equal(await gu.getType(), 'Toggle');
            break;
          case "SeenAt":
            // This should be a datetime column.
            assert.equal(await gu.getType(), 'DateTime');
            assert.equal(await driver.find(".test-tz-autocomplete input").value(), 'UTC');
            break;
          case "Photo":
            // This should be an attachment column.
            assert.equal(await gu.getType(), 'Attachment');
            break;
          case "Fun":
            // This should be an any column.
            assert.equal(await gu.getType(), 'Any');
            break;
          case "Parent":
            // This should be a ref column.
            assert.equal(await gu.getType(), 'Reference');
            // With a proper table.
            assert.equal(await gu.getRefTable(), 'Person');
            // And a proper column.
            assert.equal(await gu.getRefShowColumn(), 'Row ID');
            break;
          case "Children":
            // This should be a ref list column.
            assert.equal(await gu.getType(), 'Reference List');
            // With a proper table.
            assert.equal(await gu.getRefTable(), 'Person');
            // And a proper column.
            assert.equal(await gu.getRefShowColumn(), 'Row ID');
            break;
        }

        await revert();
      });
    }

    it('should suggest aggregations for RefList column', async function () {
      await clickAddColumn();
      await driver.findWait('.test-new-columns-menu-lookup-Employees', STANDARD_WAITING_TIME).click();
      // Wait for the menu to appear.
      await driver.findWait('.test-new-columns-menu-lookup-column', STANDARD_WAITING_TIME);
      // First check items (so columns we can add which don't have menu)
      const items = await driver.findAll('.test-new-columns-menu-lookup-column', (el) => el.getText());
      assert.deepEqual(items, [
        'Name\nlist',
        'Hobby\nlist',
        'Employee\nlist',
        'Photo\nlist',
        'Fun\nlist',
        'Parent\nlist',
        'Children\nlist'
      ]);

      const menus = await driver.findAll('.test-new-columns-menu-lookup-submenu', (el) => el.getText());
      assert.deepEqual(menus, [
        'Age\nsum',
        'Birthday date\nlist',
        'Member\ncount',
        'SeenAt\nlist'
      ]);

      // Make sure that clicking on a column adds it with a default aggregation.
      await driver.find('.test-new-columns-menu-lookup-column-Name').click();
      await gu.waitForServer();
      const columns = await gu.getColumnNames();
      assert.deepEqual(columns, ['A', 'B', 'C', 'Person', 'Employees', 'Employees_Name']);
      await checkTypeAndFormula('Any', `$Employees.Name`);

      await gu.undo();
    });

    // Now test each aggregation.
    for(const column of ['Age', 'Member', 'Birthday date', 'SeenAt']) {
      it(`should insert ${column} with a proper name and type from a RefList column`, async function () {
        const colId = column.replace(" ", "_");

        await clickAddColumn();
        await driver.findWait('.test-new-columns-menu-lookup-Employees', STANDARD_WAITING_TIME).click();
        await driver.findWait(`.test-new-columns-menu-lookup-submenu-${colId}`, STANDARD_WAITING_TIME).mouseMove();

        // Wait for the menu to show up.
        await driver.findWait('.test-new-columns-menu-lookup-submenu-function', STANDARD_WAITING_TIME);

        // Make sure the list of function is accurate.
        const suggestedFunctions =
          await driver.findAll('.test-new-columns-menu-lookup-submenu-function', (el) => el.getText());

        switch(column) {
          case "Age":
            assert.deepEqual(suggestedFunctions, ['sum', 'average', 'min', 'max']);
            break;
          case "Birthday date":
            assert.deepEqual(suggestedFunctions, ['list', 'min', 'max']);
            break;
          case "Member":
            assert.deepEqual(suggestedFunctions, ['count', 'percent']);
            break;
          case "SeenAt":
            assert.deepEqual(suggestedFunctions, ['list', 'min', 'max']);
            break;
        }

        // Now pick the default function.
        await driver.findWait(`.test-new-columns-menu-lookup-submenu-${colId}`, STANDARD_WAITING_TIME).click();
        await gu.waitForServer();

        const columns = await gu.getColumnNames();
        assert.deepEqual(columns, ['A', 'B', 'C', 'Person', 'Employees', `Employees_${column}`]);

        // This should be a formula column.
        assert.equal(await gu.columnBehavior(), "Formula Column");

        // And the formula should be correct.
        switch(column) {
          case "Age":
            await checkTypeAndFormula('Numeric', `SUM($Employees.${colId})`);

            // For this column test other aggregations as well.
            await gu.undo();
            await addRefListLookup('Employees', column, 'average');
            await checkTypeAndFormula('Numeric', AVERAGE('$Employees', colId));

            await gu.undo();
            await addRefListLookup('Employees', column, 'min');
            await checkTypeAndFormula('Numeric', MIN('$Employees', colId));

            await gu.undo();
            await addRefListLookup('Employees', column, 'max');
            await checkTypeAndFormula('Numeric', MAX('$Employees', colId));

            break;
          case "Member":
            await checkTypeAndFormula('Integer', `SUM($Employees.${colId})`);
            // Here we also test that the formula is correct for percent.
            await gu.undo();
            await addRefListLookup('Employees', column, 'percent');
            await checkTypeAndFormula('Numeric', PERCENT('$Employees', colId));
            assert.isTrue(
              await driver.findContent('.test-numeric-mode .test-select-button', /%/).matches('[class*=-selected]'));
            break;
          case "SeenAt":
            await checkTypeAndFormula('Any', `$Employees.${colId}`);
            await gu.undo();
            await addRefListLookup('Employees', column, 'min');
            await checkTypeAndFormula('DateTime', MIN('$Employees', colId));
            assert.equal(await driver.find(".test-tz-autocomplete input").value(), 'UTC');

            await gu.undo();
            await addRefListLookup('Employees', column, 'max');
            await checkTypeAndFormula('DateTime', MAX('$Employees', colId));
            assert.equal(await driver.find(".test-tz-autocomplete input").value(), 'UTC');
            break;
          default:
            await checkTypeAndFormula('Any', `$Employees.${colId}`);
            break;
        }

        await gu.undo();
      });
    }
  });

  describe('reverse lookups', function () {
    revertThis();

    before(async function () {
      // Reference the Person table once more
      await gu.sendActions([
        ['AddVisibleColumn', 'Person', 'Item', {type: 'Ref:Table1'}],
        ['AddVisibleColumn', 'Person', 'Items', {type: 'RefList:Table1'}],
      ]);
    });

    it('should show reverse lookups in the menu', async function () {
      await clickAddColumn();
      // Wait for any menu to show up.
      await driver.findWait('.test-new-columns-menu-revlookup', STANDARD_WAITING_TIME);
      // We should see two rev lookups.
      assert.deepEqual(await driver.findAll('.test-new-columns-menu-revlookup', (el) => el.getText()), [
        'Person [← Item]',
        'Person [← Items]',
      ]);
    });

    it('should show same list from Ref and RefList', async function () {
      await driver.findContent('.test-new-columns-menu-revlookup', 'Person [← Item]').mouseMove();
      // Wait for any menu to show up.
      await driver.findWait('.test-new-columns-menu-revlookup-column', STANDARD_WAITING_TIME);

      const columns = await driver.findAll('.test-new-columns-menu-revlookup-column', (el) => el.getText());
      const submenus = await driver.findAll('.test-new-columns-menu-revlookup-submenu', (el) => el.getText());

      // Now open the other submenu and make sure list is the same.
      await driver.findContent('.test-new-columns-menu-revlookup', 'Person [← Items]').mouseMove();
      // Wait for any menu to show up.
      await driver.findWait('.test-new-columns-menu-revlookup-column', STANDARD_WAITING_TIME);

      const columns2 = await driver.findAll('.test-new-columns-menu-revlookup-column', (el) => el.getText());
      const submenus2 = await driver.findAll('.test-new-columns-menu-revlookup-submenu', (el) => el.getText());

      assert.deepEqual(columns, columns2);
      assert.deepEqual(submenus, submenus2);

      assert.deepEqual(columns, [
        'Name\nlist',
        'Hobby\nlist',
        'Employee\nlist',
        'Photo\nlist',
        'Fun\nlist',
        'Parent\nlist',
        'Children\nlist',
        'Item\nlist',
        'Items\nlist'
      ]);
      assert.deepEqual(submenus, [
        'Age\nsum',
        'Birthday date\nlist',
        'Member\ncount',
        'SeenAt\nlist'
      ]);

      // Make sure that clicking one of the columns adds it with a default aggregation.
      await driver.findContent('.test-new-columns-menu-revlookup-column', 'Name').click();
      await gu.waitForServer();

      const columns3 = await gu.getColumnNames();
      assert.deepEqual(columns3, ['A', 'B', 'C', 'Person_Name']);
      assert.equal(await gu.columnBehavior(), "Formula Column");
      assert.equal(await gu.getType(), 'Any');
      await driver.find('.formula_field_sidepane').click();
      assert.equal(await gu.getFormulaText(), `Person.lookupRecords(Items=CONTAINS($id)).Name`);
      await gu.sendKeys(Key.ESCAPE);
      await gu.undo();
    });

    describe('reverse lookups from Ref column', function () {
      for(const column of ['Age', 'Member', 'Birthday date', 'SeenAt']) {
        it(`should properly add reverse lookup for ${column}`, async function () {
          await clickAddColumn();
          await driver.findContentWait('.test-new-columns-menu-revlookup',
            'Person [← Item]',
            STANDARD_WAITING_TIME
          ).mouseMove();

          // This is submenu so expand it.
          await driver.findContentWait('.test-new-columns-menu-revlookup-submenu',
            new RegExp("^" + column),
            STANDARD_WAITING_TIME*3
          ).mouseMove();

          // Wait for any function to appear.
          await driver.findWait('.test-new-columns-menu-revlookup-column-function',
            STANDARD_WAITING_TIME);

          // Make sure we see proper list.
          const functions = await driver.findAll('.test-new-columns-menu-revlookup-column-function',
                                                (el) => el.getText());
          switch(column) {
            case "Age":
              assert.deepEqual(functions, ['sum', 'average', 'min', 'max']);
              break;
            case "Member":
              assert.deepEqual(functions, ['count', 'percent']);
              break;
            case "Birthday date":
            case "SeenAt":
              assert.deepEqual(functions, ['list', 'min', 'max']);
              break;
          }

          // Now add each function and make sure it is added with a proper name.
          await gu.sendKeys(Key.ESCAPE);
          switch(column) {
            case "Age":
              await addRevLookup('sum');
              await checkTypeAndFormula('Numeric', `SUM(Person.lookupRecords(Item=$id).Age)`);

              assert.deepEqual(await gu.getColumnNames(),
                ['A', 'B', 'C', 'Person_Age']);

              await gu.undo();
              await addRevLookup('average');
              await checkTypeAndFormula('Numeric', AVERAGE(`Person.lookupRecords(Item=$id)`, 'Age'));

              await gu.undo();
              await addRevLookup('min');
              await checkTypeAndFormula('Numeric', MIN(`Person.lookupRecords(Item=$id)`, 'Age'));

              await gu.undo();
              await addRevLookup('max');
              await checkTypeAndFormula('Numeric', MAX(`Person.lookupRecords(Item=$id)`, 'Age'));
              break;
            case "Member":
              await addRevLookup('count');
              await checkTypeAndFormula('Integer', `SUM(Person.lookupRecords(Item=$id).Member)`);

              await gu.undo();
              await addRevLookup('percent');
              await checkTypeAndFormula('Numeric', PERCENT(`Person.lookupRecords(Item=$id)`, column));
              break;
            case "Birthday date":
              await addRevLookup('list');
              await checkTypeAndFormula('Any', `Person.lookupRecords(Item=$id).Birthday_date`);

              await gu.undo();
              await addRevLookup('min');
              await checkTypeAndFormula('Date', MIN('Person.lookupRecords(Item=$id)', 'Birthday_date'));

              await gu.undo();
              await addRevLookup('max');
              await checkTypeAndFormula('Date', MAX('Person.lookupRecords(Item=$id)', 'Birthday_date'));

              assert.deepEqual(await gu.getColumnNames(),
                ['A', 'B', 'C', 'Person_Birthday date']);

              break;
            case "SeenAt":
              await addRevLookup('max');
              await checkTypeAndFormula('DateTime', MAX('Person.lookupRecords(Item=$id)', 'SeenAt'));
              // Here check the timezone.
              assert.equal(await driver.find(".test-tz-autocomplete input").value(), 'UTC');
              break;
          }

          await gu.undo();

          async function addRevLookup(func: string) {
            await clickAddColumn();
            await driver.findContentWait(
              '.test-new-columns-menu-revlookup',
              'Person [← Item]',
              STANDARD_WAITING_TIME
            ).mouseMove();
            await driver.findContentWait(
              '.test-new-columns-menu-revlookup-submenu',
              new RegExp("^" + column),
              STANDARD_WAITING_TIME
            ).mouseMove();
            await driver.findContentWait(
              '.test-new-columns-menu-revlookup-column-function',
              func,
              STANDARD_WAITING_TIME
            ).click();
            await gu.waitForServer();
          }
        });
      }
    });

    describe('reverse lookups from RefList column', function () {
      for(const column of ['Age', 'Member', 'Birthday date', 'SeenAt']) {
        it(`should properly add reverse lookup for ${column}`, async function () {
          await clickAddColumn();
          await driver.findContentWait(
            '.test-new-columns-menu-revlookup',
            'Person [← Items]',
            STANDARD_WAITING_TIME
          ).mouseMove();

          // This is submenu so expand it.
          await driver.findContentWait(
            '.test-new-columns-menu-revlookup-submenu',
            new RegExp("^" + column),
            STANDARD_WAITING_TIME
          ).mouseMove();

          // Wait for any function to appear.
          await driver.findWait(
            '.test-new-columns-menu-revlookup-column-function',
            STANDARD_WAITING_TIME
          );

          // Make sure we see proper list.
          const functions = await driver.findAll('.test-new-columns-menu-revlookup-column-function',
                                                (el) => el.getText());
          switch(column) {
            case "Age":
              assert.deepEqual(functions, ['sum', 'average', 'min', 'max']);
              break;
            case "Member":
              assert.deepEqual(functions, ['count', 'percent']);
              break;
            case "Birthday date":
            case "SeenAt":
              assert.deepEqual(functions, ['list', 'min', 'max']);
              break;
          }

          // Now add each function and make sure it is added with a proper name.
          await gu.sendKeys(Key.ESCAPE);
          switch(column) {
            case "Age":
              await addRevLookup('sum');
              await checkTypeAndFormula('Numeric', `SUM(Person.lookupRecords(Items=CONTAINS($id)).Age)`);

              await gu.undo();
              await addRevLookup('average');
              await checkTypeAndFormula('Numeric', AVERAGE(`Person.lookupRecords(Items=CONTAINS($id))`, 'Age'));

              await gu.undo();
              await addRevLookup('min');
              await checkTypeAndFormula('Numeric', MIN(`Person.lookupRecords(Items=CONTAINS($id))`, 'Age'));

              await gu.undo();
              await addRevLookup('max');
              await checkTypeAndFormula('Numeric', MAX(`Person.lookupRecords(Items=CONTAINS($id))`, 'Age'));
              break;
            case "Member":
              await addRevLookup('count');
              await checkTypeAndFormula('Integer', `SUM(Person.lookupRecords(Items=CONTAINS($id)).Member)`);

              await gu.undo();
              await addRevLookup('percent');
              await checkTypeAndFormula('Numeric', PERCENT(`Person.lookupRecords(Items=CONTAINS($id))`, column));
              break;
            case "Birthday date":
              await addRevLookup('list');
              await checkTypeAndFormula('Any', `Person.lookupRecords(Items=CONTAINS($id)).Birthday_date`);

              await gu.undo();
              await addRevLookup('min');
              await checkTypeAndFormula('Date', MIN('Person.lookupRecords(Items=CONTAINS($id))', 'Birthday_date'));

              await gu.undo();
              await addRevLookup('max');
              await checkTypeAndFormula('Date', MAX('Person.lookupRecords(Items=CONTAINS($id))', 'Birthday_date'));
              break;
            case "SeenAt":
              await addRevLookup('max');
              await checkTypeAndFormula('DateTime', MAX('Person.lookupRecords(Items=CONTAINS($id))', 'SeenAt'));
              // Here check the timezone.
              assert.equal(await driver.find(".test-tz-autocomplete input").value(), 'UTC');
              break;
          }

          await gu.undo();

          async function addRevLookup(func: string) {
            await clickAddColumn();
            await driver.findContentWait(
              '.test-new-columns-menu-revlookup',
              'Person [← Items]',
              STANDARD_WAITING_TIME
            ).mouseMove();
            await driver.findContentWait(
              '.test-new-columns-menu-revlookup-submenu',
              new RegExp("^" + column),
              STANDARD_WAITING_TIME
            ).mouseMove();
            await driver.findContentWait(
              '.test-new-columns-menu-revlookup-column-function',
              func,
              STANDARD_WAITING_TIME
            ).click();
            await gu.waitForServer();
          }
        });
      }
    });
  });

  describe('shortcuts', function () {
    describe('Timestamp', function () {
      revertEach();

      it('created at - should create new column with date triggered on create', async function () {
        await gu.openColumnPanel();

        await clickAddColumn();
        await driver.findWait('.test-new-columns-menu-shortcuts-timestamp', STANDARD_WAITING_TIME).mouseMove();
        await driver.findWait('.test-new-columns-menu-shortcuts-timestamp-new', STANDARD_WAITING_TIME).click();
        await gu.waitForServer();

        // Make sure we have Created At column at the end.
        const columns = await gu.getColumnNames();
        assert.deepEqual(columns, ['A', 'B', 'C', 'Created at']);

        // Make sure this is the column that is selected.
        assert.equal(await driver.find('.test-field-label').value(), 'Created at');
        assert.equal(await driver.find('.test-field-col-id').value(), '$Created_at');

        // Check behavior - this is trigger formula
        assert.equal(await gu.columnBehavior(), "Data Column");
        assert.isTrue(await driver.findContent('div', 'TRIGGER FORMULA').isDisplayed());

        // It applies to new records only.
        assert.equal(await driver.find('.test-field-formula-apply-to-new').getAttribute('checked'), 'true');
        assert.equal(await driver.find('.test-field-formula-apply-on-changes').getAttribute('checked'), null);

        // Make sure type and formula are correct.
        await checkTypeAndFormula('DateTime', 'NOW()');
        assert.isNotEmpty(await driver.find(".test-tz-autocomplete input").value());
      });

      it('modified at - should create new column with date triggered on change', async function () {
        await clickAddColumn();
        await driver.findWait('.test-new-columns-menu-shortcuts-timestamp', STANDARD_WAITING_TIME).mouseMove();
        await driver.findWait('.test-new-columns-menu-shortcuts-timestamp-change', STANDARD_WAITING_TIME).click();
        await gu.waitForServer();

        // Make sure we have this column at the end.
        const columns = await gu.getColumnNames();
        assert.deepEqual(columns, ['A', 'B', 'C', 'Last updated at']);

        // Make sure this is the column that is selected.
        assert.equal(await driver.find('.test-field-label').value(), 'Last updated at');
        assert.equal(await driver.find('.test-field-col-id').value(), '$Last_updated_at');

        // Check behavior - this is trigger formula
        assert.equal(await gu.columnBehavior(), "Data Column");
        assert.isTrue(await driver.findContent('div', 'TRIGGER FORMULA').isDisplayed());

        // It applies to new records only and if anything changes.
        assert.equal(await driver.find('.test-field-formula-apply-to-new').getAttribute('checked'), 'true');
        assert.equal(await driver.find('.test-field-formula-apply-on-changes').getAttribute('checked'), 'true');
        assert.equal(await driver.find('.test-field-triggers-select').getText(), 'Any field');

        // Make sure type and formula are correct.
        await checkTypeAndFormula('DateTime', 'NOW()');
        assert.isNotEmpty(await driver.find(".test-tz-autocomplete input").value());
      });
    });

    describe('Authorship', function () {
      revertEach();

      it('created by - should create new column with author name triggered on create', async function () {
        await gu.openColumnPanel();

        await clickAddColumn();
        await driver.findWait('.test-new-columns-menu-shortcuts-author', STANDARD_WAITING_TIME).mouseMove();
        await driver.findWait('.test-new-columns-menu-shortcuts-author-new', STANDARD_WAITING_TIME).click();
        await gu.waitForServer();

        // Make sure we have this column at the end.
        const columns = await gu.getColumnNames();
        assert.deepEqual(columns, ['A', 'B', 'C', 'Created by']);

        // Make sure this is the column that is selected.
        assert.equal(await driver.find('.test-field-label').value(), 'Created by');
        assert.equal(await driver.find('.test-field-col-id').value(), '$Created_by');

        // Check behavior - this is trigger formula
        assert.equal(await gu.columnBehavior(), "Data Column");
        assert.isTrue(await driver.findContent('div', 'TRIGGER FORMULA').isDisplayed());

        // It applies to new records only.
        assert.equal(await driver.find('.test-field-formula-apply-to-new').getAttribute('checked'), 'true');
        assert.equal(await driver.find('.test-field-formula-apply-on-changes').getAttribute('checked'), null);

        // Make sure type and formula are correct.
        await checkTypeAndFormula('Text', 'user.Name');
      });

      it('modified by - should create new column with author name triggered on change', async function () {
        await gu.openColumnPanel();

        await clickAddColumn();
        await driver.findWait('.test-new-columns-menu-shortcuts-author', STANDARD_WAITING_TIME).mouseMove();
        await driver.findWait('.test-new-columns-menu-shortcuts-author-change', STANDARD_WAITING_TIME).click();
        await gu.waitForServer();

        // Make sure we have this column at the end.
        const columns = await gu.getColumnNames();
        assert.deepEqual(columns, ['A', 'B', 'C', 'Last updated by']);

        // Make sure this is the column that is selected.
        assert.equal(await driver.find('.test-field-label').value(), 'Last updated by');
        assert.equal(await driver.find('.test-field-col-id').value(), '$Last_updated_by');

        // Check behavior - this is trigger formula
        assert.equal(await gu.columnBehavior(), "Data Column");
        assert.isTrue(await driver.findContent('div', 'TRIGGER FORMULA').isDisplayed());

        // It applies to new records only and if anything changes.
        assert.equal(await driver.find('.test-field-formula-apply-to-new').getAttribute('checked'), 'true');
        assert.equal(await driver.find('.test-field-formula-apply-on-changes').getAttribute('checked'), 'true');
        assert.equal(await driver.find('.test-field-triggers-select').getText(), 'Any field');

        // Make sure type and formula are correct.
        await checkTypeAndFormula('Text', 'user.Name');
      });
    });

    describe('Detect Duplicates in...', function () {
      it('should show columns in a searchable sub-menu', async function () {
        await clickAddColumn();
        await driver.findWait('.test-new-columns-menu-shortcuts-duplicates', STANDARD_WAITING_TIME).mouseMove();
        await gu.waitToPass(async () => {
          assert.deepEqual(
            await driver.findAll('.test-searchable-menu li', (el) => el.getText()),
            ['A', 'B', 'C']
          );
        }, 500);
        await driver.find('.test-searchable-menu-input').click();
        await gu.sendKeys('A');
        await gu.waitToPass(async () => {
          assert.deepEqual(
            await driver.findAll('.test-searchable-menu li', (el) => el.getText()),
            ['A']
          );
        }, STANDARD_WAITING_TIME);

        await gu.sendKeys('BC');
        await gu.waitToPass(async () => {
          assert.deepEqual(
            await driver.findAll('.test-searchable-menu li', (el) => el.getText()),
            []
          );
        }, STANDARD_WAITING_TIME);

        await gu.clearInput();
        await gu.waitToPass(async () => {
          assert.deepEqual(
            await driver.findAll('.test-searchable-menu li', (el) => el.getText()),
            ['A', 'B', 'C']
          );
        }, STANDARD_WAITING_TIME);
      });

      it('should create new column that checks for duplicates in the specified column', async function () {
        await clickAddColumn();
        await driver.findWait('.test-new-columns-menu-shortcuts-duplicates', STANDARD_WAITING_TIME).mouseMove();
        await driver.findContentWait('.test-searchable-menu li', 'A', 500).click();
        await gu.waitForServer();
        await gu.sendKeys(Key.ENTER);

        // Just checking the formula looks plausible - correctness is best left to a python test.
        assert.equal(
          await driver.find('.test-formula-editor').getText(),
          '$A != "" and $A is not None and len(Table1.lookupRecords(A=$A)) > 1'
        );
        await gu.sendKeys(Key.ESCAPE);
        let columns = await gu.getColumnNames();
        assert.deepEqual(columns, ['A', 'B', 'C', 'Duplicate in A']);
        await gu.undo();

        // Try it with list-based columns; the formula should look a little different.
        for (const [label, type] of [['Choice', 'Choice List'], ['Ref', 'Reference List']]) {
          await gu.addColumn(label, type);
          await clickAddColumn();
          await driver.findWait('.test-new-columns-menu-shortcuts-duplicates', STANDARD_WAITING_TIME).mouseMove();
          await driver.findContentWait('.test-searchable-menu li', label, 500).click();
          await gu.waitForServer();
          await gu.sendKeys(Key.ENTER);
          assert.equal(
            await driver.find('.test-formula-editor').getText(),
            `any([len(Table1.lookupRecords(${label}=CONTAINS(x))) > 1 for x in $${label}])`
          );
          await gu.sendKeys(Key.ESCAPE);
          columns = await gu.getColumnNames();
          assert.deepEqual(columns, ['A', 'B', 'C', label, `Duplicate in ${label}`]);
          await gu.undo(4);
        }
      });
    });

    describe('UUID', function () {
      it('should create new column that generates a UUID on new record', async function () {
        await gu.getCell(2, 1).click();
        await gu.sendKeys('A', Key.ENTER);
        await gu.waitForServer();
        await clickAddColumn();
        await driver.findWait('.test-new-columns-menu-shortcuts-uuid', STANDARD_WAITING_TIME).click();
        await gu.waitForServer();
        const cells1 = await gu.getVisibleGridCells({col: 'UUID', rowNums: [1, 2]});
        assert.match(cells1[0], /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
        assert.equal(cells1[1], '');
        await gu.getCell(2, 2).click();
        await gu.sendKeys('B', Key.ENTER);
        await gu.waitForServer();
        const cells2 = await gu.getVisibleGridCells({col: 'UUID', rowNums: [1, 2, 3]});
        assert.match(cells2[0], /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
        assert.match(cells2[1], /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
        assert.equal(cells2[2], '');
        assert.equal(cells1[0], cells2[0]);
        await gu.undo(3);
      });
    });
  });

  it("should not show hidden Ref columns", async function () {
    // Duplicate current tab and start transforming a column.
    const mainTab = await gu.myTab();
    const transformTab = await gu.duplicateTab();

    // Start transforming a column.
    await gu.sendActions([
      ['AddRecord', 'Table1', null, {A: 1, B: 2, C: 3}],
    ]);
    await gu.getCell('A', 1).click();
    await gu.setType('Reference', {apply: false});
    await gu.waitForServer();
    await gu.setRefTable('Person');
    await gu.waitForServer();

    // Now we have two hidden columns present.
    let columns = await api.getTable(docId, 'Table1');
    assert.includeMembers(Object.keys(columns), [
      'gristHelper_Converted',
      'gristHelper_Transform'
    ]);

    // Now on the main tab, make sure we don't see those references in lookup menu.
    await mainTab.open();
    await clickAddColumn();
    await driver.findWait('.test-new-columns-menu-lookups-none', STANDARD_WAITING_TIME);

    // Now test RefList columns.
    await transformTab.open();
    await driver.find('.test-type-transform-cancel').click();
    await gu.waitForServer();
    // Make sure hidden columns are removed.
    columns = await api.getTable(docId, 'Table1');
    assert.notIncludeMembers(Object.keys(columns), [
      'gristHelper_Converted',
      'gristHelper_Transform'
    ]);
    await gu.setType('Reference List', {apply: false});
    await gu.setRefTable('Person');
    await gu.waitForServer();
    columns = await api.getTable(docId, 'Table1');
    assert.includeMembers(Object.keys(columns), [
      'gristHelper_Converted',
      'gristHelper_Transform'
    ]);

    // Now on the main make sure we still don't see those references in lookup menu.
    await mainTab.open();
    await clickAddColumn();
    await driver.findWait('.test-new-columns-menu-lookups-none', STANDARD_WAITING_TIME);

    // Now test reverse lookups.
    await gu.openPage('Person');
    await clickAddColumn();

    // Wait for any menu to show up.
    await driver.findWait('.test-new-columns-menu-lookup', STANDARD_WAITING_TIME);

    // Now make sure we don't have helper columns
    assert.isEmpty(await driver.findAll('.test-new-columns-menu-revlookup', e => e.getText()));

    await gu.sendKeys(Key.ESCAPE);
    await gu.scrollActiveView(-1000, 0);

    await transformTab.open();
    await driver.find('.test-type-transform-cancel').click();
    await gu.waitForServer();
    await transformTab.close();
    await mainTab.open();
    await gu.openPage('Table1');
  });

  async function clickAddColumn() {
    const isMenuPresent = await driver.find(".test-new-columns-menu").isPresent();
    if (!isMenuPresent) {
      await driver.findWait(".mod-add-column", STANDARD_WAITING_TIME).click();
    }
    await driver.findWait(".test-new-columns-menu", STANDARD_WAITING_TIME);
  }

  async function isMenuPresent() {
    return await driver.find(".test-new-columns-menu").isPresent();
  }

  async function closeAddColumnMenu() {
    await driver.sendKeys(Key.ESCAPE);
    assert.isFalse(await isMenuPresent(), 'menu is still present');
  }

  async function hasAddNewColumMenu() {
    await isDisplayed('.test-new-columns-menu-add-new', 'add new column menu is not present');
  }

  async function isDisplayed(selector: string, message: string) {
    assert.isTrue(await driver.findWait(selector, STANDARD_WAITING_TIME, message).isDisplayed(), message);
  }

  async function hasShortcuts() {
    await isDisplayed('.test-new-columns-menu-shortcuts', 'shortcuts section is not present');
    await isDisplayed('.test-new-columns-menu-shortcuts-timestamp', 'timestamp shortcuts section is not present');
    await isDisplayed('.test-new-columns-menu-shortcuts-author', 'authorship shortcuts section is not present');
  }

  async function hasLookupMenu(colId: string) {
    await isDisplayed('.test-new-columns-menu-lookup', 'lookup section is not present');
    await isDisplayed(`.test-new-columns-menu-lookup-${colId}`, `lookup section for ${colId} is not present`);
  }

  async function collapsedHiddenColumns() {
    return await driver.findAll('.test-new-columns-menu-hidden-column-collapsed', (el) => el.getText());
  }

  function revertEach() {
    let revert: () => Promise<void>;
    beforeEach(async function () {
      revert = await gu.begin();
    });

    gu.afterEachCleanup(async function () {
      if (await isMenuPresent()) {
        await closeAddColumnMenu();
      }
      await revert();
    });
  }


  function revertThis() {
    let revert: () => Promise<void>;
    before(async function () {
      revert = await gu.begin();
    });

    gu.afterCleanup(async function () {
      if (await isMenuPresent()) {
        await closeAddColumnMenu();
      }
      await revert();
    });
  }

  async function addRefListLookup(refListId: string, colId: string, func: string) {
    await clickAddColumn();
    await driver.findWait(`.test-new-columns-menu-lookup-${refListId}`, STANDARD_WAITING_TIME).click();
    await driver.findWait(`.test-new-columns-menu-lookup-submenu-${colId}`, STANDARD_WAITING_TIME).mouseMove();
    await driver.findWait(`.test-new-columns-menu-lookup-submenu-function-${func}`, STANDARD_WAITING_TIME).click();
    await gu.waitForServer();
  }

  async function checkTypeAndFormula(type: string, formula: string) {
    assert.equal(await gu.getType(), type);
    await driver.find('.formula_field_sidepane').click();
    assert.equal(await gu.getFormulaText(false).then(s => s.trim()), formula);
    await gu.sendKeys(Key.ESCAPE);
  }
});

const PERCENT = (ref: string, col: string) => `ref = ${ref}\nAVERAGE(map(int, ref.${col})) if ref else None`;
const AVERAGE = (ref: string, col: string) => `ref = ${ref}\nAVERAGE(ref.${col}) if ref else None`;
const MIN = (ref: string, col: string) => `ref = ${ref}\nMIN(ref.${col}) if ref else None`;
const MAX = (ref: string, col: string) => `ref = ${ref}\nMAX(ref.${col}) if ref else None`;
