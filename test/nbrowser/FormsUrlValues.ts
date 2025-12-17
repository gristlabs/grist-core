/**
 * Test for acceptance of URL values in forms.
 */
import {UserAPI} from 'app/common/UserAPI';
import {assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';
import {plusButton, question} from 'test/nbrowser/formTools';

describe('FormsUrlValues', function() {
  this.timeout(60000);
  const cleanup = setupTestSuite();
  afterEach(() => gu.checkForErrors());
  let docId: string;
  let api: UserAPI;
  let formLink: string;

  const choices = {choices: ["Foo Choice", "Bar Choice", "Baz Choice"]};
  const spinner = {formNumberFormat: "spinner"};
  const radio = {formSelectFormat: "radio"};

  const sampleUrlParameters = new URLSearchParams([
    ['Field_Text', 'url text'],
    ['Field_Numeric', '17'],
    ['Field_Spinner', '5'],
    ['Field_Bool', 'yes'],
    ['Field_Date', '2025-10-03'],
    ['Field_DateTime', '2025-10-03 17:17:00'],
    ['Field_Choice', 'Bar Choice'],
    ['Field_Choice_Radio', 'Baz Choice'],
    ['Field_ChoiceList', 'Foo Choice'],
    ['Field_ChoiceList', 'Baz Choice'],   // Note how we set two values for a choice list.
    ['Field_Ref', 'Alice'],
    ['Field_Ref_Radio', 'Bob'],
    ['Field_RefList', 'Bob'],
    ['Field_RefList', 'Carol'],           // Note how we set multiple values of a ref list.
  ]);


  it('setup', async function() {
    const session = await gu.session().login();

    // Create a document with a table that has most types of fields.
    docId = await session.tempNewDoc(cleanup, 'FormsUrlValues', {load: false});
    api = session.createHomeApi();
    await api.applyUserActions(docId, [
      ['BulkAddRecord', 'Table1', [null, null, null], {A: ['Alice', 'Bob', 'Carol']}],
      ['AddTable', 'FormTest', [
        {id: 'Field_Text', type: 'Text', isFormula: false},
        {id: 'Field_Numeric', type: 'Numeric', isFormula: false},
        {id: 'Field_Spinner', type: 'Numeric', isFormula: false, widgetOptions: JSON.stringify(spinner)},
        {id: 'Field_Bool', type: 'Bool', isFormula: false},
        {id: 'Field_Date', type: 'Date', isFormula: false},
        {id: 'Field_DateTime', type: 'DateTime', isFormula: false},
        {id: 'Field_Choice', type: 'Choice', isFormula: false, widgetOptions: JSON.stringify(choices)},
        {id: 'Field_Choice_Radio', type: 'Choice', isFormula: false,
          widgetOptions: JSON.stringify({...choices, ...radio})},
        {id: 'Field_ChoiceList', type: 'ChoiceList', isFormula: false, widgetOptions: JSON.stringify(choices)},
        {id: 'Field_Ref', type: 'Ref:Table1', isFormula: false},
        {id: 'Field_Ref_Radio', type: 'Ref:Table1', isFormula: false, widgetOptions: JSON.stringify(radio)},
        {id: 'Field_RefList', type: 'RefList:Table1', isFormula: false},
      ]]
    ]);

    // Load the document, and switch to the FormTest table.
    await gu.loadDoc(`/doc/${docId}`);
    await gu.openPage('FormTest');

    // Set a better "Show column" for reference fields, easier to do via UI.
    await gu.openColumnPanel();
    for (const col of ['Field_Ref', 'Field_Ref_Radio', 'Field_RefList']) {
      await gu.getCell({col, rowNum: 1}).click();
      await gu.setRefShowColumn('A');
    }

    // Add a form that includes most types of fields.
    await gu.addNewPage('Form', 'FormTest');

    // The first 9 fields are added automatically. Add the remaining ones manually.
    async function addUnmapped(label: string) {
      await gu.waitToPass(() => plusButton().click(), 500);
      await gu.findOpenMenuItem('.test-forms-menu-unmapped', label).click();
      await gu.waitForServer();
    }
    await addUnmapped('Field_Ref');
    await addUnmapped('Field_Ref_Radio');
    await addUnmapped('Field_RefList');

    // Publish the form.
    await driver.find('.test-forms-publish').click();
    if (await driver.findWait('.test-modal-confirm', 200).isPresent()) {
      await driver.find('.test-modal-confirm').click();
    }
    await gu.waitForServer();
    await driver.find(`.test-forms-share`).click();
    formLink = await driver.findWait('.test-forms-link', 200).getAttribute('value');
  });


  it('should not be affected by url values that are not enabled', async function() {
    // Construct a form URL with some parameters filled in. They shouldn't work yet.
    const formUrl = new URL(formLink);
    formUrl.search = sampleUrlParameters.toString();

    // Open the form with some URL parameters in a new tab.
    await gu.onNewTabForUrl(formUrl.href, async () => {
      // Check that fields are empty.
      assert.deepEqual(await getFieldValue('Field_Text'), '');
      assert.deepEqual(await getFieldValue('Field_Numeric'), '');
      assert.deepEqual(await getFieldValue('Field_Spinner'), '');
      assert.deepEqual(await getFieldValue('Field_Bool'), '0');
      assert.deepEqual(await getFieldValue('Field_Date'), '');
      assert.deepEqual(await getFieldValue('Field_DateTime'), '');
      assert.deepEqual(await getFieldValue('Field_Choice'), '');
      assert.deepEqual(await getCheckedFields('Field_Choice_Radio'), []);
      assert.deepEqual(await getCheckedFields('Field_ChoiceList[]'), []);
      assert.deepEqual(await getFieldValue('Field_Ref'), '');
      assert.deepEqual(await getCheckedFields('Field_Ref_Radio'), []);
      assert.deepEqual(await getCheckedFields('Field_RefList[]'), []);

      // Submit.
      await driver.findWait('button[type="submit"]', 500).click();
      await driver.findWait('.test-form-success-page-text', 2000);
    });

    // Check that submitted values are empty.
    let records = await api.getDocAPI(docId).getRecords('FormTest');
    let lastRow = records[records.length - 1];
    assert.deepEqual(lastRow.fields, {
      Field_Text: '',
      Field_Numeric: 0,
      Field_Spinner: 0,
      Field_Bool: false,
      Field_Date: null,
      Field_DateTime: null,
      Field_Choice: '',
      Field_Choice_Radio: '',
      Field_ChoiceList: null,
      Field_Ref: 0,
      Field_Ref_Radio: 0,
      Field_RefList: null
    });

    // Open the form with some URL parameters again.
    await gu.onNewTabForUrl(formUrl.href, async () => {
      await driver.get(formUrl.href);
      // Fill in some fields and submit.
      await setFieldValue('Field_Text', 'my text');
      await setFieldValue('Field_Spinner', '1000');
      await setFieldValue('Field_Date', '03/20/2022');
      await setSelectValue('Field_Choice', 'Foo Choice');
      await toggleCheckedValue('Field_ChoiceList[]', 'Baz Choice');
      await toggleCheckedValue('Field_Ref_Radio', '3');  // Value is the rowId of the reference.

      // Submit.
      await driver.findWait('button[type="submit"]', 500).click();
      await driver.findWait('.test-form-success-page-text', 2000);
    });

    // Check that values are submitted correctly.
    records = await api.getDocAPI(docId).getRecords('FormTest');
    lastRow = records[records.length - 1];
    assert.deepEqual(lastRow.fields, {
      Field_Text: 'my text',
      Field_Numeric: 0,
      Field_Spinner: 1000,
      Field_Bool: false,
      Field_Date: Date.parse("2022-03-20") / 1000,
      Field_DateTime: null,
      Field_Choice: 'Foo Choice',
      Field_Choice_Radio: '',
      Field_ChoiceList: ['L', 'Baz Choice'] as any,
      Field_Ref: 0,
      Field_Ref_Radio: 3,
      Field_RefList: null
    });
  });

  it('should accept url values that are enabled', async function() {
    // Enable half the fields to accept submissions.
    for (const field of [
      'Field_Text', 'Field_Numeric', 'Field_Spinner', 'Field_Bool', 'Field_Date', 'Field_DateTime'
    ]) {
      await toggleFieldConfigCheckbox(field, '.test-form-field-accept-from-url');
    }

    // Check that we are showing the field ID in the hint text.
    assert.match(await driver.findWait('.test-form-field-url-hint', 250).getText(), /Field_DateTime/);

    // Open the form with some URL parameters.
    const formUrl = new URL(formLink);
    formUrl.search = sampleUrlParameters.toString();
    await gu.onNewTabForUrl(formUrl.href, async () => {
      // Check that the expected half of the fields are non-empty.
      assert.deepEqual(await getFieldValue('Field_Text'), 'url text');
      assert.deepEqual(await getFieldValue('Field_Numeric'), '17');
      assert.deepEqual(await getFieldValue('Field_Spinner'), '5');
      assert.deepEqual(await getFieldValue('Field_Bool'), '1');
      assert.deepEqual(await getFieldValue('Field_Date'), '2025-10-03');
      assert.deepEqual(await getFieldValue('Field_DateTime'), '2025-10-03T17:17');
      assert.deepEqual(await getFieldValue('Field_Choice'), '');
      assert.deepEqual(await getCheckedFields('Field_Choice_Radio'), []);
      assert.deepEqual(await getCheckedFields('Field_ChoiceList[]'), []);
      assert.deepEqual(await getFieldValue('Field_Ref'), '');
      assert.deepEqual(await getCheckedFields('Field_Ref_Radio'), []);
      assert.deepEqual(await getCheckedFields('Field_RefList[]'), []);

      // Submit.
      await driver.findWait('button[type="submit"]', 500).click();
      await driver.findWait('.test-form-success-page-text', 2000);
    });

    // Check that submitted values are as expected.
    let records = await api.getDocAPI(docId).getRecords('FormTest');
    let lastRow = records[records.length - 1];
    assert.deepEqual(lastRow.fields, {
      Field_Text: 'url text',
      Field_Numeric: 17,
      Field_Spinner: 5,
      Field_Bool: true,
      Field_Date: Date.parse("2025-10-03") / 1000,
      Field_DateTime: Date.parse("2025-10-03 17:17:00Z") / 1000,
      Field_Choice: '',
      Field_Choice_Radio: '',
      Field_ChoiceList: null,
      Field_Ref: 0,
      Field_Ref_Radio: 0,
      Field_RefList: null
    });

    // Switch which fields accept submissions.
    for (const field of [
      // These were off, and will get toggled on.
      'Field_Text', 'Field_Numeric', 'Field_Spinner', 'Field_Bool', 'Field_Date', 'Field_DateTime',
      // These were on, and will get toggled off.
      'Field_Choice', 'Field_Choice_Radio', 'Field_ChoiceList', 'Field_Ref', 'Field_Ref_Radio',
      'Field_RefList',
    ]) {
      await toggleFieldConfigCheckbox(field, '.test-form-field-accept-from-url');
    }

    // Open the form with some URL parameters again.
    await gu.onNewTabForUrl(formUrl.href, async () => {
      // The first half of the fields should now be empty (url value ignored).
      assert.deepEqual(await getFieldValue('Field_Text'), '');
      assert.deepEqual(await getFieldValue('Field_Numeric'), '');
      assert.deepEqual(await getFieldValue('Field_Spinner'), '');
      assert.deepEqual(await getFieldValue('Field_Bool'), '0');
      assert.deepEqual(await getFieldValue('Field_Date'), '');
      assert.deepEqual(await getFieldValue('Field_DateTime'), '');
      // Check that the second half of the fields (accepting URL values) is non-empty.
      assert.deepEqual(await getFieldValue('Field_Choice'), 'Bar Choice');
      assert.deepEqual(await getCheckedFields('Field_Choice_Radio'), ['Baz Choice']);
      assert.deepEqual(await getCheckedFields('Field_ChoiceList[]'), ['Foo Choice', 'Baz Choice']);
      assert.deepEqual(await getFieldValue('Field_Ref'), '1');
      assert.deepEqual(await getCheckedFields('Field_Ref_Radio'), ['2']);
      assert.deepEqual(await getCheckedFields('Field_RefList[]'), ['2', '3']);

      // Fill in a few fields and submit.
      await setFieldValue('Field_Text', 'my text');
      await setFieldValue('Field_Spinner', '1000');
      await setFieldValue('Field_Date', '03/20/2022');

      // Submit.
      await driver.findWait('button[type="submit"]', 500).click();
      await driver.findWait('.test-form-success-page-text', 2000);
    });

    // Check that values are submitted correctly.
    records = await api.getDocAPI(docId).getRecords('FormTest');
    lastRow = records[records.length - 1];
    assert.deepEqual(lastRow.fields, {
      Field_Text: 'my text',
      Field_Numeric: 0,
      Field_Spinner: 1000,
      Field_Bool: false,
      Field_Date: Date.parse("2022-03-20") / 1000,
      Field_DateTime: null,
      Field_Choice: 'Bar Choice',
      Field_Choice_Radio: 'Baz Choice',
      Field_ChoiceList: ['L', 'Foo Choice', 'Baz Choice'] as any,
      Field_Ref: 1,
      Field_Ref_Radio: 2,
      Field_RefList: ['L', 2, 3] as any,
    });
  });


  it('should allow hiding fields and still accept url values in them', async function() {
    // Hide half of the fields in the form.
    for (const field of [
      // Fields where we don't accept URL values (from last test case).
      'Field_Numeric', 'Field_Bool', 'Field_DateTime',
      // Fields where we do accept URL values (from last test case).
      'Field_Choice_Radio', 'Field_Ref', 'Field_RefList',
    ]) {
      await toggleFieldConfigCheckbox(field, '.test-form-field-hidden');
    }

    // Open the form with some URL parameters.
    const formUrl = new URL(formLink);
    formUrl.search = sampleUrlParameters.toString();
    await gu.onNewTabForUrl(formUrl.href, async () => {
      // We expect precisely the same values as in the previous test case.
      assert.deepEqual(await getFieldValue('Field_Text'), '');
      assert.deepEqual(await getFieldValue('Field_Numeric'), '');
      assert.deepEqual(await getFieldValue('Field_Spinner'), '');
      assert.deepEqual(await getFieldValue('Field_Bool'), '0');
      assert.deepEqual(await getFieldValue('Field_Date'), '');
      assert.deepEqual(await getFieldValue('Field_DateTime'), '');
      assert.deepEqual(await getFieldValue('Field_Choice'), 'Bar Choice');
      assert.deepEqual(await getCheckedFields('Field_Choice_Radio'), ['Baz Choice']);
      assert.deepEqual(await getCheckedFields('Field_ChoiceList[]'), ['Foo Choice', 'Baz Choice']);
      assert.deepEqual(await getFieldValue('Field_Ref'), '1');
      assert.deepEqual(await getCheckedFields('Field_Ref_Radio'), ['2']);
      assert.deepEqual(await getCheckedFields('Field_RefList[]'), ['2', '3']);

      // But check also that the fields are hidden (not displayed).
      assert.equal(await isFieldDisplayed('Field_Text'), true);
      assert.equal(await isFieldDisplayed('Field_Numeric'), false);
      assert.equal(await isFieldDisplayed('Field_Spinner'), true);
      assert.equal(await isFieldDisplayed('Field_Bool'), false);
      assert.equal(await isFieldDisplayed('Field_Date'), true);
      assert.equal(await isFieldDisplayed('Field_DateTime'), false);
      assert.equal(await isFieldDisplayed('Field_Choice'), true);
      assert.equal(await isFieldDisplayed('Field_Choice_Radio'), false);
      assert.equal(await isFieldDisplayed('Field_ChoiceList[]'), true);
      assert.equal(await isFieldDisplayed('Field_Ref'), false);
      assert.equal(await isFieldDisplayed('Field_Ref_Radio'), true);
      assert.equal(await isFieldDisplayed('Field_RefList[]'), false);

      // Submit.
      await driver.findWait('button[type="submit"]', 500).click();
      await driver.findWait('.test-form-success-page-text', 2000);
    });

    // Check that submitted values are as expected.
    const records = await api.getDocAPI(docId).getRecords('FormTest');
    const lastRow = records[records.length - 1];
    assert.deepEqual(lastRow.fields, {
      Field_Text: '',
      Field_Numeric: 0,
      Field_Spinner: 0,
      Field_Bool: false,
      Field_Date: null,
      Field_DateTime: null,
      Field_Choice: 'Bar Choice',
      Field_Choice_Radio: 'Baz Choice',
      Field_ChoiceList: ['L', 'Foo Choice', 'Baz Choice'] as any,
      Field_Ref: 1,
      Field_Ref_Radio: 2,
      Field_RefList: ['L', 2, 3] as any,
    });
  });
});


// Various helpers.

function getFieldValue(name: string) {
  return driver.findWait(`input[name="${name}"], select[name="${name}"]`, 500).value();
}

function getCheckedFields(name: string) {
  return driver.findAll(`input[name="${name}"]:checked`, el => el.value());
}

async function setFieldValue(name: string, value: string) {
  await driver.findWait(`input[name="${name}"]`, 500).click();
  await gu.sendKeys(value);
}

async function setSelectValue(name: string, value: string) {
  await driver.findWait(`select[name="${name}"] ~ .test-form-search-select`, 500).click();
  await driver.findContentWait('.test-sd-searchable-list-item', value, 500).click();
}

async function toggleCheckedValue(name: string, value: string) {
  await driver.findWait(`input[name="${name}"][value="${value}"]`, 500).click();
}

async function toggleFieldConfigCheckbox(field: string, selector: string) {
  await question(field).click();
  await gu.openColumnPanel();
  await driver.findWait(selector, 250).click();
  await gu.waitForServer();
}

function isFieldDisplayed(name: string) {
  return driver.findWait(`input[name="${name}"], select[name="${name}"]`, 500).isDisplayed();
}
