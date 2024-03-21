/**
 * UI for managing granular ACLs.
 */
import {aclColumnList} from 'app/client/aclui/ACLColumnList';
import {aclFormulaEditor} from 'app/client/aclui/ACLFormulaEditor';
import {aclMemoEditor} from 'app/client/aclui/ACLMemoEditor';
import {aclSelect} from 'app/client/aclui/ACLSelect';
import {ACLUsersPopup} from 'app/client/aclui/ACLUsers';
import {permissionsWidget} from 'app/client/aclui/PermissionsWidget';
import {GristDoc} from 'app/client/components/GristDoc';
import {logTelemetryEvent} from 'app/client/lib/telemetry';
import {reportError, UserError} from 'app/client/models/errors';
import {TableData} from 'app/client/models/TableData';
import {withInfoTooltip} from 'app/client/ui/tooltips';
import {shadowScroll} from 'app/client/ui/shadowScroll';
import {bigBasicButton, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {squareCheckbox} from 'app/client/ui2018/checkbox';
import {testId, theme} from 'app/client/ui2018/cssVars';
import {textInput} from 'app/client/ui2018/editableLabel';
import {cssIconButton, icon} from 'app/client/ui2018/icons';
import {menu, menuItemAsync} from 'app/client/ui2018/menus';
import {
  AVAILABLE_BITS_COLUMNS,
  AVAILABLE_BITS_TABLES,
  emptyPermissionSet,
  MixedPermissionValue,
  parsePermissions,
  PartialPermissionSet,
  PermissionKey,
  permissionSetToText,
  summarizePermissions,
  summarizePermissionSet,
  trimPermissions
} from 'app/common/ACLPermissions';
import {ACLRuleCollection, isSchemaEditResource, SPECIAL_RULES_TABLE_ID} from 'app/common/ACLRuleCollection';
import {AclRuleProblem, AclTableDescription, getTableTitle} from 'app/common/ActiveDocAPI';
import {BulkColValues, getColValues, RowRecord, UserAction} from 'app/common/DocActions';
import {
  FormulaProperties,
  getFormulaProperties,
  RulePart,
  RuleSet,
  UserAttributeRule
} from 'app/common/GranularAccessClause';
import {isHiddenCol} from 'app/common/gristTypes';
import {isNonNullish, unwrap} from 'app/common/gutil';
import {SchemaTypes} from 'app/common/schema';
import {MetaRowRecord} from 'app/common/TableData';
import {
  BaseObservable,
  Computed,
  Disposable,
  dom,
  DomContents,
  DomElementArg,
  IDisposableOwner,
  MutableObsArray,
  obsArray,
  Observable,
  styled
} from 'grainjs';
import {makeT} from 'app/client/lib/localization';
import isEqual = require('lodash/isEqual');

const t = makeT('AccessRules');

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

// UserAttribute autocomplete choices. RuleIndex is used to filter for only those user
// attributes made available by the previous rules.
interface IAttrOption {
  ruleIndex: number;
  value: string;
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

  // Special document-level rules, for resources of the form ("*SPECIAL:<RuleType>").
  // These rules are shown in different places - currently most are shown as a separate
  // section, and one is folded into the default rule section (for SeedRule).
  private _specialRulesWithDefault = Observable.create<SpecialRules|null>(this, null);
  private _specialRulesSeparate = Observable.create<SpecialRules|null>(this, null);

  // Array of all UserAttribute rules.
  private _userAttrRules = this.autoDispose(obsArray<ObsUserAttributeRule>());

  // Array of all user-attribute choices created by UserAttribute rules. Used for lookup items in
  // rules, and for ACLFormula completions.
  private _userAttrChoices: Computed<IAttrOption[]>;

  // Whether the save button should be enabled.
  private _savingEnabled: Computed<boolean>;

  // Error or warning message to show next to Save/Reset buttons if non-empty.
  private _errorMessage = Observable.create(this, '');

  // Details of rule problems, for offering solutions to the user.
  private _ruleProblems = this.autoDispose(obsArray<AclRuleProblem>());

  // Map of tableId to basic metadata for all tables in the document.
  private _aclResources = new Map<string, AclTableDescription>();

  private _aclUsersPopup = ACLUsersPopup.create(this, this.gristDoc.docPageModel);

  constructor(public gristDoc: GristDoc) {
    super();
    this._ruleStatus = Computed.create(this, (use) => {
      const defRuleSet = use(this._docDefaultRuleSet);
      const tableRules = use(this._tableRules);
      const specialRulesWithDefault = use(this._specialRulesWithDefault);
      const specialRulesSeparate = use(this._specialRulesSeparate);
      const userAttr = use(this._userAttrRules);
      return Math.max(
        defRuleSet ? use(defRuleSet.ruleStatus) : RuleStatus.Unchanged,
        // If any tables/userAttrs were changed or added, they will be considered changed. If
        // there were only removals, then length will be reduced.
        getChangedStatus(tableRules.length < this._ruleCollection.getAllTableIds().length),
        getChangedStatus(userAttr.length < this._ruleCollection.getUserAttributeRules().size),
        ...tableRules.map(tr => use(tr.ruleStatus)),
        ...userAttr.map(u => use(u.ruleStatus)),
        specialRulesWithDefault ? use(specialRulesWithDefault.ruleStatus) : RuleStatus.Unchanged,
        specialRulesSeparate ? use(specialRulesSeparate.ruleStatus) : RuleStatus.Unchanged,
      );
    });

    this._savingEnabled = Computed.create(this, this._ruleStatus, (use, s) =>
      (s === RuleStatus.ChangedValid));

    this._userAttrChoices = Computed.create(this, this._userAttrRules, (use, rules) => {
      const result: IAttrOption[] = [
        {ruleIndex: -1, value: 'user.Access'},
        {ruleIndex: -1, value: 'user.Email'},
        {ruleIndex: -1, value: 'user.UserID'},
        {ruleIndex: -1, value: 'user.Name'},
        {ruleIndex: -1, value: 'user.LinkKey.'},
        {ruleIndex: -1, value: 'user.Origin'},
        {ruleIndex: -1, value: 'user.SessionID'},
        {ruleIndex: -1, value: 'user.IsLoggedIn'},
        {ruleIndex: -1, value: 'user.UserRef'},
      ];
      for (const [i, rule] of rules.entries()) {
        const tableId = use(rule.tableId);
        const name = use(rule.name);
        for (const colId of this.getValidColIds(tableId) || []) {
          result.push({ruleIndex: i, value: `user.${name}.${colId}`});
        }
      }
      return result;
    });

    // The UI in this module isn't really dynamic (that would be tricky while allowing unsaved
    // changes). Instead, react deliberately if rules change. Note that table/column renames would
    // trigger changes to rules, so we don't need to listen for those separately.
    for (const tableId of ['_grist_ACLResources', '_grist_ACLRules']) {
      const tableData = this.gristDoc.docData.getTable(tableId)!;
      this.autoDispose(tableData.tableActionEmitter.addListener(this._onChange, this));
    }
    this.autoDispose(this.gristDoc.docPageModel.currentDoc.addListener(this._updateDocAccessData, this));

    this.update().catch((e) => this._errorMessage.set(e.message));
  }

  public get allTableIds() { return Array.from(this._aclResources.keys()).sort(); }
  public get userAttrRules() { return this._userAttrRules; }
  public get userAttrChoices() { return this._userAttrChoices; }

  public getTableTitle(tableId: string) {
    const table = this._aclResources.get(tableId);
    if (!table) { return `#Invalid (${tableId})`; }
    return getTableTitle(table);
  }

  /**
   * Replace internal state from the rules in DocData.
   */
  public async update() {
    if (this.isDisposed()) { return; }
    this._errorMessage.set('');
    const rules = this._ruleCollection;

    const [ , , aclResources] = await Promise.all([
      rules.update(this.gristDoc.docData, {log: console, pullOutSchemaEdit: true}),
      this._updateDocAccessData(),
      this.gristDoc.docComm.getAclResources(),
    ]);
    this._aclResources = new Map(Object.entries(aclResources.tables));
    this._ruleProblems.set(aclResources.problems);
    if (this.isDisposed()) { return; }

    this._tableRules.set(
      rules.getAllTableIds()
      .filter(tableId => (tableId !== SPECIAL_RULES_TABLE_ID))
      .map(tableId => TableRules.create(this._tableRules,
          tableId, this, rules.getAllColumnRuleSets(tableId), rules.getTableDefaultRuleSet(tableId)))
    );

    const withDefaultRules = ['SeedRule'];
    const separateRules = ['SchemaEdit', 'FullCopies', 'AccessRules'];

    SpecialRules.create(
      this._specialRulesWithDefault, SPECIAL_RULES_TABLE_ID, this,
      filterRuleSets(withDefaultRules, rules.getAllColumnRuleSets(SPECIAL_RULES_TABLE_ID)),
      filterRuleSet(withDefaultRules, rules.getTableDefaultRuleSet(SPECIAL_RULES_TABLE_ID)));
    SpecialRules.create(
      this._specialRulesSeparate, SPECIAL_RULES_TABLE_ID, this,
      filterRuleSets(separateRules, rules.getAllColumnRuleSets(SPECIAL_RULES_TABLE_ID)),
      filterRuleSet(separateRules, rules.getTableDefaultRuleSet(SPECIAL_RULES_TABLE_ID)));
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

    const docData = this.gristDoc.docData;
    const resourcesTable = docData.getMetaTable('_grist_ACLResources');
    const rulesTable = docData.getMetaTable('_grist_ACLRules');

    // Add/remove resources to have just the ones we need.
    const newResources: MetaRowRecord<'_grist_ACLResources'>[] = flatten(
      [{tableId: '*', colIds: '*'}],
      this._specialRulesWithDefault.get()?.getResources() || [],
      this._specialRulesSeparate.get()?.getResources() || [],
      ...this._tableRules.get().map(tr => tr.getResources())
    )
    // Skip the fake "*SPECIAL:SchemaEdit" resource (frontend-specific); these rules are saved to the default resource.
    .filter(resource => !isSchemaEditResource(resource))
    .map(r => ({id: -1, ...r}));

    // Prepare userActions and a mapping of serializedResource to rowIds.
    const resourceSync = syncRecords(resourcesTable, newResources, serializeResource);

    const defaultResourceRowId = resourceSync.rowIdMap.get(serializeResource({id: -1, tableId: '*', colIds: '*'}));
    if (!defaultResourceRowId) {
      throw new Error('Default resource missing in resource map');
    }

    // For syncing rules, we'll go by rowId that we store with each RulePart and with the RuleSet.
    const newRules: RowRecord[] = [];
    for (const rule of this.getRules()) {
      // We use id of 0 internally to mark built-in rules. Skip those.
      if (rule.id === 0) {
        continue;
      }

      // Look up the rowId for the resource.
      let resourceRowId: number|undefined;
      // Assign the rules for the fake "*SPECIAL:SchemaEdit" resource to the default resource where they belong.
      if (isSchemaEditResource(rule.resourceRec!)) {
        resourceRowId = defaultResourceRowId;
      } else {
        const resourceKey = serializeResource(rule.resourceRec as RowRecord);
        resourceRowId = resourceSync.rowIdMap.get(resourceKey);
        if (!resourceRowId) {
          throw new Error(`Resource missing in resource map: ${resourceKey}`);
        }
      }
      newRules.push({
        id: rule.id || -1,
        resource: resourceRowId,
        aclFormula: rule.aclFormula!,
        permissionsText: rule.permissionsText!,
        rulePos: rule.rulePos || null,
        memo: rule.memo ?? '',
      });
    }

    // UserAttribute rules are listed in the same rulesTable.
    for (const userAttr of this._userAttrRules.get()) {
      const rule = userAttr.getRule();
      newRules.push({
        id: rule.id || -1,
        resource: defaultResourceRowId,
        rulePos: rule.rulePos || null,
        userAttributes: rule.userAttributes,
      });
    }

    logTelemetryEvent('changedAccessRules', {
      full: {
        docIdDigest: this.gristDoc.docId(),
        ruleCount: newRules.length,
      },
    });

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
      dom('div', this.gristDoc.behavioralPromptsManager.attachPopup('accessRules', {
        hideArrow: true,
      })),
      cssAddTableRow(
        bigBasicButton({disabled: true}, dom.hide(this._savingEnabled),
          dom.text((use) => {
            const s = use(this._ruleStatus);
            return s === RuleStatus.CheckPending ? t("Checking...") :
              s === RuleStatus.Unchanged ? t("Saved") : t("Invalid");
          }),
          testId('rules-non-save')
        ),
        bigPrimaryButton(t("Save"), dom.show(this._savingEnabled),
          dom.on('click', () => this.save()),
          testId('rules-save'),
        ),
        bigBasicButton(t("Reset"), dom.show(use => use(this._ruleStatus) !== RuleStatus.Unchanged),
          dom.on('click', () => this.update()),
          testId('rules-revert'),
        ),

        bigBasicButton(t("Add Table Rules"), cssDropdownIcon('Dropdown'), {style: 'margin-left: auto'},
          menu(() =>
            this.allTableIds.map((tableId) =>
              // Add the table on a timeout, to avoid disabling the clicked menu item
              // synchronously, which prevents the menu from closing on click.
              menuItemAsync(() => this._addTableRules(tableId),
                this.getTableTitle(tableId),
                dom.cls('disabled', (use) => use(this._tableRules).some(tr => tr.tableId === tableId)),
              )
            ),
          ),
        ),
        bigBasicButton(t('Add User Attributes'), dom.on('click', () => this._addUserAttributes())),
        bigBasicButton(t('View As'), cssDropdownIcon('Dropdown'),
          elem => this._aclUsersPopup.attachPopup(elem, {placement: 'bottom-end', resetDocPage: true}),
          dom.style('visibility', use => use(this._aclUsersPopup.isInitialized) ? '' : 'hidden')),
      ),
      cssConditionError({style: 'margin-left: 16px'},
        dom.text(this._errorMessage),
        testId('access-rules-error')
      ),

      dom.maybe(use => {
        const ruleProblems = use(this._ruleProblems);
        return ruleProblems.length > 0 ? ruleProblems : null;
      }, ruleProblems =>
        cssSection(
          cssRuleProblems(
            this.buildRuleProblemsDom(ruleProblems)))),
      shadowScroll(
        dom.maybe(use => use(this._userAttrRules).length, () =>
          cssSection(
            cssSectionHeading(t("User Attributes")),
            cssTableRounded(
              cssTableHeaderRow(
                cssCell1(cssCell.cls('-rborder'), cssCell.cls('-center'), cssColHeaderCell('Name')),
                cssCell4(
                  cssColumnGroup(
                    cssCell1(cssColHeaderCell(t("Attribute to Look Up"))),
                    cssCell1(cssColHeaderCell(t("Lookup Table"))),
                    cssCell1(cssColHeaderCell(t("Lookup Column"))),
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
          cssSectionHeading(t("Default Rules"), testId('rule-table-header')),
          dom.maybe(this._specialRulesWithDefault, tableRules => cssSeedRule(
            tableRules.buildCheckBoxes())),
          cssTableRounded(
            cssTableHeaderRow(
              cssCell1(cssCell.cls('-rborder'), cssCell.cls('-center'), cssColHeaderCell('Columns')),
              cssCell4(
                cssColumnGroup(
                  cssCellIcon(),
                  cssCell2(cssColHeaderCell(t('Condition'))),
                  cssCell1(cssColHeaderCell(t('Permissions'))),
                  cssCellIconWithMargins(),
                  cssCellIcon(),
                )
              )
            ),
            dom.maybe(this._docDefaultRuleSet, ruleSet => ruleSet.buildRuleSetDom()),
          ),
          testId('rule-table'),
        ),
        dom.maybe(this._specialRulesSeparate, tableRules => tableRules.buildDom()),
      ),
    );
  }

  public buildRuleProblemsDom(ruleProblems: AclRuleProblem[]) {
    const buttons: Array<HTMLAnchorElement | HTMLButtonElement> = [];
    for (const problem of ruleProblems) {
      // Is the problem a missing table?
      if (problem.tables) {
        this._addButtonsForMissingTables(buttons, problem.tables.tableIds);
      }
      // Is the problem a missing column?
      if (problem.columns) {
        this._addButtonsForMissingColumns(buttons, problem.columns.tableId, problem.columns.colIds);
      }
      // Is the problem a misconfigured user attribute?
      if (problem.userAttributes) {
        const names = problem.userAttributes.names;
        this._addButtonsForMisconfiguredUserAttributes(buttons, names);
      }
    }
    return buttons.map(button => dom('span', button));
  }

  /**
   * Get a list of all rule records, for saving.
   */
  public getRules(): RuleRec[] {
    return flatten(
      ...this._tableRules.get().map(tr => tr.getRules()),
      this._specialRulesWithDefault.get()?.getRules() || [],
      this._specialRulesSeparate.get()?.getRules() || [],
      this._docDefaultRuleSet.get()?.getRules('*') || []
    );
  }

  public removeTableRules(tableRules: TableRules) {
    removeItem(this._tableRules, tableRules);
  }

  public removeUserAttributes(userAttr: ObsUserAttributeRule) {
    removeItem(this._userAttrRules, userAttr);
  }

  public async checkAclFormula(text: string): Promise<FormulaProperties> {
    if (text) {
      return this.gristDoc.docComm.checkAclFormula(text);
    }
    return {};
  }

  // Check if the given tableId, and optionally a list of colIds, are present in this document.
  // Returns '' if valid, or an error string if not. Exempt colIds will not trigger an error.
  public checkTableColumns(tableId: string, colIds?: string[], exemptColIds?: string[]): string {
    if (!tableId || tableId === SPECIAL_RULES_TABLE_ID) { return ''; }
    const tableColIds = this._aclResources.get(tableId)?.colIds;
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
    return this._aclResources.get(tableId)?.colIds.filter(id => !isHiddenCol(id)).sort();
  }

  // Get rules to use for seeding any new set of table/column rules, e.g. to give owners
  // broad rights over the table/column contents.
  public getSeedRules(): ObsRulePart[] {
    return this._specialRulesWithDefault.get()?.getCustomRules('SeedRule') || [];
  }

  private _addTableRules(tableId: string) {
    if (this._tableRules.get().some(tr => tr.tableId === tableId)) {
      throw new Error(`Trying to add TableRules for existing table ${tableId}`);
    }
    const defRuleSet: RuleSet = {tableId, colIds: '*', body: []};
    const tableRules = TableRules.create(this._tableRules, tableId, this, undefined, defRuleSet);
    this._tableRules.push(tableRules);
    tableRules.addDefaultRules(this.getSeedRules());
  }

  private _addUserAttributes() {
    this._userAttrRules.push(ObsUserAttributeRule.create(this._userAttrRules, this, undefined, {focus: true}));
  }

  private _onChange() {
    if (this._ruleStatus.get() === RuleStatus.Unchanged) {
      // If no changes, it's safe to just reload the rules from docData.
      this.update().catch((e) => this._errorMessage.set(e.message));
    } else {
      this._errorMessage.set(
        'Access rules have changed. Click Reset to revert your changes and refresh the rules.'
      );
    }
  }

  private async _updateDocAccessData() {
    await this._aclUsersPopup.load();
  }

  private _addButtonsForMissingTables(buttons: Array<HTMLAnchorElement | HTMLButtonElement>, tableIds: string[]) {
    for (const tableId of tableIds) {
      // We don't know what the table's name was, just its tableId.
      // Hopefully, the user will understand.
      const title = t('Remove {{- tableId }} rules', { tableId });
      const button = bigBasicButton(title, cssRemoveIcon('Remove'), dom.on('click', async () => {
        await Promise.all(this._tableRules.get()
          .filter(rules => rules.tableId === tableId)
          .map(rules => rules.remove()));
        button.style.display = 'none';
      }));
      buttons.push(button);
    }
  }

  private _addButtonsForMissingColumns(buttons: Array<HTMLAnchorElement | HTMLButtonElement>,
                                       tableId: string, colIds: string[]) {
    const removeColRules = (rules: TableRules, colId: string) => {
      for (const rule of rules.columnRuleSets.get()) {
        const ruleColIds = new Set(rule.getColIdList());
        if (!ruleColIds.has(colId)) { continue; }
        if (ruleColIds.size === 1) {
          rule.remove();
        } else {
          rule.removeColId(colId);
        }
      }
    };
    for (const colId of colIds) {
      // TODO: we could translate tableId to table name in this case.
      const title = t('Remove column {{- colId }} from {{- tableId }} rules', { tableId, colId });
      const button = bigBasicButton(title, cssRemoveIcon('Remove'), dom.on('click', async () => {
        await Promise.all(this._tableRules.get()
          .filter(rules => rules.tableId === tableId)
          .map(rules => removeColRules(rules, colId)));
        button.style.display = 'none';
      }));
      buttons.push(button);
    }
  }

  private _addButtonsForMisconfiguredUserAttributes(
    buttons: Array<HTMLAnchorElement | HTMLButtonElement>,
    names: string[]
  ) {
    for (const name of names) {
      const title = t('Remove {{- name }} user attribute', {name});
      const button = bigBasicButton(title, cssRemoveIcon('Remove'), dom.on('click', async () => {
        await Promise.all(this._userAttrRules.get()
          .filter(rule => rule.name.get() === name)
          .map(rule => rule.remove()));
        button.style.display = 'none';
      }));
      buttons.push(button);
    }
  }
}

// Represents all rules for a table.
class TableRules extends Disposable {
  // Whether any table rules changed, and if they are valid.
  public ruleStatus: Computed<RuleStatus>;

  // The column-specific rule sets.
  protected _columnRuleSets = this.autoDispose(obsArray<ColumnObsRuleSet>());

  // Whether there are any column-specific rule sets.
  private _haveColumnRules = Computed.create(this, this._columnRuleSets, (use, cols) => cols.length > 0);

  // The default rule set (for columns '*'), if one is set.
  private _defaultRuleSet = Observable.create<DefaultObsRuleSet|null>(this, null);

  constructor(public readonly tableId: string, public _accessRules: AccessRules,
              private _colRuleSets?: RuleSet[], private _defRuleSet?: RuleSet) {
    super();
    this._columnRuleSets.set(this._colRuleSets?.map(rs =>
      this._createColumnObsRuleSet(this._columnRuleSets, this._accessRules, this, rs,
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

  /**
   * Get all custom rules for the specific column. Used to gather the current
   * setting of a special rule. Returns an empty list for unknown columns.
   */
  public getCustomRules(colId: string): ObsRulePart[] {
    for (const ruleSet of this._columnRuleSets.get()) {
      if (ruleSet.getColIds() === colId) {
        return ruleSet.getCustomRules();
      }
    }
    return [];
  }

  /**
   * Add the provided rules, copying their formula, permissions, and memo.
   */
  public addDefaultRules(rules: ObsRulePart[]) {
    const ruleSet = this._defaultRuleSet.get();
    ruleSet?.addRuleParts(rules, {foldEveryoneRule: true});
  }

  public remove() {
    this._accessRules.removeTableRules(this);
  }

  public get columnRuleSets() {
    return this._columnRuleSets;
  }

  public buildDom() {
    return cssSection(
      cssSectionHeading(
        dom('span', t("Rules for table "), cssTableName(this._accessRules.getTableTitle(this.tableId))),
        cssIconButton(icon('Dots'), {style: 'margin-left: auto'},
          menu(() => [
            menuItemAsync(() => this._addColumnRuleSet(), t("Add Column Rule")),
            menuItemAsync(() => this._addDefaultRuleSet(), t("Add Table-wide Rule")),
            menuItemAsync(() => this._accessRules.removeTableRules(this), t("Delete Table Rules")),
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
              cssCell2(cssColHeaderCell(t('Condition'))),
              cssCell1(cssColHeaderCell(t('Permissions'))),
              cssCellIconWithMargins(),
              cssCellIcon(),
            )
          ),
        ),
        this.buildColumnRuleSets(),
      ),
      this.buildErrors(),
      testId('rule-table'),
    );
  }

  public buildColumnRuleSets() {
    return [
      dom.forEach(this._columnRuleSets, ruleSet => ruleSet.buildRuleSetDom()),
      dom.maybe(this._defaultRuleSet, ruleSet => ruleSet.buildRuleSetDom()),
    ];
  }

  public buildErrors() {
    return dom.forEach(this._columnRuleSets, c => cssConditionError(dom.text(c.formulaError)));
  }

  /**
   * Return the resources (tableId:colIds entities), for saving, checking along the way that they
   * are valid.
   */
  public getResources(): ResourceRec[] {
    // Check that the colIds are valid.
    const seen = {
      allow: new Set<string>(),   // columns mentioned in rules that only have 'allow's.
      deny: new Set<string>(),    // columns mentioned in rules that only have 'deny's.
      mixed: new Set<string>()    // columns mentioned in any rules.
    };
    for (const ruleSet of this._columnRuleSets.get()) {
      const sign = ruleSet.summarizePermissions();
      const counterSign = sign === 'mixed' ? 'mixed' : (sign === 'allow' ? 'deny' : 'allow');
      const colIds = ruleSet.getColIdList();
      if (colIds.length === 0) {
        throw new UserError(`No columns listed in a column rule for table ${this.tableId}`);
      }
      for (const colId of colIds) {
        if (seen[counterSign].has(colId)) {
          // There may be an order dependency between rules.  We've done a little analysis, to
          // allow the useful pattern of forbidding all access to columns, and then adding back
          // access to different sets for different teams/conditions (or allowing all access
          // by default, and then forbidding different sets).  But if there's a mix of
          // allows and denies, then we throw up our hands.
          // TODO: could analyze more deeply.  An easy step would be to analyze per permission bit.
          // Could also allow order dependency and provide a way to control the order.
          // TODO: could be worth also flagging multiple rulesets with the same columns as
          // undesirable.
          throw new UserError(`Column ${colId} appears in multiple rules for table ${this.tableId}` +
                              ` that might be order-dependent. Try splitting rules up differently?`);
        }
        if (sign === 'mixed') {
          seen.allow.add(colId);
          seen.deny.add(colId);
          seen.mixed.add(colId);
        } else {
          seen[sign].add(colId);
          seen.mixed.add(colId);
        }
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

  protected _createColumnObsRuleSet(
    owner: IDisposableOwner, accessRules: AccessRules, tableRules: TableRules,
    ruleSet: RuleSet|undefined, initialColIds: string[],
  ): ColumnObsRuleSet {
    return ColumnObsRuleSet.create(owner, accessRules, tableRules, ruleSet, initialColIds);
  }

  private _addColumnRuleSet() {
    const ruleSet = ColumnObsRuleSet.create(this._columnRuleSets, this._accessRules, this, undefined, []);
    this._columnRuleSets.push(ruleSet);
    ruleSet.addRuleParts(this._accessRules.getSeedRules(), {foldEveryoneRule: true});
  }

  private _addDefaultRuleSet() {
    const ruleSet = this._defaultRuleSet.get();
    if (!ruleSet) {
      DefaultObsRuleSet.create(this._defaultRuleSet, this._accessRules, this, this._haveColumnRules);
      this.addDefaultRules(this._accessRules.getSeedRules());
    } else {
      const part = ruleSet.addRulePart(ruleSet.getDefaultCondition());
      setTimeout(() => part.focusEditor?.(), 0);
    }
  }
}

class SpecialRules extends TableRules {
  public buildDom() {
    return cssSection(
      cssSectionHeading(t('Special Rules'), testId('rule-table-header')),
      this.buildCheckBoxes(),
      testId('rule-table'),
    );
  }

  // Build dom with checkboxes, without a section wrapping it.
  // Used for folding a special rule into another section.
  public buildCheckBoxes() {
    return [
      this.buildColumnRuleSets(),
      this.buildErrors(),
    ];
  }

  public getResources(): ResourceRec[] {
    return this._columnRuleSets.get()
      .filter(rs => !rs.hasOnlyBuiltInRules())
      .map(rs => ({tableId: this.tableId, colIds: rs.getColIds()}));
  }

  protected _createColumnObsRuleSet(
    owner: IDisposableOwner, accessRules: AccessRules, tableRules: TableRules,
    ruleSet: RuleSet|undefined, initialColIds: string[],
  ): ColumnObsRuleSet {
    if (isEqual(ruleSet?.colIds, ['SchemaEdit'])) {
      // The special rule for "schemaEdit" permissions.
      return SpecialSchemaObsRuleSet.create(owner, accessRules, tableRules, ruleSet, initialColIds);
    } else {
      return SpecialObsRuleSet.create(owner, accessRules, tableRules, ruleSet, initialColIds);
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
  protected readonly _body = this.autoDispose(obsArray<ObsRulePart>());

  // ruleSet is omitted for a new ObsRuleSet added by the user.
  constructor(public accessRules: AccessRules, protected _tableRules: TableRules|null, private _ruleSet?: RuleSet) {
    super();
    const parts = this._ruleSet?.body.map(part => ObsRulePart.create(this._body, this, part)) || [];
    if (parts.length === 0) {
      // If creating a new RuleSet, or if there are no rules,
      // start with just a default permission part.
      parts.push(ObsRulePart.create(this._body, this, undefined));
    }
    this._body.set(parts);

    this.ruleStatus = Computed.create(this, this._body, (use, body) => {
      // If anything was changed or added, some part.ruleStatus will be other than Unchanged. If
      // there were only removals, then body.length will have changed.
      // Ignore empty rules.
      return Math.max(
        getChangedStatus(body.filter(part => !part.isEmpty(use)).length < (this._ruleSet?.body?.length || 0)),
        ...body.map(part => use(part.ruleStatus)));
    });
  }

  public remove() {
    this._tableRules?.removeRuleSet(this);
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

  /**
   * Check if RuleSet may only add permissions, only remove permissions, or may do either.
   * A rule that neither adds nor removes permissions is treated as mixed for simplicity,
   * though this would be suboptimal if this were a useful case to support.
   */
  public summarizePermissions(): MixedPermissionValue {
    return summarizePermissions(this._body.get().map(p => p.summarizePermissions()));
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
        dom.maybe(use => !this.hasDefaultCondition(use), () =>
          cssColumnGroup(
            {style: 'min-height: 28px'},
            cssCellIcon(
              cssIconButton(icon('Plus'),
                dom.on('click', () => this.addRulePart(null)),
                testId('rule-add'),
              )
            ),
            testId('rule-extra-add'),
          )
        ),
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

  public addRulePart(beforeRule: ObsRulePart|null,
                     content?: RulePart,
                     isNew: boolean = false): ObsRulePart {
    const body = this._body.get();
    const i = beforeRule ? body.indexOf(beforeRule) : body.length;
    const part = ObsRulePart.create(this._body, this, content, isNew);
    this._body.splice(i, 0, part);
    return part;
  }

  /**
   * Add a sequence of rules, taking priority over existing rules.
   * optionally, if lowest-priority rule being added applies to
   * everyone, and the existing rule also applies to everyone,
   * fold those rules into one.
   * This method is currently only called on newly created rule
   * sets, so there's no need to check permissions and memos.
   */
  public addRuleParts(newParts: ObsRulePart[], options: {foldEveryoneRule?: boolean}) {
    // Check if we need to consider folding rules that apply to everyone.
    if (options.foldEveryoneRule) {
      const oldParts = this._body.get();
      const myEveryonePart = (oldParts.length === 1 && !oldParts[0].getRulePart().aclFormula) ? oldParts[0] : null;
      const newEveryonePart = newParts[newParts.length - 1]?.getRulePart().aclFormula ? null :
        newParts[newParts.length - 1];
       if (myEveryonePart && newEveryonePart) {
         // It suffices to remove the existing rule that applies to everyone,
         // which is just an empty default from rule set creation.
         removeItem(this._body, myEveryonePart);
       }
    }
    for (const part of [...newParts].reverse()) {
      const {permissionsText, aclFormula, memo} = part.getRulePart();
      if (permissionsText === undefined || aclFormula === undefined) {
        // Should not happen.
        continue;
      }

      // Include only the permissions for the bits that this RuleSet supports. E.g. this matters
      // for seed rules, which may include create/delete bits which shouldn't apply to columns.
      const origPermissions = parsePermissions(permissionsText);
      const trimmedPermissions = trimPermissions(origPermissions, this.getAvailableBits());
      const trimmedPermissionsText = permissionSetToText(trimmedPermissions);

      this.addRulePart(
        this.getFirst() || null,
        {
          aclFormula,
          permissionsText: trimmedPermissionsText,
          permissions: trimmedPermissions,
          memo,
        },
        true,
      );
    }
  }

  /**
   * Returns the first built-in rule. It's the only one of the built-in rules to get a "+" next to
   * it, since we don't allow inserting new rules in-between built-in rules.
   */
  public getFirstBuiltIn(): ObsRulePart|undefined {
    return this._body.get().find(p => p.isBuiltIn());
  }

  // Get first rule part, built-in or not.
  public getFirst(): ObsRulePart|undefined {
    return this._body.get()[0];
  }

  /**
   * When an empty-condition RulePart is the only part of a RuleSet, we can say it applies to
   * "Everyone".
   */
  public isSoleCondition(use: UseCB, part: ObsRulePart): boolean {
    const body = use(this._body);
    return body.length === 1 && body[0] === part;
  }

  /**
   * When an empty-condition RulePart is last in a RuleSet, we say it applies to "Everyone Else".
   */
  public isLastCondition(use: UseCB, part: ObsRulePart): boolean {
    const body = use(this._body);
    return body[body.length - 1] === part;
  }

  public hasDefaultCondition(use: UseCB): boolean {
    const body = use(this._body);
    return body.length > 0 && body[body.length - 1].hasEmptyCondition(use);
  }

  public getDefaultCondition(): ObsRulePart|null {
    const body = this._body.get();
    const last = body.length > 0 ? body[body.length - 1] : null;
    return last?.hasEmptyCondition(unwrap) ? last : null;
  }

  /**
   * Which permission bits to allow the user to set.
   */
  public getAvailableBits(): PermissionKey[] {
    return AVAILABLE_BITS_TABLES;
  }

  /**
   * Get valid colIds for the table that this RuleSet is for.
   */
  public getValidColIds(): string[] {
    const tableId = this._tableRules?.tableId;
    return (tableId && this.accessRules.getValidColIds(tableId)) || [];
  }

  /**
   * Check if this rule set is limited to a set of columns.
   */
  public hasColumns() {
    return false;
  }

  public hasOnlyBuiltInRules() {
    return this._body.get().every(rule => rule.isBuiltIn());
  }

  // Get rule parts that are neither built-in nor empty.
  public getCustomRules(): ObsRulePart[] {
    return this._body.get().filter(rule => !rule.isBuiltInOrEmpty());
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

  public buildResourceDom(): DomElementArg {
    return aclColumnList(this._colIds, this._getValidColIdsList());
  }

  public getColIdList(): string[] {
    return this._colIds.get();
  }

  public removeColId(colId: string) {
    this._colIds.set(this._colIds.get().filter(c => (c !== colId)));
  }

  public getColIds(): string {
    return this._colIds.get().join(",");
  }

  public getAvailableBits(): PermissionKey[] {
    return AVAILABLE_BITS_COLUMNS;
  }

  public hasColumns() {
    return true;
  }

  private _getValidColIdsList(): string[] {
    return this.getValidColIds().filter(id => id !== 'id');
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
        dom.domComputed(use => this._haveColumnRules && use(this._haveColumnRules), (haveColRules) =>
          haveColRules ? withInfoTooltip('All', 'accessRulesTableWide') : 'All')
      ),
    ];
  }
}

interface SpecialRuleBody {
  permissions: string;
  formula: string;
}

/**
 * Properties we need to know about how a special rule should function and
 * be rendered.
 */
interface SpecialRuleProperties extends SpecialRuleBody {
  description: string;
  name: string;
  availableBits: PermissionKey[];
}

const schemaEditRules: {[key: string]: SpecialRuleBody} = {
  allowEditors: {
    permissions: '+S',
    formula: 'user.Access == EDITOR',
  },
  denyEditors: {
    permissions: '-S',
    formula: 'user.Access != OWNER',
  },
};

const specialRuleProperties: Record<string, SpecialRuleProperties> = {
  AccessRules: {
    name: t('Permission to view Access Rules'),
    description: t('Allow everyone to view Access Rules.'),
    availableBits: ['read'],
    permissions: '+R',
    formula: 'True',
  },
  FullCopies: {
    name: t('Permission to access the document in full when needed'),
    description: t(`Allow everyone to copy the entire document, or view it in full in fiddle mode.
Useful for examples and templates, but not for sensitive data.`),
    availableBits: ['read'],
    permissions: '+R',
    formula: 'True',
  },
  SeedRule: {
    name: t('Seed rules'),
    description: t('When adding table rules, automatically add a rule to grant OWNER full access.'),
    availableBits: ['read', 'create', 'update', 'delete'],
    permissions: '+CRUD',
    formula: 'user.Access in [OWNER]',
  },
  SchemaEdit: {
    name: t("Permission to edit document structure"),
    description: t("Allow editors to edit structure (e.g. modify and delete tables, columns, \
layouts), and to write formulas, which give access to all data regardless of read restrictions."),
    availableBits: ['schemaEdit'],
    ...schemaEditRules.denyEditors,
  },
};

function getSpecialRuleProperties(name: string): SpecialRuleProperties {
  return specialRuleProperties[name] || {
    ...specialRuleProperties.AccessRules,
    name,
    description: name,
  };
}

class SpecialObsRuleSet extends ColumnObsRuleSet {
  private _isExpanded = Observable.create<boolean>(this, false);

  public get props() {
    return getSpecialRuleProperties(this.getColIds());
  }

  public buildRuleSetDom() {
    const isNonStandard = this._createIsNonStandardObs();
    const isChecked = this._createIsCheckedObs(isNonStandard);
    if (isNonStandard.get()) {
      this._isExpanded.set(true);
    }

    return dom('div',
      dom.autoDispose(isChecked),
      dom.autoDispose(isNonStandard),
      cssRuleDescription(
        cssIconButton(icon('Expand'),
          dom.style('transform', (use) => use(this._isExpanded) ? 'rotate(90deg)' : ''),
          dom.on('click', () => this._isExpanded.set(!this._isExpanded.get())),
          testId('rule-special-expand'),
          {style: 'margin: -4px'},  // subtract padding to align better.
        ),
        cssCheckbox(isChecked,
          dom.prop('disabled', isNonStandard),
          testId('rule-special-checkbox'),
        ),
        this.props.description,
      ),
      this._buildDomWarning(),
      dom.maybe(this._isExpanded, () =>
        cssTableRounded(
          {style: 'margin-left: 56px'},
          cssTableHeaderRow(
            cssCellIcon(),
            cssCell4(cssColHeaderCell(this.props.name)),
            cssCell1(cssColHeaderCell('Permissions')),
            cssCellIconWithMargins(),
            cssCellIcon(),
          ),
          cssTableRow(
            cssRuleBody.cls(''),
            dom.forEach(this._body, part => part.buildRulePartDom(true)),
            dom.maybe(use => !this.hasDefaultCondition(use), () =>
              cssColumnGroup(
                {style: 'min-height: 28px'},
                cssCellIcon(
                  cssIconButton(
                    icon('Plus'),
                    dom.on('click', () => this.addRulePart(null)),
                    testId('rule-add'),
                  )
                ),
                testId('rule-extra-add'),
              )
            ),
          ),
          testId('rule-set'),
        )
      ),
      testId('rule-special'),
      testId(`rule-special-${this.getColIds()}`),   // Make accessible in tests as, e.g. rule-special-FullCopies
    );
  }

  public getAvailableBits(): PermissionKey[] {
    return this.props.availableBits;
  }

  public removeRulePart(rulePart: ObsRulePart) {
    removeItem(this._body, rulePart);
    if (this._body.get().length === 0) {
      this._isExpanded.set(false);
      this._allowEveryone(false);
    }
  }

  protected _buildDomWarning(): DomContents {
    return null;
  }

  // Observable for whether this ruleSet is "standard", i.e. checked or unchecked state, without
  // any strange rules that need to be shown expanded with the checkbox greyed out.
  protected _createIsNonStandardObs(): Observable<boolean> {
    return Computed.create(null, this._body, (use, body) =>
      !body.every(rule => rule.isBuiltInOrEmpty(use) || rule.matches(use, this.props.formula, this.props.permissions)));
  }

  // Observable for whether the checkbox should be shown as checked. Writing to it will update
  // rules so as to toggle the checkbox.
  protected _createIsCheckedObs(isNonStandard: Observable<boolean>): Observable<boolean> {
    return Computed.create(null, this._body,
      (use, body) => !use(isNonStandard) && !body.every(rule => rule.isBuiltInOrEmpty(use)))
      .onWrite(val => this._allowEveryone(val));
  }

  private _allowEveryone(value: boolean) {
    const builtInRules = this._body.get().filter(r => r.isBuiltIn());
    if (value) {
      const rulePart = makeRulePart(this.props);
      this._body.set([ObsRulePart.create(this._body, this, rulePart, true), ...builtInRules]);
    } else {
      this._body.set(builtInRules);
      if (builtInRules.length === 0) {
        this._body.push(ObsRulePart.create(this._body, this, undefined));
      }
    }
  }
}

function makeRulePart({permissions, formula}: SpecialRuleBody): RulePart {
  const rulePart: RulePart = {
    aclFormula: formula,
    permissionsText: permissions,
    permissions: parsePermissions(permissions),
  };
  return rulePart;
}

/**
 * SchemaEdit permissions are moved out to a special fake resource "*SPECIAL:SchemaEdit" in the
 * frontend, to be presented under their own checkbox option. Its behaviors are a bit different
 * from other checkbox options; the differences are in the overridden methods here.
 */
class SpecialSchemaObsRuleSet extends SpecialObsRuleSet {
  protected _buildDomWarning(): DomContents {
    return dom.maybe(
      (use) => use(this._body).every(rule => rule.isBuiltInOrEmpty(use)),
      () => cssError(
        t("This default should be changed if editors' access is to be limited. "),
        dom('a', {style: 'color: inherit; text-decoration: underline'},
          'Dismiss', dom.on('click', () => this._allowEditors('confirm'))),
        testId('rule-schema-edit-warning'),
      )
    );
  }

  // SchemaEdit rules support an extra "standard" state, where a no-op rule exists (explicit rule
  // allowing EDITORs SchemaEdit permission), in which case we don't show a warning.
  protected _createIsNonStandardObs(): Observable<boolean> {
    return Computed.create(null, this._body, (use, body) =>
      !body.every(rule => rule.isBuiltInOrEmpty(use) || rule.matches(use, this.props.formula, this.props.permissions)
        || rule.matches(use, schemaEditRules.allowEditors.formula, schemaEditRules.allowEditors.permissions)));
  }

  protected _createIsCheckedObs(isNonStandard: Observable<boolean>): Observable<boolean> {
    return Computed.create(null, this._body,
      (use, body) => body.every(rule => rule.isBuiltInOrEmpty(use)
        || rule.matches(use, schemaEditRules.allowEditors.formula, schemaEditRules.allowEditors.permissions)))
      .onWrite(val => this._allowEditors(val));
  }

  // The third "confirm" option is used by the "Dismiss" link in the warning.
  private _allowEditors(value: boolean|'confirm') {
    const builtInRules = this._body.get().filter(r => r.isBuiltIn());
    if (value === 'confirm') {
      const rulePart = makeRulePart(schemaEditRules.allowEditors);
      this._body.set([ObsRulePart.create(this._body, this, rulePart, true), ...builtInRules]);
    } else if (!value) {
      const rulePart = makeRulePart(schemaEditRules.denyEditors);
      this._body.set([ObsRulePart.create(this._body, this, rulePart, true), ...builtInRules]);
    } else {
      this._body.set(builtInRules);
    }
  }
}

class ObsUserAttributeRule extends Disposable {
  public ruleStatus: Computed<RuleStatus>;

  // If the rule failed validation, the error message to show. Blank if valid.
  public formulaError: Computed<string>;

  private _name = Observable.create<string>(this, this._userAttr?.name || '');
  private _tableId = Observable.create<string>(this, this._userAttr?.tableId || '');
  private _lookupColId = Observable.create<string>(this, this._userAttr?.lookupColId || '');
  private _charId = Observable.create<string>(this, 'user.' + (this._userAttr?.charId || ''));
  private _validColIds = Computed.create(this, this._tableId, (use, tableId) =>
    this._accessRules.getValidColIds(tableId) || []);

  private _userAttrChoices: Computed<IAttrOption[]>;
  private _userAttrError = Observable.create(this, '');

  constructor(private _accessRules: AccessRules, private _userAttr?: UserAttributeRule,
              private _options: {focus?: boolean} = {}) {
    super();
    this.formulaError = Computed.create(
      this, this._tableId, this._lookupColId, this._userAttrError,
      (use, tableId, colId, userAttrError) => {
        if (userAttrError.length) {
          return userAttrError;
        }

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
        use(this._charId) !== 'user.' + this._userAttr?.charId
      );
    });

    // Reset lookupColId when tableId changes, since a colId from a different table would usually be wrong
    this.autoDispose(this._tableId.addListener(() => this._lookupColId.set('')));

    this._userAttrChoices = Computed.create(this, _accessRules.userAttrRules, (use, rules) => {
      // Filter for only those choices created by previous rules.
      const index = rules.indexOf(this);
      return use(this._accessRules.userAttrChoices).filter(c => (c.ruleIndex < index));
    });
  }

  public remove() {
    this._accessRules.removeUserAttributes(this);
  }

  public get name() { return this._name; }
  public get tableId() { return this._tableId; }

  public buildUserAttrDom() {
    return cssTableRow(
      cssCell1(cssCell.cls('-rborder'),
        cssCellContent(
          cssInput(this._name, async (val) => this._name.set(val),
            {placeholder: t("Attribute name")},
            (this._options.focus ? (elem) => { setTimeout(() => elem.focus(), 0); } : null),
            testId('rule-userattr-name'),
          ),
        ),
      ),
      cssCell4(cssRuleBody.cls(''),
        cssColumnGroup(
          cssCell1(
            aclFormulaEditor({
              gristTheme: this._accessRules.gristDoc.currentTheme,
              initialValue: this._charId.get(),
              readOnly: false,
              setValue: (text) => this._setUserAttr(text),
              placeholder: '',
              getSuggestions: () => this._userAttrChoices.get().map(choice => choice.value),
              customiseEditor: (editor => {
                editor.on('focus', () => {
                  if (editor.getValue() == 'user.') {
                    // TODO this weirdly only works on the first click
                    (editor as any).completer?.showPopup(editor);
                  }
                });
              })
            }),
            testId('rule-userattr-attr'),
          ),
          cssCell1(
            aclSelect(
              this._tableId,
              this._accessRules.allTableIds.map(tableId => ({
                value: tableId,
                label: this._accessRules.getTableTitle(tableId),
              })),
              {defaultLabel: '[Select Table]'},
            ),
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
    const fullCharId = this._charId.get().trim();
    const strippedCharId = fullCharId.startsWith('user.') ?
      fullCharId.substring('user.'.length) : fullCharId;
    const spec = {
      name: this._name.get(),
      tableId: this._tableId.get(),
      lookupColId: this._lookupColId.get(),
      charId: strippedCharId,
    };
    for (const [prop, value] of Object.entries(spec)) {
      if (!value) {
        throw new UserError(`Invalid user attribute rule: ${prop} must be set`);
      }
    }
    if (this._getUserAttrError(fullCharId)) {
      throw new UserError(`Invalid user attribute to look up`);
    }
    return {
      id: this._userAttr?.origRecord?.id,
      rulePos: this._userAttr?.origRecord?.rulePos as number|undefined,
      userAttributes: JSON.stringify(spec),
    };
  }

  private _setUserAttr(text: string) {
    if (text === this._charId.get()) {
      return;
    }
    this._charId.set(text);
    this._userAttrError.set(this._getUserAttrError(text) || '');
  }

  private _getUserAttrError(text: string): string | null {
    text = text.trim();
    if (text.startsWith('user.LinkKey')) {
      if (/user\.LinkKey\.\w+$/.test(text)) {
        return null;
      }
      return 'Use a simple attribute of user.LinkKey, e.g. user.LinkKey.something';
    }

    const isChoice = this._userAttrChoices.get().map(choice => choice.value).includes(text);
    if (!isChoice) {
      return 'Not a valid user attribute';
    }
    return null;
  }
}

// Represents one line of a RuleSet, a combination of an aclFormula and permissions to apply to
// requests that match it.
class ObsRulePart extends Disposable {
  // Whether the rule part, and if it's valid or being checked.
  public ruleStatus: Computed<RuleStatus>;

  public focusEditor: (() => void)|undefined;

  // Formula to show in the formula editor.
  private _aclFormula = Observable.create<string>(this, this._rulePart?.aclFormula || "");

  // Rule-specific completions for editing the formula, e.g. "user.Email" or "rec.City".
  private _completions = Computed.create<string[]>(this, (use) => [
    ...use(this._ruleSet.accessRules.userAttrChoices).map(opt => opt.value),
    ...this._ruleSet.getValidColIds().map(colId => `rec.${colId}`),
    ...this._ruleSet.getValidColIds().map(colId => `$${colId}`),
    ...this._ruleSet.getValidColIds().map(colId => `newRec.${colId}`),
  ]);

  // The permission bits.
  private _permissions = Observable.create<PartialPermissionSet>(
    this, this._rulePart?.permissions || emptyPermissionSet());

  // The memo text. Updated whenever changes are made within `_memoEditor`.
  private _memo: Observable<string>;

  // Reference to the memo editor element, for triggering focus. Shown when
  // `_showMemoEditor` is true.
  private _memoEditor: HTMLInputElement | undefined;

  // Is the memo editor visible? Initialized to true if a saved memo exists for this rule.
  private _showMemoEditor: Observable<boolean>;

  // Whether the rule is being checked after a change. Saving will wait for such checks to finish.
  private _checkPending = Observable.create(this, false);

  // If the formula failed validation, the error message to show. Blank if valid.
  private _formulaError = Observable.create(this, '');

  private _formulaProperties = Observable.create<FormulaProperties>(this, getAclFormulaProperties(this._rulePart));

  // Error message if any validation failed.
  private _error: Computed<string>;

  constructor(private _ruleSet: ObsRuleSet, private _rulePart?: RulePart, isNew = false) {
    super();
    this._memo = Observable.create(this, _rulePart?.memo ?? '');

    if (_rulePart && isNew) {
      // rulePart is omitted for a new ObsRulePart added by the user. If given, isNew may be set to
      // treat the rule as new and only use the rulePart for its initialization.
      this._rulePart = undefined;
    }

    // If this rule has a blank memo, don't show the editor.
    this._showMemoEditor = Observable.create(this, !this.isBuiltIn() && this._memo.get() !== '');

    this._error = Computed.create(this, (use) => {
      return use(this._formulaError) ||
        this._warnInvalidColIds(use(this._formulaProperties).usedColIds) ||
        ( !this._ruleSet.isLastCondition(use, this) &&
          use(this._aclFormula) === '' &&
          permissionSetToText(use(this._permissions)) !== '' ?
          'Condition cannot be blank' : ''
        );
    });

    const emptyPerms = emptyPermissionSet();
    this.ruleStatus = Computed.create(this, (use) => {
      if (use(this._error)) { return RuleStatus.Invalid; }
      if (use(this._checkPending)) { return RuleStatus.CheckPending; }
      return getChangedStatus(
        use(this._aclFormula) !== (this._rulePart?.aclFormula ?? '') ||
        use(this._memo) !== (this._rulePart?.memo ?? '') ||
        !isEqual(use(this._permissions), this._rulePart?.permissions ?? emptyPerms)
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
      memo: this._memo.get(),
    };
  }

  public hasEmptyCondition(use: UseCB): boolean {
    return use(this._aclFormula) === '';
  }

  public matches(use: UseCB, aclFormula: string, permissionsText: string): boolean {
    return (use(this._aclFormula) === aclFormula &&
            permissionSetToText(use(this._permissions)) === permissionsText);
  }

  /**
   * Check if RulePart may only add permissions, only remove permissions, or may do either.
   * A rule that neither adds nor removes permissions is treated as mixed for simplicity,
   * though this would be suboptimal if this were a useful case to support.
   */
  public summarizePermissions(): MixedPermissionValue {
    return summarizePermissionSet(this._permissions.get());
  }

  /**
   * Verify that the rule is in a good state, optionally given a proposed permission change.
   */
  public sanityCheck(pset?: PartialPermissionSet) {
    // Nothing to do!  We now support all expressible rule permutations.
  }

  public buildRulePartDom(wide: boolean = false) {
    return cssRulePartAndMemo(
      cssColumnGroup(
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
          wide ? cssCell4.cls('') : null,
          aclFormulaEditor({
            gristTheme: this._ruleSet.accessRules.gristDoc.currentTheme,
            initialValue: this._aclFormula.get(),
            readOnly: this.isBuiltIn(),
            setValue: (value) => this._setAclFormula(value),
            placeholder: dom.text((use) => {
              return (
                this._ruleSet.isSoleCondition(use, this) ? t('Everyone') :
                this._ruleSet.isLastCondition(use, this) ? t('Everyone Else') :
                t('Enter Condition')
              );
            }),
            getSuggestions: (prefix) => this._completions.get(),
            customiseEditor: (editor) => { this.focusEditor = () => editor.focus(); },
          }),
          testId('rule-acl-formula'),
        ),
        cssCell1(cssCell.cls('-stretch'),
          permissionsWidget(this._ruleSet.getAvailableBits(), this._permissions,
            {disabled: this.isBuiltIn(), sanityCheck: (pset) => this.sanityCheck(pset)},
            testId('rule-permissions')
          ),
        ),
        cssCellIconWithMargins(
          dom.maybe(use => !this.isBuiltIn() && !use(this._showMemoEditor), () =>
            cssIconButton(icon('Memo'),
              dom.on('click', () => {
                this._showMemoEditor.set(true);
                // Note that focus is set when the memo icon is clicked, and not when
                // the editor is attached to the DOM; because rules with non-blank
                // memos have their editors visible by default when the page is first
                // loaded, focusing on creation could cause unintended focusing.
                setTimeout(() => this._memoEditor?.focus(), 0);
              }),
              testId('rule-memo-add'),
            )
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
      ),
      dom.maybe(this._showMemoEditor, () =>
        cssMemoColumnGroup(
          cssCellIcon(),
          cssMemoIcon('Memo'),
          cssCell2(
            wide ? cssCell4.cls('') : null,
            this._memoEditor = aclMemoEditor(this._memo,
              {
                placeholder: t("Type a message..."),
              },
              dom.onKeyDown({
                // Match the behavior of the formula editor.
                Enter: (_ev, el) => el.blur(),
              }),
            ),
            testId('rule-memo-editor'),
          ),
          cssCellIconWithMargins(),
          cssCellIcon(
            cssIconButton(icon('Remove'),
              dom.on('click', () => {
                this._showMemoEditor.set(false);
                this._memo.set('');
              }),
              testId('rule-memo-remove'),
            ),
          ),
          testId('rule-memo'),
        ),
      ),
      testId('rule-part-and-memo'),
    );
  }

  public isBuiltIn(): boolean {
    return this._rulePart ? !this._rulePart.origRecord?.id : false;
  }

  // return true if formula, permissions, and memo are all empty.
  public isEmpty(use: UseCB = unwrap): boolean {
    return use(this._aclFormula) === '' &&
      isEqual(use(this._permissions), emptyPermissionSet()) &&
      use(this._memo) === '';
  }

  public isBuiltInOrEmpty(use: UseCB = unwrap): boolean {
    return this.isBuiltIn() || this.isEmpty(use);
  }

  private _isNonFirstBuiltIn(): boolean {
    return this.isBuiltIn() && this._ruleSet.getFirstBuiltIn() !== this;
  }

  private async _setAclFormula(text: string) {
    if (text === this._aclFormula.get()) { return; }
    this._aclFormula.set(text);
    this._checkPending.set(true);
    this._formulaProperties.set({});
    this._formulaError.set('');
    try {
      this._formulaProperties.set(await this._ruleSet.accessRules.checkAclFormula(text));
      this.sanityCheck();
    } catch (e) {
      this._formulaError.set(e.message);
    } finally {
      this._checkPending.set(false);
    }
  }

  private _warnInvalidColIds(colIds?: string[]) {
    if (!colIds || !colIds.length) { return false; }
    const allValid = new Set(this._ruleSet.getValidColIds());
    const invalid = colIds.filter(c => !allValid.has(c));
    if (invalid.length > 0) {
      return `Invalid columns: ${invalid.join(', ')}`;
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
  }).filter(isNonNullish);

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

function getAclFormulaProperties(part?: RulePart): FormulaProperties {
  const aclFormulaParsed = part?.origRecord?.aclFormulaParsed;
  return aclFormulaParsed ? getFormulaProperties(JSON.parse(String(aclFormulaParsed))) : {};
}

// Return a rule set if it applies to one of the specified columns.
function filterRuleSet(colIds: string[], ruleSet?: RuleSet): RuleSet|undefined {
  if (!ruleSet) { return undefined; }
  if (ruleSet.colIds === '*') { return ruleSet; }
  for (const colId of ruleSet.colIds) {
    if (colIds.includes(colId)) { return ruleSet; }
  }
  return undefined;
}

// Filter an array of rule sets for just those that apply to one of the specified
// columns.
function filterRuleSets(colIds: string[], ruleSets: RuleSet[]): RuleSet[] {
  return ruleSets.map(ruleSet => filterRuleSet(colIds, ruleSet)).filter(rs => rs) as RuleSet[];
}

const cssOuter = styled('div', `
  flex: auto;
  height: 100%;
  width: 100%;
  max-width: 1500px;
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

const cssRemoveIcon = styled(icon, `
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
  color: ${theme.lightText};
`);

const cssTableName = styled('span', `
  color: ${theme.text};
`);

const cssInput = styled(textInput, `
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};
  width: 100%;
  border: 1px solid transparent;
  cursor: pointer;

  &:hover {
    border: 1px solid ${theme.inputBorder};
  }
  &:focus {
    box-shadow: inset 0 0 0 1px ${theme.controlFg};
    border-color: ${theme.controlFg};
    cursor: unset;
  }
  &[disabled] {
    color: ${theme.inputDisabledFg};
    background-color: ${theme.inputDisabledBg};
    box-shadow: unset;
    border-color: transparent;
  }
  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
`);

const cssError = styled('div', `
  color: ${theme.errorText};
  margin-left: 56px;
  margin-bottom: 8px;
  margin-top: 4px;
`);

const cssConditionError = styled('div', `
  color: ${theme.errorText};
  margin-top: 4px;
  width: 100%;
`);

/**
 * Fairly general table styles.
 */
const cssTableRounded = styled('div', `
  border: 1px solid ${theme.accessRulesTableBorder};
  border-radius: 8px;
  overflow: hidden;
`);

// Row with a border
const cssTableRow = styled('div', `
  display: flex;
  border-bottom: 1px solid ${theme.accessRulesTableBorder};
  &:last-child {
    border-bottom: none;
  }
`);

// Darker table header
const cssTableHeaderRow = styled(cssTableRow, `
  background-color: ${theme.accessRulesTableHeaderBg};
  color: ${theme.accessRulesTableHeaderFg};
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
    border-right: 1px solid ${theme.accessRulesTableBorder};
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
const cssCellIconWithMargins = styled(cssCellIcon, `margin: 0px 8px;`);
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

const cssRuleDescription = styled('div', `
  color: ${theme.text};
  display: flex;
  align-items: top;
  margin: 16px 0 8px 0;
  gap: 12px;
  white-space: pre-line;  /* preserve line breaks in long descriptions */
`);

const cssCheckbox = styled(squareCheckbox, `
  flex: none;
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
  color: ${theme.accessRulesTableBodyFg};
  font-weight: bold;
`);

const cssRuleProblems = styled('div', `
  flex: auto;
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
`);

const cssRulePartAndMemo = styled('div', `
  display: flex;
  flex-direction: column;
  row-gap: 4px;
`);

const cssMemoColumnGroup = styled(cssColumnGroup, `
  margin-bottom: 8px;
`);

const cssMemoIcon = styled(icon, `
  --icon-color: ${theme.accentIcon};
  margin-left: 8px;
  margin-right: 8px;
`);

const cssSeedRule = styled('div', `
  margin-bottom: 16px;
`);
