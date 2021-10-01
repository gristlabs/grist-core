import {getHomeUrl, reportError} from 'app/client/models/AppModel';
import {BillingModel} from 'app/client/models/BillingModel';
import {createUserImage} from 'app/client/ui/UserImage';
import {cssEmailInput, cssEmailInputContainer, cssMailIcon, cssMemberBtn, cssMemberImage, cssMemberListItem,
        cssMemberPrimary, cssMemberSecondary, cssMemberText, cssRemoveIcon} from 'app/client/ui/UserItem';
import {bigPrimaryButton} from 'app/client/ui2018/buttons';
import {testId} from 'app/client/ui2018/cssVars';
import {normalizeEmail} from 'app/common/emails';
import {FullUser} from 'app/common/LoginSessionAPI';
import {Organization, UserAPI, UserAPIImpl} from 'app/common/UserAPI';
import {Computed, Disposable, dom, obsArray, ObsArray, Observable, styled} from 'grainjs';
import pick = require('lodash/pick');

export class BillingPlanManagers extends Disposable {

  private readonly _userAPI: UserAPI = new UserAPIImpl(getHomeUrl());
  private readonly _email: Observable<string> = Observable.create(this, "");
  private readonly _managers = this.autoDispose(obsArray<FullUser>([]));
  private readonly _orgMembers: ObsArray<FullUser> = this.autoDispose(obsArray<FullUser>([]));
  private readonly _isValid: Observable<boolean> = Observable.create(this, false);
  private readonly _loading: Observable<boolean> = Observable.create(this, true);

  private _emailElem: HTMLInputElement;

  constructor(
    private readonly _model: BillingModel,
    private readonly _currentOrg: Organization,
    private readonly _currentValidUser: FullUser|null
  ) {
    super();
    this._initialize().catch(reportError);
  }

  public buildDom() {
    const enableAdd: Computed<boolean> = Computed.create(null, (use) =>
      Boolean(use(this._email) && use(this._isValid) && !use(this._loading)));
    return dom('div',
      dom.autoDispose(enableAdd),
      cssMemberList(
        dom.forEach(this._managers, manager => this._buildManagerRow(manager)),
      ),
      cssEmailInputRow(
        cssEmailInputContainer({style: `flex: 1 1 0; margin: 0 7px 0 0;`},
          cssMailIcon('Mail'),
          this._emailElem = cssEmailInput(this._email, {onInput: true, isValid: this._isValid},
            {type: "email", placeholder: "Enter email address"},
            dom.on('keyup', (e: KeyboardEvent) => {
              switch (e.keyCode) {
                case 13: return this._commit();
                default: return this._update();
              }
            }),
            dom.boolAttr('disabled', this._loading)
          ),
          cssEmailInputContainer.cls('-green', enableAdd),
          cssEmailInputContainer.cls('-disabled', this._loading),
          testId('bpm-manager-new')
        ),
        bigPrimaryButton('Add Billing Contact',
          dom.on('click', () => this._commit()),
          dom.boolAttr('disabled', (use) => !use(enableAdd)),
          testId('bpm-manager-add')
        )
      )
    );
  }

  private _buildManagerRow(manager: FullUser) {
    const isCurrentUser = this._currentValidUser && manager.id === this._currentValidUser.id;
    return cssMemberListItem({style: 'width: auto;'},
      cssMemberImage(
        createUserImage(manager, 'large')
      ),
      cssMemberText(
        cssMemberPrimary(manager.name || dom('span', manager.email, testId('bpm-email'))),
        manager.name ? cssMemberSecondary(manager.email, testId('bpm-email')) : null
      ),
      cssMemberBtn(
        cssRemoveIcon('Remove', testId('bpm-manager-delete')),
        cssMemberBtn.cls('-disabled', (use) => Boolean(use(this._loading) || isCurrentUser)),
        // Click handler.
        dom.on('click', () => this._loading.get() || isCurrentUser || this._remove(manager))
      ),
      testId('bpm-manager')
    );
  }

  private async _initialize(): Promise<void> {
    if (this._currentValidUser) {
      const managers = await this._model.fetchManagers();
      const {users} = await this._userAPI.getOrgAccess(this._currentOrg.id);
      // This next line is here primarily for tests, where pages may be opened and closed
      // rapidly and we only want to log "real" errors.
      if (this.isDisposed()) { return; }
      const fullUsers = users.filter(u => u.access).map(u => pick(u, ['id', 'name', 'email', 'picture']));
      this._managers.set(managers);
      this._orgMembers.set(fullUsers);
      this._loading.set(false);
    }
  }

  // Add the currently entered email if valid, or trigger a validation message if not.
  private async _commit() {
    await this._update();
    if (this._email.get() && this._isValid.get()) {
      try {
        await this._add(this._email.get());
        this._email.set("");
        this._emailElem.focus();
      } catch (e) {
        this._emailElem.setCustomValidity(e.message);
      }
    }
    (this._emailElem as any).reportValidity();
  }

  private async _update() {
    this._emailElem.setCustomValidity("");
    this._isValid.set(this._emailElem.checkValidity());
  }

  // Add the user with the given email as a plan manager.
  private async _add(email: string): Promise<void> {
    email = normalizeEmail(email);
    const member = this._managers.get().find((m) => m.email === email);
    const possible = this._orgMembers.get().find((m) => m.email === email);
    // These errors should be reported by the email validity checker in _commit().
    if (member) { throw new Error("This user is already in the list"); }
    // TODO: Allow adding non-members of the org as billing plan managers with confirmation.
    if (!possible) { throw new Error("Only members of the org can be billing plan managers"); }
    this._loading.set(true);
    await this._doAddManager(possible);
    this._loading.set(false);
  }

  // Remove the user from the list of plan managers.
  private async _remove(manager: FullUser): Promise<void> {
    this._loading.set(true);
    try {
      await this._model.removeManager(manager.email);
      const index = this._managers.get().findIndex((m) => m.id === manager.id);
      this._managers.splice(index, 1);
    } catch (e) {
      // TODO: Report error in a friendly way.
      reportError(e);
    }
    this._loading.set(false);
  }

  // TODO: Use to confirm adding non-org members as plan managers.
  // private _showConfirmAdd(orgName: string, user: FullUser) {
  //   const nameSpaced = user.name ? `${user.name} ` : '';
  //   return confirmModal('Add Plan Manager', 'Add', () => this._doAddManager(user),
  //     `User ${nameSpaced}with email ${user.email} is not a member of organization ${orgName}. ` +
  //     `Add user to ${orgName}?`)
  // }

  private async _doAddManager(user: FullUser) {
    try {
      await this._model.addManager(user.email);
      this._managers.push(user);
    } catch (e) {
      // TODO: Report error in a friendly way.
      reportError(e);
    }
  }
}

const cssMemberList = styled('div', `
  flex: 1 1 0;
  margin: 20px 0;
  width: 100%;
  overflow-y: auto;
`);

const cssEmailInputRow = styled('div', `
  display: flex;
  margin: 28px 0;
`);
