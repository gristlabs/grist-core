import {AppModel, reportError} from 'app/client/models/AppModel';
import {AxiosProgressEvent} from 'axios';
import {PluginScreen} from 'app/client/components/PluginScreen';
import {guessTimezone} from 'app/client/lib/guessTimezone';
import {ImportSourceElement} from 'app/client/lib/ImportSourceElement';
import {ImportProgress} from 'app/client/ui/ImportProgress';
import {IMPORTABLE_EXTENSIONS} from 'app/client/lib/uploads';
import {openFilePicker} from 'app/client/ui/FileDialog';
import {byteString} from 'app/common/gutil';
import {uploadFiles} from 'app/client/lib/uploads';

/**
 * Imports a document and returns its docId, or null if no files were selected.
 */
export async function docImport(app: AppModel, workspaceId: number|"unsaved"): Promise<string|null> {
  // We use openFilePicker() and uploadFiles() separately, rather than the selectFiles() helper,
  // because we only want to connect to a docWorker if there are in fact any files to upload.

  // Start selecting files.  This needs to start synchronously to be seen as a user-initiated
  // popup, or it would get blocked by default in a typical browser.
  const files: File[] = await openFilePicker({
    multiple: false,
    accept: IMPORTABLE_EXTENSIONS.join(","),
  });

  if (!files.length) { return null; }

  return await fileImport(files, app, workspaceId);
}

/**
 * Imports a document from a file and returns its docId.
 */
export async function fileImport(
  files: File[], app: AppModel, workspaceId: number | "unsaved"): Promise<string | null> {
  // There is just one file (thanks to {multiple: false} above).
  const progressUI = app.notifier.createProgressIndicator(files[0].name, byteString(files[0].size));
  const progress = ImportProgress.create(progressUI, progressUI, files[0]);
  try {
    const timezone = await guessTimezone();

    if (workspaceId === "unsaved") {
      function onUploadProgress(ev: AxiosProgressEvent) {
        if (ev.event.lengthComputable) {
          progress.setUploadProgress(ev.event.loaded / ev.event.total * 100);   // percentage complete
        }
      }
      return await app.api.importUnsavedDoc(files[0], {timezone, onUploadProgress});
    } else {
      // Connect to a docworker.  Imports share some properties of documents but not all. In place of
      // docId, for the purposes of work allocation, we use the special assigmentId `import`.
      const docWorker = await app.api.getWorkerAPI('import');

      // This uploads to the docWorkerUrl saved in window.gristConfig
      const uploadResult = await uploadFiles(files, {docWorkerUrl: docWorker.url, sizeLimit: 'import'},
        (p) => progress.setUploadProgress(p));
      const importResult = await docWorker.importDocToWorkspace(uploadResult!.uploadId, workspaceId, {timezone});
      return importResult.id;
    }
  } catch (err) {
    reportError(err);
    return null;
  } finally {
    progress.finish();
    // Dispose the indicator UI and the progress timer owned by it.
    progressUI.dispose();
  }
}
/**
 * Imports document through a plugin from a home/welcome screen.
 */
export async function importFromPlugin(
  app: AppModel,
  workspaceId: number | "unsaved",
  importSourceElem: ImportSourceElement
) {
  const screen = PluginScreen.create(null, importSourceElem.importSource.label);
  try {

    const plugin = importSourceElem.plugin;
    const handle = screen.renderPlugin(plugin);
    const importSource = await importSourceElem.importSourceStub.getImportSource(handle);
    plugin.removeRenderTarget(handle);

    if (importSource) {
      // If data has been picked, upload it.
      const item = importSource.item;
      if (item.kind === "fileList") {
        const files = item.files.map(({ content, name }) => new File([content], name));
        const docId = await fileImport(files, app, workspaceId);
        screen.close();
        return docId;
      } else if (item.kind === "url") {
        //TODO: importing from url is not yet implemented.
        //uploadResult = await fetchURL(this._docComm, item.url);
        throw new Error("Url is not supported yet");
      } else {
        throw new Error(`Import source of kind ${(item as any).kind} are not yet supported!`);
      }
    } else {
      screen.close();
      return null;
    }
  } catch (err) {
    screen.renderError(err.message);
    return null;
  }
}
