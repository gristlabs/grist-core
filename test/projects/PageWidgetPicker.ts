import { delay } from 'app/common/delay';
import { assert, driver, Key } from 'mocha-webdriver';
import { server, setupTestSuite } from './testUtils';

describe('PageWidgetPicker', () => {
  setupTestSuite();

  async function setOption(options: {value?: string, isNewPage?: boolean}) {
    // set value
    const value = await driver.find('.test-option-value');
    await value.sendKeys(Key.HOME, Key.chord(Key.SHIFT, Key.END), Key.DELETE, options.value || '', Key.ENTER);

    // set isNewPage
    const isNewPage = await driver.find('.test-option-isNewPage');
    if ((await isNewPage.isSelected()) !== Boolean(options.isNewPage)) {
      await isNewPage.click();
    }
  }

  async function closePicker() {
    await driver.sendKeys(Key.ESCAPE);
  }

  async function openPicker(options: {value?: string, isNewPage?: boolean} = {}) {
    await driver.find('.test-trigger').click();
    await driver.findWait('.test-wselect-container', 100);
  }

  before(async function() {
    this.timeout(60000);
    await driver.get(`${server.getHost()}/PageWidgetPicker`);
  });

  it('should reflect `.value` on open', async function() {

    // set value option to [`Card List`, 'Companies', ['company_id', 'city']]
    await driver.find('.test-option-value').click();
    await driver.findContent('.test-wselect-type', /Card List/).click();
    await driver.findContent('.test-wselect-table', /History/).click();
    await driver.findContent('.test-wselect-table', /History/).find('.test-wselect-pivot').click();
    await driver.findContent('.test-wselect-column', /company_id/).doClick();
    await driver.findContent('.test-wselect-column', /city/).doClick();
    await driver.find('.test-wselect-addBtn').doClick();

    // open picker
    await openPicker();

    // check `detail` is selected
    assert.deepEqual(await findAllSelected('type'), ['Card List']);

    // check `Companies` is selected
    assert.deepEqual(await findAllSelected('table'), ['History']);

    // check Group by panel is opened
    assert.equal(await driver.findContent('.test-wselect-heading', /Group by/).isDisplayed(), true);

    // check 'company_id' and 'City' are selected
    assert.deepEqual(await findAllSelected('column'), ['company_id', 'city']);

    // close picker
    await closePicker();

    // remove .value and open picker
    await driver.find('.test-option-omit-value').click();
    await openPicker();

    // check `Table` is selected
    assert.deepEqual(await findAllSelected('type'), ['Table']);

    // check no table is selected
    assert.deepEqual(await findAllSelected('table'), []);

    // check Group by panel is closed
    assert.equal(await driver.findContent('.test-wselect-heading', /Group by/).isDisplayed(), false);
  });

  it('should show \'Group by\' pane when using summarized table', async () => {

    // check `Group by` panel is not visible
    assert.deepEqual(await driver.findAll('.test-wselect-heading', (e) => e.getText()),
      ['Select Widget', 'Select Data', '']);

    // clicking pivot icon should show 'Group by'
    await driver.findContent('.test-wselect-table', /History/).find('.test-wselect-pivot').doClick();
    assert.deepEqual(await driver.findAll('.test-wselect-heading', (e) => e.getText()),
      ['Select Widget', 'Select Data', 'Group by']);

    // clicking icon again should hide
    await driver.findContent('.test-wselect-table', /History/).find('.test-wselect-pivot').doClick();
    assert.deepEqual(await driver.findAll('.test-wselect-heading', (e) => e.getText()),
      ['Select Widget', 'Select Data', '']);

    // let's show it again
    await driver.findContent('.test-wselect-table', /History/).find('.test-wselect-pivot').doClick();
    assert.deepEqual(await driver.findAll('.test-wselect-heading', (e) => e.getText()),
      ['Select Widget', 'Select Data', 'Group by']);

    // clicking another table should hide
    await driver.findContent('.test-wselect-table', /Companies/).doClick();
    assert.deepEqual(await driver.findAll('.test-wselect-heading', (e) => e.getText()),
      ['Select Widget', 'Select Data', '']);

  });

  it('should clear columns when hiding \'Group by\' pane', async () => {

    // open 'Group by' for 'History'
    await driver.findContent('.test-wselect-table', /History/).find('.test-wselect-pivot').doClick();

    // initially no columns are selected
    assert.deepEqual(await findAllSelected('column'), []);

    // let's click one field and see that it's selected
    await driver.findContent('.test-wselect-column', /company_id/).doClick();
    assert.deepEqual(await findAllSelected('column'), ['company_id']);

    // click another field and see that both are selected
    await driver.findContent('.test-wselect-column', /city/).doClick();
    assert.deepEqual(await findAllSelected('column'), ['company_id', 'city']);

    // clicking a selected field deselect it
    await driver.findContent('.test-wselect-column', /company_id/).doClick();
    assert.deepEqual(await findAllSelected('column'), ['city']);

    // switching to another table should clear the columns
    await driver.findContent('.test-wselect-table', /Companies/).find('.test-wselect-pivot').doClick();
    assert.deepEqual(await findAllSelected('column'), []);
    await driver.findContent('.test-wselect-table', /History/).find('.test-wselect-pivot').doClick();
    assert.deepEqual(await findAllSelected('column'), []);

  });

  it('should reflect changes', async () => {

    // select ['Table', 'Companies']
    await driver.findContent('.test-wselect-type', /Table/).doClick();
    await driver.findContent('.test-wselect-table', /Companies/).doClick();

    // check values reflect selection
    await driver.find('.test-wselect-addBtn').click();
    assert.equal(
      await driver.find('.test-call-log:last-child .test-call-value').getText(),
      JSON.stringify(
        {type: 'record', table: 0, summarize: false, columns: [], link: '[0,0,0]', section: 0})
    );

    // resolve call and re-open picker
    await driver.findContent('.test-call-logs button', 'Resolve').click();
    await openPicker();

    // select ['Detail', 'History', ['Url', 'city']]
    await driver.findContent('.test-wselect-type', /Card$/).doClick();
    await driver.findContent('.test-wselect-table', /History/).find('.test-wselect-pivot').doClick();
    await driver.findContent('.test-wselect-column', /URL/).doClick();
    await driver.findContent('.test-wselect-column', /city/).doClick();

    // check values reflect selection
    await driver.find('.test-wselect-addBtn').click();
    assert.equal(
      await driver.find('.test-call-log:last-child .test-call-value').getText(),
      JSON.stringify(
        {type: 'single', table: 1, summarize: true, columns: [2, 3], link: '[0,0,0]', section: 0})
    );

    // resolve call and re-open picker
    await driver.findContent('.test-call-log:last-child button', 'Resolve').click();
    await openPicker();

  });

  it('should disable incompatible choices', async function() {

    // re-open picker
    await driver.sendKeys(Key.ESCAPE);
    await openPicker();

    const addBtn = await driver.find('.test-wselect-addBtn');

    // check no types and no tables are disabled
    assert.deepEqual(await findAllDisabled('type'), []);
    assert.deepEqual(await findAllDisabled('table'), []);

    // check that addBtn is disabled
    assert.equal(await addBtn.getAttribute('disabled'), 'true');

    // select `Chart`
    await driver.findContent('.test-wselect-type', /Chart/).doClick();

    // check that `New Table` is disabled and addBtn is disabled
    assert.deepEqual(await findAllDisabled('type'), []);
    assert.deepEqual(await findAllDisabled('table'), ['New Table']);
    assert.equal(await addBtn.getAttribute('disabled'), 'true');

    // click `New Table`
    await driver.findContent('.test-wselect-table', /New Table/).click();

    // check that no tables are selected
    assert.deepEqual(await findAllSelected('table'), []);

    // select `Table` and check that no table are disabled
    await driver.findContent('.test-wselect-type', /Table/).doClick();
    assert.deepEqual(await findAllDisabled('type'), []);
    assert.deepEqual(await findAllDisabled('table'), []);

    // check that addBtn is still disabled
    assert.equal(await addBtn.getAttribute('disabled'), 'true');

    // select 'New Table'
    await driver.findContent('.test-wselect-table', /New Table/).doClick();

    // check that 'Chart' and 'Custom' are disabled
    assert.deepEqual(await findAllDisabled('type'), ['Chart', 'Custom']);
    assert.deepEqual(await findAllDisabled('table'), []);

    // click 'Chart'
    await driver.findContent('.test-wselect-type', /Chart/).doClick();

    // check that Table is (still) selected
    assert.deepEqual(await findAllSelected('type'), ['Table']);

    // select 'Companies' and check that none are disabled
    await driver.findContent('.test-wselect-table', /Companies/).doClick();
    assert.deepEqual(await findAllDisabled('type'), []);
    assert.deepEqual(await findAllDisabled('table'), []);

    // check that addBtn is not disabled anymore
    assert.equal(await addBtn.getAttribute('disabled'), null);

    // set option IsNewPage to true and reopen picker
    await closePicker();
    await setOption({isNewPage: true});
    await openPicker();

    // select `Table` type
    await driver.findContent('.test-wselect-type', /Table/).doClick();

    // select 'New Table' and  check that 'single', 'detail', 'chart', 'custom' are disabled
    await driver.findContent('.test-wselect-table', /New Table/).doClick();
    assert.deepEqual(await findAllDisabled('type'), ['Card', 'Card List', 'Chart', 'Custom']);
    assert.deepEqual(await findAllDisabled('table'), []);

    // select 'Companies' and check that none are disabled
    await driver.findContent('.test-wselect-table', /Companies/).doClick();
    assert.deepEqual(await findAllDisabled('type'), []);
    assert.deepEqual(await findAllDisabled('table'), []);

    // select Card and check that 'New Table' is disabled
    await driver.findContent('.test-wselect-type', /Card/).doClick();
    assert.deepEqual(await findAllDisabled('type'), []);
    assert.deepEqual(await findAllDisabled('table'), ['New Table']);
  });

  it('should correctly show spinner on long call', async function() {
    // select Table, Companies
    await driver.findContent('.test-wselect-type', /Table/).doClick();
    await driver.findContent('.test-wselect-table', /Companies/).doClick();

    // click addBtn
    await driver.find('.test-wselect-addBtn').click();

    // check spinner does show before 500ms delay
    assert.equal(await driver.find('.test-modal-spinner').isPresent(), false);
    await delay(500);
    assert.equal(await driver.find('.test-modal-spinner').isPresent(), true);

    // check spinner has correct title
    assert.equal(await driver.find('.test-modal-spinner-title').getText(), 'Building Table widget');

    // check spinner hide on resolving the call
    await driver.find('.test-call-log:last-of-type .test-resolve').click();
    assert.equal(await driver.find('.test-modal-spinner').isPresent(), false);

    // reopen picker
    await openPicker();

    // now select Card, Companies and click addBtn
    await driver.findContent('.test-wselect-type', /Card/).doClick();
    await driver.findContent('.test-wselect-table', /Companies/).doClick();
    await driver.find('.test-wselect-addBtn').click();

    // check spinner has correct title
    await delay(500);
    assert.equal(await driver.find('.test-modal-spinner-title').getText(), 'Building Card widget');

    await driver.find('.test-call-log:last-of-type .test-resolve').click();
  });

  it('should not show spinner on short call',  async function() {
    await openPicker();

    // select Table, Companies
    await driver.findContent('.test-wselect-type', /Table/).doClick();
    await driver.findContent('.test-wselect-table', /Companies/).doClick();

    // click addBtn
    await driver.find('.test-wselect-addBtn').click();

    // resolve the call
    await driver.find('.test-call-log:last-of-type .test-resolve').click();

    // wait a bit more than 500ms
    await delay(700);

    // check the spinner does not show within
    assert.equal(await driver.find('.test-modal-spinner').isPresent(), false);
  });
});

async function findAllDisabled(cat: 'type'|'table'|'column'): Promise<string[]> {
  return await driver.findAll(`.test-wselect-${cat}[class*=-disabled]`, e => e.getText());
}

async function findAllSelected(cat: 'type'|'table'|'column'|'pivot'): Promise<string[]> {
  if (cat === 'table') {
    return await driver.findAll('.test-wselect-table .test-wselect-table-label[class*=-selected]', e => e.getText());
  }
  if (cat === 'pivot') {
    return await driver.findAll('.test-wselect-table .test-wselect-pivot[class*=-selected]', e => e.getText());
  }
  return await driver.findAll(`.test-wselect-${cat}[class*=-selected]`, e => e.getText());
}
