import {driver, Key, WebElement} from "mocha-webdriver";
import {DocCreationInfo} from "app/common/DocListAPI";
import {UserAPIImpl} from "app/common/UserAPI";
import {assert} from "chai";
import * as gu from "./gristUtils";
import {setupTestSuite} from "./testUtils";


describe.skip('GridViewNewColumnMenu', function () {
  if(process.env.GRIST_NEW_COLUMN_MENU) {
    this.timeout('5m');
    const cleanup = setupTestSuite();

    //helpers
    let session: gu.Session, doc: DocCreationInfo, apiImpl: UserAPIImpl;

    before(async function () {
      session = await gu.session().login();
      await createEmptyDoc('ColumnMenu');
    });

    this.afterEach(async function () {
      await closeAddColumnMenu();
    });
    describe('menu composition', function () {

      it('simple columns, should have add column and shortcuts', async function () {
        const menu = await openAddColumnIcon();
        await hasAddNewColumMenu(menu);
        await hasShortcuts(menu);
      });

      it('have lookup columns, should have add column, shortcuts and lookup section ', async function () {
        const createReferenceTable = async () => {
          await apiImpl.applyUserActions(doc.id, [
            ['AddTable', 'Reference', [
              {id: "Name"},
              {id: "Age"},
              {id: "City"}]],
          ]);
          await apiImpl.applyUserActions(doc.id, [
            ['AddRecord', 'Reference', null, {Name: "Bob", Age: 12, City: "New York"}],
            ['AddRecord', 'Reference', null, {Name: "Robert", Age: 34, City: "Łódź"}],
          ]);
        };

        const addReferenceColumnToManinTable = async () => {
          //add reference column
          await apiImpl.applyUserActions(doc.id, [
            ['AddColumn', 'Table1', 'Reference', {type: 'Ref:Reference'}],
          ]);
        };

        await createReferenceTable();
        await addReferenceColumnToManinTable();
        await gu.reloadDoc();

        //open menu
        const menu = await openAddColumnIcon();
        // check if all three sections are present
        await hasAddNewColumMenu(menu);
        await hasShortcuts(menu);
        await hasLookupMenu(menu, 'Reference');
        //TODO - remove reference column somehow.
        await apiImpl.applyUserActions(doc.id, [["RemoveColumn", "Table1", "Reference"]]);
        await gu.reloadDoc();
      });
    });

    describe('column creation', function () {
      it('should show rename menu  after new column click', async function () {
        const menu = await openAddColumnIcon();
        await menu.findWait('.test-new-columns-menu-add-new', 100).click();
        await driver.findWait('.test-column-title-popup', 100, 'rename menu is not present');
        await gu.undo();
      });

      it('should create new column', async function () {
        const menu = await openAddColumnIcon();
        await menu.findWait('.test-new-columns-menu-add-new', 100).click();
        //discard rename menu
        await driver.findWait('.test-column-title-close', 100).click();
        //check if new column is present
        const columns = await gu.getColumnNames();
        assert.include(columns, 'D', 'new column is not present');
        assert.lengthOf(columns, 4, 'wrong number of columns');
        await gu.undo();
      });
    });

    describe('hidden columns', function () {
      it('no hidden column in document, section should not be present', async function () {
        const menu = await openAddColumnIcon();
        const isHiddenSectionPresent = await menu.find(".new-columns-menu-hidden-columns").isPresent();
        assert.isFalse(isHiddenSectionPresent, 'hidden section is present');
        await closeAddColumnMenu();
      });

      describe('inline menu section', function () {
        before(async function () {
          await gu.addColumn('Add1');
          await gu.addColumn('Add2');
          await gu.addColumn('Add3');
        });

        it('1 to 5 hidden columns, secion should be inline', async function () {
          const checkSection = async (...columns: string[]) => {
            const menu = await openAddColumnIcon();
            await menu.findWait(".test-new-columns-menu-hidden-columns", 100,
              'hidden section is not present');
            for (const column of columns) {
              const isColumnPresent = await menu.find(`.test-new-columns-menu-hidden-columns-${column}`).isPresent();
              assert.isTrue(isColumnPresent, `column ${column} is not present`);
            }
            await closeAddColumnMenu();
          };

          await gu.openWidgetPanel();
          await gu.moveToHidden('A');
          await checkSection('A');
          await gu.moveToHidden('B');
          await gu.moveToHidden('C');
          await gu.moveToHidden('Add1');
          await gu.moveToHidden('Add2');
          await checkSection('A', 'B', 'C', 'Add1', 'Add2');
          await gu.undo(5);
        });

        it('inline button should show column at the end of the table', async function () {
        });
      });

      describe('submenu section', function () {
        it('more than 5 hidden columns, section should be in submenu', async function () {
        });

        it('submenu should be searchable', async function () {
        });

        it('submenu button should show column at the end of the table', async function () {
        });
      });
    });

    describe('lookups', function () {
      before(async function () {
        //save current state
      });

      after(async function () {
        //restore current state
      });
      it('should show columns in menu with lookup', async function () {
      });
      it('should create formula column with data from selected column', async function () {
      });
    });

    describe('shortucts', function () {
      describe('Timestamp', function () {
        it('created at - should create new column with date triggered on create');
      });

      describe('Timestamp', function () {
        it('created at - should create new column with date triggered on create', function () {

        });
        it('modified at - should create new column with date triggered on change', function () {

        });
      });

      describe('Authorship', function () {
        it('created by - should create new column with author name triggered on create', function () {

        });
        it('modified by - should create new column with author name triggered on change', function () {

        });
      });
    });


    async function createEmptyDoc(docName: string) {
      session = await gu.session().login();
      const docId = await session.tempNewDoc(cleanup, docName);
      doc = {id: docId, title: docName};
      apiImpl = session.createHomeApi();
    }

    async function openAddColumnIcon() {
      const isMenuPresent = await driver.find(".test-new-columns-menu").isPresent();
      if (!isMenuPresent) {
        await driver.findWait(".mod-add-column", 100).click();
      }
      return driver.findWait(".test-new-columns-menu", 100);
    }

    async function closeAddColumnMenu() {
      const isMenuPresent = await driver.find(".test-new-columns-menu").isPresent();
      if (isMenuPresent) {
        await driver.sendKeys(Key.ESCAPE);
        assert.isFalse(await driver.wait(driver.find(".test-new-columns-menu").isPresent(), 100),
         'menu is still present after close by escape');
      }
    }

    const hasAddNewColumMenu = async (menu: WebElement) => {
      await checkInMenu(menu, '.test-new-columns-menu-add-new', 'add new column menu is not present');
    };

    const checkInMenu = async (menu: WebElement, selector: string, message: string) => {
      const element = await menu.findWait(selector, 100, message);
      assert.exists(element, message);
      return element;
    };

    const hasShortcuts = async (menu: WebElement) => {
      await checkInMenu(menu, '.test-new-columns-menu-shortcuts', 'shortcuts section is not present');
      await checkInMenu(menu, '.test-new-columns-menu-shortcuts-timestamp',
      'timestamp shortcuts section is not present');
      await checkInMenu(menu, '.test-new-columns-menu-shortcuts-author', 'authorship shortcuts section is not present');
    };

    const hasLookupMenu = async (menu: WebElement, tableName: string) => {
      await checkInMenu(menu, '.test-new-columns-menu-lookups', 'lookup section is not present');
      await checkInMenu(menu, `.test-new-columns-menu-lookups-${tableName}`,
        `lookup section for ${tableName} is not present`);
    };
  }
});
