import { assert, driver, Key, stackWrapFunc, WebElement } from 'mocha-webdriver';
import { server, setupTestSuite } from './testUtils';

describe('UI2018', () => {
  setupTestSuite();

  let actionText: WebElement;
  let actionReset: WebElement;

  before(async function() {
    this.timeout(1200000);      // Set a longer default timeout.
    await driver.get(`${server.getHost()}/UI2018`);
    actionText = await driver.find('#action-text');
    actionReset = await driver.find('#action-reset');
  });

  describe('buttons', () => {
    it('should support actions on click', async function() {
      const btns = await driver.findAll('#buttons > .elements > *');
      for (const btn of btns) {
        await btn.doClick();
        assert.equal(await actionText.getText(), await btn.getText());
        await actionReset.doClick();
      }
    });
  });

  describe('editable labels', () => {
    it('should allow editing label and save on enter / tab / click', async function() {
      const label = await driver.find('#editable-label input');
      assert.equal(await label.value(), 'Hello');

      // Send new value and check that it updates and focus remains
      await label.sendKeys(Key.END, ', world!');
      assert.equal(await label.value(), 'Hello, world!');
      assert.equal(await driver.switchTo().activeElement().getId(), await label.getId());

      // Check that on Enter focus leaves but the value remains
      await label.sendKeys(Key.ENTER);
      assert.notEqual(await driver.switchTo().activeElement().getId(), await label.getId());
      assert.equal(await label.value(), 'Hello, world!');

      // Check that on Tab focus leaves but the value remains
      await label.sendKeys(Key.END, ' Foo', Key.TAB);
      assert.notEqual(await driver.switchTo().activeElement().getId(), await label.getId());
      assert.equal(await label.value(), 'Hello, world! Foo');

      // Check that on click away focus leaves but the value remains
      await label.sendKeys(Key.END, ', bar');
      await driver.find('#labels > h4').click();
      assert.notEqual(await driver.switchTo().activeElement().getId(), await label.getId());
      assert.equal(await label.value(), 'Hello, world! Foo, bar');

      // Reset back to Hello
      await label.sendKeys(Key.HOME, Key.chord(Key.SHIFT, Key.END), 'Hello', Key.ENTER);
      assert.equal(await label.value(), 'Hello');
    });

    it('should allow Escape to cancel', async function() {
      const label = await driver.find('#editable-label input');
      assert.equal(await label.value(), 'Hello');

      await label.sendKeys(Key.END, ', wrong!');
      assert.equal(await label.value(), 'Hello, wrong!');
      assert.equal(await driver.switchTo().activeElement().getId(), await label.getId());
      await label.sendKeys(Key.ESCAPE);
      assert.notEqual(await driver.switchTo().activeElement().getId(), await label.getId());
      assert.equal(await label.value(), 'Hello');

      // Check that clicking it still shows the right value
      await label.click();
      assert.equal(await label.value(), 'Hello');
      await label.sendKeys(Key.ESCAPE);
    });

    it('should revert when saving empty value', async function() {
      const label = await driver.find('#editable-label input');
      assert.equal(await label.value(), 'Hello');

      // Should cancel on Enter when empty value
      await label.sendKeys(Key.HOME, Key.chord(Key.SHIFT, Key.END), Key.ENTER);
      assert.equal(await label.value(), 'Hello');
      assert.notEqual(await driver.switchTo().activeElement().getId(), await label.getId());
      // ... or Tab
      await label.sendKeys(Key.HOME, Key.chord(Key.SHIFT, Key.END), Key.TAB);
      assert.equal(await label.value(), 'Hello');
      assert.notEqual(await driver.switchTo().activeElement().getId(), await label.getId());
      // ... or click away
      await label.sendKeys(Key.HOME, Key.chord(Key.SHIFT, Key.END));
      await driver.find('#labels > h4').click();
      assert.equal(await label.value(), 'Hello');
      assert.notEqual(await driver.switchTo().activeElement().getId(), await label.getId());
      // And should reset on Escape
      await label.sendKeys(Key.HOME, Key.chord(Key.SHIFT, Key.END), Key.ESCAPE);
      assert.equal(await label.value(), 'Hello');
      assert.notEqual(await driver.switchTo().activeElement().getId(), await label.getId());
    });

  });

  describe('search bar', async function() {
    it('should expand on click and collapse on x', async function() {
      const searchIcon = await driver.find('.test-search-icon');
      await searchIcon.click();
      await driver.sleep(500);
      const searchInput = await driver.find('.test-search-input');
      assert.isAbove((await searchInput.rect()).width, 50);

      const searchClose = await driver.find('.test-search-close');
      await searchClose.click();
      await driver.sleep(500);
      assert.equal((await searchInput.rect()).width, 0);
    });

    it('should collapse on blur', async function() {
      const searchIcon = await driver.find('.test-search-icon');
      await searchIcon.click();
      await driver.sleep(500);
      const searchInput = await driver.find('.test-search-input');
      assert.isAbove((await searchInput.rect()).width, 50);

      await driver.find('#search h4').click();
      await driver.sleep(500);
      assert.equal((await searchInput.rect()).width, 0);
    });

    it('should blur on close', async function() {
      const searchIcon = await driver.find('.test-search-icon');
      const searchInput = await driver.find('.test-search-input');
      const searchInputInput = await driver.find('.test-search-input input');

      // click search bar icon
      await searchIcon.click();
      await driver.sleep(500);

      // type in 'foo'
      await driver.sendKeys('foo');
      assert.equal(await searchInputInput.value(), 'foo');

      // hit escape to close
      await driver.sendKeys(Key.ESCAPE);
      await driver.sleep(500);

      // check searchBar is closed
      assert.equal((await searchInput.rect()).width, 0);

      // type in 'bar'
      await driver.sendKeys('foo');

      // check that value is still 'foo'
      assert.equal(await searchInputInput.value(), 'foo');
    });
  });

  describe('button select', () => {
    it('should update observable on click', async function() {
      // Select buttons and check that the observable is set to the correct value.
      const alignmentValue = await driver.find('#buttonselect .alignment-value');
      const alignmentBtns = await driver.findAll('#buttonselect .alignment-select .test-select-button');
      await alignmentBtns[0].click();
      assert.equal(await alignmentValue.getText(), 'left');
      await alignmentBtns[1].click();
      assert.equal(await alignmentValue.getText(), 'center');
      await alignmentBtns[2].click();
      assert.equal(await alignmentValue.getText(), 'right');

      const widgetValue = await driver.find('#buttonselect .widget-value');
      const widgetBtns = await driver.findAll('#buttonselect .widget-select .test-select-button');
      await widgetBtns[0].click();
      assert.equal(await widgetValue.getText(), '0');
      await widgetBtns[1].click();
      assert.equal(await widgetValue.getText(), '1');

      const chartValue = await driver.find('#buttonselect .chart-value');
      const chartBtns = await driver.findAll('#buttonselect .chart-select .test-select-button');
      await chartBtns[1].click();
      assert.equal(await chartValue.getText(), 'pie');
      await chartBtns[4].click();
      assert.equal(await chartValue.getText(), 'kaplan');
    });

    it('should allow unsetting toggle observable', async function() {
      const chartValue = await driver.find('#buttonselect .chart-value');
      const chartBtns = await driver.findAll('#buttonselect .chart-select .test-select-button');
      await chartBtns[2].click();
      assert.equal(await chartValue.getText(), 'area');
      // Click the same button and check that the value is null.
      await chartBtns[2].click();
      assert.equal(await chartValue.getText(), 'null');
    });
  });

  describe('tri state checkbox', () => {
    it('should work correctly', async function() {

      const checkState = stackWrapFunc(async function(isIndeterminate: boolean, isChecked: boolean) {
        assert.equal(await driver.find('.test-both-check').matches(':indeterminate'), isIndeterminate);
        assert.equal(await driver.find('.test-both-check').matches(':checked'), isChecked);
      });

      // check checkbox is in indeterminate state
      await checkState(true, false);

      // click checkbox
      await driver.find('.test-both-check').click();

      // check is in checked state
      await checkState(false, true);

      // click checkbox
      await driver.find('.test-both-check').click();

      // check it is unchecked state
      await checkState(false, false);

      // click checkbox
      await driver.find('.test-both-check').click();

      // check it is checked state
      await checkState(false, true);

      // click obsCheck1
      await driver.find('.test-check-1').click();

      // check it is indeterminate
      await checkState(true, false);
    });
  });

  describe('multi select', () => {
    it('should display placeholder text when nothing is selected', async function() {
      const buttonText = await driver.find('#menus .test-multi-select').getText();
      assert.equal(buttonText, 'Select column type');
    });

    it('should display available options when clicked', async function() {
      // Click the multi select to open the menu.
      await driver.find('#menus .test-multi-select').click();

      // Check that the correct available options are shown.
      const availableOptions = await driver.findAll(
        '.test-multi-select-menu .test-multi-select-menu-option-text',
        el => el.getText()
      );
      assert.deepEqual(
        availableOptions,
        [
          'Text',
          'Numeric',
          'Integer',
          'Toggle',
          'Date',
          'DateTime',
          'Choice',
          'Reference',
          'Attachment',
          'Any',
          'A very very long fake label for a very fake type'
        ]
      );

      // Check that all checkboxes are unchecked.
      const checkboxValues = await driver.findAll(
        '.test-multi-select-menu .test-multi-select-menu-option-checkbox',
        el => el.getAttribute('checked')
      );
      assert.notInclude(checkboxValues, 'true');
    });

    it('should update button text when selected options change', async function() {
      // Click the first option and check that the button text updated.
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /Text/
      ).click();
      assert.equal(await driver.find('#menus .test-multi-select').getText(), 'Text');

      // Click the last option's text and check that the button text updated.
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /A very very long/
      ).find('.test-multi-select-menu-option-text').click();
      assert.equal(
        await driver.find('#menus .test-multi-select').getText(),
        'Text, A very very long fake label for a very fake type'
      );

      // Click the second option's checkbox and check that the button text updated.
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /Numeric/
      ).find('.test-multi-select-menu-option-checkbox').click();
      assert.equal(
        await driver.find('#menus .test-multi-select').getText(),
        'Text, Numeric, A very very long fake label for a very fake type'
      );

      // Uncheck the first option ('Text') and check that the button text updated.
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /Text/
      ).click();
      assert.equal(
        await driver.find('#menus .test-multi-select').getText(),
        'Numeric, A very very long fake label for a very fake type'
      );

      // Close the menu and check that the button text is still correct.
      await driver.find('#menus > h4').click();
      assert.equal(
        await driver.find('#menus .test-multi-select').getText(),
        'Numeric, A very very long fake label for a very fake type'
      );
    });

    it('should change its outline to red when the error observable is true', async function() {
      // Check that the outline is currently not red.
      assert.equal(
        await driver.find('#menus .test-multi-select').getCssValue('border'),
        '1px solid rgb(217, 217, 217)'
      );

      // Open the menu and check 2 more option, triggering the error observable from the fixture to be true.
      await driver.find('#menus .test-multi-select').click();
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /Text/
      ).click();
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /Date/
      ).click();

      // Check that the outline is now red.
      assert.equal(
        await driver.find('#menus .test-multi-select').getCssValue('border'),
        '1px solid rgb(208, 2, 27)'
      );

      // Uncheck an option and check that the outline is no longer red.
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /Text/
      ).click();
      assert.equal(
        await driver.find('#menus .test-multi-select').getCssValue('border'),
        '1px solid rgb(217, 217, 217)'
      );
    });
  });
});
