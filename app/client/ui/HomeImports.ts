import {PluginScreen} from 'app/client/components/PluginScreen';
import {guessTimezone} from 'app/client/lib/guessTimezone';
import {ImportSourceElement} from 'app/client/lib/ImportSourceElement';
import {IMPORTABLE_EXTENSIONS, uploadFiles} from 'app/client/lib/uploads';
import {AppModel, reportError} from 'app/client/models/AppModel';
import {IProgress} from 'app/client/models/NotifyModel';
import {openFilePicker} from 'app/client/ui/FileDialog';
import {byteString} from 'app/common/gutil';
import {Disposable} from 'grainjs';

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
      function onUploadProgress(ev: ProgressEvent) {
        if (ev.lengthComputable) {
          progress.setUploadProgress(ev.loaded / ev.total * 100);   // percentage complete
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

export class ImportProgress extends Disposable {
  // Import does upload first, then import. We show a single indicator, estimating which fraction
  // of the time should be given to upload (whose progress we can report well), and which to the
  // subsequent import (whose progress indicator is mostly faked).
  private _uploadFraction: number;
  private _estImportSeconds: number;

  private _importTimer: null | ReturnType<typeof setInterval> = null;
  private _importStart: number = 0;

  constructor(private _progressUI: IProgress, file: File) {
    super();
    // We'll assume that for .grist files, the upload takes 90% of the total time, and for other
    // files, 40%.
    this._uploadFraction = file.name.endsWith(".grist") ? 0.9 : 0.4;

    // TODO: Import step should include a progress callback, to be combined with upload progress.
    // Without it, we estimate import to take 2s per MB (non-scientific unreliable estimate), and
    // use an asymptotic indicator which keeps moving without ever finishing. Not terribly useful,
    // but does slow down for larger files, and is more comforting than a stuck indicator.
    this._estImportSeconds = file.size / 1024 / 1024 * 2;

    this._progressUI.setProgress(0);
    this.onDispose(() => this._importTimer && clearInterval(this._importTimer));
  }

  // Once this reaches 100, the import stage begins.
  public setUploadProgress(percentage: number) {
    this._progressUI.setProgress(percentage * this._uploadFraction);
    if (percentage >= 100 && !this._importTimer) {
      this._importStart = Date.now();
      this._importTimer = setInterval(() => this._onImportTimer(), 100);
    }
  }

  public finish() {
    if (this._importTimer) {
      clearInterval(this._importTimer);
    }
    this._progressUI.setProgress(100);
  }

  /**
   * Calls _progressUI.setProgress(percent) with percentage increasing from 0 and asymptotically
   * approaching 100, reaching 50% after estSeconds. It's intended to look reasonable when the
   * estimate is good, and to keep showing slowing progress even if it's not.
   */
  private _onImportTimer() {
    const elapsedSeconds = (Date.now() - this._importStart) / 1000;
    const importProgress = elapsedSeconds / (elapsedSeconds + this._estImportSeconds);
    const progress = this._uploadFraction + importProgress * (1 - this._uploadFraction);
    this._progressUI.setProgress(100 * progress);
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
