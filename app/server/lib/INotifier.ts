export interface INotifier {
  deleteUser(userId: number): Promise<void>;
  // for test purposes, check if any notifications are in progress
  readonly testPending: boolean;
}
