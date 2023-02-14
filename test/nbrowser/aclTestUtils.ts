import { assert, driver, Key, stackWrapOwnMethods, WebElement } from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';

// tslint:disable:no-namespace
// Wrap in a namespace so that we can apply stackWrapOwnMethods to all the exports together.
namespace gristUtils {

  /**
   * Find .test-rule-table element for the given tableId.
   */
  export function findTable(tableId: RegExp|'*'): WebElement {
    const header = driver.findContent('.test-rule-table-header', tableId === '*' ? 'Default Rules' : tableId);
    return header.findClosest('.test-rule-table');
  }

  /**
   * Remove any rules within a .test-rule-table element, by hitting the trash buttons.
   */
  export async function removeTable(tableId: RegExp|'*'): Promise<void> {
    const header = driver.findContent('.test-rule-table-header', tableId === '*' ? 'Default Rules' : tableId);
    if (await header.isPresent()) {
      const table = header.findClosest('.test-rule-table');
      await removeRules(table);
    }
  }

  /**
   * Remove any rules within an element, by hitting the trash button.
   */
  export async function removeRules(el: WebElement): Promise<void> {
    while (true) {  // eslint-disable-line no-constant-condition
      const remove = el.find('.test-rule-remove');
      if (!await remove.isPresent()) { break; }
      await remove.click();
    }
  }

  /**
   * Find .test-rule-set for the default rule set of the given tableId.
   */
  export function findDefaultRuleSet(tableId: RegExp|'*'): WebElement {
    const table = findTable(tableId);
    const cols = table.findContent('.test-rule-resource', /All/);
    return cols.findClosest('.test-rule-set');
  }

  /**
   * Find a .test-rule-set at the given 1-based index, among the rule sets for the given tableId.
   */
  export function findRuleSet(tableId: RegExp|'*', ruleNum: number): WebElement {
    const table = findTable(tableId);
    // Add one to skip table header element.
    return table.find(`.test-rule-set:nth-child(${ruleNum + 1})`);
  }

  /**
   * PartNum should be 1-based. Permissions is either the text of an option in the permission
   * widget's dropdown menu (e.g. "Allow All") or a mapping of single-character bit to desired
   * state, e.g. {R: 'deny', U: 'allow', C: ''}.
   */
  export async function enterRulePart(
    ruleSet: WebElement,
    partNum: number,
    aclFormula: string|null,
    permissions: string|{[bit: string]: string},
    memo?: string
  ) {
    const part = ruleSet.find(`.test-rule-part-and-memo:nth-child(${partNum}) .test-rule-part`);
    if (aclFormula !== null) {
      await part.findWait('.test-rule-acl-formula .ace_editor', 500);
      await part.find('.test-rule-acl-formula').doClick();
      await driver.findWait('.test-rule-acl-formula .ace_focus', 500);
      await gu.sendKeys(Key.HOME, Key.chord(Key.SHIFT, Key.END), Key.DELETE);     // Clear formula
      await gu.sendKeys(aclFormula, Key.ENTER);
    }
    if (typeof permissions === 'string') {
      await part.find('.test-rule-permissions .test-permissions-dropdown').click();
      await driver.findContent('.grist-floating-menu li', permissions).click();
    } else {
      for (const [bit, desired] of Object.entries(permissions)) {
        const elem = await part.findContent('.test-rule-permissions div', bit);
        if (!await elem.matches(`[class$=-${desired}]`)) {
          await elem.click();
          if (!await elem.matches(`[class$=-${desired}]`)) {
            await elem.click();
            if (!await elem.matches(`[class$=-${desired}]`)) {
              throw new Error(`Can't set permission bit ${bit} to ${desired}`);
            }
          }
        }
      }
    }
    if (memo) {
      const memoEditorPromise = ruleSet.find(`.test-rule-part-and-memo:nth-child(${partNum}) .test-rule-memo-editor`);
      if (await memoEditorPromise.isPresent()) {
        await memoEditorPromise.click();
        await gu.clearInput();
      } else {
        await part.find('.test-rule-memo-add').click();
      }
      await gu.sendKeys(memo, Key.ENTER);
    }
  }

  /**
   * Enters formula in the ACL condition editor to trigger the autocomplete dropdown.
   * @param ruleSet Rule set dom (for a table or default)
   * @param partNum Index of the condition
   * @param aclFormula Formula to enter
   */
  export async function triggerAutoComplete(
    ruleSet: WebElement, partNum: number, aclFormula: string
  ) {
    const part = ruleSet.find(`.test-rule-part-and-memo:nth-child(${partNum}) .test-rule-part`);
    if (aclFormula !== null) {
      await part.findWait('.test-rule-acl-formula .ace_editor', 500);
      await part.find('.test-rule-acl-formula').doClick();
      await driver.findWait('.test-rule-acl-formula .ace_focus', 500);
      await gu.sendKeys(Key.HOME, Key.chord(Key.SHIFT, Key.END), Key.DELETE);     // Clear formula
      await gu.sendKeys(aclFormula);
    }
  }

  /**
   * Fetch rule text from an element.  Uses Ace text if that is non-empty, in order
   * to get complete text of long rules.  If Ace text is empty, returns any plain
   * text (e.g. "Everyone Else").
   */
  export async function getRuleText(el: WebElement) {
    const plainText = await el.getText();
    const aceText = await gu.getAceText(el);
    return aceText || plainText;
  }

  /**
   * Read the rules within an element in a format that is easy to
   * compare with.
   */
  export async function getRules(el: WebElement): Promise<Array<{
    formula: string, perm: string,
    res?: string,
    memo?: string}>> {
    const ruleSets = await el.findAll('.test-rule-set');
    const results: Array<{formula: string, perm: string,
                          res?: string,
                          memo?: string}> = [];
    for (const ruleSet of ruleSets) {
      const scope = ruleSet.find('.test-rule-resource');
      const res = (await scope.isPresent()) ? (await scope.getText()) : undefined;
      const parts = await ruleSet.findAll('.test-rule-part-and-memo');
      for (const part of parts) {
        const formula = await getRuleText(await part.find('.test-rule-acl-formula'));
        const perms = await part.find('.test-rule-permissions').findAll('div');
        const permParts: Array<string> = [];
        for (const perm of perms) {
          const content = await perm.getText();
          if (content.length !== 1) { continue; }
          const classes = await perm.getAttribute('class');
          const prefix = classes.includes('-deny') ? '-' :
            (classes.includes('-allow') ? '+' : '');
          permParts.push(prefix ? (prefix + content) : '');
        }
        const hasMemo = await part.find('.test-rule-memo').isPresent();
        const memo = hasMemo ? await part.find('.test-rule-memo input').value() : undefined;
        results.push({formula, perm: permParts.join(''),
                      ...(memo ? {memo} : {}),
                      ...(res ? {res} : {})
                     });
      }
    }
    return results;
  }

  /**
   * Check if there is an extra "add" button compared to the number of rules
   * within an element.
   */
  export async function hasExtraAdd(el: WebElement): Promise<boolean> {
    const parts = await el.findAll('.test-rule-part-and-memo');
    const adds = await el.findAll('.test-rule-add');
    return adds.length === parts.length + 1;
  }

  /**
   * Assert that the Save button is currently disabled because the rules are
   * saved.
   */
  export async function assertSaved() {
    assert.equal(await driver.find('.test-rules-non-save').getText(), 'Saved');
    assert.equal(await driver.find('.test-rules-save').getText(), '');
  }

  /**
   * Assert that the Save button is currently enabled because the rules have
   * changed.
   */
  export async function assertChanged() {
    assert.equal(await driver.find('.test-rules-save').getText(), 'Save');
    assert.equal(await driver.find('.test-rules-non-save').getText(), '');
  }
} // end of namespace aclTestUtils

stackWrapOwnMethods(gristUtils);
export = gristUtils;
