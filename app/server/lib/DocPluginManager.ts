import { ApplyUAResult } from 'app/common/ActiveDocAPI';
import { fromTableDataAction, TableColValues } from 'app/common/DocActions';
import * as gutil from 'app/common/gutil';
import { LocalPlugin } from 'app/common/plugin';
import { createRpcLogger, PluginInstance } from 'app/common/PluginInstance';
import { Promisified } from 'app/common/tpromisified';
import { ParseFileResult, ParseOptions } from 'app/plugin/FileParserAPI';
import { checkers, GristTable } from "app/plugin/grist-plugin-api";
import { AccessTokenResult, GristDocAPI } from "app/plugin/GristAPI";
import { Storage } from 'app/plugin/StorageAPI';
import { ActiveDoc } from 'app/server/lib/ActiveDoc';
import { DocPluginData } from 'app/server/lib/DocPluginData';
import { makeExceptionalDocSession } from 'app/server/lib/DocSession';
import { FileParserElement } from 'app/server/lib/FileParserElement';
import { GristServer } from 'app/server/lib/GristServer';
import log from 'app/server/lib/log';
import { SafePythonComponent } from 'app/server/lib/SafePythonComponent';
import { UnsafeNodeComponent } from 'app/server/lib/UnsafeNodeComponent';
import { promisifyAll } from 'bluebird';
import * as fse from 'fs-extra';
import * as path from 'path';
import tmp from 'tmp';


promisifyAll(tmp);

/**
 * Implements GristDocAPI interface.
 */
class GristDocAPIImpl implements GristDocAPI {
  constructor(private _activeDoc: ActiveDoc) { }

  public async getDocName() { return this._activeDoc.docName; }

  public async listTables(): Promise<string[]> {
    return this._activeDoc.docData!.getMetaTable('_grist_Tables')
      .getRecords()
      .filter(r => !r.summarySourceTable)
      .map(r => r.tableId);
  }

  public async fetchTable(tableId: string): Promise<TableColValues> {
    return fromTableDataAction(await this._activeDoc.fetchTable(
      makeExceptionalDocSession('plugin'), tableId));
  }

  public applyUserActions(actions: any[][]): Promise<ApplyUAResult> {
    return this._activeDoc.applyUserActions(makeExceptionalDocSession('plugin'), actions);
  }

  // These implementations of GristDocAPI are from an early implementation of
  // plugins that is incompatible with access control. No need to add new
  // methods here.
  public async getAccessToken(): Promise<AccessTokenResult> {
    throw new Error('getAccessToken not implemented');
  }
}

/**
 * DocPluginManager manages plugins for a document.
 *
 * DocPluginManager instantiates asynchronously. Wait for the `ready` to resolve before using any
 * plugin.
 *
 */
export class DocPluginManager {

  public readonly plugins: { [s: string]: PluginInstance } = {};
  public readonly ready: Promise<any>;
  public readonly gristDocAPI: GristDocAPI;

  private _tmpDir: string;
  private _pluginInstances: PluginInstance[];


  constructor(
    private _localPlugins: LocalPlugin[],
    private _appRoot: string,
    private _activeDoc: ActiveDoc,
    private _server: GristServer
  ) {
    this.gristDocAPI = new GristDocAPIImpl(_activeDoc);
    this._pluginInstances = [];
    this.ready = this._initialize();
  }

  public tmpDir(): string {
    return this._tmpDir;
  }

  /**
   * To be moved in ActiveDoc.js as a new implementation for ActiveDoc.importFile.
   * Throws if no importers can parse the file.
   */
  public async parseFile(filePath: string, fileName: string, parseOptions: ParseOptions): Promise<ParseFileResult> {

    // Support an existing grist json format directly for files with a "jgrist"
    // extension.
    if (path.extname(fileName) === '.jgrist') {
      try {
        const result = JSON.parse(await fse.readFile(filePath, 'utf8')) as ParseFileResult;
        result.parseOptions = {};
        // The parseOptions component isn't checked here, since it seems free-form.
        checkers.ParseFileResult.check(result);
        checkReferences(result.tables);
        return result;
      } catch (err) {
        throw new Error('Grist json format could not be parsed: ' + err);
      }
    }

    if (path.extname(fileName) === '.grist') {
      throw new Error(`To import a grist document use the "Import document" menu option on your home screen`);
    }

    const matchingFileParsers: FileParserElement[] = FileParserElement.getMatching(this._pluginInstances, fileName);

    if (!this._tmpDir) {
      throw new Error("DocPluginManager: initialization has not completed");
    }

    // TODO: PluginManager shouldn't patch path here. Instead it should expose a method to create
    // dataSources, that would move the file to under _tmpDir and return an object with the relative
    // path.
    filePath = path.relative(this._tmpDir, filePath);
    log.debug(`parseFile: found ${matchingFileParsers.length} fileParser with matching file extensions`);
    const messages = [];
    for (const { plugin, parseFileStub } of matchingFileParsers) {
      const name = plugin.definition.id;
      try {
        log.info(`DocPluginManager.parseFile: calling to ${name} with ${filePath}`);
        const result = await parseFileStub.parseFile({ path: filePath, origName: fileName }, parseOptions);
        checkers.ParseFileResult.check(result);
        checkReferences(result.tables);
        return result;
      } catch (err) {
        const cleanerMessage = err.message.replace(/^\[Sandbox\] (Exception)?/, '').trim();
        messages.push(cleanerMessage);
        log.warn(`DocPluginManager.parseFile: ${name} Failed parseFile `, err.message);
        continue;
      }
    }

    if (messages.length) {
      const extToType: Record<string, string> = {
        '.xlsx' : 'Excel',
        '.json' : 'JSON',
        '.csv' : 'CSV',
        '.tsv' : 'TSV',
        '.dsv' : 'PSV',
      };
      const fileType = extToType[path.extname(fileName)] || path.extname(fileName);
      throw new Error(`Failed to parse ${fileType} file.\nError: ${messages.join("; ")}`);
    }
    throw new Error(`File format is not supported.`);
  }

  /**
   * Returns a list of plugins definitions.
   */
  public getPlugins(): LocalPlugin[] {
    return this._localPlugins;
  }

  /**
   * Shut down all plugins for this document.
   */
  public async shutdown(): Promise<void> {
    const names = Object.keys(this.plugins);
    log.debug("DocPluginManager.shutdown cleaning up %s plugins", names.length);
    await Promise.all(names.map(name => this.plugins[name].shutdown()));
    if (this._tmpDir) {
      log.debug("DocPluginManager.shutdown removing tmpDir %s", this._tmpDir);
      await fse.remove(this._tmpDir);
    }
  }

  /**
   * Reload plugins: shutdown all plugins, clear list of plugins and load new ones. Returns a
   * promise that resolves when initialisation is done.
   */
  public async reload(plugins: LocalPlugin[]): Promise<void> {
    await this.shutdown();
    this._pluginInstances = [];
    this._localPlugins = plugins;
    await this._initialize();
  }

  public receiveAction(action: any[]): void {
    for (const plugin of this._pluginInstances) {
      const unsafeNode = plugin.unsafeNode as UnsafeNodeComponent;
      if (unsafeNode) {
        unsafeNode.receiveAction(action);
      }
    }
  }

  private async _initialize(): Promise<void> {
    this._tmpDir = await tmp.dirAsync({ prefix: 'grist-tmp-', unsafeCleanup: true });
    for (const plugin of this._localPlugins) {
      try {
        // todo: once Comm has been replaced by grain-rpc, pluginInstance.rpc should forward '*' to client
        const pluginInstance = new PluginInstance(plugin, createRpcLogger(log, `PLUGIN ${plugin.id}:`));
        pluginInstance.rpc.registerForwarder('grist', pluginInstance.rpc, '');
        pluginInstance.rpc.registerImpl<GristDocAPI>("GristDocAPI", this.gristDocAPI, checkers.GristDocAPI);
        pluginInstance.rpc.registerImpl<Promisified<Storage>>("DocStorage",
          new DocPluginData(this._activeDoc.docStorage, plugin.id), checkers.Storage);
        const components = plugin.manifest.components;
        if (components) {
          const { safePython, unsafeNode } = components;
          if (safePython) {
            const comp = pluginInstance.safePython = new SafePythonComponent(plugin, this._tmpDir,
              this._activeDoc.docName, this._server);
            pluginInstance.rpc.registerForwarder(safePython, comp);
          }
          if (unsafeNode) {
            const gristDocPath = this._activeDoc.docStorage.docPath;
            const comp = pluginInstance.unsafeNode = new UnsafeNodeComponent(plugin, pluginInstance.rpc, unsafeNode,
              this._appRoot, gristDocPath);
            pluginInstance.rpc.registerForwarder(unsafeNode, comp);
          }
        }
        this._pluginInstances.push(pluginInstance);
      } catch (err) {
        log.info(`DocPluginInstance: failed to create instance ${plugin.id}: ${err.message}`);
      }
    }
    for (const instance of this._pluginInstances) {
      this.plugins[instance.definition.id] = instance;
    }
  }
}

/**
 * Checks that tables include all the tables referenced by tables columns. Throws an exception
 * otherwise.
 */
function checkReferences(tables: GristTable[]) {
  const tableIds = tables.map(table => table.table_name);
  for (const table of tables) {
    for (const col of table.column_metadata) {
      const refTableId = gutil.removePrefix(col.type, "Ref:");
      if (refTableId && !tableIds.includes(refTableId)) {
        throw new Error(`Column type: ${col.type}, references an unknown table`);
      }
    }
  }
}
