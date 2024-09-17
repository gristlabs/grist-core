import {IProgress} from 'app/client/models/NotifyModel';
import {Disposable} from 'grainjs';

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
