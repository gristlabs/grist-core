/**
 * Types for encrypted ActionBundles that get sent between instances and hub.
 */

import {ActionInfo, Envelope} from 'app/common/ActionBundle';
import {DocAction} from 'app/common/DocActions';

// Type representing a point in time as milliseconds since Epoch.
export type Timestamp = number;

// Type representing binary data encoded as a base64 string.
export type Base64String = string;

// Metadata about a symmetric encryption key.
export interface KeyInfo {
  firstActionNum: number;     // ActionNum of first action for which this key was used.
  firstUsedTime: Timestamp;   // Timestamp of first action for which this key was used.
}

// Encrypted symmetric key with metadata, sent from hub to instance with each envelope.
export interface EncKeyInfo extends KeyInfo {
  encryptedKey: Base64String; // Symmetric key encrypted with the recipient's public key.
}

// Bundle of encryptions of the symmetric key. Note that the hub will store EncKeyBundles for
// lookup, indexed by the combination {recipients: string[], firstActionNum: number}.
export interface EncKeyBundle extends KeyInfo {
  encryptedKeys: {
    // Map of instanceId to the symmetric key encrypted with that instance's public key.
    // A single symmetric key is used for all, and only present here in encrypted form.
    [instanceId: string]: Base64String;
  };
}

// This allows reorganizing ActionBundle by envelope while preserving order information for
// actions. E.g. if ActionBundle contains {stored: [(0,A), (1,B), (2,C), (0,D)], then we'll have:
//    - in envelopes 0: {stored: [[0, A], [3, D]]}
//    - in envelopes 1: {stored: [[1, B]]}
//    - in envelopes 2: {stored: [[2, C]]}
// Then recipients of multiple envelopes can sort actions by index to get their correct order.
export interface DecryptedEnvelopeContent {
  info?: ActionInfo;
  // number is the index into the bundle-wide array of 'stored' or 'calc' DocActions.
  stored: Array<[number, DocAction]>;
  calc: Array<[number, DocAction]>;
}

export type DecryptedEnvelope = Envelope & DecryptedEnvelopeContent;

// Sent from instance to hub.
export interface EncEnvelopeToHub extends Envelope {
  encKeyReused?: number;        // If reusing a key, firstActionNum of the key being reused.
  encKeyBundle?: EncKeyBundle;  // If created a new key, its encryption for all recipients.
  content: Base64String;        // Marshalled and encrypted DecryptedEnvelopeContent as a base64 string.
}

// Sent from hub to instance.
export interface EncEnvelopeFromHub extends Envelope {
  encKeyInfo: EncKeyInfo;
  content: Base64String;        // Marshalled and encrypted DecryptedEnvelopeContent as a base64 string.
}

// EncActionBundle is an encrypted version of ActionBundle. It comes in two varieties, one for
// sending ActionBundle to the hub, and one for receiving from the hub.
export interface EncActionBundle<EncEnvelope> {
  actionNum: number;
  actionHash: string|null;
  parentActionHash: string|null;
  envelopes: EncEnvelope[];
}

export type EncActionBundleToHub = EncActionBundle<EncEnvelopeToHub>;
export type EncActionBundleFromHub = EncActionBundle<EncEnvelopeFromHub>;
