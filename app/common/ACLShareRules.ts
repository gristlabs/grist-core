import { DocData } from 'app/common/DocData';
import { SchemaTypes } from 'app/common/schema';
import { ShareOptions } from 'app/common/ShareOptions';
import { MetaRowRecord, MetaTableData } from 'app/common/TableData';
import { isEqual } from 'lodash';

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

  // Support the few MetaTableData methods we actually use
  // in ACLRuleCollection and ACLShareRules.

  public getRecord(resourceId: number) {
    // Reroute negative IDs to our local stash of records.
    if (resourceId < 0) {
      return this._extraRecordsById.get(resourceId);
    }
    // Everything else, we just pass along.
    return this._originalTable.getRecord(resourceId);
  }

  public getRecords() {
    return [...this._originalTable.getRecords(), ...this._extraRecords];
  }

  public findMatchingRowId(properties: Partial<MetaRowRecord<T>>): number {
    // Check stored records.
    const rowId = this._originalTable.findMatchingRowId(properties);
    if (rowId) { return rowId; }
    // Check overlay.
    return this._extraRecords.find((rec) =>
        Object.keys(properties).every((p) => isEqual(
          (rec as any)[p],
          (properties as any)[p])))?.id || 0;
  }
}

/**
 * Helper for managing special share rules.
 */
export class ACLShareRules {

  public constructor(
    public docData: DocData,
    public resourcesTable: TableWithOverlay<'_grist_ACLResources'>,
    public rulesTable: TableWithOverlay<'_grist_ACLRules'>,
  ) {}

  /**
   * Add any rules needed for the specified share.
   *
   * The only kind of share we support for now is form endpoint
   * sharing.
   */
  public addRulesForShare(shareRef: number, shareOptions: ShareOptions) {
    // TODO: Unpublished shares could and should be blocked earlier,
    // by home server
    if (!shareOptions.publish) {
      this._blockShare(shareRef);
      return;
    }

    // Let's go looking for sections related to the share.
    // It was decided that the relationship between sections and
    // shares is via pages. Every section on a given page can belong
    // to at most one share.
    // Ignore sections which do not have `publish` set to `true` in
    // `shareOptions`.
    const pages = this.docData.getMetaTable('_grist_Pages').filterRecords({
      shareRef,
    });
    const parentViews = new Set(pages.map(page => page.viewRef));
    const sections = this.docData.getMetaTable('_grist_Views_section').getRecords().filter(
      section => {
        if (!parentViews.has(section.parentId)) { return false; }
        const options = JSON.parse(section.shareOptions || '{}');
        return Boolean(options.publish) && Boolean(options.form);
      }
    );

    const tableRefs = new Set(sections.map(section => section.tableRef));
    const tables = this.docData.getMetaTable('_grist_Tables').getRecords().filter(
      table => tableRefs.has(table.id)
    );

    // For tables associated with forms, allow creation of records,
    // and reading of referenced columns.
    // TODO: should probably be limiting to a set of columns associated
    // with section - but for form widget that could potentially be very
    // confusing since it may not be easy to see that certain columns
    // haven't been made visible for it? For now, just working at table
    // level.
    for (const table of tables) {
      this._shareTableForForm(table, shareRef);
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
  public addDefaultRulesForShares() {
    const tableIds = this.docData.getMetaTable('_grist_Tables').getRecords()
      .map(table => table.tableId)
      .filter(tableId => !tableId.startsWith('_grist_'))
      .sort();
    for (const tableId of tableIds) {
      const resource = this._findOrAddResource({
        tableId, colIds: '*',
      });
      const aclFormula = `user.ShareRef is not None`;
      const aclFormulaParsed = JSON.stringify([
        'NotEq',
        [ 'Attr', [ "Name", "user" ], "ShareRef" ],
        ['Const', null] ]);
      this.rulesTable.addRecord(this._makeRule({
        resource, aclFormula, aclFormulaParsed, permissionsText: '-CRUDS',
      }));
    }
  }

  /**
   * When accessing a document via a share, any regular granular access
   * rules should not apply. This requires an extra conditional.
   */
  public transformNonShareRules(state: {
    rule: MetaRowRecord<'_grist_ACLRules'>,
    aclFormulaParsed: object,
  }) {
    state.rule.aclFormula = 'user.ShareRef is None and (' + String(state.rule.aclFormula || 'True') + ')';
    state.aclFormulaParsed = [
      'And',
      [ 'Eq', [ 'Attr', [ 'Name', 'user' ], 'ShareRef' ], ['Const', null] ],
      state.aclFormulaParsed || [ 'Const', true ]
    ];
    state.rule.aclFormulaParsed = JSON.stringify(state.aclFormulaParsed);
    return state.aclFormulaParsed;
  }

  /**
   * Allow creating records in a table.
   */
  private _shareTableForForm(table: MetaRowRecord<'_grist_Tables'>,
                             shareRef: number) {
    const resource = this._findOrAddResource({
      tableId: table.tableId,
      colIds: '*',
    });
    let aclFormula = `user.ShareRef == ${shareRef}`;
    let aclFormulaParsed = JSON.stringify([
      'Eq',
      [ 'Attr', [ "Name", "user" ], "ShareRef" ],
      [ 'Const', shareRef ] ]);
    this.rulesTable.addRecord(this._makeRule({
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
    this.rulesTable.addRecord(this._makeRule({
      resource, aclFormula, aclFormulaParsed, permissionsText: '+R',
    }));

    this._shareTableReferencesForForm(table, shareRef);
  }

  /**
   * Give read access to referenced columns.
   */
  private _shareTableReferencesForForm(table: MetaRowRecord<'_grist_Tables'>,
                                       shareRef: number) {
    const tables = this.docData.getMetaTable('_grist_Tables');
    const columns = this.docData.getMetaTable('_grist_Tables_column');
    const tableColumns = columns.filterRecords({
      parentId: table.id,
    }).filter(c => c.type.startsWith('Ref:') || c.type.startsWith('RefList:'));
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
      const resource = this._findOrAddResource({
        tableId: tableId,
        colIds: colId,
      });
      const aclFormula = `user.ShareRef == ${shareRef}`;
      const aclFormulaParsed = JSON.stringify(
        [ 'Eq',
          [ 'Attr', [ "Name", "user" ], "ShareRef" ],
          ['Const', shareRef] ]);
      this.rulesTable.addRecord(this._makeRule({
        resource, aclFormula, aclFormulaParsed, permissionsText: '+R',
      }));
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
    const resource = this.resourcesTable.findMatchingRowId(properties);
    if (resource !== 0) { return resource; }
    return this.resourcesTable.addRecord({
      id: 0,
      ...properties,
    });
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
    this.rulesTable.addRecord(this._makeRule({
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
