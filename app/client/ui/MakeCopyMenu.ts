/**
 * Link or button that opens a menu to make a copy of a document, full or empty. It's used for
 * the sample documents (those in the Support user's Examples & Templates workspace).
 */

import {hooks} from 'app/client/Hooks';
import {makeT} from 'app/client/lib/localization';
import {AppModel, reportError} from 'app/client/models/AppModel';
import {DocPageModel} from 'app/client/models/DocPageModel';
import {urlState} from 'app/client/models/gristUrlState';
import {getWorkspaceInfo, ownerName, workspaceName} from 'app/client/models/WorkspaceInfo';
import {cssInput} from 'app/client/ui/cssInput';
import {bigBasicButton, bigPrimaryButtonLink} from 'app/client/ui2018/buttons';
import {cssRadioCheckboxOptions, labeledSquareCheckbox, radioCheckboxOption} from 'app/client/ui2018/checkbox';
import {testId, theme, vars} from 'app/client/ui2018/cssVars';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {select} from 'app/client/ui2018/menus';
import {confirmModal, cssModalBody, cssModalButtons, cssModalTitle, modal, saveModal} from 'app/client/ui2018/modals';
import * as roles from 'app/common/roles';
import {Document, isTemplatesOrg, Organization, Workspace} from 'app/common/UserAPI';
import {Computed, Disposable, dom, input, Observable, styled, subscribe} from 'grainjs';
import sortBy = require('lodash/sortBy');

const t = makeT('MakeCopyMenu');

export async function replaceTrunkWithFork(doc: Document, pageModel: DocPageModel, origUrlId: string) {
  const {appModel} = pageModel;
  const trunkAccess = (await appModel.api.getDoc(origUrlId)).access;
  if (!roles.canEdit(trunkAccess)) {
    modal((ctl) => [
      cssModalBody(t("Replacing the original requires editing rights on the original document.")),
      cssModalButtons(
        bigBasicButton(t("Cancel"), dom.on('click', () => ctl.close())),
      )
    ]);
    return;
  }
  const docApi = appModel.api.getDocAPI(origUrlId);
  const cmp = await docApi.compareDoc(doc.id);
  let titleText = t("Update Original");
  let buttonText = t("Update");
  let warningText = t("The original version of this document will be updated.");
  if (cmp.summary === 'left' || cmp.summary === 'both') {
    titleText = t("Original Has Modifications");
    buttonText = t("Overwrite");
    warningText = `${warningText} ${t("Be careful, the original has changes \
not in this document. Those changes will be overwritten.")}`;
  } else if (cmp.summary === 'unrelated') {
    titleText = t("Original Looks Unrelated");
    buttonText = t("Overwrite");
    warningText = `${warningText} ${t("It will be overwritten, losing any content not in this document.")}`;
  } else if (cmp.summary === 'same') {
    titleText = t('Original Looks Identical');
    warningText = `${warningText} ${t("However, it appears to be already identical.")}`;
  }
  confirmModal(titleText, buttonText,
    async () => {
      try {
        await docApi.replace({sourceDocId: doc.id});
        pageModel.clearUnsavedChanges();
        await urlState().pushUrl({doc: origUrlId});
      } catch (e) {
        reportError(e);  // For example: no write access on trunk.
      }
    }, {explanation: warningText});
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
export async function makeCopy(options: {
  pageModel: DocPageModel,
  doc: Document,
  modalTitle: string,
}): Promise<void> {
  const {pageModel, doc, modalTitle} = options;
  const {appModel} = pageModel;
  let orgs = allowOtherOrgs(doc, appModel) ? await appModel.api.getOrgs(true) : null;
  if (orgs) {
    // Don't show the templates org since it's selected by default, and
    // is not writable to.
    orgs = orgs.filter(o => !isTemplatesOrg(o));
  }

  // Show a dialog with a form to select destination.
  saveModal((ctl, owner) => {
    const saveCopyModal = SaveCopyModal.create(owner, {pageModel, doc, orgs});
    return {
      title: modalTitle,
      body: saveCopyModal.buildDom(),
      saveFunc: () => saveCopyModal.save(),
      saveDisabled: saveCopyModal.saveDisabled,
      width: 'normal',
    };
  });
}

interface SaveCopyModalParams {
  pageModel: DocPageModel;
  doc: Document;
  orgs: Organization[]|null;
}

class SaveCopyModal extends Disposable {
  private _pageModel = this._params.pageModel;
  private _app = this._pageModel.appModel;
  private _doc = this._params.doc;
  private _orgs = this._params.orgs;
  private _workspaces = Observable.create<Workspace[]|null>(this, null);
  private _destName = Observable.create<string>(this, '');
  private _destOrg = Observable.create<Organization|null>(this, this._app.currentOrg);
  private _destWS = Observable.create<Workspace|null>(this, this._doc.workspace);
  private _asTemplate = Observable.create<boolean>(this, false);
  private _saveDisabled = Computed.create(this, this._destWS, this._destName, (use, ws, name) =>
    (!name.trim() || !ws || !roles.canEdit(ws.access)));

  private _showWorkspaces = Computed.create(this, this._destOrg, (use, org) => {
    // Workspace are available for personal and team sites now, but there are legacy sites without it.
    // Make best effort to figure out if they are disabled, but if we don't have the info, show the selector.
    if (!org) {
      return false;
    }
    // We won't have info about any other org except the one we are at.
    if (org.id === this._app.currentOrg?.id) {
      const workspaces = this._app.currentOrg.billingAccount?.product.features.workspaces ?? true;
      const numberAllowed = this._app.currentOrg.billingAccount?.product.features.maxWorkspacesPerOrg ?? 2;
      return workspaces && numberAllowed > 1;
    }
    return true;
  });

  // If orgs is non-null, then we show a selector for orgs.
  constructor(private _params: SaveCopyModalParams) {
    super();
    if (this._doc.name !== 'Untitled') {
      this._destName.set(this._doc.name + ' (copy)');
    }
    if (this._orgs && this._app.currentOrg) {
      // Set _destOrg to an Organization object from _orgs array; there should be one equivalent
      // to currentOrg, but we need the actual object for select() to recognize it as selected.
      const orgId = this._app.currentOrg.id;
      const newOrg = this._orgs.find((org) => org.id === orgId) || this._orgs[0];
      this._destOrg.set(newOrg);
    }
    this.autoDispose(subscribe(this._destOrg, (use, org) => this._updateWorkspaces(org).catch(reportError)));
  }

  public get saveDisabled() { return this._saveDisabled; }

  public async save() {
    const ws = this._destWS.get();
    if (!ws) { throw new Error(t("No destination workspace")); }
    const api = this._app.api;
    const org = this._destOrg.get();
    const destName = this._destName.get();
    try {
      const doc = await api.copyDoc(this._doc.id, ws.id, {
        documentName: destName,
        asTemplate: this._asTemplate.get(),
      });
      this._pageModel.clearUnsavedChanges();
      await urlState().pushUrl({org: org?.domain || undefined, doc, docPage: urlState().state.get().docPage});
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
        cssLabel(t("Name")),
        input(this._destName, {onInput: true}, {placeholder: t("Enter document name")},  dom.cls(cssInput.className),
          // modal dialog grabs focus after 10ms delay; so to focus this input, wait a bit longer
          // (see the TODO in app/client/ui2018/modals.ts about weasel.js and focus).
          (elem) => { setTimeout(() => { elem.focus(); }, 20); },
          dom.on('focus', (ev, elem) => { elem.select(); }),
          testId('copy-dest-name'))
      ),
      cssField(
        cssLabel(t("As Template")),
        cssCheckbox(this._asTemplate, t("Include the structure without any of the data."),
          testId('save-as-template'))
      ),
      // Show the team picker only when saving to other teams is allowed and there are other teams
      // accessible.
      (this._orgs ?
        cssField(
          cssLabel(t("Organization")),
          select(this._destOrg, this._orgs.map(value => ({value, label: value.name}))),
          testId('copy-dest-org'),
        ) : null
      ),
      // Don't show the workspace picker when destOrg is a personal site and there is just one
      // workspace, since workspaces are not a feature of personal orgs.
      // Show the workspace picker only when destOrg is a team site, because personal orgs do not have workspaces.
      dom.domComputed((use) => use(this._showWorkspaces) && use(this._workspaces), (wss) =>
        wss === false ? null :
        wss && wss.length === 0 ? cssWarningText(t("You do not have write access to this site"),
          testId('copy-warning')) :
        [
          cssField(
            cssLabel(t("Workspace")),
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
              cssWarningText(t("You do not have write access to the selected workspace"),
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

type DownloadOption = 'full' | 'nohistory' | 'template';

export function downloadDocModal(doc: Document, pageModel: DocPageModel) {
  return modal((ctl, owner) => {
    const selected = Observable.create<DownloadOption>(owner, 'full');

    return [
      cssModalTitle(t(`Download document`)),
      cssRadioCheckboxOptions(
          radioCheckboxOption(selected, 'full', t("Download full document and history")),
          radioCheckboxOption(selected, 'nohistory', t("Remove document history (can significantly reduce file size)")),
          radioCheckboxOption(selected, 'template', t("Remove all data but keep the structure to use as a template")),
      ),
      cssModalButtons(
        dom.domComputed(use =>
          bigPrimaryButtonLink(t(`Download`), hooks.maybeModifyLinkAttrs({
              href: pageModel.appModel.api.getDocAPI(doc.id).getDownloadUrl({
                template: use(selected) === "template",
                removeHistory: use(selected) === "nohistory" || use(selected) === "template",
              }),
              target: '_blank',
              download: ''
            }),
            dom.on('click', () => {
              ctl.close();
            }),
            testId('download-button-link'),
          ),
        ),
        bigBasicButton(t('Cancel'), dom.on('click', () => {
          ctl.close();
        }))
      )
    ];
  });
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
