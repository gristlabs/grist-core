import { HomeDBManager } from 'app/gen-server/lib/HomeDBManager';
import { ActiveDoc } from 'app/server/lib/ActiveDoc';
import { ScopedSession } from 'app/server/lib/BrowserSession';
import * as Comm from 'app/server/lib/Comm';
import { DocManager } from 'app/server/lib/DocManager';
import { ExternalStorage } from 'app/server/lib/ExternalStorage';
import { GristServer } from 'app/server/lib/GristServer';
import { IBilling } from 'app/server/lib/IBilling';
import { IDocStorageManager } from 'app/server/lib/IDocStorageManager';
import { IInstanceManager } from 'app/server/lib/IInstanceManager';
import { ILoginSession } from 'app/server/lib/ILoginSession';
import { INotifier } from 'app/server/lib/INotifier';
import { ISandbox, ISandboxCreationOptions } from 'app/server/lib/ISandbox';
import { IShell } from 'app/server/lib/IShell';
import { PluginManager } from 'app/server/lib/PluginManager';

export interface ICreate {
  LoginSession(comm: Comm, sid: string, domain: string, scopeSession: ScopedSession,
               instanceManager: IInstanceManager|null): ILoginSession;
  Billing(dbManager: HomeDBManager): IBilling;
  Notifier(dbManager: HomeDBManager, homeUrl: string): INotifier;
  Shell(): IShell|undefined;
  ExternalStorage(bucket: string, prefix: string): ExternalStorage|undefined;
  ActiveDoc(docManager: DocManager, docName: string): ActiveDoc;
  DocManager(storageManager: IDocStorageManager, pluginManager: PluginManager,
             homeDbManager: HomeDBManager|null, gristServer: GristServer): DocManager;
  NSandbox(options: ISandboxCreationOptions): ISandbox;

  sessionSecret(): string;
}
