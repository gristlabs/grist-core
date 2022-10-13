/**
 * Link or button that opens a menu to make a copy of a document, full or empty. It's used for
 * the sample documents (those in the Support user's Examples & Templates workspace).
 */

import {t} from 'app/client/lib/localization';
import {AppModel, reportError} from 'app/client/models/AppModel';
import {getLoginOrSignupUrl, urlState} from 'app/client/models/gristUrlState';
import {getWorkspaceInfo, ownerName, workspaceName} from 'app/client/models/WorkspaceInfo';
import {cssInput} from 'app/client/ui/cssInput';
import {bigBasicButton, bigPrimaryButtonLink} from 'app/client/ui2018/buttons';
import {labeledSquareCheckbox} from 'app/client/ui2018/checkbox';
import {testId, theme, vars} from 'app/client/ui2018/cssVars';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {select} from 'app/client/ui2018/menus';
import {confirmModal, cssModalBody, cssModalButtons, cssModalWidth, modal, saveModal} from 'app/client/ui2018/modals';
import {FullUser} from 'app/common/LoginSessionAPI';
import * as roles from 'app/common/roles';
import {Document, isTemplatesOrg, Organization, Workspace} from 'app/common/UserAPI';
import {Computed, Disposable, dom, input, Observable, styled, subscribe} from 'grainjs';
import sortBy = require('lodash/sortBy');

const translate = (x: string, args?: any): string => t(`MakeCopyMenu.${x}`, args);

export async function replaceTrunkWithFork(user: FullUser|null, doc: Document, app: AppModel, origUrlId: string) {
  const trunkAccess = (await app.api.getDoc(origUrlId)).access;
  if (!roles.canEdit(trunkAccess)) {
    modal((ctl) => [
      cssModalBody(translate('CannotEditOriginal')),
      cssModalButtons(
        bigBasicButton(translate('Cancel'), dom.on('click', () => ctl.close())),
      )
    ]);
    return;
  }
  const docApi = app.api.getDocAPI(origUrlId);
  const cmp = await docApi.compareDoc(doc.id);
  let titleText = translate('UpdateOriginal');
  let buttonText = translate('Update');
  let warningText = translate('WarningOriginalWillBeUpdated');
  if (cmp.summary === 'left' || cmp.summary === 'both') {
    titleText = translate('OriginalHasModifications');
    buttonText = translate('Overwrite');
    warningText = `${warningText} ${translate('WarningOverwriteOriginalChanges')}`;
  } else if (cmp.summary === 'unrelated') {
    titleText = translate('OriginalLooksUnrelated');
    buttonText = translate('Overwrite');
    warningText = `${warningText} ${translate('WarningWillBeOverwritten')}`;
  } else if (cmp.summary === 'same') {
    titleText = 'Original Looks Identical';
    warningText = `${warningText} ${translate('WarningAlreadyIdentical')}`;
  }
  confirmModal(titleText, buttonText,
    async () => {
      try {
        await docApi.replace({sourceDocId: doc.id});
        await urlState().pushUrl({doc: origUrlId});
      } catch (e) {
        reportError(e);  // For example: no write access on trunk.
      }
    },  warningText);
}

// Show message in a modal with a `Sign up` button that redirects to the login page.
function signupModal(message: string) {
  return modal((ctl) => [
    cssModalBody(message),
    cssModalButtons(
      bigPrimaryButtonLink(translate('SignUp'), {href: getLoginOrSignupUrl(), target: '_blank'}, testId('modal-signup')),
      bigBasicButton(translate('Cancel'), dom.on('click', () => ctl.close())),
    ),
    cssModalWidth('normal'),
  ]);
}

/**
 * Whether we should offer user the option to copy this doc to other orgs.
 * We allow copying out of source org when the source org is a personal org, or user has owner
 * access to the doc, or the doc is public.
 */
function allowOtherOrgs(doc: Document, app: AppModel): boolean {
  const org = app.currentOrg;
  const isPersonalOrg = Boolean(org && org.owner);
  // We allow copying out of a personal org.
  if (isPersonalOrg) { return true; }
  // Otherwise, it's a proper org. Allow copying out if the doc is public or if the user has
  // owner access to it. In case of a fork, it's the owner access to trunk that matters.
  if (doc.public || roles.canEditAccess(doc.trunkAccess || doc.access)) { return true; }
  // For non-public docs on a team site, non-privileged users are not allowed to copy them out.
  return false;
}


/**
 * Ask user for the destination and new name, and make a copy of the doc using those.
 */
export async function makeCopy(doc: Document, app: AppModel, modalTitle: string): Promise<void> {
  if (!app.currentValidUser) {
    signupModal(translate('ToSaveSignUpAndReload'));
    return;
  }
  let orgs = allowOtherOrgs(doc, app) ? await app.api.getOrgs(true) : null;
  if (orgs) {
    // Don't show the templates org since it's selected by default, and
    // is not writable to.
    orgs = orgs.filter(o => !isTemplatesOrg(o));
  }

  // Show a dialog with a form to select destination.
  saveModal((ctl, owner) => {
    const saveCopyModal = SaveCopyModal.create(owner, doc, app, orgs);
    return {
      title: modalTitle,
      body: saveCopyModal.buildDom(),
      saveFunc: () => saveCopyModal.save(),
      saveDisabled: saveCopyModal.saveDisabled,
      width: 'normal',
    };
  });
}

class SaveCopyModal extends Disposable {
  private _workspaces = Observable.create<Workspace[]|null>(this, null);
  private _destName = Observable.create<string>(this, '');
  private _destOrg = Observable.create<Organization|null>(this, this._app.currentOrg);
  private _destWS = Observable.create<Workspace|null>(this, this._doc.workspace);
  private _asTemplate = Observable.create<boolean>(this, false);
  private _saveDisabled = Computed.create(this, this._destWS, this._destName, (use, ws, name) =>
    (!name.trim() || !ws || !roles.canEdit(ws.access)));

  // Only show workspaces for team sites, since they are not a feature of personal orgs.
  private _showWorkspaces = Computed.create(this, this._destOrg, (use, org) => Boolean(org && !org.owner));

  // If orgs is non-null, then we show a selector for orgs.
  constructor(private _doc: Document, private _app: AppModel, private _orgs: Organization[]|null) {
    super();
    if (_doc.name !== 'Untitled') {
      this._destName.set(_doc.name + ' (copy)');
    }
    if (this._orgs && this._app.currentOrg) {
      // Set _destOrg to an Organization object from _orgs array; there should be one equivalent
      // to currentOrg, but we need the actual object for select() to recognize it as selected.
      const orgId = this._app.currentOrg.id;
      this._destOrg.set(this._orgs.find((org) => org.id === orgId) || this._orgs[0]);
    }
    this.autoDispose(subscribe(this._destOrg, (use, org) => this._updateWorkspaces(org).catch(reportError)));
  }

  public get saveDisabled() { return this._saveDisabled; }

  public async save() {
    const ws = this._destWS.get();
    if (!ws) { throw new Error(translate('NoDestinationWorkspace')); }
    const api = this._app.api;
    const org = this._destOrg.get();
    const docWorker = await api.getWorkerAPI('import');
    const destName = this._destName.get() + '.grist';
    try {
      const uploadId = await docWorker.copyDoc(this._doc.id, this._asTemplate.get(), destName);
      const {id} = await docWorker.importDocToWorkspace(uploadId, ws.id);
      await urlState().pushUrl({org: org?.domain || undefined, doc: id, docPage: urlState().state.get().docPage});
    } catch(err) {
      // Convert access denied errors to normal Error to make it consistent with other endpoints.
      // TODO: Should not allow to click this button when user doesn't have permissions.
      if (err.status === 403) {
        throw new Error(err.details.userError || err.message);
      }
      throw err;
    }
  }

  public buildDom() {
    return [
      cssField(
        cssLabel(translate("Name")),
        input(this._destName, {onInput: true}, {placeholder: translate('EnterDocumentName')},  dom.cls(cssInput.className),
          // modal dialog grabs focus after 10ms delay; so to focus this input, wait a bit longer
          // (see the TODO in app/client/ui2018/modals.ts about weasel.js and focus).
          (elem) => { setTimeout(() => { elem.focus(); }, 20); },
          dom.on('focus', (ev, elem) => { elem.select(); }),
          testId('copy-dest-name'))
      ),
      cssField(
        cssLabel(translate("AsTemplate")),
        cssCheckbox(this._asTemplate, translate('IncludeStructureWithoutData'),
          testId('save-as-template'))
      ),
      // Show the team picker only when saving to other teams is allowed and there are other teams
      // accessible.
      (this._orgs ?
        cssField(
          cssLabel(translate("Organization")),
          select(this._destOrg, this._orgs.map(value => ({value, label: value.name}))),
          testId('copy-dest-org'),
        ) : null
      ),
      // Don't show the workspace picker when destOrg is a personal site and there is just one
      // workspace, since workspaces are not a feature of personal orgs.
      // Show the workspace picker only when destOrg is a team site, because personal orgs do not have workspaces.
      dom.domComputed((use) => use(this._showWorkspaces) && use(this._workspaces), (wss) =>
        wss === false ? null :
        wss && wss.length === 0 ? cssWarningText(translate("NoWriteAccessToSite"),
          testId('copy-warning')) :
        [
          cssField(
            cssLabel(translate("Workspace")),
            (wss === null ?
              cssSpinner(loadingSpinner()) :
              select(this._destWS, wss.map(value => ({
                value,
                label: workspaceName(this._app, value),
                disabled: !roles.canEdit(value.access),
              })))
            ),
            testId('copy-dest-workspace'),
          ),
          wss ? dom.domComputed(this._destWS, (destWs) =>
            destWs && !roles.canEdit(destWs.access) ?
              cssWarningText(translate("NoWriteAccessToWorkspace"),
                testId('copy-warning')
              ) : null
          ) : null
        ]
      ),
    ];
  }

  /**
   * Fetch a list of workspaces for the given org, in the same order in which we list them in HomeModel,
   * and set this._workspaces to it. While fetching, this._workspaces is set to null.
   * Once fetched, we also set this._destWS.
   */
  private async _updateWorkspaces(org: Organization|null) {
    this._workspaces.set(null);     // Show that workspaces are loading.
    this._destWS.set(null);         // Disable saving while waiting to set a new destination workspace.
    try {
      let wss = org ? await this._app.api.getOrgWorkspaces(org.id) : [];
      if (this._destOrg.get() !== org) {
        // We must have switched the org. Don't update anything; in particularr, keep _workspaces
        // and _destWS as null, to show loading/save-disabled status. Let the new fetch update things.
        return;
      }
      // Sort the same way that HomeModel sorts workspaces.
      wss = sortBy(wss,
        (ws) => [ws.isSupportWorkspace, ownerName(this._app, ws).toLowerCase(), ws.name.toLowerCase()]);
      // Filter out isSupportWorkspace, since it's not writable and confusing to include.
      // (The support user creating a new example can just download and upload.)
      wss = wss.filter(ws => !ws.isSupportWorkspace);

      let defaultWS: Workspace|undefined;
      const showWorkspaces = (org && !org.owner);
      if (showWorkspaces) {
        // If we show a workspace selector, default to the current document's workspace (when its
        // org is selected) even if it's not writable. User can switch the workspace manually.
        defaultWS = wss.find(ws => (ws.id === this._doc.workspace.id));
      } else {
        // If the workspace selector is not shown (for personal orgs), prefer the user's default
        // Home workspace as long as its writable.
        defaultWS = wss.find(ws => getWorkspaceInfo(this._app, ws).isDefault && roles.canEdit(ws.access));
      }
      const firstWritable = wss.find(ws => roles.canEdit(ws.access));

      // If there is at least one destination available, set one as the current selection.
      // Otherwise, make it clear to the user that there are no options.
      if (firstWritable) {
        this._workspaces.set(wss);
        this._destWS.set(defaultWS || firstWritable);
      } else {
        this._workspaces.set([]);
        this._destWS.set(null);
      }
    } catch (e) {
      this._workspaces.set([]);
      this._destWS.set(null);
      throw e;
    }
  }
}

export const cssField = styled('div', `
  margin: 16px 0;
  display: flex;
`);

export const cssLabel = styled('label', `
  font-weight: normal;
  font-size: ${vars.mediumFontSize};
  color: ${theme.text};
  margin: 8px 16px 0 0;
  white-space: nowrap;
  width: 80px;
  flex: none;
`);

const cssWarningText = styled('div', `
  color: ${theme.errorText};
  margin-top: 8px;
`);

const cssSpinner = styled('div', `
  text-align: center;
  flex: 1;
  height: 30px;
`);

const cssCheckbox = styled(labeledSquareCheckbox, `
  margin-top: 8px;
`);
