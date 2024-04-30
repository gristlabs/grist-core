import { DocData } from 'app/common/DocData';
import { getSetMapValue } from 'app/common/gutil';
import { SchemaTypes } from 'app/common/schema';
import { ShareOptions } from 'app/common/ShareOptions';
import { MetaRowRecord, MetaTableData } from 'app/common/TableData';
import isEqual from 'lodash/isEqual';
import sortBy from 'lodash/sortBy';

/**
 * For special shares, we need to refer to resources that may not
 * be listed in the _grist_ACLResources table, and have rules that
 * aren't backed by storage in _grist_ACLRules. So we implement
 * a small helper to add an overlay of extra resources and rules.
 * They are distinguishable from real, stored resources and rules
 * by having negative IDs.
 */
export class TableWithOverlay<T extends keyof SchemaTypes> {
  private _extraRecords = new Array<MetaRowRecord<T>>();
  private _extraRecordsById = new Map<number, MetaRowRecord<T>>();
  private _excludedRecordIds = new Set<number>();
  private _nextFreeVirtualId: number = -1;

  public constructor(private _originalTable: MetaTableData<T>) {}

  // Add a record to the table, but only as an overlay - no
  // persistent changes are made. Uses negative row IDs.
  // Returns the ID assigned to the record. The passed in
  // record is expected to have an ID of zero.
  public addRecord(rec: MetaRowRecord<T>): number {
    if (rec.id !== 0) { throw new Error('Expected a zero ID'); }
    const id = this._nextFreeVirtualId;
    const recWithCorrectId: MetaRowRecord<T> = {...rec, id};
    this._extraRecords.push({...rec, id});
    this._extraRecordsById.set(id, recWithCorrectId);
    this._nextFreeVirtualId--;
    return id;
  }

  public excludeRecord(id: number) {
    this._excludedRecordIds.add(id);
  }

  // Support the few MetaTableData methods we actually use
  // in ACLRulesReader.

  public getRecord(id: number) {
    if (this._excludedRecordIds.has(id)) { return undefined; }

    if (id < 0) {
      // Reroute negative IDs to our local stash of records.
      return this._extraRecordsById.get(id);
    } else {
      // Everything else, we just pass along.
      return this._originalTable.getRecord(id);
    }
  }

  public getRecords() {
    return this._filterExcludedRecords([
      ...this._originalTable.getRecords(),
      ...this._extraRecords,
    ]);
  }

  public filterRecords(properties: Partial<MetaRowRecord<T>>): Array<MetaRowRecord<T>> {
    const originalRecords = this._originalTable.filterRecords(properties);
    const extraRecords = this._extraRecords.filter((rec) => Object.keys(properties)
      .every((p) => isEqual((rec as any)[p], (properties as any)[p])));
    return this._filterExcludedRecords([...originalRecords, ...extraRecords]);
  }

  public findMatchingRowId(properties: Partial<MetaRowRecord<T>>): number {
    const rowId = (
      this._originalTable.findMatchingRowId(properties) ||
      this._extraRecords.find((rec) => Object.keys(properties).every((p) =>
        isEqual((rec as any)[p], (properties as any)[p]))
      )?.id
    );
    return rowId && !this._excludedRecordIds.has(rowId) ? rowId : 0;
  }

  private _filterExcludedRecords(records: MetaRowRecord<T>[]) {
    return records.filter(({id}) => !this._excludedRecordIds.has(id));
  }
}

export interface ACLRulesReaderOptions {
  /**
   * Adds virtual rules for all shares in the document.
   *
   * If set to `true` and there are shares in the document, regular rules are
   * modified so that they don't apply when a document is being accessed through
   * a share, and new rules are added to grant access to the resources specified by
   * the shares.
   *
   * This will also "split" any resources (and their rules) if they apply to multiple
   * resources. Splitting produces copies of the original resource and rules
   * rules, but with modifications in place so that each copy applies to a single
   * resource. Normalizing the original rules in this way allows for a simpler mechanism
   * to override the original rules/resources with share rules, for situations where a
   * share needs to grant access to a resource that is protected by access rules (shares
   * and access rules are mutually exclusive at this time).
   *
   * Note: a value of `true` will *not* cause any persistent modifications to be made to
   * rules; all changes are "virtual" in the sense that they are applied on top of the
   * persisted rules to enable shares.
   *
   * Defaults to `false`.
   */
  addShareRules?: boolean;
}

interface ShareContext {
  shareRef: number;
  sections: MetaRowRecord<"_grist_Views_section">[];
  columns: MetaRowRecord<"_grist_Tables_column">[];
}

/**
 * Helper class for reading ACL rules from DocData.
 */
export class ACLRulesReader {
  private _resourcesTable = new TableWithOverlay(this.docData.getMetaTable('_grist_ACLResources'));
  private _rulesTable = new TableWithOverlay(this.docData.getMetaTable('_grist_ACLRules'));
  private _sharesTable = this.docData.getMetaTable('_grist_Shares');
  private _hasShares = this._options.addShareRules && this._sharesTable.numRecords() > 0;
  /** Maps 'tableId:colId' to the comma-separated list of column IDs from the associated resource. */
  private _resourceColIdsByTableAndColId: Map<string, string> = new Map();

  public constructor(public docData: DocData, private _options: ACLRulesReaderOptions = {}) {
    this._addOriginalRules();
    this._maybeAddShareRules();
  }

  public entries() {
    const rulesByResourceId = new Map<number, Array<MetaRowRecord<'_grist_ACLRules'>>>();
    for (const rule of sortBy(this._rulesTable.getRecords(), 'rulePos')) {
      // If we have "virtual" rules to implement shares, then regular
      // rules need to be tweaked so that they don't apply when the
      // share is active.
      if (this._hasShares && rule.id >= 0) {
        disableRuleInShare(rule);
      }

      getSetMapValue(rulesByResourceId, rule.resource, () => []).push(rule);
    }
    return rulesByResourceId.entries();
  }

  public getResourceById(id: number) {
    return this._resourcesTable.getRecord(id);
  }

  private _addOriginalRules() {
    for (const rule of sortBy(this._rulesTable.getRecords(), 'rulePos')) {
      const resource = this.getResourceById(rule.resource);
      if (!resource) {
        throw new Error(`ACLRule ${rule.id} refers to an invalid ACLResource ${rule.resource}`);
      }

      if (resource.tableId !== '*' && resource.colIds !== '*') {
        const colIds = resource.colIds.split(',');
        if (colIds.length === 1) { continue; }

        for (const colId of colIds) {
          this._resourceColIdsByTableAndColId.set(`${resource.tableId}:${colId}`, resource.colIds);
        }
      }
    }
  }

  private _maybeAddShareRules() {
    if (!this._hasShares) { return; }

    for (const share of this._sharesTable.getRecords()) {
      this._addRulesForShare(share);
    }
    this._addDefaultShareRules();
  }

  /**
   * Add any rules needed for the specified share.
   *
   * The only kind of share we support for now is form endpoint
   * sharing.
   */
  private _addRulesForShare(share: MetaRowRecord<'_grist_Shares'>) {
    // TODO: Unpublished shares could and should be blocked earlier,
    // by home server
    const {publish}: ShareOptions = JSON.parse(share.options || '{}');
    if (!publish) {
      this._blockShare(share.id);
      return;
    }

    // Let's go looking for sections related to the share.
    // It was decided that the relationship between sections and
    // shares is via pages. Every section on a given page can belong
    // to at most one share.
    // Ignore sections which do not have `publish` set to `true` in
    // `shareOptions`.
    const pages = this.docData.getMetaTable('_grist_Pages').filterRecords({
      shareRef: share.id,
    });
    const parentViews = new Set(pages.map(page => page.viewRef));
    const sections = this.docData.getMetaTable('_grist_Views_section').getRecords().filter(
      section => {
        if (!parentViews.has(section.parentId)) { return false; }
        const options = JSON.parse(section.shareOptions || '{}');
        return Boolean(options.publish) && Boolean(options.form);
      }
    );

    const sectionIds = new Set(sections.map(section => section.id));
    const fields = this.docData.getMetaTable('_grist_Views_section_field').getRecords().filter(
      field => {
        return sectionIds.has(field.parentId);
      }
    );
    const columnIds = new Set(fields.map(field => field.colRef));
    const columns = this.docData.getMetaTable('_grist_Tables_column').getRecords().filter(
      column => {
        return columnIds.has(column.id);
      }
    );

    const tableRefs = new Set(sections.map(section => section.tableRef));
    const tables = this.docData.getMetaTable('_grist_Tables').getRecords().filter(
      table => tableRefs.has(table.id)
    );

    // For tables associated with forms, allow creation of records,
    // and reading of referenced columns.
    // TODO: tighten access control on creation since it may be broader
    // than users expect - hidden columns could be written.
    for (const table of tables) {
      this._shareTableForForm(table, {
        shareRef: share.id, sections, columns,
      });
    }
  }

  /**
   * When accessing a document via a share, by default no user tables are
   * accessible. Everything added to the share gives additional
   * access, and never reduces access, making it easy to grant
   * access to multiple parts of the document.
   *
   * We do leave access unchanged for metadata tables, since they are
   * censored via an alternative mechanism.
   */
  private _addDefaultShareRules() {
    // Block access to each table.
    const tableIds = this.docData.getMetaTable('_grist_Tables').getRecords()
      .map(table => table.tableId)
      .filter(tableId => !tableId.startsWith('_grist_'))
      .sort();
    for (const tableId of tableIds) {
      this._addShareRule(this._findOrAddResource({tableId, colIds: '*'}), '-CRUDS');
    }

    // Block schema access at the default level.
    this._addShareRule(this._findOrAddResource({tableId: '*', colIds: '*'}), '-S');
  }

  /**
   * Allow creating records in a table.
   */
  private _shareTableForForm(table: MetaRowRecord<'_grist_Tables'>,
                             shareContext: ShareContext) {
    const { shareRef } = shareContext;
    const resource = this._findOrAddResource({
      tableId: table.tableId,
      colIds: '*',  // At creation, allow all columns to be
                    // initialized.
    });
    let aclFormula = `user.ShareRef == ${shareRef}`;
    let aclFormulaParsed = JSON.stringify([
      'Eq',
      [ 'Attr', [ "Name", "user" ], "ShareRef" ],
      [ 'Const', shareRef ] ]);
    this._rulesTable.addRecord(this._makeRule({
      resource, aclFormula, aclFormulaParsed, permissionsText: '+C',
    }));

    // This is a hack to grant read schema access, needed for forms -
    // Should not be needed once forms are actually available, but
    // until them is very handy to allow using the web client to
    // submit records.
    aclFormula = `user.ShareRef == ${shareRef} and rec.id == 0`;
    aclFormulaParsed = JSON.stringify(
      [ 'And',
        [ 'Eq',
          [ 'Attr', [ "Name", "user" ], "ShareRef" ],
          ['Const', shareRef] ],
        [ 'Eq', [ 'Attr', ['Name', 'rec'], 'id'], ['Const', 0]]]);
    this._rulesTable.addRecord(this._makeRule({
      resource, aclFormula, aclFormulaParsed, permissionsText: '+R',
    }));

    this._shareTableReferencesForForm(table, shareContext);
  }

  /**
   * Give read access to referenced columns.
   */
  private _shareTableReferencesForForm(table: MetaRowRecord<'_grist_Tables'>,
                                       shareContext: ShareContext) {
    const { shareRef } = shareContext;

    const tables = this.docData.getMetaTable('_grist_Tables');
    const columns = this.docData.getMetaTable('_grist_Tables_column');
    const tableColumns = shareContext.columns.filter(c =>
        c.parentId === table.id &&
        (c.type.startsWith('Ref:') || c.type.startsWith('RefList:')));
    for (const column of tableColumns) {
      const visibleColRef = column.visibleCol;
      // This could be blank in tests, not sure about real life.
      if (!visibleColRef) { continue; }
      const visibleCol = columns.getRecord(visibleColRef);
      if (!visibleCol) { continue; }
      const referencedTable = tables.getRecord(visibleCol.parentId);
      if (!referencedTable) { continue; }

      const tableId = referencedTable.tableId;
      const colId = visibleCol.colId;
      const resourceColIds = this._resourceColIdsByTableAndColId.get(`${tableId}:${colId}`) ?? colId;
      const maybeResourceId = this._resourcesTable.findMatchingRowId({tableId, colIds: resourceColIds});
      if (maybeResourceId !== 0) {
        this._maybeSplitResourceForShares(maybeResourceId);
      }
      const resource = this._findOrAddResource({tableId, colIds: colId});
      const aclFormula = `user.ShareRef == ${shareRef}`;
      const aclFormulaParsed = JSON.stringify(
        [ 'Eq',
          [ 'Attr', [ "Name", "user" ], "ShareRef" ],
          ['Const', shareRef] ]);
      this._rulesTable.addRecord(this._makeRule({
        resource, aclFormula, aclFormulaParsed, permissionsText: '+R',
      }));
    }
  }

  /**
   * Splits a resource into multiple resources that are suitable for being
   * overridden by shares. Rules are copied to each resource, with modifications
   * that disable them in shares.
   *
   * Ignores resources for single columns, and resources created for shares
   * (i.e. those with a negative ID); the former can already be overridden
   * by shares without any additional work, and the latter are guaranteed to
   * only be for single columns.
   *
   * The motivation for this method is to normalize document access rules so
   * that rule sets apply to at most a single column. Document shares may
   * automatically grant limited access to parts of a document, such as columns
   * that are referenced from a form field. But for this to happen, extra rules
   * first need to be added to the original or new resource, which requires looking
   * up the resource by column ID to see if it exists. This lookup only works if
   * the rule set of the resource is for a single column; otherwise, the lookup
   * will fail and cause a new resource to be created, which consequently causes
   * 2 resources to exist that both contain the same column. Since this is an
   * unsupported scenario with ambiguous evaluation semantics, we pre-emptively call
   * this method to avoid such scenarios altogether.
   */
  private _maybeSplitResourceForShares(resourceId: number) {
    if (resourceId < 0) { return; }

    const resource = this.getResourceById(resourceId);
    if (!resource) {
      throw new Error(`Unable to find ACLResource with ID ${resourceId}`);
    }

    const {tableId} = resource;
    const colIds = resource.colIds.split(',');
    if (colIds.length === 1) { return; }

    const rules = sortBy(this._rulesTable.filterRecords({resource: resourceId}), 'rulePos')
      .map(r => disableRuleInShare(r));
    // Prepare a new resource for each column, with copies of the original resource's rules.
    for (const colId of colIds) {
      const newResourceId = this._resourcesTable.addRecord({id: 0, tableId, colIds: colId});
      for (const rule of rules) {
        this._rulesTable.addRecord({...rule, id: 0, resource: newResourceId});
      }
    }
    // Exclude the original resource and rules.
    this._resourcesTable.excludeRecord(resourceId);
    for (const rule of rules) {
      this._rulesTable.excludeRecord(rule.id);
    }
  }

  /**
   * Find a resource we need, and return its rowId. The resource is
   * added if it is not already present.
   */
  private _findOrAddResource(properties: {
    tableId: string,
    colIds: string,
  }): number {
    const resource = this._resourcesTable.findMatchingRowId(properties);
    if (resource !== 0) { return resource; }
    return this._resourcesTable.addRecord({
      id: 0,
      ...properties,
    });
  }

  private _addShareRule(resourceRef: number, permissionsText: string) {
    const aclFormula = 'user.ShareRef is not None';
    const aclFormulaParsed = JSON.stringify([
      'NotEq',
      ['Attr', ['Name', 'user'], 'ShareRef'],
      ['Const', null],
    ]);
    this._rulesTable.addRecord(this._makeRule({
      resource: resourceRef, aclFormula, aclFormulaParsed, permissionsText,
    }));
  }

  private _blockShare(shareRef: number) {
    const resource = this._findOrAddResource({
      tableId: '*', colIds: '*',
    });
    const aclFormula = `user.ShareRef == ${shareRef}`;
    const aclFormulaParsed = JSON.stringify(
      [ 'Eq',
        [ 'Attr', [ "Name", "user" ], "ShareRef" ],
        ['Const', shareRef] ]);
    this._rulesTable.addRecord(this._makeRule({
      resource, aclFormula, aclFormulaParsed, permissionsText: '-CRUDS',
    }));
  }

  private _makeRule(options: {
    resource: number,
    aclFormula: string,
    aclFormulaParsed: string,
    permissionsText: string,
  }): MetaRowRecord<'_grist_ACLRules'> {
    const {resource, aclFormula, aclFormulaParsed, permissionsText} = options;
    return {
      id: 0,
      resource,
      aclFormula,
      aclFormulaParsed,
      memo: '',
      permissionsText,
      userAttributes: '',
      rulePos: 0,

      // The following fields are unused and deprecated.
      aclColumn: 0,
      permissions: 0,
      principals: '',
    };
  }
}

/**
 * Updates the ACL formula of `rule` such that it's disabled if a document is being
 * accessed via a share.
 *
 * Modifies `rule` in place.
 */
function disableRuleInShare(rule: MetaRowRecord<'_grist_ACLRules'>) {
  const aclFormulaParsed = rule.aclFormula && JSON.parse(String(rule.aclFormulaParsed));
  const newAclFormulaParsed = [
    'And',
    [ 'Eq', [ 'Attr', [ 'Name', 'user' ], 'ShareRef' ], ['Const', null] ],
    aclFormulaParsed || [ 'Const', true ]
  ];
  rule.aclFormula = 'user.ShareRef is None and (' + String(rule.aclFormula || 'True') + ')';
  rule.aclFormulaParsed = JSON.stringify(newAclFormulaParsed);
  return rule;
}
