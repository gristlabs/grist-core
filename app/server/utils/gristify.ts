import { ColInfoWithId } from 'app/common/DocActions';
import { ActiveDoc } from 'app/server/lib/ActiveDoc';
import { DocManager } from 'app/server/lib/DocManager';
import { makeExceptionalDocSession, OptDocSession } from 'app/server/lib/DocSession';
import { createDummyGristServer } from 'app/server/lib/GristServer';
import { TrivialDocStorageManager } from 'app/server/lib/IDocStorageManager';
import { DBMetadata, quoteIdent, SQLiteDB } from 'app/server/lib/SQLiteDB';

/**
 * A utility class for modifying a SQLite file to be viewed/edited with Grist.
 */
export class Gristifier {
  public constructor(private _filename: string) {
  }

  /**
   * Add Grist metadata tables to a SQLite file. After this action,
   * the file can be opened as a Grist document, with partial functionality.
   * Level of functionality will depend on the nature of the tables in the
   * SQLite file.
   *
   * The `user_version` slot of SQLite will be modified by this operation,
   * losing whatever was in it previously.
   *
   * A "manualSort" column may be added to tables by specifying `addSort`,
   * to support a notion of order that exists in spreadsheets.
   *
   * Grist is very finicky about primary keys, and tables that don't match
   * its expectations cannot be viewed or edited directly at the moment.
   * Instead, views are added supporting selects, updates, inserts, and
   * deletes. Structure changes (e.g. adding/removing columns) are not
   * supported unfortunately.
   *
   * This is very much an experiment, with plenty of limits and
   * sharp edges. In general it isn't possible to treat an arbitrary
   * SQLite file as a Grist document, but in particular cases it can
   * work and be very useful.
   */
  public async gristify(options: {addSort?: boolean}) {
    // Remove any existing Grist material from the file.
    await this.degristify();

    // Enumerate user tables and columns.
    const inventory = await this._getUserTables();

    // Grist keeps a schema number in the SQLite "user_version" slot,
    // so we need to zap it. This is the one destructive operation
    // involved in gristification.
    // TODO: consider moving schema information somewhere more neutral.
    await this._zapUserVersion();

    // Open the file as an empty Grist document, creating Grist metadata
    // tables.
    const docManager = new DocManager(
      new TrivialDocStorageManager(), null, null, createDummyGristServer()
    );
    const activeDoc = new ActiveDoc(docManager, this._filename);
    const docSession = makeExceptionalDocSession('system');
    await activeDoc.createEmptyDoc(docSession, {useExisting: true});
    await activeDoc.waitForInitialization();

    // Now "create" user tables and columns with Grist. The creation
    // will be fictitious since the tables and columns already exist -
    // they just don't have metadata describing them to Grist.
    const outcomes: TableOutcome[] = [];
    for (const [tableId, table] of Object.entries(inventory)) {
      const columnDefs = this._collectColumnDefinitions(table);
      if (!('id' in columnDefs)) {
        // Can't handle this table in Grist directly at the moment, but
        // we can do something via a view.
        await this._createView(docSession, activeDoc, tableId, Object.keys(table), columnDefs);
        outcomes.push({tableId, viewed: true, reason: 'id complications'});
      } else {
        await this._registerTable(docSession, activeDoc, tableId, columnDefs);
        if (options.addSort) {
          await this._addManualSort(activeDoc, tableId);
          outcomes.push({tableId, addManualSort: true});
        } else {
          outcomes.push({tableId});
        }
      }
    }
    await activeDoc.shutdown();

    // Give a final readout of what happened for every table, since the
    // conversion process is quite noisy.
    for (const outcome of outcomes) {
      console.log(JSON.stringify(outcome));
    }
  }

  /**
   * Remove all Grist metadata tables. Warning: attachments are considered metadata.
   */
  public async degristify() {
    const db = await SQLiteDB.openDBRaw(this._filename);
    const tables = await db.all(
      `SELECT name FROM sqlite_master WHERE type='table' ` +
        `  AND name LIKE '_grist%'`
    );
    for (const table of tables) {
      console.log(`Removing ${table.name}`);
      await db.exec(`DROP TABLE ${quoteIdent(table.name)}`);
    }
    const views = await db.all(
      `SELECT name FROM sqlite_master WHERE type='view' ` +
        `  AND name LIKE 'GristView%'`
    );
    for (const view of views) {
      console.log(`Removing ${view.name}`);
      await db.exec(`DROP VIEW ${quoteIdent(view.name)}`);
    }
    await db.close();
  }

  /**
   * Make definitions for the table's columns. This is very crude, it handles
   * integers and leaves everything else as "Any".
   */
  private _collectColumnDefinitions(table: DBMetadata[string]) {
    const defs: Record<string, ColInfoWithId> = {};
    for (const [colId, info] of Object.entries(table)) {
      if (colId.startsWith('manualSort')) { continue; }
      const type = info.toLowerCase();
      const c: ColInfoWithId = {
        id: colId,
        type: 'Any',
        isFormula: false,
        formula: '',
      };
      // see https://www.sqlite.org/datatype3.html#determination_of_column_affinity
      if (type.includes('int')) {
        c.type = 'Int';
      }
      if (colId === 'id') {
        if (c.type !== 'Int') {
          // Grist can only support integer id columns.
          // For now, just rename this column out of the way to id2, and use
          // a view to map SQLite's built-in ROWID to the id column.
          // TODO: could collide with a column called "id2".
          c.id = 'id2';
        }
      }
      defs[c.id] = c;
    }
    return defs;
  }

  /**
   * Support tables that don't have an integer column called "id" through views.
   * It would be better to enhance Grist to support a wider variety of scenarios,
   * but this is helpful for now.
   */
  private async _createView(docSession: OptDocSession, activeDoc: ActiveDoc, tableId: string,
                            cols: string[], columnDefs: Record<string, ColInfoWithId>) {
    const newName = `GristView_${tableId}`;
    function quote(name: string) {
      return quoteIdent(name === 'id' ? 'id2' : name);
    }
    function quoteForSelect(name: string) {
      if (name === 'id') { return 'id as id2'; }
      return quoteIdent(name);
    }

    // View table tableId via a view GristView_tableId, with id and manualSort supplied
    // from ROWID. SQLite tables may not have a ROWID, but this is relatively rare.
    await activeDoc.docStorage.exec(`CREATE VIEW ${quoteIdent(newName)} AS SELECT ` +
      ['ROWID AS id', 'ROWID AS manualSort', ...cols.map(quoteForSelect)].join(', ') +
      ` FROM ${quoteIdent(tableId)}`);

    // Make an INSTEAD OF UPDATE trigger, so that if someone tries to update the view,
    // we instead update the underlying table. Updates of manualSort or id are just ignored.
    // The trigger is a little awkward to write since we need to compare OLD and NEW
    // to see what changed - updating unchanged material could needlessly run afoul of
    // constraints.
    const updateTrigger = `CREATE TRIGGER ${quoteIdent('trigger_update_' + newName)} ` +
      `INSTEAD OF UPDATE ON ${quoteIdent(newName)} BEGIN ` +
      cols.map(col =>
        `UPDATE ${quoteIdent(tableId)} SET ` +
        `${quoteIdent(col)} = NEW.${quote(col)} ` +
        ` WHERE OLD.${quote(col)} <> NEW.${quote(col)} ` +
        ` AND ${quoteIdent(tableId)}.ROWID = NEW.ROWID`
              ).join('; ') +
      `; END`;
    await activeDoc.docStorage.exec(updateTrigger);

    // Make an INSTEAD OF INSERT trigger.
    const insertTrigger = `create trigger ${quoteIdent('trigger_insert_' + newName)} ` +
      `INSTEAD OF INSERT ON ${quoteIdent(newName)} BEGIN ` +
      `INSERT INTO ${quoteIdent(tableId)}` +
      '(' + cols.map(quoteIdent).join(',') + ') VALUES(' +
      cols.map(col => `NEW.${quote(col)}`).join(', ') +
      `); END`;
    await activeDoc.docStorage.exec(insertTrigger);

    // Make an INSTEAD OF DELETE trigger.
    const deleteTrigger = `create trigger ${quoteIdent('trigger_delete_' + newName)} ` +
      `INSTEAD OF DELETE ON ${quoteIdent(newName)} BEGIN ` +
      `DELETE FROM ${quoteIdent(tableId)} WHERE ${quoteIdent(tableId)}.ROWID = OLD.ROWID` +
      `; END`;
    await activeDoc.docStorage.exec(deleteTrigger);

    const result = await this._registerTable(docSession, activeDoc, newName, columnDefs);

    // Now, tweak the Grist metadata to make the table name the expected one
    // (the table id as far as Grist is concerned must remain that of the view)
    const id = result.retValues[0].id;
    await activeDoc.docStorage.run('update _grist_Views_section set title = ? ' +
      'where id in (select rawViewSectionRef from _grist_Tables where id = ?)',
                                   [tableId, id]);
    await activeDoc.docStorage.run('update _grist_Views set name = ? ' +
      'where id in (select primaryViewId from _grist_Tables where id = ?)',
                                   [tableId, id]);
  }

  private async _getUserTables(): Promise<DBMetadata> {
    // Enumerate existing tables and columns.
    const db = await SQLiteDB.openDBRaw(this._filename);
    const inventory = await db.collectMetadata();
    await db.close();
    // We are not interested in the special "sqlite_sequence" table.
    delete inventory.sqlite_sequence;
    return inventory;
  }

  private async _zapUserVersion(): Promise<void> {
    const db = await SQLiteDB.openDBRaw(this._filename);
    await db.exec(`PRAGMA user_version = 0`);
    await db.close();
  }

  private async _addManualSort(activeDoc: ActiveDoc, tableId: string) {
    const db = activeDoc.docStorage;
    await db.exec(`ALTER TABLE ${quoteIdent(tableId)} ADD COLUMN manualSort INTEGER`).catch(e => null);
    await db.exec(`UPDATE ${quoteIdent(tableId)} SET manualSort = id`);
  }

  private async _registerTable(docSession: OptDocSession, activeDoc: ActiveDoc,
                               tableId: string, args: Record<string, ColInfoWithId>) {
    delete args.id;
    activeDoc.onlyAllowMetaDataActionsOnDb(true);
    const result = await activeDoc.applyUserActions(docSession, [
      ['AddTable', tableId, Object.values(args)],
    ]);
    activeDoc.onlyAllowMetaDataActionsOnDb(false);
    return result;
  }
}

interface TableOutcome {
  tableId: string;
  skipped?: boolean;
  viewed?: boolean;
  addManualSort?: boolean;
  reason?: string;
}
