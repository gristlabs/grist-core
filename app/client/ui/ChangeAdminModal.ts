import { makeT } from "app/client/lib/localization";
import { cssInput } from "app/client/ui/cssInput";
import { cssField, cssLabel } from "app/client/ui/MakeCopyMenu";
import { cssRadioCheckboxOptions, radioCheckboxOption } from "app/client/ui2018/checkbox";
import { isEmail } from "app/common/gutil";
import { InstallAPI } from "app/common/InstallAPI";

import { Computed, Disposable, dom, input, Observable } from "grainjs";

const t = makeT("ChangeAdminModal");

export interface ChangeAdminModalOptions {
  currentUserEmail: string;
  installAPI: InstallAPI;
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

  /**
   * Replace cannot succeed when an account already exists at the new admin
   * email -- the rename would violate logins.email's uniqueness, and the
   * resulting restart-time failure rolls back the whole change. Check up
   * front and throw a useful error so saveModal keeps the modal open.
   */
  public async save() {
    const email = this._email.get();
    const replace = this._replace.get();
    if (replace && await this._options.installAPI.userExists(email)) {
      throw new Error(t("An account with {{email}} already exists.", { email }));
    }
    await this._options.onSave({ email, replace });
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
