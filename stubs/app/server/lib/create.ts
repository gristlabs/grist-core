import { HomeDBManager } from 'app/gen-server/lib/HomeDBManager';
import { ActiveDoc } from 'app/server/lib/ActiveDoc';
import { DocManager } from 'app/server/lib/DocManager';
import { ICreate } from 'app/server/lib/ICreate';
import { LoginSession } from 'app/server/lib/LoginSession';
import { NSandbox } from 'app/server/lib/NSandbox';

export const create: ICreate = {
  LoginSession() {
    return new LoginSession();
  },
  Billing(dbManager: HomeDBManager) {
    return {
      addEndpoints(app: any) { /* do nothing */ },
      addEventHandlers() { /* do nothing */ },
      addWebhooks(app: any) { /* do nothing */ }
    };
  },
  Notifier(dbManager: HomeDBManager, homeUrl: string) {
    return {
      get testPending() { return false; }
    };
  },
  Shell() {
    return {
      moveItemToTrash()  { throw new Error('moveToTrash unavailable'); },
      showItemInFolder() { throw new Error('showItemInFolder unavailable'); }
    };
  },
  ExternalStorage() { return undefined; },
  ActiveDoc(docManager, docName) { return new ActiveDoc(docManager, docName); },
  DocManager(storageManager, pluginManager, homeDBManager, gristServer) {
    return new DocManager(storageManager, pluginManager, homeDBManager, gristServer);
  },
  NSandbox(options) {
    const args = [options.entryPoint || 'grist/main.pyc'];
    if (!options.entryPoint && options.comment) {
      // Note that docName isn't used by main.py, but it makes it possible to tell in `ps` output
      // which sandbox process is for which document.
      args.push(options.comment);
    }
    const selLdrArgs: string[] = [];
    if (options.sandboxMount) {
      selLdrArgs.push(
        // TODO: Only modules that we share with plugins should be mounted. They could be gathered in
        // a "$APPROOT/sandbox/plugin" folder, only which get mounted.
        '-E', 'PYTHONPATH=grist:thirdparty',
        '-m', `${options.sandboxMount}:/sandbox:ro`);
    }
    if (options.importMount) {
      selLdrArgs.push('-m', `${options.importMount}:/importdir:ro`);
    }
    return new NSandbox({
      args,
      logCalls: options.logCalls,
      logMeta: options.logMeta,
      logTimes: options.logTimes,
      selLdrArgs,
    });
  },
  sessionSecret() {
    return process.env.GRIST_SESSION_SECRET ||
      'Phoo2ag1jaiz6Moo2Iese2xoaphahbai3oNg7diemohlah0ohtae9iengafieS2Hae7quungoCi9iaPh';
  }
};
