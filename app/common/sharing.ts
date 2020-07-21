import {EncActionBundleFromHub} from 'app/common/EncActionBundle';

export const allToken: string = '#ALL';

/**
 * Messages received from SQS
 */
export interface Message {
  type: MessageType;
  content: Invite | EncActionBundleFromHub;
  docId: string; // The docId to which the message pertains.
}

export enum MessageType {
  invite = 1,
  accept,
  decline,
  action
}

export interface Invite {
  senderEmail: string;
  senderName?: string;
  docId: string;  // Indicates the doc to which the user is being invited to join.
  docName: string; // Indicates the docName at the time of sending for user doc recognition.
  isUnread?: boolean;
  isIgnored?: boolean;
}

/**
 * Contains information about someone who may or may not be a Grist user.
 */
export interface Peer {
  email: string;
  name?: string;
  instIds?: string[];
}

export interface EmailResult {
  email: string;
  instIds: string[];
  name?: string;
}
