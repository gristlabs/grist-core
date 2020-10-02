/**
 * When app.html is fetched, the results for the API calls for getDoc() and getWorker() are
 * embedded into the page using window.gristConfig object. When making these calls on the client,
 * we check gristConfig to see if we can use these cached values.
 *
 * Usage is simply:
 *  getDoc(api, docId)
 *  getWorker(api, assignmentId)
 *
 * The cached value is used once only (and reset in gristConfig) and only if marked with a recent
 * timestamp. This optimizes the case of loading the page. On subsequent use, these calls will
 * translate to the usual api.getDoc(), api.getWorker() calls.
 */
import {urlState} from 'app/client/models/gristUrlState';
import {getWeakestRole} from 'app/common/roles';
import {getGristConfig} from 'app/common/urlUtils';
import {Document, UserAPI} from 'app/common/UserAPI';

// tslint:disable:no-console


const MaxGristConfigAgeMs = 5000;

export async function getDoc(api: UserAPI, docId: string): Promise<Document> {
  const value = findAndResetInGristConfig('getDoc', docId);
  const result = await (value || api.getDoc(docId));
  const mode = urlState().state.get().mode;
  if (mode === 'view') {
    // This mode will be honored by the websocket; here we make sure the rest of the
    // client knows about it too.
    result.access = getWeakestRole(result.access, 'viewers');
  }
  return result;
}

export async function getWorker(api: UserAPI, assignmentId: string): Promise<string> {
  const value = findAndResetInGristConfig('getWorker', assignmentId);
  return value || api.getWorker(assignmentId);
}

type CallType = "getDoc" | "getWorker";

function findAndResetInGristConfig(method: "getDoc", id: string): Document|null;
function findAndResetInGristConfig(method: "getWorker", id: string): string|null;
function findAndResetInGristConfig(method: CallType, id: string): any {
  const gristConfig = getGristConfig();
  const methodCache = gristConfig[method];
  if (!methodCache || !methodCache[id]) {
    console.log(`gristConfigCache ${method}[${id}]: not found`);
    return null;
  }
  // Ignores difference between client and server timestamps, but doing better seems difficult.
  const timeSinceServer = Date.now() - gristConfig.timestampMs;
  if (timeSinceServer >= MaxGristConfigAgeMs) {
    console.log(`gristConfigCache ${method}[${id}]: ${gristConfig.timestampMs} is stale (${timeSinceServer})`);
    return null;
  }
  const value = methodCache[id];
  delete methodCache[id];         // To be used only once.
  console.log(`gristConfigCache ${method}[${id}]: found and deleted value`, value);
  return value;
}
