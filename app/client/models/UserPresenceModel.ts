import {DisposableWithEvents} from 'app/common/DisposableWithEvents';
import {Disposable, Observable} from 'grainjs';
import {DocComm} from 'app/client/components/DocComm';
import {VisibleUserProfile} from 'app/common/ActiveDocAPI';

export interface UserPresenceModel {
  userProfiles: Observable<VisibleUserProfile[]>;

  initialize(): Promise<void>;
}

export class UserPresenceModelImpl extends DisposableWithEvents implements UserPresenceModel {
  public userProfiles: Observable<VisibleUserProfile[]>;

  constructor(private _docComm: DocComm) {
    super();
    this.userProfiles = Observable.create<VisibleUserProfile[]>(this, []);
  }

  public async initialize(): Promise<void> {
    const userProfiles = await this._docComm.listActiveUserProfiles();
    this.userProfiles.set(userProfiles);
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
