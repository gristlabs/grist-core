import {FullUser} from 'app/common/UserAPI';
import {Disposable} from 'grainjs';

export class MFAConfig extends Disposable {
  constructor(_user: FullUser) { super(); }

  public buildDom() { return null; }
}
