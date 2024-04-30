import {SendGridConfig, SendGridMail} from 'app/gen-server/lib/NotifierTypes';

export interface INotifier {
  // for test purposes, check if any notifications are in progress
  readonly testPending: boolean;

  deleteUser(userId: number): Promise<void>;

  // Intercept outgoing messages for test purposes.
  // Return undefined if no notification system is available.
  testSetSendMessageCallback(op: (body: SendGridMail, description: string) => Promise<void>): SendGridConfig|undefined;
}

/**
 * A notifier that does nothing. Used when no email notifications are configured.
 */
export const EmptyNotifier: INotifier = {
  get testPending() { return false; },
  async deleteUser()      { /* do nothing */ },
  testSetSendMessageCallback() { return undefined; },
} as const;
