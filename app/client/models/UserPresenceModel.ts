import {Comm} from 'app/client/components/Comm';
import {DocComm} from 'app/client/components/DocComm';
import {VisibleUserProfile} from 'app/common/ActiveDocAPI';
import {DisposableWithEvents} from 'app/common/DisposableWithEvents';
import {Disposable, Observable} from 'grainjs';
import {CommDocUserPresenceUpdate} from 'app/common/CommTypes';

export interface UserPresenceModel {
  userProfiles: Observable<VisibleUserProfile[]>;

  initialize(): Promise<void>;
}

export class UserPresenceModelImpl extends DisposableWithEvents implements UserPresenceModel {
  public userProfiles: Observable<VisibleUserProfile[]>;

  constructor(private _docComm: DocComm, private _comm: Comm) {
    super();
    this.userProfiles = Observable.create<VisibleUserProfile[]>(this, []);
    this.listenTo(this._comm, 'docUserPresenceUpdate', this._onUserPresenceUpdateMessage);
  }

  public async initialize(): Promise<void> {
    const userProfiles = await this._docComm.listActiveUserProfiles();
    this.userProfiles.set(userProfiles);
  }

  private _onUserPresenceUpdateMessage(message: CommDocUserPresenceUpdate) {
    const { data } = message;
    const newProfiles = this.userProfiles.get().slice();
    const index = newProfiles.findIndex((profileToCheck) => profileToCheck.id === data.id);
    if (!data.profile) {
      newProfiles.splice(index, 1);
    } else if (index < 0) {
      newProfiles.push(data.profile);
    } else {
      newProfiles[index] = data.profile;
    }
    this.userProfiles.set(newProfiles);
  }
}

export class UserPresenceModelStub extends Disposable implements UserPresenceModel {
  public userProfiles: Observable<VisibleUserProfile[]>;

  constructor() {
    super();
    this.userProfiles = Observable.create<VisibleUserProfile[]>(this, []);
  }

  public async initialize(): Promise<void> {}
}
