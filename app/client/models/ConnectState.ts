/**
 * The ConnectStateManager helper class helps maintain the connection state. A disconnect goes
 * through multiple stages, to inform the user of long disconnects while minimizing the disruption
 * for short ones. This class manages these timings, and triggers ConnectState changes.
 */
import {Disposable, Observable} from 'grainjs';

// Describes the connection state, which is shown as part of the notifications UI.
// See https://grist.quip.com/X92IAHZV3uoo/Notifications
export enum ConnectState { Connected, JustDisconnected, RecentlyDisconnected, ReallyDisconnected }

export class ConnectStateManager extends Disposable {
  // On disconnect, ConnectState changes to JustDisconnected. These intervals set how long after
  // the disconnect ConnectState should change to other values.
  public static timeToRecentlyDisconnected = 5000;
  public static timeToReallyDisconnected = 30000;

  public readonly connectState = Observable.create<ConnectState>(this, ConnectState.Connected);

  private _timers: Array<ReturnType<typeof setTimeout>> = [];

  public setConnected(yesNo: boolean) {
    if (yesNo) {
      this._timers.forEach((t) => clearTimeout(t));
      this._timers = [];
      this._setState(ConnectState.Connected);
    } else if (this.connectState.get() === ConnectState.Connected) {
      this._timers = [
        setTimeout(() => this._setState(ConnectState.RecentlyDisconnected),
                   ConnectStateManager.timeToRecentlyDisconnected),
        setTimeout(() => this._setState(ConnectState.ReallyDisconnected),
                   ConnectStateManager.timeToReallyDisconnected),
      ];
      this._setState(ConnectState.JustDisconnected);
    }
  }

  private _setState(state: ConnectState) {
    this.connectState.set(state);
  }
}
