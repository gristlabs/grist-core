import {DisposableWithEvents} from 'app/common/DisposableWithEvents';
import {Disposable, Observable} from 'grainjs';

interface PresentUserDetails {
  name: string;
}

export interface UserPresenceModel {
  userDetails: Observable<PresentUserDetails[]>;
}

export class UserPresenceModelImpl extends DisposableWithEvents implements UserPresenceModel {
  public userDetails: Observable<PresentUserDetails[]>;

  constructor() {
    super();
    this.userDetails = Observable.create<PresentUserDetails[]>(this, [
      {
        name: "Samwise Gamgee"
      },
      {
        name: "Frodo Baggins"
      },
      {
        name: "Aragorn, Son of Arathorn"
      },
      {
        name: "Gandalf the Grey"
      },
      {
        name: "Meriadoc Brandybuck"
      },
    ]);
  }
}

export class UserPresenceModelStub extends Disposable implements UserPresenceModel {
  public userDetails: Observable<PresentUserDetails[]>;

  constructor() {
    super();
    this.userDetails = Observable.create<PresentUserDetails[]>(this, []);
  }
}
