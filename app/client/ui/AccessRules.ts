/**
 * UI for managing granular ACLs.
 */
import {GristDoc} from 'app/client/components/GristDoc';
import {createObsArray} from 'app/client/lib/koArrayWrap';
import {reportError, UserError} from 'app/client/models/errors';
import {TableData} from 'app/client/models/TableData';
import {shadowScroll} from 'app/client/ui/shadowScroll';
import {bigBasicButton, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {colors, testId} from 'app/client/ui2018/cssVars';
import {textInput} from 'app/client/ui2018/editableLabel';
import {icon} from 'app/client/ui2018/icons';
import {menu, menuItemAsync} from 'app/client/ui2018/menus';
import {emptyPermissionSet, parsePermissions} from 'app/common/ACLPermissions';
import {PartialPermissionSet, permissionSetToText} from 'app/common/ACLPermissions';
import {ACLRuleCollection} from 'app/common/ACLRuleCollection';
import {BulkColValues, RowRecord, UserAction} from 'app/common/DocActions';
import {RulePart, RuleSet, UserAttributeRule} from 'app/common/GranularAccessClause';
import {isObject} from 'app/common/gutil';
import {SchemaTypes} from 'app/common/schema';
import {BaseObservable, Computed, Disposable, dom, MutableObsArray, obsArray, Observable, styled} from 'grainjs';
import isEqual = require('lodash/isEqual');

// tslint:disable:max-classes-per-file no-console

// Types for the rows in the ACL tables we use.
type ResourceRec = SchemaTypes["_grist_ACLResources"] & {id?: number};
type RuleRec = Partial<SchemaTypes["_grist_ACLRules"]> & {id?: number, resourceRec?: ResourceRec};

type UseCB = <T>(obs: BaseObservable<T>) => T;

// Status of rules, which determines whether the "Save" button is enabled. The order of the values
// matters, as we take the max of all the parts to determine the ultimate status.
enum RuleStatus {
  Unchanged,
  ChangedValid,
  Invalid,
  CheckPending,
}

/**
 * Top-most container managing state and dom-building for the ACL rule UI.
 */
export class AccessRules extends Disposable {
  // Whether anything has changed, i.e. whether to show a "Save" button.
  private _ruleStatus: Computed<RuleStatus>;

  // Parsed rules obtained from DocData during last call to update(). Used for _ruleStatus.
  private _ruleCollection = new ACLRuleCollection();

  // Array of all per-table rules.
  private _tableRules = this.autoDispose(obsArray<TableRules>());

  // The default rule set for the document (for "*:*").
  private _docDefaultRuleSet = Observable.create<DefaultObsRuleSet|null>(this, null);

  // Array of all tableIds in the document (for adding new per-table rules).
  private _allTableIds = createObsArray(this, this._gristDoc.docModel.allTableIds);

  // Array of all UserAttribute rules.
  private _userAttrRules = this.autoDispose(obsArray<ObsUserAttributeRule>());

  // Whether the save button should be enabled.
  private _savingEnabled: Computed<boolean>;

  constructor(private _gristDoc: GristDoc) {
    super();
    this._ruleStatus = Computed.create(this, (use) => {
      const defRuleSet = use(this._docDefaultRuleSet);
      const tableRules = use(this._tableRules);
      const userAttr = use(this._userAttrRules);
      return Math.max(
        defRuleSet ? use(defRuleSet.ruleStatus) : RuleStatus.Unchanged,
        // If any tables/userAttrs were changed or added, they will be considered changed. If
        // there were only removals, then length will be reduced.
        getChangedStatus(tableRules.length < this._ruleCollection.getAllTableIds().length),
        getChangedStatus(userAttr.length < this._ruleCollection.getUserAttributeRules().size),
        ...tableRules.map(t => use(t.ruleStatus)),
        ...userAttr.map(u => use(u.ruleStatus)),
      );
    });

    this._savingEnabled = Computed.create(this, this._ruleStatus, (use, s) => (s === RuleStatus.ChangedValid));

    this.update().catch(reportError);
  }

  /**
   * Replace internal state from the rules in DocData.
   */
  public async update() {
    const rules = this._ruleCollection;
    await rules.update(this._gristDoc.docData, {log: console});
    this._tableRules.set(
      rules.getAllTableIds().map(tableId => TableRules.create(this._tableRules,
          tableId, this, rules.getAllColumnRuleSets(tableId), rules.getTableDefaultRuleSet(tableId)))
    );
    DefaultObsRuleSet.create(this._docDefaultRuleSet, this, null, undefined, rules.getDocDefaultRuleSet());
    this._userAttrRules.set(
      Array.from(rules.getUserAttributeRules().values(), userAttr =>
        ObsUserAttributeRule.create(this._userAttrRules, this, userAttr))
    );
  }

  /**
   * Collect the internal state into records and sync them to the document.
   */
  public async save(): Promise<void> {
    if (!this._savingEnabled.get()) { return; }

    // Note that if anything has changed, we apply changes relative to the current state of the
    // ACL tables (they may have changed by other users). So our changes will win.
    // TODO: There is a race condition if two people save different rules at the same time, since
    // it's a two-step operation (syncing resources and rules).

    const docData = this._gristDoc.docData;
    const resourcesTable = docData.getTable('_grist_ACLResources')!;
    const rulesTable = docData.getTable('_grist_ACLRules')!;

    await docData.bundleActions(null, async () => {

      // Add/remove resources to have just the ones we need.
      const newResources: RowRecord[] = flatten(
        [{tableId: '*', colIds: '*'}], ...this._tableRules.get().map(t => t.getResources()))
        .map(r => ({id: -1, ...r}));
      const newResourceMap = await syncRecords(resourcesTable, newResources, serializeResource);

      // For syncing rules, we'll go by rowId that we store with each RulePart and with the RuleSet.
      // New rules will get temporary negative rowIds.
      let nextId: number = -1;
      const newRules: RowRecord[] = [];
      for (const rule of this.getRules()) {
        // We use id of 0 internally to mark built-in rules. Skip those.
        if (rule.id === 0) {
          continue;
        }

        // Look up the rowId for the resource.
        const resourceKey = serializeResource(rule.resourceRec as RowRecord);
        const resourceRowId = newResourceMap.get(resourceKey);
        if (!resourceRowId) {
          throw new Error(`Resource missing in resource map: ${resourceKey}`);
        }
        newRules.push({
          id: rule.id || (nextId--),
          resource: resourceRowId,
          aclFormula: rule.aclFormula!,
          permissionsText: rule.permissionsText!,
          rulePos: rule.rulePos || null,
        });
      }

      // UserAttribute rules are listed in the same rulesTable.
      const defaultResourceRowId = newResourceMap.get(serializeResource({id: -1, tableId: '*', colIds: '*'}));
      if (!defaultResourceRowId) {
        throw new Error('Default resource missing in resource map');
      }
      for (const userAttr of this._userAttrRules.get()) {
        const rule = userAttr.getRule();
        newRules.push({
          id: rule.id || (nextId--),
          resource: defaultResourceRowId,
          rulePos: rule.rulePos || null,
          userAttributes: rule.userAttributes,
        });
      }

      // We need to fill in rulePos values. We'll add them in the order the rules are listed (since
      // this.getRules() returns them in a suitable order), keeping rulePos unchanged when possible.
      let lastGoodRulePos = 0;
      let lastGoodIndex = -1;
      for (let i = 0; i < newRules.length; i++) {
        const pos = newRules[i].rulePos as number;
        if (pos && pos > lastGoodRulePos) {
          const step = (pos - lastGoodRulePos) / (i - lastGoodIndex);
          for (let k = lastGoodIndex + 1; k < i; k++) {
            newRules[k].rulePos = step * (k - lastGoodIndex);
          }
          lastGoodRulePos = pos;
          lastGoodIndex = i;
        }
      }
      // Fill in the rulePos values for the remaining rules.
      for (let k = lastGoodIndex + 1; k < newRules.length; k++) {
        newRules[k].rulePos = ++lastGoodRulePos;
      }
      // Finally we can sync the records.
      await syncRecords(rulesTable, newRules);
    }).catch(e => {
      // Report the error, but go on to update the rules. The user may lose their entries, but
      // will see what's in the document. To preserve entries and show what's wrong, we try to
      // catch errors earlier.
      reportError(e);
    });

    // Re-populate the state from DocData once the records are synced.
    await this.update();
  }

  public buildDom() {
    return [
      cssAddTableRow(
        bigBasicButton({disabled: true}, dom.hide(this._savingEnabled),
          dom.text((use) => {
            const s = use(this._ruleStatus);
            return s === RuleStatus.CheckPending ? 'Checking...' :
              s === RuleStatus.Invalid ? 'Invalid' : 'Saved';
          }),
          testId('rules-non-save')
        ),
        bigPrimaryButton('Save', dom.show(this._savingEnabled),
          dom.on('click', () => this.save()),
          testId('rules-save'),
        ),
        bigBasicButton('Revert', dom.show(this._savingEnabled),
          dom.on('click', () => this.update()),
          testId('rules-revert'),
        ),

        bigBasicButton('Add Table Rules', {style: 'margin-left: auto'},
          menu(() => [
            dom.forEach(this._allTableIds, (tableId) =>
              // Add the table on a timeout, to avoid disabling the clicked menu item
              // synchronously, which prevents the menu from closing on click.
              menuItemAsync(() => this._addTableRules(tableId),
                tableId,
                dom.cls('disabled', (use) => use(this._tableRules).some(t => t.tableId === tableId)),
              )
            ),
          ]),
        ),
        bigBasicButton('Add User Attributes', dom.on('click', () => this._addUserAttributes())),
      ),
      shadowScroll(
        dom.maybe(use => use(this._userAttrRules).length, () =>
          cssTableRule(
            cssTableHeader('User Attributes'),
            cssTableBody(
              dom.forEach(this._userAttrRules, (userAttr) => userAttr.buildDom()),
            ),
          ),
        ),
        dom.forEach(this._tableRules, (tableRules) => tableRules.buildDom()),
        cssTableRule(
          cssTableHeader('Default Rules'),
          cssTableBody(
            dom.maybe(this._docDefaultRuleSet, ruleSet => ruleSet.buildDom()),
          )
        )
      ),
    ];
  }

  /**
   * Get a list of all rule records, for saving.
   */
  public getRules(): RuleRec[] {
    return flatten(
      ...this._tableRules.get().map(t => t.getRules()),
      this._docDefaultRuleSet.get()?.getRules('*') || []
    );
  }

  public removeTableRules(tableRules: TableRules) {
    removeItem(this._tableRules, tableRules);
  }

  public removeUserAttributes(userAttr: ObsUserAttributeRule) {
    removeItem(this._userAttrRules, userAttr);
  }

  public async checkAclFormula(text: string): Promise<void> {
    if (text) {
      return this._gristDoc.docComm.checkAclFormula(text);
    }
  }

  private _addTableRules(tableId: string) {
    if (this._tableRules.get().some(t => t.tableId === tableId)) {
      throw new Error(`Trying to add TableRules for existing table ${tableId}`);
    }
    const defRuleSet: RuleSet = {tableId, colIds: '*', body: []};
    this._tableRules.push(TableRules.create(this._tableRules, tableId, this, undefined, defRuleSet));
  }

  private _addUserAttributes() {
    this._userAttrRules.push(ObsUserAttributeRule.create(this._userAttrRules, this));
  }
}

// Represents all rules for a table.
class TableRules extends Disposable {
  // Whether any table rules changed, and if they are valid.
  public ruleStatus: Computed<RuleStatus>;

  // The column-specific rule sets.
  private _columnRuleSets = this.autoDispose(obsArray<ColumnObsRuleSet>());

  // Whether there are any column-specific rule sets.
  private _haveColumnRules = Computed.create(this, this._columnRuleSets, (use, cols) => cols.length > 0);

  // The default rule set (for columns '*'), if one is set.
  private _defaultRuleSet = Observable.create<DefaultObsRuleSet|null>(this, null);

  constructor(public readonly tableId: string, public _accessRules: AccessRules,
              private _colRuleSets?: RuleSet[], private _defRuleSet?: RuleSet) {
    super();
    this._columnRuleSets.set(this._colRuleSets?.map(rs =>
      ColumnObsRuleSet.create(this._columnRuleSets, this._accessRules, this, rs,
        rs.colIds === '*' ? [] : rs.colIds)) || []);

    if (!this._colRuleSets) {
      // Must be a newly-created TableRules object. Just create a default RuleSet (for tableId:*)
      DefaultObsRuleSet.create(this._defaultRuleSet, this._accessRules, this, this._haveColumnRules);
    } else if (this._defRuleSet) {
      DefaultObsRuleSet.create(this._defaultRuleSet, this._accessRules, this, this._haveColumnRules,
        this._defRuleSet);
    }

    this.ruleStatus = Computed.create(this, (use) => {
      const columnRuleSets = use(this._columnRuleSets);
      const d = use(this._defaultRuleSet);
      return Math.max(
        getChangedStatus(
          !this._colRuleSets ||                               // This TableRules object must be newly-added
          Boolean(d) !== Boolean(this._defRuleSet) ||         // Default rule set got added or removed
          columnRuleSets.length < this._colRuleSets.length    // There was a removal
        ),
        d ? use(d.ruleStatus) : RuleStatus.Unchanged,         // Default rule set got changed.
        ...columnRuleSets.map(rs => use(rs.ruleStatus)));     // Column rule set was added or changed.
    });
  }

  public buildDom() {
    return cssTableRule(
      cssTableHeader(
        dom('span', 'Rules for table ', cssTableName(this.tableId)),
        cssIconButton(icon('Dots'), {style: 'margin-left: auto'},
          menu(() => [
            menuItemAsync(() => this._addColumnRuleSet(), 'Add Column Rule'),
            menuItemAsync(() => this._addDefaultRuleSet(), 'Add Default Rule',
              dom.cls('disabled', use => Boolean(use(this._defaultRuleSet)))),
            menuItemAsync(() => this._accessRules.removeTableRules(this), 'Delete Table Rules'),
          ]),
          testId('rule-table-menu-btn'),
        ),
        testId('rule-table-header'),
      ),
      cssTableBody(
        dom.forEach(this._columnRuleSets, ruleSet => ruleSet.buildDom()),
        dom.maybe(this._defaultRuleSet, ruleSet => ruleSet.buildDom()),
      ),
      testId('rule-table'),
    );
  }

  /**
   * Return the resources (tableId:colIds entities), for saving, checking along the way that they
   * are valid.
   */
  public getResources(): ResourceRec[] {
    // Check that the colIds are valid.
    const seen = new Set<string>();
    for (const ruleSet of this._columnRuleSets.get()) {
      const colIds = ruleSet.getColIdList();
      if (colIds.length === 0) {
        throw new UserError(`No columns listed in a column rule for table ${this.tableId}`);
      }
      for (const colId of colIds) {
        if (seen.has(colId)) {
          throw new UserError(`Column ${colId} appears in multiple rules for table ${this.tableId}`);
        }
        seen.add(colId);
      }
    }

    return [
      ...this._columnRuleSets.get().map(rs => ({tableId: this.tableId, colIds: rs.getColIds()})),
      {tableId: this.tableId, colIds: '*'},
    ];
  }

  /**
   * Get rules for this table, for saving.
   */
  public getRules(): RuleRec[] {
    return flatten(
      ...this._columnRuleSets.get().map(rs => rs.getRules(this.tableId)),
      this._defaultRuleSet.get()?.getRules(this.tableId) || [],
    );
  }

  public removeRuleSet(ruleSet: ObsRuleSet) {
    if (ruleSet === this._defaultRuleSet.get()) {
      this._defaultRuleSet.set(null);
    } else {
      removeItem(this._columnRuleSets, ruleSet);
    }
    if (!this._defaultRuleSet.get() && this._columnRuleSets.get().length === 0) {
      this._accessRules.removeTableRules(this);
    }
  }

  private _addColumnRuleSet() {
    this._columnRuleSets.push(ColumnObsRuleSet.create(this._columnRuleSets, this._accessRules, this, undefined, []));
  }

  private _addDefaultRuleSet() {
    if (!this._defaultRuleSet.get()) {
      DefaultObsRuleSet.create(this._defaultRuleSet, this._accessRules, this, this._haveColumnRules);
    }
  }
}

// Represents one RuleSet, for a combination of columns in one table, or the default RuleSet for
// all remaining columns in a table.
abstract class ObsRuleSet extends Disposable {
  // Whether rules changed, and if they are valid. Never unchanged if this._ruleSet is undefined.
  public ruleStatus: Computed<RuleStatus>;

  // Whether the rule set includes any conditions besides the default rule.
  public haveConditions: Computed<boolean>;

  // List of individual rule parts for this entity. The default permissions may be included as the
  // last rule part, with an empty aclFormula.
  private _body = this.autoDispose(obsArray<ObsRulePart>());

  // ruleSet is omitted for a new ObsRuleSet added by the user.
  constructor(public accessRules: AccessRules, private _tableRules: TableRules|null, private _ruleSet?: RuleSet) {
    super();
    if (this._ruleSet) {
      this._body.set(this._ruleSet.body.map(part => ObsRulePart.create(this._body, this, part)));
    } else {
      // If creating a new RuleSet, start with just a default permission part.
      this._body.set([ObsRulePart.create(this._body, this, undefined, true)]);
    }

    this.ruleStatus = Computed.create(this, this._body, (use, body) => {
      // If anything was changed or added, some part.ruleStatus will be other than Unchanged. If
      // there were only removals, then body.length will have changed.
      return Math.max(
        getChangedStatus(body.length < (this._ruleSet?.body?.length || 0)),
        ...body.map(part => use(part.ruleStatus)));
    });

    this.haveConditions = Computed.create(this, this._body, (use, body) => body.some(p => !p.isDefault));
  }

  public getRules(tableId: string): RuleRec[] {
    // Return every part in the body, tacking on resourceRec to each rule.
    return this._body.get().map(part => ({
      ...part.getRulePart(),
      resourceRec: {tableId, colIds: this.getColIds()}
    }));
  }

  public getColIds(): string {
    return '*';
  }

  public abstract buildDom(): Element;

  public removeRulePart(rulePart: ObsRulePart) {
    removeItem(this._body, rulePart);
    if (this._body.get().length === 0) {
      this._tableRules?.removeRuleSet(this);
    }
  }

  public addRulePart(beforeRule: ObsRulePart) {
    const i = this._body.get().indexOf(beforeRule);
    this._body.splice(i, 0, ObsRulePart.create(this._body, this, undefined, false));
  }

  /**
   * Returns the first built-in rule. It's the only one of the built-in rules to get a "+" next to
   * it, since we don't allow inserting new rules in-between built-in rules.
   */
  public getFirstBuiltIn(): ObsRulePart|undefined {
    return this._body.get().find(p => p.isBuiltIn());
  }

  /**
   * When an empty-conditition RulePart is the only part of a RuleSet, we can say it applies to
   * "Everyone".
   */
  public isSoleCondition(use: UseCB, part: ObsRulePart): boolean {
    const body = use(this._body);
    return body.length === 1 && body[0] === part;
  }

  /**
   * When an empty-conditition RulePart is last in a RuleSet, we say it applies to "Everyone Else".
   */
  public isLastCondition(use: UseCB, part: ObsRulePart): boolean {
    const body = use(this._body);
    return body[body.length - 1] === part;
  }

  protected buildRuleBody() {
    return cssRuleSetBody(
      dom.forEach(this._body, part => part.buildDom()),
    );
  }
}

class ColumnObsRuleSet extends ObsRuleSet {
  private _colIds = Observable.create<string[]>(this, this._initialColIds);
  private _colIdStr = Computed.create(this, (use) => use(this._colIds).join(", "));

  constructor(accessRules: AccessRules, tableRules: TableRules, ruleSet: RuleSet|undefined,
              private _initialColIds: string[]) {
    super(accessRules, tableRules, ruleSet);
    const baseRuleStatus = this.ruleStatus;
    this.ruleStatus = Computed.create(this, (use) => Math.max(
        getChangedStatus(!isEqual(use(this._colIds), this._initialColIds)),
        use(baseRuleStatus)
    ));
  }

  public buildDom() {
    const saveColIds = async (colIdStr: string) => {
      this._colIds.set(colIdStr.split(',').map(val => val.trim()).filter(Boolean));
    };
    return cssRuleSet(
      cssResource('Columns', textInput(this._colIdStr, saveColIds),
        testId('rule-resource')
      ),
      this.buildRuleBody(),
      testId('rule-set'),
    );
  }

  public getColIdList(): string[] {
    return this._colIds.get();
  }

  public getColIds(): string {
    return this._colIds.get().join(",");
  }
}

class DefaultObsRuleSet extends ObsRuleSet {
  constructor(accessRules: AccessRules, tableRules: TableRules|null,
              private _haveColumnRules?: Observable<boolean>, ruleSet?: RuleSet) {
    super(accessRules, tableRules, ruleSet);
  }
  public buildDom() {
    return cssRuleSet(
      cssResource(dom.text(use => this._haveColumnRules && use(this._haveColumnRules) ?
        'Remaining Columns' : 'All Columns'),
        testId('rule-resource')
      ),
      this.buildRuleBody(),
      testId('rule-set'),
    );
  }
}

class ObsUserAttributeRule extends Disposable {
  public ruleStatus: Computed<RuleStatus>;

  private _name = Observable.create<string>(this, this._userAttr?.name || '');
  private _tableId = Observable.create<string>(this, this._userAttr?.tableId || '');
  private _lookupColId = Observable.create<string>(this, this._userAttr?.lookupColId || '');
  private _charId = Observable.create<string>(this, this._userAttr?.charId || '');

  constructor(private _accessRules: AccessRules, private _userAttr?: UserAttributeRule) {
    super();
    this.ruleStatus = Computed.create(this, use =>
      getChangedStatus(
        use(this._name) !== this._userAttr?.name ||
        use(this._tableId) !== this._userAttr?.tableId ||
        use(this._lookupColId) !== this._userAttr?.lookupColId ||
        use(this._charId) !== this._userAttr?.charId
      ));
  }

  public buildDom() {
    return cssUserAttribute(
      cssConditionInput(this._name, async (val) => this._name.set(val),
        {placeholder: 'New attribute name'}),
      cssConditionInput(this._tableId, async (val) => this._tableId.set(val),
        {placeholder: 'Table ID'}),
      cssConditionInput(this._lookupColId, async (val) => this._lookupColId.set(val),
        {placeholder: 'Column to look up'}),
      cssConditionInput(this._charId, async (val) => this._charId.set(val),
        {placeholder: 'User attribute to look up'}),
      cssIconButton(icon('Remove'), {style: 'margin-left: 4px'},
        dom.on('click', () => this._accessRules.removeUserAttributes(this)))
    );
  }

  public getRule() {
    const spec = {
      name: this._name.get(),
      tableId: this._tableId.get(),
      lookupColId: this._lookupColId.get(),
      charId: this._charId.get(),
    };
    for (const [prop, value] of Object.entries(spec)) {
      if (!value) {
        throw new UserError(`Invalid user attribute rule: ${prop} must be set`);
      }
    }
    return {
      id: this._userAttr?.origRecord?.id,
      rulePos: this._userAttr?.origRecord?.rulePos as number|undefined,
      userAttributes: JSON.stringify(spec),
    };
  }
}

// Represents one line of a RuleSet, a combination of an aclFormula and permissions to apply to
// requests that match it.
class ObsRulePart extends Disposable {
  // Whether the rule part, and if it's valid or being checked.
  public ruleStatus: Computed<RuleStatus>;

  // Formula to show in the "advanced" UI.
  private _aclFormula = Observable.create<string>(this, this._rulePart?.aclFormula || "");

  // The permission bits.
  private _permissions = Observable.create<PartialPermissionSet>(
    this, this._rulePart?.permissions || emptyPermissionSet());

  private _permissionsText = Computed.create(this, this._permissions, (use, p) => permissionSetToText(p));

  // Whether the rule is being checked after a change. Saving will wait for such checks to finish.
  private _checkPending = Observable.create(this, false);

  // If the formula failed validation, the error message to show. Blank if valid.
  private _formulaError = Observable.create(this, '');

  // rulePart is omitted for a new ObsRulePart added by the user.
  constructor(private _ruleSet: ObsRuleSet, private _rulePart?: RulePart,
              public readonly isDefault: boolean = (_rulePart?.aclFormula === '')) {
    super();
    this.ruleStatus = Computed.create(this, (use) => {
      if (use(this._formulaError)) { return RuleStatus.Invalid; }
      if (use(this._checkPending)) { return RuleStatus.CheckPending; }
      return getChangedStatus(
        use(this._aclFormula) !== this._rulePart?.aclFormula ||
        !isEqual(use(this._permissions), this._rulePart?.permissions)
      );
    });
  }

  public getRulePart(): RuleRec {
    // Use id of 0 to distinguish built-in rules from newly added rule, which will have id of undefined.
    const id = this.isBuiltIn() ? 0 : this._rulePart?.origRecord?.id;
    return {
      id,
      aclFormula: this._aclFormula.get(),
      permissionsText: permissionSetToText(this._permissions.get()),
      rulePos: this._rulePart?.origRecord?.rulePos as number|undefined,
    };
  }

  public buildDom() {
    return cssRulePart(
      (this._isNonFirstBuiltIn() ?
        cssIconSpace({style: 'margin-right: 4px'}) :
        cssIconButton(icon('Plus'), {style: 'margin-right: 4px'},
          dom.on('click', () => this._ruleSet.addRulePart(this)),
          testId('rule-add'),
        )
      ),
      cssCondition(
        cssConditionInput(
          this._aclFormula, this._setAclFormula.bind(this),
          dom.prop('disabled', this.isBuiltIn()),
          dom.prop('placeholder', (use) => {
            return (
              this._ruleSet.isSoleCondition(use, this) ? 'Everyone' :
              this._ruleSet.isLastCondition(use, this) ? 'Everyone Else' :
              'Enter Condition'
            );
          }),
          testId('rule-acl-formula'),
        ),
        dom.maybe(this._formulaError, (msg) => cssConditionError(msg, testId('rule-error'))),
      ),
      cssPermissionsInput(
        this._permissionsText, async (p) => this._permissions.set(parsePermissions(p)),
        dom.prop('disabled', this.isBuiltIn()),
        testId('rule-permissions')
      ),
      (this.isBuiltIn() ?
        cssIconSpace({style: 'margin-left: 4px'}) :
        cssIconButton(icon('Remove'), {style: 'margin-left: 4px'},
          dom.on('click', () => this._ruleSet.removeRulePart(this)),
          testId('rule-remove'),
        )
      ),
      testId('rule-part'),
    );
  }

  public isBuiltIn(): boolean {
    return this._rulePart ? !this._rulePart.origRecord?.id : false;
  }

  private _isNonFirstBuiltIn(): boolean {
    return this.isBuiltIn() && this._ruleSet.getFirstBuiltIn() !== this;
  }

  private async _setAclFormula(text: string) {
    this._aclFormula.set(text);
    this._checkPending.set(true);
    this._formulaError.set('');
    try {
      await this._ruleSet.accessRules.checkAclFormula(text);
    } catch (e) {
      this._formulaError.set(e.message);
    } finally {
      this._checkPending.set(false);
    }
  }
}


/**
 * Produce and apply UserActions to create/update/remove records, to replace data in tableData
 * with newRecords. Records are matched on uniqueId(record), which defaults to returning record.id
 * (unique negative IDs may be used for new records). The returned Map maps uniqueId(record) to
 * rowId for all existing and newly added records.
 *
 * TODO This is a general-purpose function, and should live in a separate module.
 */
async function syncRecords(tableData: TableData, newRecords: RowRecord[],
                           uniqueId: (r: RowRecord) => string = (r => String(r.id))
): Promise<Map<string, number>> {
  const oldRecords = tableData.getRecords();
  const oldRecordMap = new Map<string, RowRecord>(oldRecords.map(r => [uniqueId(r), r]));
  const newRecordMap = new Map<string, RowRecord>(newRecords.map(r => [uniqueId(r), r]));

  const removedRecords: RowRecord[] = oldRecords.filter(r => !newRecordMap.has(uniqueId(r)));
  const addedRecords: RowRecord[] = newRecords.filter(r => !oldRecordMap.has(uniqueId(r)));
  // Array of [before, after] pairs for changed records.
  const updatedRecords: Array<[RowRecord, RowRecord]> = oldRecords.map((r): ([RowRecord, RowRecord]|null) => {
    const newRec = newRecordMap.get(uniqueId(r));
    const updated = newRec && {...r, ...newRec, id: r.id};
    return updated && !isEqual(updated, r) ? [r, updated] : null;
  }).filter(isObject);

  console.log("syncRecords: removing [%s], adding [%s], updating [%s]",
    removedRecords.map(uniqueId).join(", "),
    addedRecords.map(uniqueId).join(", "),
    updatedRecords.map(([r]) => uniqueId(r)).join(", "));

  const userActions: UserAction[] = [];
  if (removedRecords.length > 0) {
    userActions.push(['BulkRemoveRecord', removedRecords.map(r => r.id)]);
  }
  if (updatedRecords.length > 0) {
    userActions.push(['BulkUpdateRecord', updatedRecords.map(([r]) => r.id), getColChanges(updatedRecords)]);
  }
  let addActionIndex: number = -1;
  if (addedRecords.length > 0) {
    addActionIndex = userActions.length;
    userActions.push(['BulkAddRecord', addedRecords.map(r => null), getColValues(addedRecords)]);
  }

  const rowIdMap = new Map<string, number>();
  oldRecords.forEach((r) => rowIdMap.set(uniqueId(r), r.id));

  if (userActions.length > 0) {
    const results = await tableData.sendTableActions(userActions);
    const newRowIds = results[addActionIndex];
    addedRecords.forEach((r, i) => rowIdMap.set(uniqueId(r), newRowIds[i]));
  }
  return rowIdMap;
}

/**
 * Convert a list of rows into an object with columns of values, used for
 * BulkAddRecord/BulkUpdateRecord actions.
 */
function getColValues(records: RowRecord[]): BulkColValues {
  const colIdSet = new Set<string>();
  for (const r of records) {
    for (const c of Object.keys(r)) {
      if (c !== 'id') {
        colIdSet.add(c);
      }
    }
  }
  const result: BulkColValues = {};
  for (const colId of colIdSet) {
    result[colId] = records.map(r => r[colId]);
  }
  return result;
}

/**
 * Convert a list of [before, after] rows into an object of changes, skipping columns which
 * haven't changed.
 */
function getColChanges(pairs: Array<[RowRecord, RowRecord]>): BulkColValues {
  const colIdSet = new Set<string>();
  for (const [before, after] of pairs) {
    for (const c of Object.keys(after)) {
      if (c !== 'id' && !isEqual(before[c], after[c])) {
        colIdSet.add(c);
      }
    }
  }
  const result: BulkColValues = {};
  for (const colId of colIdSet) {
    result[colId] = pairs.map(([before, after]) => after[colId]);
  }
  return result;
}

function serializeResource(rec: RowRecord): string {
  return JSON.stringify([rec.tableId, rec.colIds]);
}

function flatten<T>(...args: T[][]): T[] {
  return ([] as T[]).concat(...args);
}

function removeItem<T>(observableArray: MutableObsArray<T>, item: T): boolean {
  const i = observableArray.get().indexOf(item);
  if (i >= 0) {
    observableArray.splice(i, 1);
    return true;
  }
  return false;
}

function getChangedStatus(value: boolean): RuleStatus {
  return value ? RuleStatus.ChangedValid : RuleStatus.Unchanged;
}

const cssAddTableRow = styled('div', `
  margin: 16px 64px 0 64px;
  display: flex;
  gap: 16px;
`);

const cssTableRule = styled('div', `
  margin: 24px 64px;
`);

const cssTableBody = styled('div', `
  border: 2px solid ${colors.slate};
  border-radius: 8px;
`);

const cssTableHeader = styled('div', `
  display: flex;
  align-items: center;
  margin-bottom: 8px;
  font-weight: bold;
  color: ${colors.slate};
`);

const cssTableName = styled('span', `
  color: ${colors.dark};
`);

const cssRuleSet = styled('div', `
  display: flex;
  border-bottom: 2px solid ${colors.slate};
  &:last-child {
    border-bottom: none;
  }
`);

const cssResource = styled('div', `
  flex: 1;
  display: flex;
  flex-direction: column;
  border-right: 2px solid ${colors.slate};
  padding: 8px;
  min-width: 0;
`);


const cssRuleSetBody = styled('div', `
  flex: 4;
  display: flex;
  flex-direction: column;
  padding: 8px;
  min-width: 0;
`);

const cssRulePart = styled('div', `
  display: flex;
  align-items: start;
  margin: 4px 0;
`);

const cssCondition = styled('div', `
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
`);

const cssConditionInput = styled(textInput, `
  &[disabled] {
    background-color: ${colors.mediumGreyOpaque};
    color: ${colors.dark};
  }
`);

const cssConditionError = styled('div', `
  color: ${colors.error};
`);

const cssPermissionsInput = styled(cssConditionInput, `
  margin-left: 8px;
  width: 64px;
  flex: none;
`);

const cssIconSpace = styled('div', `
  flex: none;
  height: 24px;
  width: 24px;
  margin: 2px;
`);

const cssIconButton = styled(cssIconSpace, `
  padding: 4px;
  border-radius: 3px;
  line-height: 0px;
  cursor: default;
  --icon-color: ${colors.slate};
  &:hover {
    background-color: ${colors.darkGrey};
    --icon-color: ${colors.slate};
  }
`);

const cssUserAttribute = styled('div', `
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 16px 8px;
`);
