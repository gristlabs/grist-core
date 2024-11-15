import { TableMetadataLoader } from "app/server/lib/TableMetadataLoader";
import { TableColValues } from "app/common/DocActions";
import { delay } from "app/common/delay";

import { assert } from "chai";

/**
 * A test harness for trying different load timings. Written with delays and pollings so
 * that it doesn't in turn need testing.
 */
class TableMetadataLoaderHarness {
  public fetchWait = new Map<string, number>();
  public loadWait = new Map<string, number>();
  public loaded = new Set<string>();

  public async loadMetaTables(tables: Buffer, columns: Buffer): Promise<any> {
    await delay(this.loadWait.get('metatables') || 1000);
    this.loaded.add('metatables');
  }

  public async loadTable(tableId: string, buffer: Buffer): Promise<any> {
    await delay(this.loadWait.get(tableId) || 1000);
    this.loaded.add(tableId);
  }

  public decodeBuffer(buffer: Buffer, tableId: string): TableColValues {
    return 1 as any;
  }

  public async fetchTable(tableId: string): Promise<Buffer> {
    await delay(this.fetchWait.get(tableId) || 1000);
    return Buffer.from(tableId);
  }
}

describe('TableMetadataLoader', function() {
  this.timeout(10000);

  it('check flow works with typical operation order', async function() {
    for (let i = 0; i < 5; i++) {
      const harness = new TableMetadataLoaderHarness();
      const loader = new TableMetadataLoader(harness);
      for (const key of ['_grist_Tables', '_grist_Tables_column', '_grist_DocInfo',
                         '_grist_Thing', 'User', 'metatables']) {
        harness.fetchWait.set(key, Math.random() * 100);
        harness.loadWait.set(key, Math.random() * 100);
      }
      loader.startFetchingTable('_grist_DocInfo');
      await loader.fetchBulkColValuesWithoutIds('_grist_DocInfo');
      loader.startStreamingToEngine();
      loader.startFetchingTable('_grist_Tables');
      loader.startFetchingTable('_grist_Tables_column');
      loader.startFetchingTable('_grist_Thing');
      assert.deepEqual(Object.keys(await loader.fetchTablesAsActions()).sort(),
                       ['_grist_DocInfo', '_grist_Tables', '_grist_Tables_column', '_grist_Thing']);
      loader.startFetchingTable('User');
      await loader.wait();
      assert.deepEqual(Object.keys(await loader.fetchTablesAsActions()).sort(),
                       ['User', '_grist_DocInfo', '_grist_Tables', '_grist_Tables_column', '_grist_Thing']);
      assert.deepEqual([...harness.loaded].sort(),
                       ['User', '_grist_DocInfo', '_grist_Thing', 'metatables']);
    }
  });

  it('check flow works with atypical operation order', async function() {
    for (let i = 0; i < 5; i++) {
      const harness = new TableMetadataLoaderHarness();
      const loader = new TableMetadataLoader(harness);
      for (const key of ['_grist_Tables', '_grist_Tables_column', '_grist_DocInfo',
                         '_grist_Thing', 'User', 'metatables']) {
        harness.fetchWait.set(key, Math.random() * 100);
        harness.loadWait.set(key, Math.random() * 100);
      }
      loader.startStreamingToEngine();
      loader.startFetchingTable('User');
      loader.startFetchingTable('_grist_Thing');
      loader.startFetchingTable('_grist_Tables_column');
      loader.startFetchingTable('_grist_Tables');
      loader.startFetchingTable('_grist_DocInfo');
      await loader.wait();
      assert.deepEqual(Object.keys(await loader.fetchTablesAsActions()).sort(),
                       ['User', '_grist_DocInfo', '_grist_Tables', '_grist_Tables_column', '_grist_Thing']);
      assert.deepEqual([...harness.loaded].sort(),
                       ['User', '_grist_DocInfo', '_grist_Thing', 'metatables']);
    }
  });
});
