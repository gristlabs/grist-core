/**
 * Module to help deal with unsaved changes when closing a page.
 */
import {Disposable} from 'grainjs';

/**
 * Create an UnsavedChanges object to indicate there are UnsavedChanges. Dispose it when this is
 * no longer the case. The optional callback will be called to confirm there are indeed unsaved
 * changes. If omitted, it is assumed that there are.
 */
export class UnsavedChange extends Disposable {
  constructor(
    // If given, saveChanges() will call it to save changes.
    private _saveCB?: () => Promise<void>,
    // If given, it may return false to indicate that actually nothing has changed.
    private _haveChanges?: () => boolean,
  ) {
    super();
    unsavedChanges.add(this);
    this.onDispose(() => unsavedChanges.delete(this));
  }
  public haveUnsavedChanges() { return !this._haveChanges || this._haveChanges(); }
  public async save(): Promise<void> { return this._saveCB && this._saveCB(); }
}

export class UnsavedChangeSet {
  private _changes = new Set<UnsavedChange>();

  /**
   * Check if there are any unsaved changes out there.
   */
  public haveUnsavedChanges(): boolean {
    return Array.from(this._changes).some((c) => c.haveUnsavedChanges());
  }

  /**
   * Save any unsaved changes out there.
   */
  public async saveChanges(): Promise<void> {
    await Promise.all(Array.from(this._changes).map((c) => c.save()));
  }

  public add(unsaved: UnsavedChange) { this._changes.add(unsaved); }
  public delete(unsaved: UnsavedChange) { this._changes.delete(unsaved); }
}

// Global set of UnsavedChanges, checked on page unload.
export const unsavedChanges = new UnsavedChangeSet();
