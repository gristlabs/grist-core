/**
 * Module to help deal with unsaved changes when closing a page.
 */
import { makeT } from "app/client/lib/localization";
import { saveModal } from "app/client/ui2018/modals";

import { Disposable } from "grainjs";

const t = makeT("UnsavedChanges");

export type Behavior = "auto" | "manual";

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
   * If there are changes that need confirmation before leaving, show a dialog.
   * Returns true if navigation should proceed, false if the user chose to stay.
   */
  public async canLeavePage(): Promise<boolean> {
    const change = this.findManualSaveChange();
    if (!change) { return Promise.resolve(true); }

    return new Promise((resolve) => {
      saveModal(() => ({
        title: t("Unsaved changes"),
        body: t("You have unsaved changes. If you leave now, your changes will be lost."),
        saveLabel: t("Exit without saving"),
        saveFunc: async () => { resolve(true); },
        cancelLabel: t("Stay on the page"),
        defaultCancel: true,
      }), {
        onCancel: () => resolve(false),
      });
    });
  }

  public add(unsaved: UnsavedChange) { this._changes.add(unsaved); }
  public delete(unsaved: UnsavedChange) { this._changes.delete(unsaved); }
}

// Global set of UnsavedChanges, checked on page unload.
export const unsavedChanges = new UnsavedChangeSet();
