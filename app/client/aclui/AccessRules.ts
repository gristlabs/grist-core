/**
 * UI for managing granular ACLs.
 */
import {aclColumnList} from 'app/client/aclui/ACLColumnList';
import {aclFormulaEditor} from 'app/client/aclui/ACLFormulaEditor';
import {aclSelect} from 'app/client/aclui/ACLSelect';
import {ACLUsersPopup} from 'app/client/aclui/ACLUsers';
import {PermissionKey, permissionsWidget} from 'app/client/aclui/PermissionsWidget';
import {GristDoc} from 'app/client/components/GristDoc';
import {reportError, UserError} from 'app/client/models/errors';
import {TableData} from 'app/client/models/TableData';
import {shadowScroll} from 'app/client/ui/shadowScroll';
import {bigBasicButton, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {colors, testId} from 'app/client/ui2018/cssVars';
import {textInput} from 'app/client/ui2018/editableLabel';
import {cssIconButton, icon} from 'app/client/ui2018/icons';
import {IOptionFull, menu, menuItemAsync} from 'app/client/ui2018/menus';
import {emptyPermissionSet} from 'app/common/ACLPermissions';
import {PartialPermissionSet, permissionSetToText} from 'app/common/ACLPermissions';
import {ACLRuleCollection} from 'app/common/ACLRuleCollection';
import {BulkColValues, RowRecord, UserAction} from 'app/common/DocActions';
import {RulePart, RuleSet, UserAttributeRule} from 'app/common/GranularAccessClause';
import {isHiddenCol} from 'app/common/gristTypes';
import {isObject} from 'app/common/gutil';
import {SchemaTypes} from 'app/common/schema';
import {BaseObservable, Computed, Disposable, MutableObsArray, obsArray, Observable} from 'grainjs';
import {dom, DomElementArg, styled} from 'grainjs';
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

// Option for UserAttribute select() choices. RuleIndex is used to filter for only those user
// attributes made available by the previous rules.
interface IAttrOption extends IOptionFull<string> {
  ruleIndex: number;
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

  // Array of all UserAttribute rules.
  private _userAttrRules = this.autoDispose(obsArray<ObsUserAttributeRule>());

  // Array of all user-attribute choices created by UserAttribute rules. Used for lookup items in
  // rules, and for ACLFormula completions.
  private _userAttrChoices: Computed<IAttrOption[]>;

  // Whether the save button should be enabled.
  private _savingEnabled: Computed<boolean>;

  // Error or warning message to show next to Save/Reset buttons if non-empty.
  private _errorMessage = Observable.create(this, '');

  // Map of tableId to the list of columns for all tables in the document.
  private _aclResources: {[tableId: string]: string[]} = {};

  private _aclUsersPopup = ACLUsersPopup.create(this);

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

    this._userAttrChoices = Computed.create(this, this._userAttrRules, (use, rules) => {
      const result: IAttrOption[] = [
        {ruleIndex: -1, value: 'Access', label: 'user.Access'},
        {ruleIndex: -1, value: 'Email', label: 'user.Email'},
        {ruleIndex: -1, value: 'UserID', label: 'user.UserID'},
        {ruleIndex: -1, value: 'Name', label: 'user.Name'},
        {ruleIndex: -1, value: 'Link', label: 'user.Link'},
        {ruleIndex: -1, value: 'Origin', label: 'user.Origin'},
      ];
      for (const [i, rule] of rules.entries()) {
        const tableId = use(rule.tableId);
        const name = use(rule.name);
        for (const colId of this.getValidColIds(tableId) || []) {
          result.push({ruleIndex: i, value: `${name}.${colId}`, label: `user.${name}.${colId}`});
        }
      }
      return result;
    });

    // The UI in this module isn't really dynamic (that would be tricky while allowing unsaved
    // changes). Instead, react deliberately if rules change. Note that table/column renames would
    // trigger changes to rules, so we don't need to listen for those separately.
    for (const tableId of ['_grist_ACLResources', '_grist_ACLRules']) {
      const tableData = this._gristDoc.docData.getTable(tableId)!;
      this.autoDispose(tableData.tableActionEmitter.addListener(this._onChange, this));
    }

    this.update().catch((e) => this._errorMessage.set(e.message));
  }

  public _onChange() {
    if (this._ruleStatus.get() === RuleStatus.Unchanged) {
      // If no changes, it's safe to just reload the rules from docData.
      this.update().catch((e) => this._errorMessage.set(e.message));
    } else {
      this._errorMessage.set(
        'Access rules have changed. Click Reset to revert your changes and refresh the rules.'
      );
    }
  }

  public get allTableIds() { return Object.keys(this._aclResources).sort(); }
  public get userAttrRules() { return this._userAttrRules; }
  public get userAttrChoices() { return this._userAttrChoices; }

  /**
   * Replace internal state from the rules in DocData.
   */
  public async update() {
    this._errorMessage.set('');
    const rules = this._ruleCollection;
    [ , , this._aclResources] = await Promise.all([
      rules.update(this._gristDoc.docData, {log: console}),
      this._aclUsersPopup.init(this._gristDoc.docPageModel),
      this._gristDoc.docComm.getAclResources(),
    ]);

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

    const docData = this._gristDoc.docData;
    const resourcesTable = docData.getTable('_grist_ACLResources')!;
    const rulesTable = docData.getTable('_grist_ACLRules')!;

    // Add/remove resources to have just the ones we need.
    const newResources: RowRecord[] = flatten(
      [{tableId: '*', colIds: '*'}], ...this._tableRules.get().map(t => t.getResources()))
      .map(r => ({id: -1, ...r}));

    // Prepare userActions and a mapping of serializedResource to rowIds.
    const resourceSync = syncRecords(resourcesTable, newResources, serializeResource);

    // For syncing rules, we'll go by rowId that we store with each RulePart and with the RuleSet.
    const newRules: RowRecord[] = [];
    for (const rule of this.getRules()) {
      // We use id of 0 internally to mark built-in rules. Skip those.
      if (rule.id === 0) {
        continue;
      }

      // Look up the rowId for the resource.
      const resourceKey = serializeResource(rule.resourceRec as RowRecord);
      const resourceRowId = resourceSync.rowIdMap.get(resourceKey);
      if (!resourceRowId) {
        throw new Error(`Resource missing in resource map: ${resourceKey}`);
      }
      newRules.push({
        id: rule.id || -1,
        resource: resourceRowId,
        aclFormula: rule.aclFormula!,
        permissionsText: rule.permissionsText!,
        rulePos: rule.rulePos || null,
      });
    }

    // UserAttribute rules are listed in the same rulesTable.
    const defaultResourceRowId = resourceSync.rowIdMap.get(serializeResource({id: -1, tableId: '*', colIds: '*'}));
    if (!defaultResourceRowId) {
      throw new Error('Default resource missing in resource map');
    }
    for (const userAttr of this._userAttrRules.get()) {
      const rule = userAttr.getRule();
      newRules.push({
        id: rule.id || -1,
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
          newRules[k].rulePos = lastGoodRulePos + step * (k - lastGoodIndex);
        }
        lastGoodRulePos = pos;
        lastGoodIndex = i;
      }
    }
    // Fill in the rulePos values for the remaining rules.
    for (let k = lastGoodIndex + 1; k < newRules.length; k++) {
      newRules[k].rulePos = ++lastGoodRulePos;
    }
    // Prepare the UserActions for syncing the Rules table.
    const rulesSync = syncRecords(rulesTable, newRules);

    // Finally collect and apply all the actions together.
    try {
      await docData.sendActions([...resourceSync.userActions, ...rulesSync.userActions]);
    } catch (e) {
      // Report the error, but go on to update the rules. The user may lose their entries, but
      // will see what's in the document. To preserve entries and show what's wrong, we try to
      // catch errors earlier.
      reportError(e);
    }

    // Re-populate the state from DocData once the records are synced.
    await this.update();
  }

  public buildDom() {
    return cssOuter(
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
        bigBasicButton('Reset', dom.show(use => use(this._ruleStatus) !== RuleStatus.Unchanged),
          dom.on('click', () => this.update()),
          testId('rules-revert'),
        ),

        bigBasicButton('Add Table Rules', cssDropdownIcon('Dropdown'), {style: 'margin-left: auto'},
          menu(() =>
            this.allTableIds.map((tableId) =>
              // Add the table on a timeout, to avoid disabling the clicked menu item
              // synchronously, which prevents the menu from closing on click.
              menuItemAsync(() => this._addTableRules(tableId),
                tableId,
                dom.cls('disabled', (use) => use(this._tableRules).some(t => t.tableId === tableId)),
              )
            ),
          ),
        ),
        bigBasicButton('Add User Attributes', dom.on('click', () => this._addUserAttributes())),
        bigBasicButton('Users', cssDropdownIcon('Dropdown'), elem => this._aclUsersPopup.attachPopup(elem),
          dom.style('visibility', use => use(this._aclUsersPopup.isInitialized) ? '' : 'hidden'),
        ),
      ),
      cssConditionError(dom.text(this._errorMessage), {style: 'margin-left: 16px'},
        testId('access-rules-error')
      ),
      shadowScroll(
        dom.maybe(use => use(this._userAttrRules).length, () =>
          cssSection(
            cssSectionHeading('User Attributes'),
            cssTableRounded(
              cssTableHeaderRow(
                cssCell1(cssCell.cls('-rborder'), cssCell.cls('-center'), cssColHeaderCell('Name')),
                cssCell4(
                  cssColumnGroup(
                    cssCell1(cssColHeaderCell('Attribute to Look Up')),
                    cssCell1(cssColHeaderCell('Lookup Table')),
                    cssCell1(cssColHeaderCell('Lookup Column')),
                    cssCellIcon(),
                  ),
                ),
              ),
              dom.forEach(this._userAttrRules, (userAttr) => userAttr.buildUserAttrDom()),
            ),
          ),
        ),
        dom.forEach(this._tableRules, (tableRules) => tableRules.buildDom()),
        cssSection(
          cssSectionHeading('Default Rules'),
          cssTableRounded(
            cssTableHeaderRow(
              cssCell1(cssCell.cls('-rborder'), cssCell.cls('-center'), cssColHeaderCell('Columns')),
              cssCell4(
                cssColumnGroup(
                  cssCellIcon(),
                  cssCell2(cssColHeaderCell('Condition')),
                  cssCell1(cssColHeaderCell('Permissions')),
                  cssCellIcon(),
                )
              )
            ),
            dom.maybe(this._docDefaultRuleSet, ruleSet => ruleSet.buildRuleSetDom()),
          )
        )
      ),
    );
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

  // Check if the given tableId, and optionally a list of colIds, are present in this document.
  // Returns '' if valid, or an error string if not. Exempt colIds will not trigger an error.
  public checkTableColumns(tableId: string, colIds?: string[], exemptColIds?: string[]): string {
    if (!tableId) { return ''; }
    const tableColIds = this._aclResources[tableId];
    if (!tableColIds) { return `Invalid table: ${tableId}`; }
    if (colIds) {
      const validColIds = new Set([...tableColIds, ...exemptColIds || []]);
      const invalidColIds = colIds.filter(c => !validColIds.has(c));
      if (invalidColIds.length === 0) { return ''; }
      return `Invalid columns in table ${tableId}: ${invalidColIds.join(', ')}`;
    }
    return '';
  }

  // Returns a list of valid colIds for the given table, or undefined if the table isn't valid.
  public getValidColIds(tableId: string): string[]|undefined {
    return this._aclResources[tableId]?.filter(id => !isHiddenCol(id)).sort();
  }

  private _addTableRules(tableId: string) {
    if (this._tableRules.get().some(t => t.tableId === tableId)) {
      throw new Error(`Trying to add TableRules for existing table ${tableId}`);
    }
    const defRuleSet: RuleSet = {tableId, colIds: '*', body: []};
    this._tableRules.push(TableRules.create(this._tableRules, tableId, this, undefined, defRuleSet));
  }

  private _addUserAttributes() {
    this._userAttrRules.push(ObsUserAttributeRule.create(this._userAttrRules, this, undefined, {focus: true}));
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
    return cssSection(
      cssSectionHeading(
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
      cssTableRounded(
        cssTableHeaderRow(
          cssCell1(cssCell.cls('-rborder'), cssCell.cls('-center'), cssColHeaderCell('Columns')),
          cssCell4(
            cssColumnGroup(
              cssCellIcon(),
              cssCell2(cssColHeaderCell('Condition')),
              cssCell1(cssColHeaderCell('Permissions')),
              cssCellIcon(),
            )
          ),
        ),
        dom.forEach(this._columnRuleSets, ruleSet => ruleSet.buildRuleSetDom()),
        dom.maybe(this._defaultRuleSet, ruleSet => ruleSet.buildRuleSetDom()),
      ),
      dom.forEach(this._columnRuleSets, c => cssConditionError(dom.text(c.formulaError))),
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

  // List of individual rule parts for this entity. The default permissions may be included as the
  // last rule part, with an empty aclFormula.
  private _body = this.autoDispose(obsArray<ObsRulePart>());

  // ruleSet is omitted for a new ObsRuleSet added by the user.
  constructor(public accessRules: AccessRules, protected _tableRules: TableRules|null, private _ruleSet?: RuleSet) {
    super();
    if (this._ruleSet) {
      this._body.set(this._ruleSet.body.map(part => ObsRulePart.create(this._body, this, part)));
    } else {
      // If creating a new RuleSet, start with just a default permission part.
      this._body.set([ObsRulePart.create(this._body, this, undefined)]);
    }

    this.ruleStatus = Computed.create(this, this._body, (use, body) => {
      // If anything was changed or added, some part.ruleStatus will be other than Unchanged. If
      // there were only removals, then body.length will have changed.
      return Math.max(
        getChangedStatus(body.length < (this._ruleSet?.body?.length || 0)),
        ...body.map(part => use(part.ruleStatus)));
    });
  }

  public getRules(tableId: string): RuleRec[] {
    // Return every part in the body, tacking on resourceRec to each rule.
    return this._body.get().map(part => ({
      ...part.getRulePart(),
      resourceRec: {tableId, colIds: this.getColIds()}
    }))
    // Skip entirely empty rule parts: they are invalid and dropping them is the best fix.
    .filter(part => part.aclFormula || part.permissionsText);
  }

  public getColIds(): string {
    return '*';
  }

  public abstract buildResourceDom(): DomElementArg;

  public buildRuleSetDom() {
    return cssTableRow(
      cssCell1(cssCell.cls('-rborder'),
        this.buildResourceDom(),
        testId('rule-resource')
      ),
      cssCell4(cssRuleBody.cls(''),
        dom.forEach(this._body, part => part.buildRulePartDom()),
      ),
      testId('rule-set'),
    );
  }

  public removeRulePart(rulePart: ObsRulePart) {
    removeItem(this._body, rulePart);
    if (this._body.get().length === 0) {
      this._tableRules?.removeRuleSet(this);
    }
  }

  public addRulePart(beforeRule: ObsRulePart) {
    const i = this._body.get().indexOf(beforeRule);
    this._body.splice(i, 0, ObsRulePart.create(this._body, this, undefined));
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

  /**
   * Which permission bits to allow the user to set.
   */
  public getAvailableBits(): PermissionKey[] {
    if (this._tableRules) {
      return ['read', 'update', 'create', 'delete'];
    } else {
      // For the doc-wide rule set, expose the schemaEdit bit too.
      return ['read', 'update', 'create', 'delete', 'schemaEdit'];
    }
  }

  /**
   * Get valid colIds for the table that this RuleSet is for.
   */
  public getValidColIds(): string[] {
    const tableId = this._tableRules?.tableId;
    return (tableId && this.accessRules.getValidColIds(tableId)) || [];
  }
}

class ColumnObsRuleSet extends ObsRuleSet {
  // Error message for this rule set, or '' if valid.
  public formulaError: Computed<string>;

  private _colIds = Observable.create<string[]>(this, this._initialColIds);

  constructor(accessRules: AccessRules, tableRules: TableRules, ruleSet: RuleSet|undefined,
              private _initialColIds: string[]) {
    super(accessRules, tableRules, ruleSet);

    this.formulaError = Computed.create(this, (use) => {
      // Exempt existing colIds from checks, by including as a third argument.
      return accessRules.checkTableColumns(tableRules.tableId, use(this._colIds), this._initialColIds);
    });

    const baseRuleStatus = this.ruleStatus;
    this.ruleStatus = Computed.create(this, (use) => {
      if (use(this.formulaError)) { return RuleStatus.Invalid; }
      return Math.max(
        getChangedStatus(!isEqual(use(this._colIds), this._initialColIds)),
        use(baseRuleStatus));
    });
  }

  public buildResourceDom() {
    return aclColumnList(this._colIds, this.getValidColIds());
  }

  public getColIdList(): string[] {
    return this._colIds.get();
  }

  public getColIds(): string {
    return this._colIds.get().join(",");
  }

  public getAvailableBits(): PermissionKey[] {
    // Create/Delete bits can't be set on a column-specific rule.
    return ['read', 'update'];
  }
}

class DefaultObsRuleSet extends ObsRuleSet {
  constructor(accessRules: AccessRules, tableRules: TableRules|null,
              private _haveColumnRules?: Observable<boolean>, ruleSet?: RuleSet) {
    super(accessRules, tableRules, ruleSet);
  }
  public buildResourceDom() {
    return [
      cssCenterContent.cls(''),
      cssDefaultLabel(
        dom.text(use => this._haveColumnRules && use(this._haveColumnRules) ? 'All Other' : 'All'),
      )
    ];
  }
}

class ObsUserAttributeRule extends Disposable {
  public ruleStatus: Computed<RuleStatus>;

  // If the rule failed validation, the error message to show. Blank if valid.
  public formulaError: Computed<string>;

  private _name = Observable.create<string>(this, this._userAttr?.name || '');
  private _tableId = Observable.create<string>(this, this._userAttr?.tableId || '');
  private _lookupColId = Observable.create<string>(this, this._userAttr?.lookupColId || '');
  private _charId = Observable.create<string>(this, this._userAttr?.charId || '');
  private _validColIds = Computed.create(this, this._tableId, (use, tableId) =>
    this._accessRules.getValidColIds(tableId) || []);

  private _userAttrChoices: Computed<IAttrOption[]>;

  constructor(private _accessRules: AccessRules, private _userAttr?: UserAttributeRule,
              private _options: {focus?: boolean} = {}) {
    super();
    this.formulaError = Computed.create(this, this._tableId, this._lookupColId, (use, tableId, colId) => {
      // Don't check for errors if it's an existing rule and hasn't changed.
      if (use(this._tableId) === this._userAttr?.tableId &&
          use(this._lookupColId) === this._userAttr?.lookupColId) {
        return '';
      }
      return _accessRules.checkTableColumns(tableId, colId ? [colId] : undefined);
    });
    this.ruleStatus = Computed.create(this, use => {
      if (use(this.formulaError)) { return RuleStatus.Invalid; }
      return getChangedStatus(
        use(this._name) !== this._userAttr?.name ||
        use(this._tableId) !== this._userAttr?.tableId ||
        use(this._lookupColId) !== this._userAttr?.lookupColId ||
        use(this._charId) !== this._userAttr?.charId
      );
    });

    // Reset lookupColId when tableId changes, since a colId from a different table would usually be wrong
    this.autoDispose(this._tableId.addListener(() => this._lookupColId.set('')));

    this._userAttrChoices = Computed.create(this, _accessRules.userAttrRules, (use, rules) => {
      // Filter for only those choices created by previous rules.
      const index = rules.indexOf(this);
      const result = use(this._accessRules.userAttrChoices).filter(c => (c.ruleIndex < index));

      // If the currently-selected option isn't one of the choices, insert it too.
      const charId = use(this._charId);
      if (charId && !result.some(choice => (choice.value === charId))) {
        result.unshift({ruleIndex: -1, value: charId, label: `user.${charId}`});
      }
      return result;
    });
  }

  public get name() { return this._name; }
  public get tableId() { return this._tableId; }

  public buildUserAttrDom() {
    return cssTableRow(
      cssCell1(cssCell.cls('-rborder'),
        cssCellContent(
          cssInput(this._name, async (val) => this._name.set(val),
            {placeholder: 'Attribute name'},
            (this._options.focus ? (elem) => { setTimeout(() => elem.focus(), 0); } : null),
            testId('rule-userattr-name'),
          ),
        ),
      ),
      cssCell4(cssRuleBody.cls(''),
        cssColumnGroup(
          cssCell1(
            aclSelect(this._charId, this._userAttrChoices,
              {defaultLabel: '[Select Attribute]'}),
            testId('rule-userattr-attr'),
          ),
          cssCell1(
            aclSelect(this._tableId, this._accessRules.allTableIds,
              {defaultLabel: '[Select Table]'}),
            testId('rule-userattr-table'),
          ),
          cssCell1(
            aclSelect(this._lookupColId, this._validColIds,
              {defaultLabel: '[Select Column]'}),
            testId('rule-userattr-col'),
          ),
          cssCellIcon(
            cssIconButton(icon('Remove'),
              dom.on('click', () => this._accessRules.removeUserAttributes(this)))
          ),
          dom.maybe(this.formulaError, (msg) => cssConditionError(msg, testId('rule-error'))),
        ),
      ),
      testId('rule-userattr'),
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

  // Formula to show in the formula editor.
  private _aclFormula = Observable.create<string>(this, this._rulePart?.aclFormula || "");

  // Rule-specific completions for editing the formula, e.g. "user.Email" or "rec.City".
  private _completions = Computed.create<string[]>(this, (use) => [
    ...use(this._ruleSet.accessRules.userAttrChoices).map(opt => opt.label),
    ...this._ruleSet.getValidColIds().map(colId => `rec.${colId}`),
  ]);

  // The permission bits.
  private _permissions = Observable.create<PartialPermissionSet>(
    this, this._rulePart?.permissions || emptyPermissionSet());

  // Whether the rule is being checked after a change. Saving will wait for such checks to finish.
  private _checkPending = Observable.create(this, false);

  // If the formula failed validation, the error message to show. Blank if valid.
  private _formulaError = Observable.create(this, '');

  // Error message if any validation failed.
  private _error: Computed<string>;

  // rulePart is omitted for a new ObsRulePart added by the user.
  constructor(private _ruleSet: ObsRuleSet, private _rulePart?: RulePart) {
    super();
    this._error = Computed.create(this, (use) => {
      return use(this._formulaError) ||
        ( !this._ruleSet.isLastCondition(use, this) &&
          use(this._aclFormula) === '' &&
          permissionSetToText(use(this._permissions)) !== '' ?
          'Condition cannot be blank' : ''
        );
    });

    this.ruleStatus = Computed.create(this, (use) => {
      if (use(this._error)) { return RuleStatus.Invalid; }
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

  public buildRulePartDom() {
    return cssColumnGroup(
      cssCellIcon(
        (this._isNonFirstBuiltIn() ?
          null :
          cssIconButton(icon('Plus'),
            dom.on('click', () => this._ruleSet.addRulePart(this)),
            testId('rule-add'),
          )
        ),
      ),
      cssCell2(
        aclFormulaEditor({
          initialValue: this._aclFormula.get(),
          readOnly: this.isBuiltIn(),
          setValue: (value) => this._setAclFormula(value),
          placeholder: dom.text((use) => {
            return (
              this._ruleSet.isSoleCondition(use, this) ? 'Everyone' :
              this._ruleSet.isLastCondition(use, this) ? 'Everyone Else' :
              'Enter Condition'
            );
          }),
          getSuggestions: (prefix) => this._completions.get(),
        }),
        testId('rule-acl-formula'),
      ),
      cssCell1(cssCell.cls('-stretch'),
        permissionsWidget(this._ruleSet.getAvailableBits(), this._permissions,
          {disabled: this.isBuiltIn()},
          testId('rule-permissions')
        ),
      ),
      cssCellIcon(
        (this.isBuiltIn() ?
          null :
          cssIconButton(icon('Remove'),
            dom.on('click', () => this._ruleSet.removeRulePart(this)),
            testId('rule-remove'),
          )
        ),
      ),
      dom.maybe(this._error, (msg) => cssConditionError(msg, testId('rule-error'))),
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
    if (text === this._aclFormula.get()) { return; }
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
 * Produce UserActions to create/update/remove records, to replace data in tableData
 * with newRecords. Records are matched on uniqueId(record), which defaults to returning
 * String(record.id). UniqueIds of new records don't need to be unique as long as they don't
 * overlap with uniqueIds of existing records.
 *
 * Return also a rowIdMap, mapping uniqueId(record) to a rowId used in the actions. The rowIds may
 * include negative values (auto-generated when newRecords doesn't include one). These may be used
 * in Reference values within the same action bundle.
 *
 * TODO This is a general-purpose function, and should live in a separate module.
 */
function syncRecords(tableData: TableData, newRecords: RowRecord[],
                     uniqueId: (r: RowRecord) => string = (r => String(r.id))
): {userActions: UserAction[], rowIdMap: Map<string, number>} {
  const oldRecords = tableData.getRecords();
  const rowIdMap = new Map<string, number>(oldRecords.map(r => [uniqueId(r), r.id]));
  const newRecordMap = new Map<string, RowRecord>(newRecords.map(r => [uniqueId(r), r]));

  const removedRecords: RowRecord[] = oldRecords.filter(r => !newRecordMap.has(uniqueId(r)));

  // Generate a unique negative rowId for each added record.
  const addedRecords: RowRecord[] = newRecords.filter(r => !rowIdMap.has(uniqueId(r)))
    .map((r, index) => ({...r, id: -(index + 1)}));

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

  const tableId = tableData.tableId;
  const userActions: UserAction[] = [];
  if (removedRecords.length > 0) {
    userActions.push(['BulkRemoveRecord', tableId, removedRecords.map(r => r.id)]);
  }
  if (updatedRecords.length > 0) {
    userActions.push(['BulkUpdateRecord', tableId, updatedRecords.map(([r]) => r.id), getColChanges(updatedRecords)]);
  }
  if (addedRecords.length > 0) {
    userActions.push(['BulkAddRecord', tableId, addedRecords.map(r => r.id), getColValues(addedRecords)]);
  }

  // Include generated rowIds for added records into the returned map.
  addedRecords.forEach(r => rowIdMap.set(uniqueId(r), r.id));
  return {userActions, rowIdMap};
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

const cssOuter = styled('div', `
  flex: auto;
  height: 100%;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
`);

const cssAddTableRow = styled('div', `
  flex: none;
  margin: 16px 16px 8px 16px;
  display: flex;
  gap: 16px;
`);

const cssDropdownIcon = styled(icon, `
  margin: -2px -2px 0 4px;
`);

const cssSection = styled('div', `
  margin: 16px 16px 24px 16px;
`);

const cssSectionHeading = styled('div', `
  display: flex;
  align-items: center;
  margin-bottom: 8px;
  font-weight: bold;
  color: ${colors.slate};
`);

const cssTableName = styled('span', `
  color: ${colors.dark};
`);

const cssInput = styled(textInput, `
  width: 100%;
  border: 1px solid transparent;
  cursor: pointer;

  &:hover {
    border: 1px solid ${colors.darkGrey};
  }
  &:focus {
    box-shadow: inset 0 0 0 1px ${colors.cursor};
    border-color: ${colors.cursor};
    cursor: unset;
  }
  &[disabled] {
    color: ${colors.dark};
    background-color: ${colors.mediumGreyOpaque};
    box-shadow: unset;
    border-color: transparent;
  }
`);

const cssConditionError = styled('div', `
  margin-top: 4px;
  width: 100%;
  color: ${colors.error};
`);

/**
 * Fairly general table styles.
 */
const cssTableRounded = styled('div', `
  border: 1px solid ${colors.slate};
  border-radius: 8px;
  overflow: hidden;
`);

// Row with a border
const cssTableRow = styled('div', `
  display: flex;
  border-bottom: 1px solid ${colors.slate};
  &:last-child {
    border-bottom: none;
  }
`);

// Darker table header
const cssTableHeaderRow = styled(cssTableRow, `
  background-color: ${colors.mediumGrey};
  color: ${colors.dark};
`);

// Cell for table column header.
const cssColHeaderCell = styled('div', `
  margin: 4px 8px;
  text-transform: uppercase;
  font-weight: 500;
  font-size: 10px;
`);

// General table cell.
const cssCell = styled('div', `
  min-width: 0px;
  overflow: hidden;

  &-rborder {
    border-right: 1px solid ${colors.slate};
  }
  &-center {
    text-align: center;
  }
  &-stretch {
    min-width: unset;
    overflow: visible;
  }
`);

// Variations on columns of different widths.
const cssCellIcon = styled(cssCell, `flex: none; width: 24px;`);
const cssCell1 = styled(cssCell, `flex: 1;`);
const cssCell2 = styled(cssCell, `flex: 2;`);
const cssCell4 = styled(cssCell, `flex: 4;`);

// Group of columns, which may be placed inside a cell.
const cssColumnGroup = styled('div', `
  display: flex;
  align-items: center;
  gap: 0px 8px;
  margin: 0 8px;
  flex-wrap: wrap;
`);

const cssRuleBody = styled('div', `
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 4px 0;
`);

const cssCellContent = styled('div', `
  margin: 4px 8px;
`);

const cssCenterContent = styled('div', `
  display: flex;
  align-items: center;
  justify-content: center;
`);

const cssDefaultLabel = styled('div', `
  color: ${colors.slate};
  font-weight: bold;
`);
