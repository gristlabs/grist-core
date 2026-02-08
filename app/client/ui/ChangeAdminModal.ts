import { makeT } from "app/client/lib/localization";
import { cssInput } from "app/client/ui/cssInput";
import { cssField, cssLabel } from "app/client/ui/MakeCopyMenu";
import { cssRadioCheckboxOptions, radioCheckboxOption } from "app/client/ui2018/checkbox";
import { isEmail } from "app/common/gutil";

import { Computed, Disposable, dom, input, Observable } from "grainjs";

const t = makeT("ChangeAdminModal");

export interface ChangeAdminModalOptions {
  currentUserEmail: string;
  defaultEmail?: string;
  onSave: (fields: { email: string, replace: boolean }) => Promise<void>;
}

export class ChangeAdminModal extends Disposable {
  private _currentUserEmail = this._options.currentUserEmail;
  private _email = Observable.create(this, this._options.defaultEmail ?? "");
  private _replace = Observable.create(this, true);
  private _saveDisabled = Computed.create(this, this._email, (_use, email) => !isEmail(email));

  constructor(private _options: ChangeAdminModalOptions) {
    super();
  }

  public get saveDisabled() { return this._saveDisabled; }

  public async save() {
    await this._options.onSave({ email: this._email.get(), replace: this._replace.get() });
  }

  public buildDom() {
    return [
      cssField(
        cssLabel(t("New admin")),
        input(this._email,
          { onInput: true },
          { placeholder: t("Enter new admin email") },
          dom.cls(cssInput.className),
          (elem) => { setTimeout(() => { elem.focus(); }, 20); },
        ),
      ),
      cssRadioCheckboxOptions(
        radioCheckboxOption(this._replace, true,
          t("Replace {{email}} with the new email throughout. \
The new email will become the installation admin, as well as \
the owner of all materials previously owned by you@example.com.",
          { email: dom("strong", this._currentUserEmail) },
          ),
        ),
        radioCheckboxOption(this._replace, false,
          t("Make the new email the installation admin. \
Orgs, workspaces, and documents will remain owned by {{email}}. \
These changes will take effect after you restart this Grist server.",
          { email: dom("strong", this._currentUserEmail) },
          ),
        ),
      ),
    ];
  }
}
