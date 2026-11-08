import { makeT } from "app/client/lib/localization";
import { getLoginUrl } from "app/client/lib/urlUtils";
import { getHomeUrl } from "app/client/models/homeUrl";
import { previewReferenceConnection } from "app/client/ui/ReferenceConnection";
import { basicButton, primaryButton } from "app/client/ui2018/buttons";
import { theme } from "app/client/ui2018/cssVars";
import { encodeUrl } from "app/common/gristUrls";
import { ReferenceTableAPI } from "app/common/ReferenceTableAPI";
import { DocAPIImpl, Document, Organization, UserAPIImpl } from "app/common/UserAPI";

import { Computed, Disposable, dom, input, Observable, select, styled } from "grainjs";

const t = makeT("ReferenceConnectionPage");
const pendingKey = "grist-reference-pending";

function clearPending() {
  try { sessionStorage.removeItem(pendingKey); } catch { /* Storage may be disabled. */ }
}

function readPending(): string {
  try {
    const pending = JSON.parse(sessionStorage.getItem(pendingKey) || "null");
    if (pending && typeof pending.url === "string" && pending.expires > Date.now()) { return pending.url; }
  } catch { /* Storage may be disabled or contain an obsolete value. */ }
  clearPending();
  return "";
}

export class ReferenceConnectionPage extends Disposable {
  private _api = new UserAPIImpl(getHomeUrl());
  private _url = Observable.create(this, readPending());
  private _orgs = Observable.create<Organization[]>(this, []);
  private _org = Observable.create(this, "");
  private _docs = Observable.create<Document[]>(this, []);
  private _doc = Observable.create(this, "");
  private _busy = Observable.create(this, false);
  private _signedIn = Observable.create(this, false);
  private _error = Observable.create(this, "");
  private _request = 0;

  constructor() {
    super();
    void this._run(async () => {
      const session = await this._api.getSessionActive();
      if (session.user.anonymous) { return; }
      this._signedIn.set(true);
      this._orgs.set(await this._api.getOrgs());
    });
    this.autoDispose(this._org.addListener(() => void this._loadDocs()));
  }

  public buildDom() {
    return cssPage(cssCard(
      dom("h1", t("Connect a shared reference")),
      dom("p", t("Choose a document you own, then preview the tables before connecting.")),
      dom("p", { role: "alert" }, dom.text(this._error)),
      dom.domComputed(this._signedIn, signedIn => signedIn ? [
        dom("label", t("Connection link"), input(this._url, { onInput: true },
          { type: "password", autocomplete: "off", spellcheck: "false" })),
        dom("label", t("Site"), select(this._org, Computed.create(this, use => [
          { value: "", label: t("Choose a site") },
          ...use(this._orgs).map(org => ({ value: String(org.id), label: org.name })),
        ]))),
        dom("label", t("Destination document"), select(this._doc, Computed.create(this, use => [
          { value: "", label: t("Choose a document") },
          ...use(this._docs).map(doc => ({ value: doc.id, label: `${doc.workspace.name} / ${doc.name}` })),
        ]))),
        dom("p", dom.show(use => Boolean(use(this._org)) && !use(this._busy) && !use(this._docs).length),
          t("No editable document owned by this account in this site.")),
        primaryButton(t("Preview"), dom.prop("disabled", use => use(this._busy) || !use(this._doc) || !use(this._url)),
          dom.on("click", () => void this._run(() => this._preview()))),
      ] : [
        dom("p", t("Sign in to choose a destination. The link stays in this tab for up to 30 minutes.")),
        primaryButton(t("Sign in"), dom.prop("disabled", this._busy), dom.on("click", () => {
          window.location.assign(getLoginUrl({ nextUrl: window.location.pathname }));
        })),
      ]),
      basicButton(t("Cancel"), dom.on("click", () => {
        clearPending();
        this._url.set("");
        window.location.assign(getHomeUrl());
      })),
    ));
  }

  private async _loadDocs() {
    const request = ++this._request;
    this._doc.set("");
    this._docs.set([]);
    const org = this._org.get();
    if (!org) { return; }
    await this._run(async () => {
      const workspaces = await this._api.getOrgWorkspaces(Number(org), false);
      if (request !== this._request || this.isDisposed()) { return; }
      this._docs.set(workspaces.flatMap(workspace => workspace.docs
        .filter(doc => doc.access === "owners" && !doc.readOnlyReason && !doc.removedAt)
        .map(doc => ({ ...doc, workspace }))));
    });
  }

  private async _preview() {
    const org = this._orgs.get().find(o => String(o.id) === this._org.get())!;
    const doc = this._docs.get().find(d => d.id === this._doc.get())!;
    const orgUrl = encodeUrl(window.gristConfig!, { org: org.domain || `o-${org.id}` }, window.location);
    const api = new ReferenceTableAPI(new DocAPIImpl(orgUrl.replace(/\/$/, ""), doc.id));
    const url = this._url.get().trim();
    const preview = await api.previewConnection(url);
    previewReferenceConnection(`${preview.name} → ${doc.name}`, preview, async (aliases) => {
      await api.connect(url, aliases, preview.contractVersion);
      clearPending();
      this._url.set("");
      window.location.assign(encodeUrl(window.gristConfig!,
        { org: org.domain || `o-${org.id}`, doc: doc.id }, window.location));
    }, preview.description);
  }

  private async _run(action: () => Promise<void>) {
    this._busy.set(true);
    this._error.set("");
    try { await action(); } catch {
      // A pasted credential must never enter generic error reporting or telemetry.
      this._error.set(t("Unable to continue. Check the link, your permissions and the connection, then try again."));
    } finally { this._busy.set(false); }
  }
}

const cssPage = styled("main", `
  min-height: 100vh; padding: 48px 20px; background: ${theme.pageBg}; color: ${theme.text};
  display: flex; align-items: flex-start; justify-content: center;
`);
const cssCard = styled("div", `
  width: 100%; max-width: 620px; display: flex; flex-direction: column; gap: 16px;
  & label { display: flex; flex-direction: column; gap: 8px; }
`);
