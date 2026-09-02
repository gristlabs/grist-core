/**
 * Module to help deal with unsaved changes when closing a page.
 */
import { Disposable } from "grainjs";

export type Behavior = "auto" | "manual";

export type ManualConfirmModal = () => Promise<boolean>;

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
    public readonly behavior: Behavior = "auto",
  ) {
    super();
    unsavedChanges.add(this);
    this.onDispose(() => unsavedChanges.delete(this));
  }

  public haveUnsavedChanges() { return !this._haveChanges || this._haveChanges(); }
  public async save(): Promise<void> { return this._saveCB?.(); }
}

export class UnsavedChangeSet {
  private _changes = new Set<UnsavedChange>();
  private _manualConfirmModal?: ManualConfirmModal;

  /**
   * Check if there are any unsaved changes out there.
   */
  public haveUnsavedChanges(): boolean {
    return Array.from(this._changes).some(c => c.haveUnsavedChanges());
  }

  /**
   * Save any unsaved changes that should be saved automatically on navigation.
   */
  public async saveChanges(): Promise<void> {
    await Promise.all(
      Array.from(this._changes)
        .filter(c => c.behavior === "auto" && c.haveUnsavedChanges())
        .map(c => c.save()),
    );
  }

  public findManualSaveChange(): UnsavedChange | undefined {
    return Array.from(this._changes)
      .find(c => c.behavior === "manual" && c.haveUnsavedChanges());
  }

  /**
   * Configure the modal that will be shown to the user when there are "manual save" changes.
   *
   * The modal handler should return a promise that resolves to true if the user wants to leave,
   * false if they want to stay on the page.
   *
   * This is coded this way mostly to avoid annoying circular imports with urlState/theme.
   */
  public setManualConfirmModal(handler: ManualConfirmModal) {
    this._manualConfirmModal = handler;
  }

  /**
   * If there are changes that need confirmation before leaving, ask the previously configured modal.
   * Returns true if navigation should proceed, false if the user chose to stay.
   */
  public async canLeavePage(): Promise<boolean> {
    if (!this.findManualSaveChange()) { return true; }
    if (!this._manualConfirmModal) { return true; }
    return this._manualConfirmModal();
  }

  public add(unsaved: UnsavedChange) { this._changes.add(unsaved); }
  public delete(unsaved: UnsavedChange) { this._changes.delete(unsaved); }
}

// Global set of UnsavedChanges, checked on page unload.
export const unsavedChanges = new UnsavedChangeSet();
