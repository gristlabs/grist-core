import {homeImports} from 'app/client/ui/HomeImports';
import {makeT} from 'app/client/lib/localization';
import {docUrl, urlState} from 'app/client/models/gristUrlState';
import {HomeModel} from 'app/client/models/HomeModel';
import {ImportSourceElement} from 'app/client/lib/ImportSourceElement';
import {reportError} from 'app/client/models/AppModel';

const t = makeT('CoreNewDocMethods');

export async function createDocAndOpen(home: HomeModel) {
  const destWS = home.newDocWorkspace.get();
  if (!destWS) { return; }
  try {
    const docId = await home.createDoc(t("Untitled document"), destWS === "unsaved" ? "unsaved" : destWS.id);
    // Fetch doc information including urlId.
    // TODO: consider changing API to return same response as a GET when creating an
    // object, which is a semi-standard.
    const doc = await home.app.api.getDoc(docId);
    await urlState().pushUrl(docUrl(doc));
  } catch (err) {
    reportError(err);
  }
}

export async function importDocAndOpen(home: HomeModel) {
  const destWS = home.newDocWorkspace.get();
  if (!destWS) { return; }
  const docId = await homeImports.docImport(home.app, destWS === "unsaved" ? "unsaved" : destWS.id);
  if (docId) {
    const doc = await home.app.api.getDoc(docId);
    await urlState().pushUrl(docUrl(doc));
  }
}

export async function importFromPluginAndOpen(home: HomeModel, source: ImportSourceElement) {
  try {
    const destWS = home.newDocWorkspace.get();
    if (!destWS) { return; }
    const docId = await homeImports.importFromPlugin(
      home.app,
      destWS === "unsaved" ? "unsaved" : destWS.id,
      source);
    if (docId) {
      const doc = await home.app.api.getDoc(docId);
      await urlState().pushUrl(docUrl(doc));
    }
  } catch (err) {
    reportError(err);
  }
}
