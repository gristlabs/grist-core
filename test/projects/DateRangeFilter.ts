import range from "lodash/range";
import { addToRepl, assert, driver, Key } from "mocha-webdriver";
import moment from "moment";
import { server, setupTestSuite } from "./testUtils";
import * as gu from "test/nbrowser/gristUtils";
import * as fu from "test/projects/filterUtils";

const CURRENT_TIME = moment('2022-09-20T15:28:09.092Z');
const now = () => moment(CURRENT_TIME);


describe('DateRangeFilter', function() {
  setupTestSuite();
  addToRepl('fu', fu);

  this.timeout(10000);

  async function refresh() {
    await driver.get(`${server.getHost()}/ColumnFilterMenu?filterType=Date` +
      `&currentTime=${encodeURIComponent(now().toISOString())}`);
    await gu.waitToPass(async () => {
      assert(await driver.find('.test-filter-menu-search-input').hasFocus());
    });
  }


  async function testBoundShowCalendar(minMax: 'min'|'max') {

    // check calendar is NOT present
    assert.equal(await driver.find('.datepicker-inline').isPresent(), false);

    // click min bound
    await fu.findBound(minMax).click();

    // check calendar is visible
    assert.equal(await driver.find('.datepicker-inline').isPresent(), true);
  }

  beforeEach(async function() {
    await refresh();
  });


  it('should switch to calendar view when clicking on min bound', async function() {
    await testBoundShowCalendar('min');
  });

  it('should switch to calendar view when clicking on max bound', async function() {
    await testBoundShowCalendar('max');
  });

  it('should switch back to default view when clicking on \'List View\'', async function() {
    // click min bound
    await fu.findBound('min').click();

    // check calendar is visible
    assert.equal(await driver.find('.datepicker-inline').isPresent(), true);

    // click List View
    await driver.findContent('.test-calendar-links button', 'List view').click();

    // check calendar is not visible
    assert.equal(await driver.find('.datepicker-inline').isPresent(), false);
  });

  async function testPickingBound(minMax: 'min'|'max') {
    // check min bound shows no border
    assert.equal(await fu.findBound(minMax).matches('.selected'), false);

    // check min bound shows 'Min' placeholder
    assert.equal(await fu.getBoundText(minMax), minMax === 'min' ? 'Start' : 'End');

    // click min bound
    await fu.findBound(minMax).click();

    // check min bound shows border
    assert.equal(await fu.findBound(minMax).matches('.selected'), true);

    // pick a date (2022-09-18)
    await driver.findContent('.datepicker-inline td.day', '18').click();

    // check min bound shows 2022-09-18
    assert.equal(await fu.getBoundText(minMax), '2022-09-18');
  }

  it('should update min bound when clicking date on calendar', async function() {
    await testPickingBound('min');
  });

  it('should update max bound when clicking date on calendar', async function() {
    await testPickingBound('max');
  });

  it('should show finite range correctly', async function() {
    // set min bound to 2022-09-18
    await fu.setBound('min', '2022-09-18');

    // set max bound to 2022-09-22
    await fu.setBound('max', '2022-09-22');

    // check 18th has .range-start class
    assert.deepEqual(await fu.findCalendarDates('.range-start'), ['18']);

    // check 19 to 21 have .range class
    assert.deepEqual(await fu.findCalendarDates('.range'), ['19', '20', '21']);

    // check 22 has .range-end class
    assert.deepEqual(await fu.findCalendarDates('.range-end'), ['22']);
  });

  it('should show infinite range when max is unbound', async function() {
    // set min bound to 2022-09-18
    await fu.setBound('min', '2022-09-18');

    // check 18th has range-start class
    await gu.waitToPass(async () => {
      assert.deepEqual(await fu.findCalendarDates('.range-start'), ['18']);
    });

    // check 19, 22, 31 have .range class
    assert.deepEqual(await fu.findCalendarDates('.range'),
                     range(19, 31).concat([1, 2, 3, 4, 5, 6, 7, 8]).map(n => n.toString()));
  });

  it('should show infinite range when min is unbound', async function() {
    // set max bound to 2022-09-18
    await fu.setBound('max', '2022-09-18');

    // check 18th has range-end class
    await gu.waitToPass(async () => {
      assert.deepEqual(await fu.findCalendarDates('.range-end'), ['18']);
    });

    // check 1, 3, 8 have .range class
    assert.deepEqual(await fu.findCalendarDates('.range'),
                     [28, 29, 30, 31].concat(range(1, 18)).map(n => n.toString()));
  });

  it('should allow to convert to relative date', async function() {
    // set min bound to 2022-09-18
    await fu.setBound('min', '2022-09-18');

    // click '2 days ago' from menu
    await fu.setBound('min', {relative: '2 days ago'});

    // check bound shows 2 days ago
    assert.equal(await fu.getBoundText('min'), '2 days ago');

    // check range is still correct
    assert.deepEqual(await fu.findCalendarDates('.range-start'), ['18']);
    assert.deepEqual(await fu.findCalendarDates('.range'),
                     range(19, 31).concat([1, 2, 3, 4, 5, 6, 7, 8]).map(n => n.toString()));

    // check menus till offer 2 days ago
    await fu.openRelativeOptionsMenu('min');
    assert.equal(await driver.findContent('.grist-floating-menu li', '2 days ago').isPresent(), true);
    await driver.sendKeys(Key.ESCAPE);
  });

  it('should support relative date in future', async function() {
    // set min bound to 2022-09-24
    await fu.setBound('min', '2022-09-24');

    // click '4 days from now' from menu
    await fu.setBound('min', {relative: '4 days from now'});

    // check bound shows 4 days from now
    assert.equal(await fu.getBoundText('min'), '4 days from now');

    // check range is still correct
    assert.deepEqual(await fu.findCalendarDates('.range-start'), ['24']);
    assert.deepEqual(await fu.findCalendarDates('.range'),
                     range(25, 31).concat([1, 2, 3, 4, 5, 6, 7, 8]).map(n => n.toString()));

    // check menus still offer 4 days from now
    await fu.openRelativeOptionsMenu('min');
    assert.equal(await driver.findContent('.grist-floating-menu li', '4 days from now').isPresent(), true);
    await driver.sendKeys(Key.ESCAPE);
  });

  it('should allow deleting of relative date', async function() {
    // set min bound to '3 days ago`
    await fu.setBound('min', {relative: '3 days ago'});

    // check min bound shows `3 days ago`
    assert.equal(await fu.getBoundText('min'), '3 days ago');

    // hover token and click the x button
    await driver.withActions(
      action => action
        .move({origin: fu.findBound('min').find('.test-filter-menu-tokenfield-token')})
        .move({origin: driver.find('.test-filter-menu-tokenfield-delete')})
        .click()
    );

    // check min bound shows `Min`
    assert.equal(await fu.getBoundText('min'), 'Start');
  });

  it('should delete relative date on keyboard Delete', async function() {
    // set min bound to '3 days ago`
    await fu.setBound('min', {relative: '3 days ago'});

    // check min bound shows `3 days ago`
    assert.equal(await fu.getBoundText('min'), '3 days ago');

    // press keyboard Delete
    await driver.sendKeys(Key.BACK_SPACE);

    // check min bound shows `Min`
    assert.equal(await fu.getBoundText('min'), 'Start');
  });

  it('should allow to convert to absolute date', async function() {
    // set min bound to 2022-09-18
    await fu.setBound('min', '2022-09-18');
    assert.equal(await fu.getBoundText('min'), '2022-09-18');

    // click '2 days ago' from menu
    await fu.setBound('min', {relative: '2 days ago'});
    assert.equal(await fu.getBoundText('min'), '2 days ago');

    // click  2022-09-18 from menu
    await fu.setBound('min', {relative: '2022-09-18'});

    // check min bound shows 2022-09-18
    assert.equal(await fu.getBoundText('min'), '2022-09-18');

    // check range is still correct
    assert.deepEqual(await fu.findCalendarDates('.range-start'), ['18']);
    assert.deepEqual(await fu.findCalendarDates('.range'),
                     range(19, 31).concat([1, 2, 3, 4, 5, 6, 7, 8]).map(n => n.toString()));
  });

  it('should update relative date', async function() {
    // set min bound to 2022-09-18
    await fu.setBound('min', '2022-09-18');

    // click '2 days ago' from menu
    await fu.setBound('min', {relative: '2 days ago'});

    // pick 2022-09-17 from calendar
    await driver.findContent('.datepicker-inline td.day', '17').click();

    // check min shows '3 days ago'
    assert.equal(await fu.getBoundText('min'), '3 days ago');
  });

  it('should support going back and forth between relative and absolute date', async function() {
    // set min bound to 2022-09-18
    await fu.setBound('min', '2022-09-18');

    // click '2 days ago' from menu
    await fu.setBound('min', {relative: '2 days ago'});

    // set min bound to 2022-09-18
    await fu.setBound('min', {relative: '2022-09-18'});

    // pick 2022-09-17 from calendar
    await driver.findContent('.datepicker-inline td.day', '17').click();

    // check min shows 2022-09-17
    assert.equal(await fu.getBoundText('min'), '2022-09-17');
  });

  it('should select max when pressing Enter while on min', async  function() {
    await fu.findBound('min').click();
    assert.equal(await fu.getSelected(), 'min');
    await driver.sendKeys(Key.ARROW_DOWN, Key.ENTER);
    assert.equal(await fu.getSelected(), 'max');
  });

  it('should keep focus on max when pressing Tab', async function() {
    await fu.findBound('max').click();
    assert.equal(await fu.getSelected(), 'max');
    await driver.sendKeys(Key.TAB);
    assert.equal(await fu.getSelected(), 'max');
  });

  it('should select min when pressing sift+tab while on max', async function() {
    await fu.findBound('max').click();
    assert.equal(await fu.getSelected(), 'max');
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.TAB));
    assert.equal(await fu.getSelected(), 'min');
  });

  it('should hide options on Escape', async function() {
    await fu.findBound('max').click();
    assert.equal(await fu.isOptionsVisible(), true);
    await driver.sendKeys(Key.ESCAPE);
    assert.equal(await fu.isOptionsVisible(), false);
  });

  it('should show relative dates options when value changes', async function() {
    await fu.findBound('min').click();
    await driver.sendKeys(Key.ESCAPE);
    assert.equal(await fu.isOptionsVisible(), false);
    await fu.pickDateInCurrentMonth('18');
    assert.equal(await fu.isOptionsVisible(), true);
  });

  it('should show relative dates when selected bound changes', async function() {
    await fu.findBound('min').click();
    await driver.sendKeys(Key.ESCAPE);
    assert.equal(await fu.isOptionsVisible(), false);
    await driver.sendKeys(Key.TAB);
    assert.equal(await fu.isOptionsVisible(), true);
  });

  it('should toggle relative dates on click', async function() {
    await fu.findBound('min').click();
    assert.equal(await fu.isOptionsVisible(), true);
    await fu.findBound('min').click();
    assert.equal(await fu.isOptionsVisible(), false);
  });

  it('should show relative dates options when pressing Enter while the options are closed', async function() {
    await fu.findBound('min').click();
    await driver.sendKeys(Key.ESCAPE); // Escape to close
    assert.equal(await fu.isOptionsVisible(), false);
    await driver.sendKeys(Key.ENTER); // Enter to reopen
    assert.equal(await fu.isOptionsVisible(), true);
    assert.equal(await fu.getSelected(), 'min');
  });

  it('should switch to calendar view on click', async function() {
    assert.equal(await fu.getViewType(), 'Default');
    await fu.findBound('min').click();
    assert.equal(await fu.getViewType(), 'Calendar');
  });

  it('should have working keyboard navigation after picking date from calendar', async function() {
    await fu.findBound('min').click();
    assert.deepEqual(await fu.getSelectedOption(), []);
    await fu.pickDateInCurrentMonth('18');
    assert.deepEqual(await fu.getSelectedOption(), ['2022-09-18']);
    await driver.sendKeys(Key.ARROW_DOWN);
    assert.deepEqual(await fu.getSelectedOption(), ['2 days ago']);
  });

  it('should select bounds on click', async function() {
    assert.equal(await fu.getSelected(), undefined);
    await fu.findBound('min').click();
    assert.equal(await fu.getSelected(), 'min');
    await fu.findBound('max').click();
    assert.equal(await fu.getSelected(), 'max');
  });

  it('should have working keyboard navigation after switching bounds using Enter', async function() {
    await fu.findBound('min').click();
    assert.equal(await fu.getSelected(), 'min');
    await driver.sendKeys(Key.ENTER);
    assert.equal(await fu.getSelected(), 'max');
    assert.deepEqual(await fu.getSelectedOption(), []);
    await driver.sendKeys(Key.ARROW_DOWN);
    assert.deepEqual(await fu.getSelectedOption(), ['Today']);
  });

  it('should not lose keyboard navigation when using Tab while Max is selected', async function() {
    await fu.findBound('min').click();
    await driver.sendKeys(Key.TAB);
    assert.equal(await fu.getSelected(), 'max');
    assert.deepEqual(await fu.getSelectedOption(), []);
    // check arrow navigation still working
    await driver.sendKeys(Key.ARROW_DOWN);
    assert.deepEqual(await fu.getSelectedOption(), ['Today']);
  });

  it('should hide Future Values on calendar view', async function() {
    const getSummaries = () => (
      driver.findAll('.test-filter-menu-summary', (e) => e.find('label').getText())
    );
    assert.equal(await fu.getViewType(), 'Default');
    assert.deepEqual(await getSummaries(), ['Future Values']);
    await fu.findBound('min').click();
    assert.equal(await fu.getViewType(), 'Calendar');
    assert.deepEqual(await getSummaries(), []);
  });

  it('should not show \'[object Object]\' string after a deleting a relative date', async function() {
    // The issue happened as follow: After selecting a relative date, if you start typing, the extra
    // keypresses aren't visible (as expected), but once you hit Delete, you see an [object Object]
    // string.

    await fu.setBound('max', {relative: '3 days ago'});
    await gu.sendKeys('random keys', Key.BACK_SPACE);
    assert.equal(await fu.getBoundText('max'), 'End');
  });

  describe('default view', function() {
    it('should have working presets', async function() {
      // click Today
      await driver.findContent('.test-filter-menu-presets-links button', 'Today').click();

      // check min bounds shows 'today'
      assert.equal(await fu.getBoundText('min'), 'Today');

      // check max bound shows 'today'
      assert.equal(await fu.getBoundText('max'), 'Today');

      // click Last week
      await driver.findContent('.test-filter-menu-presets-links button', 'More').click();
      await driver.findContent('.grist-floating-menu li', 'Last Week').click();

      // check min bounds shows '1st day of last week'
      assert.equal(await fu.getBoundText('min'), '1st day of last week');

      // check max bound shows '7th day of last week'
      assert.equal(await fu.getBoundText('max'), 'Last day of last week');
    });

    it('should open calendar view when picking a preset', async function() {
      assert.equal(await fu.getViewType(), 'Default');
      await driver.findContent('.test-filter-menu-presets-links button', 'Last 7 days').click();
      assert.equal(await fu.getViewType(), 'Calendar');
      assert.equal(await fu.getBoundText('min'), '7 days ago');
      assert.equal(await fu.getBoundText('max'), 'Yesterday');
    });
  });

});
