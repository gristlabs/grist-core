/**
 * Basic definitions of types needed for ActionBundles.
 * See also EncActionBundle for how these are packaged for encryption.
 */

import { ApplyUAOptions } from "app/common/ActiveDocAPI";
import { DocAction, UserAction } from "app/common/DocActions";
import { RowCounts } from "app/common/DocUsage";

// Metadata about the action.
export interface ActionInfo {
  time: number;       // Milliseconds since epoch.
  user: string;
  inst: string;
  desc?: string;
  otherId: number;
  linkId: number;
}

// Envelope contains information about recipients. In EncActionBundle, it's augmented with
// information about the symmetric key that encrypts this envelope's contents.
export interface Envelope {
  recipients: string[];       // sorted array of recipient instanceIds
}

// EnvContent packages arbitrary content with the index of the envelope to which it belongs.
export type EnvContent<Content> = [number, Content];

// ActionBundle contains actions arranged into envelopes, i.e. split up by sets of recipients.
// Note that different Envelopes contain different sets of recipients (which may overlap however).
// ActionBundle is what gets encrypted/decrypted and then sent between hub and instance.
export interface ActionBundle {
  actionNum: number;
  actionHash: string | null;        // a checksum of bundle, (not including actionHash and other parts).
  parentActionHash: string | null;  // a checksum of the parent action bundle, if there is one.
  envelopes: Envelope[];
  info: EnvContent<ActionInfo>;           // Should be in the envelope addressed to all peers.
  stored: EnvContent<DocAction>[];
  calc: EnvContent<DocAction>[];
}

export function getEnvContent<Content>(items: EnvContent<Content>[]): Content[] {
  return items.map(item => item[1]);
}

// ======================================================================
// Types for ActionBundles used locally inside an instance.

// Local action received from the browser, that is not yet applied. It is usually one UserAction,
// but when multiple actions are sent by the browser in one call, they will form one bundle.
export interface UserActionBundle {
  info: ActionInfo;
  userActions: UserAction[];
  options?: ApplyUAOptions;
}

// ActionBundle as received from the sandbox. It does not have some action metadata, but does have
// undo information and a retValue for each input UserAction. Note that it is satisfied by the
// ActionBundle structure defined in sandbox/grist/action_obj.py.
export interface SandboxActionBundle {
  envelopes: Envelope[];
  stored: EnvContent<DocAction>[];
  direct: EnvContent<boolean>[];
  calc: EnvContent<DocAction>[];
  undo: EnvContent<DocAction>[];   // Inverse actions for all 'stored' actions.
  // Parallel to 'undo': the index into 'stored' of the action that produced each undo action, as
  // the engine knows it directly, or null for a front calc-flush restore that the summarizer
  // attributes for itself. Lets the summarizer chunk a bundle without re-inferring the grouping
  // (see app/common/ActionLayout.ts chunkByOwners). Enveloped like the other parallel arrays,
  // though the index is global to the bundle; flattened into LocalActionBundle alongside 'undo'.
  undoOwner?: EnvContent<number | null>[];
  retValues: any[];                     // Contains retValue for each of userActions.
  rowCount: RowCounts;
  // Mapping of keys (hashes of request args) to all unique requests made in a round of calculation
  requests?: Record<string, SandboxRequest>;

  // Optionally we can measure and include how many bytes it took to represent this bundle.
  numBytes?: number;
}

// Represents a unique call to the Python REQUEST function
export interface SandboxRequest {
  url: string;
  method: string;
  body?: string;
  params: Record<string, string> | null;
  headers: Record<string, string> | null;
  deps: unknown;  // pass back to the sandbox unchanged in the response
}

// Local action that's been applied. It now has an actionNum, and includes doc actions packaged
// into envelopes, as well as undo, and userActions, which allow rebasing.
export interface LocalActionBundle extends ActionBundle {
  userActions: UserAction[];

  // Inverse actions for all 'stored' actions. These aren't shared and not split by envelope.
  // Applying 'undo' is governed by EDIT rather than READ permissions, so we always apply all undo
  // actions. (It is the result of applying 'undo' that may be addressed to different recipients).
  undo: DocAction[];

  // Parallel to 'undo': the stored-action index each undo corresponds to (or null), as reported
  // by the engine. Absent on bundles produced before this was recorded, and on bundles assembled
  // without the data engine; the summarizer then falls back to inferring the grouping. Persisted
  // with the bundle in the action history, and folded into the action hash when present (see
  // computeActionHash) so it is covered by the checksum.
  undoOwner?: (number | null)[];
}
