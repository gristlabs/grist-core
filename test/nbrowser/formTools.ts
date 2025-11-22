import {escapeRegExp} from 'lodash';
import {By, driver, WebElement, WebElementPromise} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';

export function element(type: string, parent?: WebElement): ExtraElement;
export function element(type: string, index: number, parent?: WebElement): ExtraElement;
export function element(type: string, arg1?: number | WebElement, arg2?: WebElement): ExtraElement {
  if (typeof arg1 === 'number') {
    if (arg1 === 1) {
      return extra((arg2 ?? driver).find(`.active_section .test-forms-${type}`));
    }
    const nth = ((arg2 ?? driver).findAll(`.active_section .test-forms-${type}`)
      .then(els => els[arg1 - 1]))
      .then(el => {
        if (!el) { throw new Error(`No element of type ${type} at index ${arg1}`); }
        return el;
      });
    return extra(new WebElementPromise(driver, nth));
  } else {
    return extra((arg1 ?? driver).find(`.active_section .test-forms-${type}`));
  }
}

export async function elementCount(type: string, parent?: WebElement) {
  return await (parent ?? driver).findAll(`.active_section .test-forms-${type}`).then(els => els.length);
}

export async function labels() {
  return await driver.findAll('.active_section .test-forms-question .test-forms-label', el => el.getText());
}

export function question(label: string) {
  return extra(driver.findContent(`.active_section .test-forms-label`, new RegExp('^' + escapeRegExp(label) + '\\*?$'))
                     .findClosest('.test-forms-editor'));
}

export function questionDrag(label: string) {
  return question(label).find('.active_section .test-forms-drag');
}

export function questionType(label: string) {
  return question(label).find('.active_section .test-forms-type').value();
}

export function plusButton(parent?: WebElement) {
  return element('plus', parent);
}

export function drops() {
  return driver.findAll('.active_section .test-forms-plus');
}

export async function clickMenu(label: string) {
  await driver.findWait('.grist-floating-menu', 100);
  // First try command as it will also contain the keyboard shortcut we need to discard.
  if (await driver.findContent('.grist-floating-menu li .test-cmd-name', gu.exactMatch(label)).isPresent()) {
    return driver.findContent('.grist-floating-menu li .test-cmd-name', gu.exactMatch(label)).click();
  }
  return driver.findContentWait('.grist-floating-menu li', gu.exactMatch(label), 100).click();
}

export async function isSelected() {
  const els = await driver.findAll('.active_section .test-forms-field-editor-selected');
  return els.length > 0;
}

export function selected() {
  return driver.find('.active_section .test-forms-field-editor-selected');
}

export function selectedLabel() {
  return selected().find('.active_section .test-forms-label-rendered').getText();
}

export function hiddenColumns() {
  return driver.findAll('.test-vfc-hidden-field', e => e.getText());
}

export function hiddenColumn(label: string) {
  return driver.findContent('.test-vfc-hidden-field', gu.exactMatch(label));
}

export type ExtraElement = WebElementPromise & {
  rightClick: () => Promise<void>,
  element: (type: string, index?: number) => ExtraElement,
  /**
   * A draggable element inside. This is 2x2px div to help with drag and drop.
   */
  drag: () => WebElementPromise,
  type: () => Promise<string>,
  remove: () => Promise<void>,
  hover: () => Promise<void>;
};

export function extra(el: WebElementPromise): ExtraElement {
  const webElement: any = el;

  webElement.rightClick = async function() {
    await driver.withActions(a => a.contextClick(el));
  };

  webElement.element = function(type: string, index?: number) {
    return element(type, index ?? 1, el);
  };

  webElement.drag = function() {
    return el.find('.test-forms-drag');
  };
  webElement.type = async function() {
    return await el.getAttribute('data-box-model');
  };
  webElement.remove = async function() {
    return await el.find('.test-forms-remove').click();
  };
  webElement.hover = function() {
    return el.mouseMove();
  };

  return webElement;
}

export async function arrow(key: string, times: number = 1) {
  for (let i = 0; i < times; i++) {
    await gu.sendKeys(key);
  }
}

export async function elements() {
  return await driver.findAll('.active_section .test-forms-element', el => el.getAttribute('data-box-model'));
}

export interface FormElement {
  type: string;
  label?: string;
  content?: string;
  children: FormElement[];
}

export async function formSchema(): Promise<FormElement[]> {
  const topElement = await driver.find('.active_section .test-forms-content');
  const topElements = await topElement.findElements(By.css(':scope > .test-forms-element'));
  const list: FormElement[] = [];
  for (const el of topElements) {
    list.push(await inspect(el));
  }
  return list;

  async function inspect(el: WebElement): Promise<FormElement> {
    const type = await el.getAttribute('data-box-model');
    let label: string|undefined;
    let content: string|undefined;

    if (type === 'Field') {
      label = await el.find('.test-forms-label').getText();
    } else {
      content = await el.getText();
    }

    const children: FormElement[] = [];

    if (await el.find('.test-forms-content').isPresent()) {
      const innerList = await el.find('.test-forms-content').findElements(By.css(':scope > .test-forms-element'));
      for (const innerEl of innerList) {
        children.push(await inspect(innerEl));
      }
    }

    return {type, label, content, children};
  }
}
